import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { z } from "zod";
import { type Bundle, validateSnapshot, now, uid } from "./domain";

export const MAX_BACKUP_BYTES = 100 * 1024 * 1024;
export const bytesBuffer = (bytes: Uint8Array) => Uint8Array.from(bytes).buffer;
export async function sha256(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytesBuffer(bytes));
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
const magic = strToU8("KINFOLK1\n");
const manifestSchema = z.object({
  format: z.literal("kinfolk-backup"),
  version: z.literal(1),
  backupId: z.string().uuid(),
  createdAt: z.string().datetime(),
  appVersion: z.literal("1.0.0"),
  revision: z.number().int().nonnegative(),
  files: z
    .array(
      z.object({
        path: z.string().max(100),
        size: z.number().int().nonnegative().max(MAX_BACKUP_BYTES),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    )
    .max(5001),
});
export type ParsedBackup = Bundle & {
  backupId: string;
  createdAt: string;
  encrypted: boolean;
};
export type PreparedBackup = {
  bytes: Uint8Array;
  filename: string;
  backupId: string;
  createdAt: string;
  revision: number;
};
export function isEncrypted(bytes: Uint8Array) {
  return magic.every((n, i) => bytes[i] === n);
}
async function derive(password: string, salt: Uint8Array, iterations: number) {
  const material = await crypto.subtle.importKey(
    "raw",
    bytesBuffer(strToU8(password)),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: bytesBuffer(salt), iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
async function encrypt(bytes: Uint8Array, password: string) {
  if (password.length < 12)
    throw new Error("Use a backup passphrase with at least 12 characters.");
  const salt = crypto.getRandomValues(new Uint8Array(16)),
    iv = crypto.getRandomValues(new Uint8Array(12));
  const header = strToU8(
    JSON.stringify({
      version: 1,
      cipher: "AES-256-GCM",
      kdf: "PBKDF2-SHA256",
      iterations: 600000,
      salt: Array.from(salt),
      iv: Array.from(iv),
    }),
  );
  const key = await derive(password, salt, 600000);
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: bytesBuffer(iv),
        additionalData: bytesBuffer(header),
        tagLength: 128,
      },
      key,
      bytesBuffer(bytes),
    ),
  );
  const out = new Uint8Array(
    magic.length + 4 + header.length + encrypted.length,
  );
  out.set(magic);
  new DataView(out.buffer).setUint32(magic.length, header.length);
  out.set(header, magic.length + 4);
  out.set(encrypted, magic.length + 4 + header.length);
  return out;
}
async function decrypt(bytes: Uint8Array, password: string) {
  if (!password)
    throw new Error("This backup is encrypted. Enter its passphrase.");
  if (bytes.length < magic.length + 4)
    throw new Error("Incomplete encrypted backup.");
  const length = new DataView(bytesBuffer(bytes)).getUint32(magic.length);
  if (
    length > 2048 ||
    length < 1 ||
    bytes.length < magic.length + 4 + length + 16
  )
    throw new Error("Invalid encryption header.");
  const raw = bytes.slice(magic.length + 4, magic.length + 4 + length);
  const h = z
    .object({
      version: z.literal(1),
      cipher: z.literal("AES-256-GCM"),
      kdf: z.literal("PBKDF2-SHA256"),
      iterations: z.number().int().min(100000).max(2000000),
      salt: z.array(z.number().int().min(0).max(255)).length(16),
      iv: z.array(z.number().int().min(0).max(255)).length(12),
    })
    .parse(JSON.parse(strFromU8(raw)));
  const key = await derive(password, new Uint8Array(h.salt), h.iterations);
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: new Uint8Array(h.iv),
          additionalData: bytesBuffer(raw),
          tagLength: 128,
        },
        key,
        bytesBuffer(bytes.slice(magic.length + 4 + length)),
      ),
    );
  } catch {
    throw new Error(
      "Unable to unlock this backup. The passphrase is wrong or the file is damaged.",
    );
  }
}
export async function validateBundle(bundle: Bundle) {
  const data = validateSnapshot(bundle.data);
  let total = strToU8(JSON.stringify(data)).length;
  if (total > MAX_BACKUP_BYTES)
    throw new Error("Family records exceed the backup size limit.");
  if (bundle.assets.size !== data.media.length)
    throw new Error("Backup media count does not match.");
  for (const m of data.media) {
    const bytes = bundle.assets.get(m.id);
    if (!bytes || bytes.length !== m.size)
      throw new Error(`Missing or incomplete attachment: ${m.name}`);
    total += bytes.length;
    if (total > MAX_BACKUP_BYTES)
      throw new Error(
        "This release supports backups up to 100 MiB of uncompressed data.",
      );
    if ((await sha256(bytes)) !== m.sha256)
      throw new Error(`Attachment integrity check failed: ${m.name}`);
  }
  return data;
}
export async function makeBackup(
  bundle: Bundle,
  password = "",
): Promise<PreparedBackup> {
  const data = await validateBundle(bundle);
  const backupId = uid(),
    createdAt = now();
  const files: Record<string, Uint8Array> = {
    "family.json": strToU8(JSON.stringify(data)),
  };
  for (const m of data.media) files[`media/${m.id}`] = bundle.assets.get(m.id)!;
  let size = 0;
  const entries = [];
  for (const [path, bytes] of Object.entries(files)) {
    size += bytes.length;
    entries.push({ path, size: bytes.length, sha256: await sha256(bytes) });
  }
  if (size > MAX_BACKUP_BYTES)
    throw new Error("Backup exceeds the 100 MiB uncompressed limit.");
  files["manifest.json"] = strToU8(
    JSON.stringify({
      format: "kinfolk-backup",
      version: 1,
      backupId,
      createdAt,
      appVersion: "1.0.0",
      revision: data.tree.revision,
      files: entries,
    }),
  );
  files["README.txt"] = strToU8(
    "Kinfolk family backup, format 1. Restore from the Backups screen in Kinfolk. This archive includes family.json and every photograph and attachment. Install/open the app on another computer before going offline. Keep at least two independent copies. A ZIP is not encrypted.",
  );
  let bytes = zipSync(files, { level: 6 });
  if (password) bytes = await encrypt(bytes, password);
  await readBackup(bytes, password);
  const safe =
    data.tree.name
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9_-]/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 60) || "Family";
  return {
    bytes,
    backupId,
    createdAt,
    revision: data.tree.revision,
    filename: `${safe}_${createdAt.replace(/[:.]/g, "-")}.${password ? "ftbackup" : "zip"}`,
  };
}
export async function readBackup(
  input: Uint8Array,
  password = "",
): Promise<ParsedBackup> {
  if (input.byteLength > MAX_BACKUP_BYTES + 4 * 1024 * 1024)
    throw new Error(
      "Backup file is too large for this release (100 MiB uncompressed limit).",
    );
  const encrypted = isEncrypted(input),
    bytes = encrypted ? await decrypt(input, password) : input;
  let total = 0,
    count = 0;
  const seen = new Set<string>();
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (file) => {
        if (++count > 5003 || seen.has(file.name))
          throw new Error("Too many files or duplicate archive entries.");
        seen.add(file.name);
        if (
          !/^(manifest\.json|family\.json|README\.txt|media\/[a-f0-9-]{36})$/.test(
            file.name,
          )
        )
          throw new Error("Unexpected file or unsafe path in backup.");
        total += file.originalSize;
        if (total > MAX_BACKUP_BYTES + 1024 * 1024)
          throw new Error("Decompressed backup exceeds the size limit.");
        if (file.name === "manifest.json" && file.originalSize > 1024 * 1024)
          throw new Error("Manifest is too large.");
        if (
          file.name.startsWith("media/") &&
          file.originalSize > 20 * 1024 * 1024
        )
          throw new Error("Attachment exceeds 20 MiB.");
        return true;
      },
    });
  } catch (e) {
    throw new Error(
      `Cannot read this backup: ${e instanceof Error ? e.message : "invalid ZIP"}`,
    );
  }
  if (!files["manifest.json"] || !files["family.json"])
    throw new Error("Not a Kinfolk backup: required files are missing.");
  let manifest, raw;
  try {
    manifest = manifestSchema.parse(
      JSON.parse(strFromU8(files["manifest.json"])),
    );
    raw = JSON.parse(strFromU8(files["family.json"]));
  } catch {
    throw new Error(
      "Invalid manifest or unsupported backup version. No records have been changed.",
    );
  }
  const names = new Set<string>();
  for (const entry of manifest.files) {
    if (names.has(entry.path)) throw new Error("Duplicate file in manifest.");
    names.add(entry.path);
    const content = files[entry.path];
    if (
      !content ||
      content.length !== entry.size ||
      (await sha256(content)) !== entry.sha256
    )
      throw new Error(`Backup integrity check failed: ${entry.path}`);
  }
  const data = validateSnapshot(raw);
  if (data.tree.revision !== manifest.revision)
    throw new Error("Snapshot revision mismatch.");
  const required = new Set([
    "family.json",
    ...data.media.map((m) => `media/${m.id}`),
  ]);
  if (names.size !== required.size || [...required].some((n) => !names.has(n)))
    throw new Error("The manifest does not match the family records.");
  if (
    Object.keys(files).some(
      (n) => n !== "manifest.json" && n !== "README.txt" && !required.has(n),
    )
  )
    throw new Error("Unlisted archive content.");
  const assets = new Map(data.media.map((m) => [m.id, files[`media/${m.id}`]]));
  await validateBundle({ data, assets });
  return {
    data,
    assets,
    backupId: manifest.backupId,
    createdAt: manifest.createdAt,
    encrypted,
  };
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
