# Verification and release checks

Automated tests use fictional records only. Test results and screenshots are kept in the ignored `test-results/` directory. Run `npm test`, `npm run build`, and `npm run test:e2e` to reproduce checks.

## Completed on 5 November 2026

- Production TypeScript/Vite build and offline precache generation passed.
- 41 unit/integration tests passed, including encrypted/corrupt backup cases, schema migration, stale edits, atomic recovery after simulated write failure, and saving both parent links with a child in one transaction.
- Six Chromium browser workflows passed: desktop/mobile navigation, profile persistence with attachments, encrypted backup verification and fresh-context recovery with photos, offline reopen/edit/export, adding relatives with PNG/print export, and optional second-parent selection with reload persistence.
- The exported PNG was checked for nonblank content and visually inspected. Desktop and mobile screenshots were also inspected.
- Production dependency audit reported zero known vulnerabilities at the time of the check. This is not an independent security audit.

The browser tests used separate disposable contexts on one computer. They do not establish physical USB or second-computer reliability.

## Required manual hardware checks

These cannot be established by a fresh browser context or automated disk download alone.

- [ ] On a physical USB, save an encrypted backup with photos and documents.
- [ ] Eject and reconnect the USB; reopen the saved file and verify it.
- [ ] Install/open the application on a second physical computer.
- [ ] Disconnect internet, restore from USB, and compare people, relationships, photographs, and documents.
- [ ] Confirm the passphrase is available independently of the source device.
- [ ] Keep a second backup on a different physical device.
- [ ] Test installation and offline reopening on the actual phones/tablets used by the family.

## Important limits

Desktop Chromium automation is not a substitute for Safari/Firefox/device validation. Browser storage policies and installation support vary. Persistent-storage permission is advisory protection against eviction, not protection against user deletion or hardware loss. A read-back verification is a current integrity check, not a guarantee of future USB reliability.
