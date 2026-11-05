import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Dexie from "dexie";
import { unzipSync, zipSync, strToU8 } from "fflate";
import {
  blankPerson,
  now,
  uid,
  validDate,
  validateGraph,
  validateSnapshot,
  visiblePeople,
  relativesOf,
  duplicatePeople,
  type Person,
  type Relation,
  type Bundle,
} from "../src/domain";
import {
  db,
  FamilyDB,
  createTree,
  savePerson,
  saveRelation,
  deletePerson,
  snapshotTree,
  restoreBundle,
  loadDemo,
} from "../src/db";
import { makeBackup, readBackup, sha256 } from "../src/backup";

const edge = (
  a: Person,
  b: Person,
  kind: Relation["kind"] = "biological",
): Relation => ({
  id: uid(),
  treeId: a.treeId,
  fromId: a.id,
  toId: b.id,
  kind,
  startDate: "",
  endDate: "",
  endReason: "",
  notes: "",
  createdAt: now(),
});
beforeEach(async () => {
  await db.open();
  await db.transaction("rw", db.tables, async () => {
    for (const table of db.tables) await table.clear();
  });
});
afterEach(() => db.close());
async function fixture() {
  const tree = await loadDemo();
  const p = (await db.people.where("treeId").equals(tree.id).toArray())[0];
  const bytes = strToU8("A family memory. Names: Léa, Tshilidzi, 李.");
  const asset = {
    id: uid(),
    treeId: tree.id,
    personId: p.id,
    name: "memory.txt",
    type: "text/plain" as const,
    size: bytes.length,
    sha256: await sha256(bytes),
    blob: new Blob([bytes]),
  };
  await db.media.add(asset);
  return snapshotTree(tree.id);
}

describe("family graph rules", () => {
  it.each(["", "1945", "1945-02", "2000-02-29", "0096-02-29"])(
    "accepts partial or valid dates: %s",
    (value) => expect(validDate(value)).toBe(true),
  );
  it.each([
    "1945-13",
    "1945-02-30",
    "1900-02-29",
    "0000",
    "1945-1",
    "yesterday",
  ])("rejects invalid dates: %s", (value) =>
    expect(validDate(value)).toBe(false),
  );
  it("rejects an ancestor cycle across biological and adoptive links", () => {
    const tree = uid(),
      [a, b, c] = [0, 1, 2].map(() => blankPerson(tree));
    expect(() =>
      validateGraph(
        [a, b, c],
        [edge(a, b), edge(b, c, "adoptive"), edge(c, a)],
        tree,
      ),
    ).toThrow(/cycle/);
  });
  it("allows multiple partnerships and adoption without inventing parentage", () => {
    const tree = uid(),
      [a, b, c, d] = [0, 1, 2, 3].map(() => blankPerson(tree));
    expect(() =>
      validateGraph(
        [a, b, c, d],
        [edge(a, b, "marriage"), edge(a, c, "partner"), edge(a, d, "adoptive")],
        tree,
      ),
    ).not.toThrow();
  });
  it("rejects self relationships and missing references", () => {
    const tree = uid(),
      a = blankPerson(tree),
      b = blankPerson(tree);
    expect(() => validateGraph([a], [edge(a, a)], tree)).toThrow(/themselves/);
    expect(() => validateGraph([a], [edge(a, b)], tree)).toThrow(/missing/);
  });
  it("rejects reverse duplicate partnerships", () => {
    const tree = uid(),
      a = blankPerson(tree),
      b = blankPerson(tree);
    expect(() =>
      validateGraph(
        [a, b],
        [edge(a, b, "marriage"), edge(b, a, "marriage")],
        tree,
      ),
    ).toThrow(/already exists/);
  });
  it("keeps shared descendants visible through another expanded branch", () => {
    const tree = uid(),
      [a, b, c, d] = [0, 1, 2, 3].map(() => blankPerson(tree));
    const links = [edge(a, b), edge(a, c), edge(b, d), edge(c, d)];
    expect(
      visiblePeople(a.id, links, "descendants", 4, new Set([b.id])).has(d.id),
    ).toBe(true);
  });
  it("does not assert half siblings when other parents are unknown", () => {
    const tree = uid(),
      [a, b, c] = [0, 1, 2].map(() => blankPerson(tree));
    const result = relativesOf(b.id, [a, b, c], [edge(a, b), edge(a, c)]);
    expect(result.find((r) => r.person.id === c.id)?.label).toMatch(
      /incomplete/,
    );
  });
  it("warns about possible duplicate people without equating their IDs", () => {
    const t = uid(),
      a = { ...blankPerson(t), givenName: "Léa", surname: "Willow" },
      b = { ...blankPerson(t), givenName: "Léa", surname: "Willow" };
    expect(duplicatePeople(a, [b])).toHaveLength(1);
  });
});
describe("transactional storage", () => {
  it("persists a person across closing and reopening the database", async () => {
    const t = await createTree("Test family");
    const p = await savePerson({ ...blankPerson(t.id), givenName: "Thandi" });
    db.close();
    await db.open();
    expect((await db.people.get(p.id))?.givenName).toBe("Thandi");
  });
  it("rejects stale edits from another tab", async () => {
    const t = await createTree("Test");
    const p = await savePerson(blankPerson(t.id));
    await savePerson({ ...p, givenName: "New name" });
    await expect(savePerson({ ...p, givenName: "Stale" })).rejects.toThrow(
      /another tab/,
    );
    expect((await db.people.get(p.id))?.givenName).toBe("New name");
  });
  it("rolls back a new relative when its link is invalid", async () => {
    const t = await createTree("Test");
    const p = blankPerson(t.id);
    await expect(savePerson(p, edge(p, p))).rejects.toThrow();
    expect(await db.people.count()).toBe(0);
    expect((await db.trees.get(t.id))?.revision).toBe(0);
  });
  it("deletes a person and links but keeps their descendants", async () => {
    const t = await createTree("Test");
    const a = await savePerson(blankPerson(t.id)),
      b = await savePerson(blankPerson(t.id));
    await saveRelation(edge(a, b));
    await deletePerson(a);
    expect(await db.people.get(b.id)).toBeDefined();
    expect(await db.relations.count()).toBe(0);
  });
  it("migrates a version 1 database without losing records", async () => {
    const name = `migration-${uid()}`;
    const old = new Dexie(name);
    old.version(1).stores({
      trees: "id,updatedAt",
      people: "id,treeId,[treeId+surname]",
      relations: "id,treeId,fromId,toId",
      media: "id,treeId,personId",
      backups: "id,treeId,createdAt",
    });
    const id = uid();
    await old.table("trees").add({
      id,
      name: "Legacy",
      createdAt: now(),
      updatedAt: now(),
      description: "",
    });
    old.close();
    const current = new FamilyDB(name);
    await current.open();
    expect((await current.trees.get(id))?.revision).toBe(0);
    expect((await current.trees.get(id))?.name).toBe("Legacy");
    current.close();
    await Dexie.delete(name);
  });
});
describe("portable backups and recovery", () => {
  it("imports maximum-length tree names without producing an unexportable tree", async () => {
    const original = await fixture();
    original.data.tree.name = "A".repeat(120);
    const restored = await restoreBundle(original);
    expect(restored.name.length).toBeLessThanOrEqual(120);
    await expect(
      makeBackup(await snapshotTree(restored.id)),
    ).resolves.toBeDefined();
  });
  it("refuses a tampered bundle at the storage boundary before replacement", async () => {
    const original = await fixture();
    const id = original.data.media[0].id;
    const changed = original.assets.get(id)!.slice();
    changed[0] ^= 1;
    original.assets.set(id, changed);
    await expect(
      restoreBundle(original, {
        id: original.data.tree.id,
        revision: original.data.tree.revision,
      }),
    ).rejects.toThrow(/integrity/);
    expect(await db.people.count()).toBe(original.data.people.length);
  });
  it("round trips every record and attachment byte", async () => {
    const original = await fixture();
    const prepared = await makeBackup(original);
    const parsed = await readBackup(prepared.bytes);
    expect(parsed.data).toEqual(original.data);
    for (const [id, bytes] of original.assets)
      expect(parsed.assets.get(id)).toEqual(bytes);
  });
  it("round trips an encrypted backup and rejects the wrong passphrase", async () => {
    const original = await fixture();
    const prepared = await makeBackup(original, "a long test passphrase");
    expect(prepared.filename).toMatch(/ftbackup$/);
    expect(
      (await readBackup(prepared.bytes, "a long test passphrase")).data,
    ).toEqual(original.data);
    await expect(
      readBackup(prepared.bytes, "a wrong test passphrase"),
    ).rejects.toThrow(/wrong|damaged/);
  });
  it("detects altered ciphertext", async () => {
    const prepared = await makeBackup(
      await fixture(),
      "a long test passphrase",
    );
    const bytes = prepared.bytes.slice();
    bytes[bytes.length - 8] ^= 1;
    await expect(readBackup(bytes, "a long test passphrase")).rejects.toThrow(
      /damaged/,
    );
  });
  it("rejects damaged JSON even when the ZIP remains readable", async () => {
    const prepared = await makeBackup(await fixture());
    const files = unzipSync(prepared.bytes);
    files["family.json"] = strToU8("{}");
    await expect(readBackup(zipSync(files))).rejects.toThrow(/integrity/);
  });
  it("rejects a missing attachment", async () => {
    const prepared = await makeBackup(await fixture());
    const files = unzipSync(prepared.bytes);
    delete files[Object.keys(files).find((n) => n.startsWith("media/"))!];
    await expect(readBackup(zipSync(files))).rejects.toThrow(/integrity/);
  });
  it("rejects future backup formats without changing the database", async () => {
    const prepared = await makeBackup(await fixture()),
      before = await db.people.count();
    const files = unzipSync(prepared.bytes);
    const manifest = JSON.parse(
      new TextDecoder().decode(files["manifest.json"]),
    );
    manifest.version = 99;
    files["manifest.json"] = strToU8(JSON.stringify(manifest));
    await expect(readBackup(zipSync(files))).rejects.toThrow(/unsupported/);
    expect(await db.people.count()).toBe(before);
  });
  it("rejects unsafe archive paths and arbitrary files", async () => {
    const prepared = await makeBackup(await fixture());
    const files = unzipSync(prepared.bytes);
    files["../outside.txt"] = strToU8("bad");
    await expect(readBackup(zipSync(files))).rejects.toThrow(/unsafe path/);
  });
  it("imports a separate tree and remaps every reference", async () => {
    const original = await fixture();
    const restored = await restoreBundle(
      await readBackup((await makeBackup(original)).bytes),
    );
    const copy = await snapshotTree(restored.id);
    expect(restored.id).not.toBe(original.data.tree.id);
    expect(copy.data.people).toHaveLength(original.data.people.length);
    expect(copy.data.relations).toHaveLength(original.data.relations.length);
    expect(() => validateSnapshot(copy.data)).not.toThrow();
    expect(await db.trees.count()).toBe(2);
    const originalIds = new Set(original.data.people.map((p) => p.id));
    expect(copy.data.people.every((p) => !originalIds.has(p.id))).toBe(true);
    expect([...copy.assets.values()]).toEqual([...original.assets.values()]);
  });
  it("restores onto an empty database like a different browser profile", async () => {
    const original = await fixture(),
      bytes = (await makeBackup(original, "portable test passphrase")).bytes;
    await db.transaction("rw", db.tables, async () => {
      for (const table of db.tables) await table.clear();
    });
    const restored = await restoreBundle(
      await readBackup(bytes, "portable test passphrase"),
    );
    const copy = await snapshotTree(restored.id);
    expect(copy.data.people.map((p) => p.givenName).sort()).toEqual(
      original.data.people.map((p) => p.givenName).sort(),
    );
    expect([...copy.assets.values()]).toEqual([...original.assets.values()]);
  });
  it("refuses replacement when the destination changed after preview", async () => {
    const original = await fixture();
    const target = {
      id: original.data.tree.id,
      revision: original.data.tree.revision,
    };
    await savePerson({
      ...blankPerson(target.id),
      givenName: "Added after preview",
    });
    await expect(restoreBundle(original, target)).rejects.toThrow(
      /changed after preview/,
    );
    expect(await db.people.count()).toBe(original.data.people.length + 1);
  });
  it("rolls back replacement if a database write fails after deleting old rows", async () => {
    const original = await fixture(),
      target = {
        id: original.data.tree.id,
        revision: original.data.tree.revision,
      };
    const fail = () => {
      throw new DOMException("Simulated quota failure", "QuotaExceededError");
    };
    db.people.hook("creating", fail);
    try {
      await expect(restoreBundle(original, target)).rejects.toThrow();
    } finally {
      db.people.hook("creating").unsubscribe(fail);
    }
    expect(await db.people.where("treeId").equals(target.id).count()).toBe(
      original.data.people.length,
    );
    expect(await db.media.count()).toBe(original.data.media.length);
  });
  it("rejects export with altered in-memory media", async () => {
    const original = await fixture();
    original.assets.set(original.data.media[0].id, strToU8("damaged"));
    await expect(makeBackup(original)).rejects.toThrow(/incomplete|integrity/);
  });
  it("round trips a profile picture and restores the photograph reference", async () => {
    const original = await fixture();
    const p = original.data.people[0],
      id = uid(),
      bytes = new Uint8Array([137, 80, 78, 71]);
    original.data.media.push({
      id,
      treeId: original.data.tree.id,
      personId: p.id,
      name: "photo.png",
      type: "image/png",
      size: bytes.length,
      sha256: await sha256(bytes),
    });
    original.assets.set(id, bytes);
    p.photoId = id;
    const parsed = await readBackup((await makeBackup(original)).bytes),
      restored = await restoreBundle(parsed),
      copy = await snapshotTree(restored.id);
    const restoredPerson = copy.data.people.find(
      (x) => x.givenName === p.givenName,
    )!;
    expect(
      copy.data.media.find((m) => m.id === restoredPerson.photoId)?.personId,
    ).toBe(restoredPerson.id);
  });
});
