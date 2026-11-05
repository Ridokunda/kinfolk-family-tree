# Kinfolk · Family Tree

A local-first family archive built with React, TypeScript, Vite, Dexie, React Flow, and Tailwind. Records stay in the browser. No backend, account, paid database, or synchronization service is required.

## Run locally

Use Node.js 22.12+ (Node 24 recommended).

```sh
npm ci
npm run dev
```

For the actual offline application, use the production build:

```sh
npm run build
npm run preview -- --port 4173
```

Open the printed address. Wait for the service worker to finish installing before disconnecting. Development mode does not install the production service worker. Opening `index.html` directly from a USB with `file://` is not supported.

## Included

- Multiple separate family trees, plus an explicitly fictional sample.
- People, photographs, biographies, notes, gender, living status, birthplace, partial and approximate dates.
- Biological/adoptive/unspecified parentage, marriages, partnerships, divorce, stepparents, and guardianship.
- Relationship editing, duplicate detection, transactional cycle prevention, and derived relatives. Unknown parentage is not treated as proof of a half-sibling relationship.
- Automatic graph layout in a worker, focused ancestor/descendant/extended views, collapsed branches, search, zoom/pan, profile selection, and adding relatives from a person card.
- Local save transactions, concurrent profile edit detection, database schema migration, storage estimates, and persistent-storage requests.
- ZIP and encrypted backups, photographs and attachments, SHA-256 integrity validation, preview-first restore, atomic replacement, and separate-tree import with all IDs remapped.
- User-chosen file saving where supported and a download fallback. Backup history distinguishes creation, download initiation, write completion, file verification, and a user-confirmed external location.
- Offline application caching, update prompts, install icons, PNG graph export, and browser print/PDF output.
- Responsive layouts, keyboard controls, text alternatives, and a people directory alongside the graph.

## Safeguard your records

IndexedDB is a working copy, not an independent backup. Clearing site data, losing a device/browser profile, browser eviction, or using private browsing may lose records. Persistent-storage permission does not protect against manual clearing or device failure.

The same address in a different browser, profile, or device has a separate database. A different hosting address is also a separate storage origin. Export before changing domains. The application does not upload records, synchronize devices, or provide shared editing.

Anyone with access to your unlocked browser profile can read local records. Use separate device accounts, screen locks, and appropriate disk protection. There is no misleading application PIN. Backup encryption does not encrypt IndexedDB.

### Save and verify a USB backup

1. Open **Backups**. Choose encryption and a strong passphrase of at least 12 characters, or an ordinary readable ZIP.
2. Select **Prepare & validate backup**. This creates a snapshot and validates the completed archive. It has not yet saved anything to external storage.
3. Choose **Choose USB or folder**, where supported, or **Download file**. With a download, check it completed and copy the file to your USB yourself.
4. In **Check or restore**, select that saved file from the USB and enter its passphrase.
5. Select **Validate & preview**, confirm the external location if accurate, and **Record file verification**.
6. Eject the USB using the operating system. Keep another copy on a separate device; rotate copies rather than overwriting the only one.

The browser cannot silently write to a USB or prove that an arbitrary folder is removable storage. File read-back checks verify current bytes, not future drive health. The generated filename includes the tree name, which remains visible even for encrypted backups.

### Restore

Open the app on the receiving device first. On the welcome screen choose **Restore a backup**, or use **Backups** in an existing tree. Choose the file, validate it, and review counts before importing. Separate-tree import is the default. Replacement requires typing the selected tree name, refuses stale previews, and commits all records in one transaction. Export the current tree before replacement. Automatic merging is intentionally unavailable.

The backup contains family data, not an application installer. A completely new offline computer needs the application installed/cached before it can restore. Backup activity on the old device is not imported as proof that the new device has an external copy.

## File format and limits

An ordinary ZIP contains `manifest.json`, `family.json`, `media/<uuid>` binary files, and `README.txt`. The manifest records format version, application version, backup ID, snapshot revision, timestamps, file sizes, and SHA-256 hashes. Every referenced file is required; unsafe paths, duplicate entries, excessive decompression sizes, unsupported versions, missing records, invalid graph edges, and failed hashes are rejected before any database write.

Encrypted `.ftbackup` files contain the same ZIP encrypted with AES-256-GCM. The authenticated JSON header records PBKDF2-HMAC-SHA-256 parameters (600,000 iterations), a fresh 16-byte random salt, and a fresh 12-byte random nonce. Keys are derived per file and never persisted. Forgotten passphrases cannot be recovered. See [format documentation](docs/backup-format.md).

Safety limits: 10,000 people, 50,000 relationships, 5,000 media assets, 20 MiB per asset, and 100 MiB uncompressed archive payload. Export/restore requires working memory; constrained devices may reach their limits sooner. Focused views are recommended for large trees. Photos chosen as profile pictures are resized to at most 1,200 pixels and re-encoded as WebP; attach the original separately if preservation matters. PDF and text attachments are downloaded, never executed inside the app.

## Tests

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Unit/integration tests cover graph invariants, partial dates, stale edits, v1→v2 migration, full backup round trips, encryption, corruption, media references, separate import, empty-database recovery, and rollback after a simulated storage failure. Browser tests use disposable synthetic data and exercise profiles, attachments, responsive layout, offline reopen/edit/export, and restoration into a fresh browser context. A browser context is not a physical second computer.

Physical USB and second-computer checks remain a separate release checklist in [verification notes](docs/verification.md). No real family data or backups should be committed to Git. Downloaded backup extensions and test output folders are ignored.

## Architecture

`src/domain.ts` contains validated records and graph rules. `src/db.ts` owns Dexie transactions and migrations; UI components call these services. `src/backup.ts` is independent of UI/database and can be tested in isolation. Workers handle ZIP/encryption and ELK layout. `src/media.ts` handles local file attachments. React components use Dexie live queries for changes.

Database schema version 2 is independent of backup format version 1. Derived relationships and graph coordinates are not stored as genealogical facts. Partnerships and parentage are separate edges. Caregiver connections do not imply biological ancestry. Unknown information is retained as unknown.

Future synchronization should add a repository adapter and an explicit change/conflict protocol. Stable IDs and record revisions help, but cloud synchronization is not implemented and is not a drop-in database toggle.

## Free static deployment

Cloudflare Pages can host `dist/` without Functions or a database. Use build command `npm run build`, output directory `dist`, and Node 24. Use a free `pages.dev` hostname. The deployment includes `_headers` security rules and the service worker.

Alternatively, upload the contents of `dist/` using Cloudflare Pages Direct Upload. Do not upload browser exports or family backups. Use HTTPS; the browser requires a secure origin for service workers, encryption, and direct file saving (localhost is suitable for development).

As checked on 5 November 2026, Pages Free documents 500 builds/month, one concurrent build, a 20-minute build timeout, 20,000 files per deployment, and 25 MiB per deployed file. Static asset requests are free and unlimited. The intended cost is R0/month with no Functions, R2, D1, paid plan, or custom domain. If limits are reached, wait for the relevant reset, reduce build size/frequency, or request an increase; do not enable paid services automatically. Recheck provider terms before deploying.

Sources: [Pages limits](https://developers.cloudflare.com/pages/platform/limits/) and [static asset pricing](https://developers.cloudflare.com/pages/functions/pricing/). Local photographs do not count toward hosted file limits. A Sites preview, if published, is separate from your own Cloudflare Pages account; this repository remains a portable static app.

## Next enhancements

GEDCOM import/export, carefully reviewed duplicate-aware merging, paginated genealogy PDFs, relationship path explanations, and optional encrypted synchronization/collaboration. None is required for the current local-first workflow.
