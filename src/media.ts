import { db, assertBackupCapacity } from "./db";
import { type Person, type Media, uid, now, mediaSchema } from "./domain";
import { sha256 } from "./backup";
export async function attachFile(person: Person, file: File, asPhoto = false) {
  if (file.size > 20 * 1024 * 1024)
    throw new Error("Choose a file smaller than 20 MiB.");
  if (
    ![
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/pdf",
      "text/plain",
    ].includes(file.type)
  )
    throw new Error("Supported files: JPG, PNG, WebP, PDF, and plain text.");
  if (asPhoto && !file.type.startsWith("image/"))
    throw new Error("Choose a JPG, PNG, or WebP photograph.");
  let blob: Blob = file;
  if (asPhoto) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas
      .getContext("2d")!
      .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) =>
          b
            ? resolve(b)
            : reject(new Error("Photograph could not be processed.")),
        "image/webp",
        0.86,
      ),
    );
  }
  const meta = mediaSchema.parse({
    id: uid(),
    treeId: person.treeId,
    personId: person.id,
    name: asPhoto ? file.name.replace(/\.[^.]+$/, "") + ".webp" : file.name,
    type: blob.type,
    size: blob.size,
    sha256: await sha256(new Uint8Array(await blob.arrayBuffer())),
  });
  const asset: Media = { ...meta, blob };
  await db.transaction(
    "rw",
    [db.trees, db.people, db.media, db.relations],
    async () => {
      const p = await db.people.get(person.id),
        tree = await db.trees.get(person.treeId);
      if (!p || !tree) throw new Error("Save this person before adding files.");
      if (p.revision !== person.revision)
        throw new Error("Profile changed. Reopen it before adding files.");
      await db.media.add(asset);
      if (asPhoto)
        await db.people.update(p.id, {
          photoId: asset.id,
          revision: p.revision + 1,
          updatedAt: now(),
        });
      await db.trees.update(tree.id, {
        revision: tree.revision + 1,
        updatedAt: now(),
      });
      await assertBackupCapacity(tree.id);
    },
  );
  return asset;
}
