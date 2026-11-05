import Dexie, { type Table } from "dexie";
import { validateBundle } from "./backup";
import {
  type Tree,
  type Person,
  type Relation,
  type Media,
  type Bundle,
  type BackupEvent,
  treeSchema,
  personSchema,
  relationSchema,
  validateGraph,
  validateSnapshot,
  blankPerson,
  now,
  uid,
} from "./domain";

export class FamilyDB extends Dexie {
  trees!: Table<Tree>;
  people!: Table<Person>;
  relations!: Table<Relation>;
  media!: Table<Media>;
  backups!: Table<BackupEvent>;
  constructor(name = "kinfolk-family-tree") {
    super(name);
    this.version(1).stores({
      trees: "id,updatedAt",
      people: "id,treeId,[treeId+surname]",
      relations: "id,treeId,fromId,toId",
      media: "id,treeId,personId",
      backups: "id,treeId,createdAt",
    });
    this.version(2)
      .stores({ people: "id,treeId,[treeId+surname],updatedAt" })
      .upgrade(async (tx) => {
        await tx
          .table("trees")
          .toCollection()
          .modify((t) => {
            t.revision ??= 0;
            t.isDemo ??= false;
          });
        await tx
          .table("people")
          .toCollection()
          .modify((p) => {
            p.revision ??= 0;
          });
      });
    this.on("versionchange", () => {
      this.close();
      if (typeof window !== "undefined")
        window.dispatchEvent(new Event("database-outdated"));
    });
  }
}
export const db = new FamilyDB();
export async function createTree(name: string, isDemo = false) {
  const tree = treeSchema.parse({
    id: uid(),
    name,
    description: "",
    createdAt: now(),
    updatedAt: now(),
    revision: 0,
    isDemo,
  });
  await db.trees.add(tree);
  return tree;
}
async function bump(treeId: string) {
  const tree = await db.trees.get(treeId);
  if (!tree) throw new Error("Family tree no longer exists.");
  await db.trees.update(treeId, {
    updatedAt: now(),
    revision: tree.revision + 1,
  });
}
/** Called inside each write transaction so a tree never grows beyond its portable format. */
export async function assertBackupCapacity(treeId: string) {
  const tree = await db.trees.get(treeId);
  const people = await db.people.where("treeId").equals(treeId).toArray();
  const relations = await db.relations.where("treeId").equals(treeId).toArray();
  const assets = await db.media.where("treeId").equals(treeId).toArray();
  if (people.length > 10000 || relations.length > 50000 || assets.length > 5000)
    throw new Error(
      "This family tree has reached the portable backup record limit. Your change was not saved.",
    );
  const data = {
    format: "kinfolk",
    version: 1,
    tree,
    people,
    relations,
    media: assets.map(({ blob, ...meta }) => meta),
  };
  const size =
    new TextEncoder().encode(JSON.stringify(data)).length +
    assets.reduce((sum, m) => sum + m.size, 0);
  if (size > 100 * 1024 * 1024)
    throw new Error(
      "This change would exceed the 100 MiB backup limit. Use a smaller attachment or keep a separate archive. Your change was not saved.",
    );
}
export async function savePerson(
  input: Person,
  newRelations: Relation | Relation[] = [],
) {
  const links = (
    Array.isArray(newRelations) ? newRelations : [newRelations]
  ).map((r) => relationSchema.parse(r));
  const p = personSchema.parse({
    ...input,
    givenName: input.givenName.trim(),
    surname: input.surname.trim(),
    updatedAt: now(),
    revision: input.revision + 1,
  });
  await db.transaction(
    "rw",
    [db.trees, db.people, db.relations, db.media],
    async () => {
      const existing = await db.people.get(p.id);
      if (existing && existing.revision !== input.revision)
        throw new Error(
          "This profile changed in another tab. Close and reopen it before editing.",
        );
      if (p.photoId) {
        const m = await db.media.get(p.photoId);
        if (!m || m.personId !== p.id || !m.type.startsWith("image/"))
          throw new Error("Choose a valid photograph from this profile.");
      }
      await bump(p.treeId);
      await db.people.put(p);
      if (links.length) {
        const people = await db.people
          .where("treeId")
          .equals(p.treeId)
          .toArray();
        const relations = await db.relations
          .where("treeId")
          .equals(p.treeId)
          .toArray();
        validateGraph(people, [...relations, ...links], p.treeId);
        await db.relations.bulkAdd(links);
      }
      await assertBackupCapacity(p.treeId);
    },
  );
  return p;
}
export async function saveRelation(input: Relation) {
  const r = relationSchema.parse(input);
  await db.transaction(
    "rw",
    [db.trees, db.people, db.relations, db.media],
    async () => {
      const people = await db.people.where("treeId").equals(r.treeId).toArray(),
        relations = await db.relations
          .where("treeId")
          .equals(r.treeId)
          .toArray();
      validateGraph(
        people,
        [...relations.filter((x) => x.id !== r.id), r],
        r.treeId,
      );
      await bump(r.treeId);
      await db.relations.put(r);
      await assertBackupCapacity(r.treeId);
    },
  );
}
export async function deleteRelation(r: Relation) {
  await db.transaction("rw", [db.trees, db.relations], async () => {
    await db.relations.delete(r.id);
    await bump(r.treeId);
  });
}
export async function deletePerson(p: Person) {
  await db.transaction(
    "rw",
    [db.trees, db.people, db.relations, db.media],
    async () => {
      const current = await db.people.get(p.id);
      if (!current || current.revision !== p.revision)
        throw new Error("Profile changed. Reopen it before deleting.");
      await db.relations
        .where("treeId")
        .equals(p.treeId)
        .filter((r) => r.fromId === p.id || r.toId === p.id)
        .delete();
      await db.media.where("personId").equals(p.id).delete();
      await db.people.delete(p.id);
      await bump(p.treeId);
    },
  );
}
export async function removeMedia(asset: Media) {
  await db.transaction("rw", [db.trees, db.people, db.media], async () => {
    const p = await db.people.get(asset.personId);
    if (p?.photoId === asset.id)
      await db.people.update(p.id, {
        photoId: null,
        updatedAt: now(),
        revision: p.revision + 1,
      });
    await db.media.delete(asset.id);
    await bump(asset.treeId);
  });
}
export async function snapshotTree(treeId: string): Promise<Bundle> {
  const snapshot = await db.transaction(
    "r",
    [db.trees, db.people, db.relations, db.media],
    async () => {
      const tree = await db.trees.get(treeId);
      if (!tree) throw new Error("Family tree not found.");
      const people = await db.people.where("treeId").equals(treeId).toArray(),
        relations = await db.relations.where("treeId").equals(treeId).toArray(),
        media = await db.media.where("treeId").equals(treeId).toArray();
      return { tree, people, relations, media };
    },
  );
  const assets = new Map<string, Uint8Array>();
  for (const m of snapshot.media)
    assets.set(m.id, new Uint8Array(await m.blob.arrayBuffer()));
  const data = validateSnapshot({
    format: "kinfolk",
    version: 1,
    ...snapshot,
    media: snapshot.media.map(({ blob, ...meta }) => meta),
  });
  return { data, assets };
}
export async function restoreBundle(
  bundle: Bundle,
  target?: { id: string; revision: number },
) {
  const data = await validateBundle(bundle);
  const treeId = target?.id || uid();
  const ids = new Map<string, string>();
  for (const item of [...data.people, ...data.relations, ...data.media])
    ids.set(item.id, uid());
  const tree = treeSchema.parse({
    ...data.tree,
    id: treeId,
    name: target
      ? data.tree.name
      : `${data.tree.name.slice(0, 109)} · restored`,
    updatedAt: now(),
    revision: target ? target.revision + 1 : 0,
  });
  const people = data.people.map((p) => ({
    ...p,
    id: ids.get(p.id)!,
    treeId,
    photoId: p.photoId ? ids.get(p.photoId)! : null,
    revision: 0,
  }));
  const relations = data.relations.map((r) => ({
    ...r,
    id: ids.get(r.id)!,
    treeId,
    fromId: ids.get(r.fromId)!,
    toId: ids.get(r.toId)!,
  }));
  const media = data.media.map((m) => {
    const bytes = bundle.assets.get(m.id);
    if (!bytes || bytes.byteLength !== m.size)
      throw new Error("Missing attachment data.");
    return {
      ...m,
      id: ids.get(m.id)!,
      treeId,
      personId: ids.get(m.personId)!,
      blob: new Blob([Uint8Array.from(bytes).buffer], { type: m.type }),
    };
  });
  await db.transaction(
    "rw",
    [db.trees, db.people, db.relations, db.media],
    async () => {
      if (target) {
        const existing = await db.trees.get(target.id);
        if (!existing || existing.revision !== target.revision)
          throw new Error(
            "The destination tree changed after preview. Review the restore again.",
          );
        await db.people.where("treeId").equals(treeId).delete();
        await db.relations.where("treeId").equals(treeId).delete();
        await db.media.where("treeId").equals(treeId).delete();
      }
      await db.trees.put(tree);
      await db.people.bulkAdd(people);
      await db.relations.bulkAdd(relations);
      await db.media.bulkAdd(media);
    },
  );
  return tree;
}

export async function loadDemo() {
  const tree = treeSchema.parse({
    id: uid(),
    name: "The Willow family",
    description:
      "Fictional sample family. Explore freely, then create your own tree.",
    createdAt: now(),
    updatedAt: now(),
    revision: 0,
    isDemo: true,
  });
  const rows: [string, string, string, Person["gender"], Person["status"]][] = [
    ["Arthur", "Willow", "1942", "male", "deceased"],
    ["Evelyn", "Willow", "1945", "female", "living"],
    ["James", "Willow", "1968", "male", "living"],
    ["Clara", "Reed", "1971", "female", "living"],
    ["Rose", "Willow", "1973", "female", "living"],
    ["Daniel", "Brooks", "1970", "male", "living"],
    ["Oliver", "Willow", "1996", "male", "living"],
    ["Isla", "Willow", "1999", "female", "living"],
    ["Mia", "Brooks", "2004", "female", "living"],
  ];
  const people = rows.map(
    ([givenName, surname, birthDate, gender, status]) => ({
      ...blankPerson(tree.id),
      givenName,
      surname,
      birthDate,
      gender,
      status,
      birthplace: "",
      biography:
        "A fictional person in the sample family. Replace this with a story from your own family.",
    }),
  );
  const edge = (a: number, b: number, kind: Relation["kind"]): Relation => ({
    id: uid(),
    treeId: tree.id,
    fromId: people[a].id,
    toId: people[b].id,
    kind,
    startDate: "",
    endDate: "",
    endReason: "",
    notes: "Fictional sample",
    createdAt: now(),
  });
  const relations = [
    edge(0, 1, "marriage"),
    edge(2, 3, "marriage"),
    edge(4, 5, "partner"),
    edge(0, 2, "biological"),
    edge(1, 2, "biological"),
    edge(0, 4, "biological"),
    edge(1, 4, "biological"),
    edge(2, 6, "biological"),
    edge(3, 6, "biological"),
    edge(2, 7, "biological"),
    edge(3, 7, "biological"),
    edge(4, 8, "adoptive"),
    edge(5, 8, "adoptive"),
  ];
  await db.transaction("rw", [db.trees, db.people, db.relations], async () => {
    await db.trees.add(tree);
    await db.people.bulkAdd(people);
    await db.relations.bulkAdd(relations);
  });
  return tree;
}
