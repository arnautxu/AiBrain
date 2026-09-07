# Server work-folder navigation — 2026-09-07

Status: candidate only. No production deployment or host configuration change was performed for this delivery. Shared code; installation-specific shortcuts. Existing Windows roots, permissions and files are unchanged.

## Problem and behavior

Opening Server currently starts at C/Y drives, exposing system clutter before useful business folders. The picker now opens `home`, an authenticated, permission-checked list of operator-configured shortcuts. This request does not open a Windows session. A shortcut is configuration, explicitly `sourceChecked:false` and `checkedAt:null`; it cannot be attached as though freshly observed. Opening it performs the existing live browse. “Explorar unidades” retains access to every existing authorized location and file type. A missing shortcut configuration leaves an empty home with the drive browser available; no customer roots are invented.

The shared UI/API contain no Arnall paths. The optional broker `--navigation-config` reads a root-private JSON file bound to the exact installation and connection, validates paths against existing source roots, and publishes at most eight bounded entries in the existing root-owned descriptor. The app independently checks descriptor ownership, installation, connection, company grant and path syntax. This gives MODTIME no Arnall access.

## Fresh metadata evidence

Authenticated same-origin API checks on Arnall, user/project authorization already enforced, without document content reads:

- `C:\Arnall`: HTTP 200, `sourceChecked:true`, checked `2026-09-07T18:52:35.882678+00:00`. Exactly `Compres` and `Vendes`, `limited:false`. Total 36,350 ms; source wait 1,251 ms, startup 24,704 ms, readback 9,890 ms.
- `Y:\`: HTTP 200, fresh check `2026-09-07T18:53:17.338840+00:00`. First page 49 visible entries, `limited:true`, next offset 50. Observed directory names include `COMPRES`, `COMPTABILITAT`, `ERP`, and `FACTURES PROVEIDORS 2022` through `2026`. Total 19,000 ms; source wait 0 ms, startup 16,112 ms, readback 2,295 ms.

These observations establish directory existence, not the meaning or completeness of their contents. Y was not fully enumerated. `infra/hetzner/arnall-server-navigation.example.json` selects six observed locations. No executable was run, source file altered, Windows service restarted, ACL changed or public bridge opened.

## Release handoff

The coordinator must integrate this commit with the active-route candidate `b0a4edcb817b5babcd097fa587582a68bc6e96f8`; both touch the broker and their independent changes must be retained. The latter also needs its matching `rdp-access.py` and `rdp-server-files.py`. Do not replace that broker with an older standalone navigation copy.

When deployments are authorized again, the release owner can install a root-private navigation config from the example for company-qa only, add `--navigation-config` to the existing broker invocation, and perform the documented idle check and broker-only restart. Preserve existing manifest, access roots and credentials. No persistent transport activation is included. Rollback removes the optional argument/config and restores the previous shared app/broker versions from the release backup.

Required acceptance after release: authenticated home shortcuts; no Windows request for home; open each observed shortcut with actual fresh metadata; retain C/Y exploration and pagination; select/deselect a supported file; close/reopen while loading; complete a real chat query with preserved partial evidence and correctly named sources. These post-release checks are pending. The new home removes a needless drive-list request but does not prove faster live RDP startup or a completed runtime turn.

## Runtime failure handoff (separate from picker)

User conversation `63bc3cb6-fdb0-4bd1-abdc-82a16e6e393f`, assistant message `787040b4-4a6c-40ef-8439-dabb325d2348`, runtime thread `01a07d28-49c7-7dd1-adff-21b4623228ed`, turn `01a07d28-4f7a-7e60-9607-a97570d729b6`:

- `exec-0206845e-9005-4239-af1e-f336c36369c3` completed `server:/` at 18:36:38.986Z.
- `exec-c72b505c-76fe-4ce4-88d8-fb59773dff19` completed `live:server:/C/` at 18:37:14.473Z; 36 fresh C entries, partial listing, checked 18:37:14.149978Z. This partial result remains persisted.
- `exec-2fbe5460-43b4-47bf-8b53-bc22c1959168` began `live:server:/Y/` at 18:37:14.484Z and remains persisted as running without output.
- Projection is streaming at sequence 21580, updated 18:37:15.203Z. The app release was promoted at 18:37:19.751Z. Gateway/client transport journals contain this turn through sequence 21631, including completed commentary at 18:37:27.549Z, but no matching terminal `turn/completed` was found. A completed final answer has not been established.

This points to an interrupted consumer/projection across restart while a tool was pending. Review `src/runtime/workers/local-gateway-runtime.ts`, `src/runtime/worker-codex-turn.ts` and `src/workbench/turn-projection-store.ts` against the persisted app client/gateway journals. Do not reset history or replay side effects blindly. The old broker could omit operation completion when writing to a disconnected client; b0a4edc adds completion logging in that case, but cannot reconstruct the missing old outcome. Do not attribute this exact conversation to the separate confirmed picker readback timeout without evidence.

Expanded real UI and persisted source agree: “Fuente 1: image.png — Archivo adjunto”, source id `source-file-0681e1b9-24c3-4d66-88bd-50a28b0756e9`. It is the user's screenshot, not an empty source and not Windows document evidence. No source-title UI change is justified.

## Validation

- 23 tests passed across picker, ServerDocumentFiles and authenticated server-browser service.
- 22 host broker/Server tests passed, including navigation installation/root/duplicate checks.
- TypeScript `tsc --noEmit` passed.
- Diff whitespace check passed.
- Production acceptance of these changes remains pending; no CI, publication or deployment result is claimed.
