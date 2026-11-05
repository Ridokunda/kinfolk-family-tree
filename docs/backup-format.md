# Kinfolk backup format 1

The database schema and backup schema are independently versioned. Format 1 requires a strict supported-version match. Unknown future versions fail safely; future supported migrations must operate in staging before committing any records.

## ZIP payload

- `manifest.json`: `format: kinfolk-backup`, `version: 1`, UUID `backupId`, ISO UTC `createdAt`, `appVersion`, tree `revision`, and `files` entries (`path`, `size`, `sha256`).
- `family.json`: `format: kinfolk`, `version: 1`, `tree`, `people`, `relations`, and media metadata. Dates are empty or valid year/month/day strings, with separate approximate flags.
- `media/<uuid>`: exact saved binary bytes; each metadata record declares owner person, filename, MIME type, length, and hash.
- `README.txt`: human-readable recovery guidance. It is informational and never executed.

SHA-256 hashes cover the exact `family.json` and media bytes. JSON serialization order is immaterial after parsing, but integrity checks compare the original serialized bytes. Checksums detect corruption; an unencrypted manifest can be maliciously replaced along with its contents and is not an authenticity signature.

## Encrypted envelope

1. Nine ASCII bytes `KINFOLK1\n`.
2. Four-byte unsigned big-endian header length (maximum 2,048).
3. UTF-8 JSON header: `version: 1`, `cipher: AES-256-GCM`, `kdf: PBKDF2-SHA256`, `iterations: 600000`, `salt` (16 random bytes as integers), `iv` (12 random bytes as integers).
4. AES-GCM encrypted ZIP with a 128-bit authentication tag. The exact JSON header bytes are additional authenticated data.

The reader accepts bounded iteration counts from 100,000 to 2,000,000 for versioned compatibility, checks field sizes before derivation, and rejects malformed or unauthenticated input. Passwords are UTF-8 encoded without trimming or normalization. Password and derived keys are not persisted. The export worker is terminated on completion/failure. This is a new format, not an independently audited cryptographic product.

## Atomic recovery

The reader checks decompressed size limits before extraction, validates structure and all references, checks every hash, and validates ancestor acyclicity. Restore rechecks the bundle before entering a single IndexedDB transaction. Separate import remaps all person, relation, media, and tree references. Replacement checks the destination revision inside the write transaction before removing any old rows. Failed writes roll back removals and additions together.

For file verification history, the exact saved file hash must match a previously exported file from the current tree on this device. Importing historical backup metadata does not constitute proof that the new device has a safe external copy.
