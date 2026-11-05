import { z } from "zod";

const id = z.string().uuid();
const text = z.string().max(20000);
export function validDate(value: string): boolean {
  if (!value) return true;
  if (!/^\d{4}(-\d{2})?(-\d{2})?$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (y < 1 || y > 9999 || (m !== undefined && (m < 1 || m > 12))) return false;
  if (d !== undefined) {
    const days = new Date(Date.UTC(y < 100 ? y + 400 : y, m, 0)).getUTCDate();
    if (d < 1 || d > days) return false;
  }
  return true;
}
const date = z
  .string()
  .refine(
    validDate,
    "Use YYYY, YYYY-MM, or YYYY-MM-DD; leave unknown dates blank.",
  );
const timestamp = z.string().datetime();
export const treeSchema = z.object({
  id,
  name: z.string().trim().min(1).max(120),
  description: text,
  createdAt: timestamp,
  updatedAt: timestamp,
  revision: z.number().int().nonnegative(),
  isDemo: z.boolean().default(false),
});
export const personSchema = z
  .object({
    id,
    treeId: id,
    givenName: z.string().max(160),
    surname: z.string().max(160),
    gender: z.enum(["unknown", "female", "male", "nonbinary", "other"]),
    status: z.enum(["unknown", "living", "deceased"]),
    birthDate: date,
    deathDate: date,
    birthApprox: z.boolean(),
    deathApprox: z.boolean(),
    birthplace: z.string().max(300),
    biography: text,
    notes: text,
    photoId: id.nullable(),
    createdAt: timestamp,
    updatedAt: timestamp,
    revision: z.number().int().nonnegative(),
  })
  .superRefine((p, ctx) => {
    if (p.status === "living" && p.deathDate)
      ctx.addIssue({
        code: "custom",
        path: ["deathDate"],
        message: "A living person cannot have a death date.",
      });
    if (
      p.birthDate.length === 10 &&
      p.deathDate.length === 10 &&
      p.deathDate < p.birthDate
    )
      ctx.addIssue({
        code: "custom",
        path: ["deathDate"],
        message: "Death date cannot be before birth date.",
      });
  });
export const kinds = [
  "biological",
  "adoptive",
  "parent",
  "marriage",
  "partner",
  "guardian",
  "step",
] as const;
export const relationSchema = z
  .object({
    id,
    treeId: id,
    fromId: id,
    toId: id,
    kind: z.enum(kinds),
    startDate: date,
    endDate: date,
    endReason: z.enum(["", "divorce", "separation", "death", "other"]),
    notes: text,
    createdAt: timestamp,
  })
  .superRefine((r, ctx) => {
    if (
      r.startDate.length === 10 &&
      r.endDate.length === 10 &&
      r.endDate < r.startDate
    )
      ctx.addIssue({
        code: "custom",
        message: "End date cannot precede start date.",
      });
  });
export const mediaSchema = z.object({
  id,
  treeId: id,
  personId: id,
  name: z.string().min(1).max(255),
  type: z.enum([
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/pdf",
    "text/plain",
  ]),
  size: z
    .number()
    .int()
    .nonnegative()
    .max(20 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export const snapshotSchema = z.object({
  format: z.literal("kinfolk"),
  version: z.literal(1),
  tree: treeSchema,
  people: z.array(personSchema).max(10000),
  relations: z.array(relationSchema).max(50000),
  media: z.array(mediaSchema).max(5000),
});
export type Tree = z.infer<typeof treeSchema>;
export type Person = z.infer<typeof personSchema>;
export type Relation = z.infer<typeof relationSchema>;
export type MediaMeta = z.infer<typeof mediaSchema>;
export type Media = MediaMeta & { blob: Blob };
export type Snapshot = z.infer<typeof snapshotSchema>;
export type Bundle = { data: Snapshot; assets: Map<string, Uint8Array> };
export type BackupEvent = {
  id: string;
  treeId: string;
  backupId: string;
  revision: number;
  createdAt: string;
  filename: string;
  fileHash?: string;
  outcome: "download" | "written" | "verified";
  verifiedAt?: string;
  usbConfirmed: boolean;
};
export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export const nameOf = (p: Person) =>
  [p.givenName, p.surname].filter(Boolean).join(" ") || "Name unknown";
export const initials = (p: Person) =>
  (p.givenName.charAt(0) + p.surname.charAt(0)).toUpperCase() || "?";
export const ancestry = (r: Relation) =>
  ["biological", "adoptive", "parent"].includes(r.kind);
export const partnership = (r: Relation) =>
  r.kind === "marriage" || r.kind === "partner";
export const kindLabel: Record<Relation["kind"], string> = {
  biological: "Biological parent",
  adoptive: "Adoptive parent",
  parent: "Parent · type unknown",
  marriage: "Marriage",
  partner: "Partnership",
  guardian: "Guardian",
  step: "Stepparent",
};
export function blankPerson(treeId: string): Person {
  return {
    id: uid(),
    treeId,
    givenName: "",
    surname: "",
    gender: "unknown",
    status: "unknown",
    birthDate: "",
    deathDate: "",
    birthApprox: false,
    deathApprox: false,
    birthplace: "",
    biography: "",
    notes: "",
    photoId: null,
    createdAt: now(),
    updatedAt: now(),
    revision: 0,
  };
}
export function relationshipKey(r: Relation): string {
  const ends = partnership(r) ? [r.fromId, r.toId].sort() : [r.fromId, r.toId];
  return [
    r.kind,
    ...ends,
    ...(partnership(r) ? [r.startDate, r.endDate] : []),
  ].join("|");
}
export function validateGraph(
  people: Person[],
  relations: Relation[],
  treeId: string,
) {
  const ids = new Set(people.map((p) => p.id));
  if (ids.size !== people.length) throw new Error("Duplicate person IDs.");
  const keys = new Set<string>(),
    relationIds = new Set<string>(),
    children = new Map<string, string[]>();
  for (const p of people)
    if (p.treeId !== treeId)
      throw new Error("A person belongs to another family tree.");
  for (const r of relations) {
    if (r.treeId !== treeId || !ids.has(r.fromId) || !ids.has(r.toId))
      throw new Error(
        "A relationship references a missing person or another tree.",
      );
    if (r.fromId === r.toId)
      throw new Error("A person cannot be related to themselves.");
    const key = relationshipKey(r);
    if (keys.has(key) || relationIds.has(r.id))
      throw new Error("This relationship already exists.");
    keys.add(key);
    relationIds.add(r.id);
    if (ancestry(r))
      children.set(r.fromId, [...(children.get(r.fromId) || []), r.toId]);
  }
  // Iterative topological traversal avoids call-stack limits in imported trees.
  const degree = new Map(people.map((p) => [p.id, 0]));
  for (const list of children.values())
    for (const child of list) degree.set(child, degree.get(child)! + 1);
  const queue = [...degree].filter(([, n]) => n === 0).map(([id]) => id);
  let visited = 0;
  for (let i = 0; i < queue.length; i++) {
    visited++;
    for (const child of children.get(queue[i]) || []) {
      degree.set(child, degree.get(child)! - 1);
      if (degree.get(child) === 0) queue.push(child);
    }
  }
  if (visited !== people.length)
    throw new Error(
      "This would create an ancestor cycle. A descendant cannot also be an ancestor.",
    );
}
export function validateSnapshot(input: unknown): Snapshot {
  const data = snapshotSchema.parse(input);
  validateGraph(data.people, data.relations, data.tree.id);
  const people = new Set(data.people.map((p) => p.id)),
    assets = new Map(data.media.map((m) => [m.id, m]));
  if (assets.size !== data.media.length)
    throw new Error("Duplicate media IDs.");
  for (const m of data.media)
    if (m.treeId !== data.tree.id || !people.has(m.personId))
      throw new Error("Attachment references a missing person.");
  for (const p of data.people)
    if (p.photoId) {
      const m = assets.get(p.photoId);
      if (!m || m.personId !== p.id || !m.type.startsWith("image/"))
        throw new Error("Profile photograph is missing or invalid.");
    }
  return data;
}
export function duplicatePeople(candidate: Person, people: Person[]) {
  return people.filter(
    (p) =>
      p.id !== candidate.id &&
      nameOf(p) !== "Name unknown" &&
      nameOf(p).toLocaleLowerCase().trim() ===
        nameOf(candidate).toLocaleLowerCase().trim() &&
      (!p.birthDate ||
        !candidate.birthDate ||
        p.birthDate === candidate.birthDate),
  );
}
export function friendlyError(e: unknown): string {
  if (e instanceof z.ZodError)
    return e.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("\n");
  if (e instanceof Error) {
    if (e.name === "QuotaExceededError")
      return "Device storage is full. Your change was not saved. Export a backup before freeing space.";
    return e.message;
  }
  return "Something went wrong. Your existing records have been kept.";
}

export type ViewMode = "extended" | "ancestors" | "descendants";
export function visiblePeople(
  focus: string,
  relations: Relation[],
  mode: ViewMode,
  depth: number,
  collapsed: Set<string>,
): Set<string> {
  const found = new Set([focus]),
    queue: [string, number][] = [[focus, 0]];
  for (let i = 0; i < queue.length; i++) {
    const [id, level] = queue[i];
    if (level >= depth || collapsed.has(id)) continue;
    for (const r of relations) {
      let next: string | undefined;
      if (mode === "extended") {
        if (r.fromId === id) next = r.toId;
        else if (r.toId === id) next = r.fromId;
      } else if (ancestry(r)) {
        if (mode === "ancestors" && r.toId === id) next = r.fromId;
        if (mode === "descendants" && r.fromId === id) next = r.toId;
      }
      if (next && !found.has(next)) {
        found.add(next);
        queue.push([next, level + 1]);
      }
    }
  }
  return found;
}
export function relativesOf(
  personId: string,
  people: Person[],
  relations: Relation[],
): { person: Person; label: string }[] {
  const parents = (id: string) =>
    new Set(
      relations
        .filter((r) => ancestry(r) && r.toId === id)
        .map((r) => r.fromId),
    );
  const myParents = parents(personId),
    myChildren = new Set(
      relations
        .filter((r) => ancestry(r) && r.fromId === personId)
        .map((r) => r.toId),
    );
  return people
    .filter((p) => p.id !== personId)
    .flatMap((p) => {
      const direct = relations.filter(
        (r) =>
          (r.fromId === personId && r.toId === p.id) ||
          (r.toId === personId && r.fromId === p.id),
      );
      if (direct.length)
        return [
          {
            person: p,
            label: direct
              .map((r) =>
                partnership(r)
                  ? `${kindLabel[r.kind]}${r.endDate || r.endReason ? " · ended" : ""}`
                  : r.toId === personId
                    ? kindLabel[r.kind]
                    : ancestry(r)
                      ? `Child · ${r.kind === "parent" ? "parentage unspecified" : r.kind}`
                      : "Under care",
              )
              .join(", "),
          },
        ];
      const theirs = parents(p.id),
        shared = [...myParents].filter((id) => theirs.has(id));
      if (shared.length)
        return [
          {
            person: p,
            label:
              "Sibling connection · shared recorded parent" +
              (shared.length > 1
                ? "s"
                : " (other parentage may be incomplete)"),
          },
        ];
      if ([...myParents].some((id) => parents(id).has(p.id)))
        return [{ person: p, label: "Grandparent · recorded parentage" }];
      if ([...theirs].some((id) => myChildren.has(id)))
        return [{ person: p, label: "Grandchild · recorded parentage" }];
      if (
        [...myParents].some((id) => [...parents(id)].some((g) => theirs.has(g)))
      )
        return [{ person: p, label: "Aunt / uncle connection" }];
      if (
        [...theirs].some((id) => [...parents(id)].some((g) => myParents.has(g)))
      )
        return [{ person: p, label: "Niece / nephew connection" }];
      const myGrand = new Set([...myParents].flatMap((id) => [...parents(id)]));
      if (
        [...theirs].some((id) => [...parents(id)].some((g) => myGrand.has(g)))
      )
        return [{ person: p, label: "Cousin connection · shared grandparent" }];
      return [];
    });
}
