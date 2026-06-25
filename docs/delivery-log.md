# Vector Forge Lab Delivery Log

Delivery date: 2026-06-25  
Current version: `0.3.1`  
Project path: `C:\Users\jackwolf-power\Documents\Codex\2026-06-21\r\work\vector-forge-lab`

## 0.3.1 Delivery Scope

This iteration prepares the project for public GitHub synchronization and tightens the split-page desktop UI. The main product surface now treats every left-sidebar entry as a dedicated page rather than a continuously mounted combined workbench. The AI control console remains policy-gated and can reveal local search results on the Search page. Electron UI smoke was updated to navigate page-by-page, and the desktop data-directory smoke now opens Settings before validating data-root controls.

Public-facing docs were also rewritten so the repository explains the product clearly: local-first knowledge base, OCR/document ingestion, LanceDB vector search, MCP access, optional AnythingLLM sync, AI control safety, security boundaries, setup, build, verification, and roadmap.

## 0.3.0 Delivery Scope

This release turns the merged Vector Forge / KB Forge direction into a practical Windows desktop deliverable. The application keeps Vector Forge Lab as the local vector database, document parsing, OCR, embedding, LanceDB, search, and MCP core. KB Forge capabilities are represented as desktop delivery, AnythingLLM management, sync safety, and local execution boundaries.

## Delivered Features

### Desktop App

- One Windows desktop entry point.
- Local API startup from the Electron shell.
- Packaged UI loading.
- API child-process cleanup on app close.
- Development desktop smoke.
- Packaged exe smoke.

### Packaging

- `win-unpacked` directory.
- NSIS setup exe.
- Portable exe.
- Zip package.
- Versioned artifacts under `release/`.

### Local Knowledge Workflow

- Existing collection/document/chunk/embedding/LanceDB workflows remain intact.
- Directory scan/import has been added.
- Directory import copies files into managed app storage and then runs the real parsing/OCR/chunking/embedding/indexing pipeline.
- Directory import is now bound to a server-side scan session and revalidates canonical paths before copying, so arbitrary absolute paths cannot be posted directly to import.
- Existing document upload, text ingest, reprocess, delete, search, batch actions, and document detail workflows remain available.
- Single-document delete now removes the app-managed uploaded source copy under the data root when no remaining document references it. External user source directories scanned through directory import are still left untouched.

### AnythingLLM

- Existing idempotent upload sync remains available.
- Sync recovery now handles the add-embedding half-success case: raw uploads can be persisted after a failed `update-embeddings` add call, and the next sync embeds those uploaded locations without uploading duplicate raw text.
- Local document, batch document, and collection delete now call AnythingLLM workspace de-index with recorded uploaded locations before local sync metadata is removed.
- Successful local document reprocess now calls AnythingLLM workspace de-index for the old recorded locations before fresh sync. If cleanup fails or is skipped because the saved base URL changed, the old sync metadata is preserved as document-level pending cleanup and can be retried from the document detail UI/API instead of being discarded.
- AnythingLLM de-index calls are batched through `VECTOR_FORGE_ANYTHING_CLEANUP_BATCH_SIZE`.
- Failed or credential-blocked AnythingLLM cleanup is now durable after local destructive commits. Cleanup intent is stored in `data/anythingllm-cleanup-queue.json`, can survive local document/collection deletion, and can be retried through `POST /api/anythingllm/cleanup-queue/retry`.
- `GET /api/anythingllm/cleanup-queue` exposes queue status with API keys redacted.
- The AnythingLLM configuration card now includes a global cleanup queue panel. Users can refresh queue status, inspect pending/prepared counts and per-entry metadata, see missing API-key states, and retry all or individual pending entries after an in-app confirmation.
- New desktop management controls:
  - environment refresh
  - custom exe path
  - desktop/API test
  - workspace fetch
  - installer download handoff
  - installer folder open
  - installer launch
- Safety checks are enforced for local execution actions.
- Workspace loading can use the current UI draft URL/key/exe path through `POST /api/anythingllm/workspaces`.
- AnythingLLM sync, document-level cleanup retry, and global cleanup queue retry now require React confirmation before external-send/delete endpoints are called.

### Persistence Reliability

- Core local JSON metadata now uses atomic same-directory temp writes and `.bak` recovery:
  - `config.json`
  - `manifest.json`
  - `onboarding.json`
  - per-collection `*.documents.json`
- Manifest document/chunk counts reconcile from document manifests on load.
- AI tool audit JSONL reads skip malformed or partial lines.
- `npm run smoke:persistence` verifies backup recovery, audit bad-line tolerance, and manifest count reconciliation.

### UI Reliability

- First-run setup is now a persisted onboarding wizard, not a static checklist. It can confirm data/LanceDB readiness, create or confirm a knowledge base, test embedding, test or skip OCR, skip or test AnythingLLM, complete, dismiss, and reset.
- Onboarding state is stored under the managed data directory and is covered by `npm run smoke:onboarding`.
- `npm run smoke:ui` now performs a real Electron-rendered UI click path: onboarding, collection creation dialog, batch delete confirmation dialog, text indexing, search, document-detail open, and native-dialog regression guard.
- Buttons that previously risked silent no-op behavior now show concrete feedback.
- Button disabled states now match the real handler preconditions for import, scan, search, copy, delete confirmation, AI quick commands, task cancellation, and installer actions.
- Global busy state is guarded so refresh, search-result open, search query/Top K edits, and configuration/AnythingLLM form edits cannot race with in-flight operations.
- Copy citation and copy document ID use a fallback path when async clipboard permission is unavailable.
- AnythingLLM sync is blocked until current collection config is saved.
- Directory select-all only selects visible scan candidates and warns when additional candidates are not displayed.
- Mobile search keeps Top K and copy-citation controls visible.
- Draft vs saved collection configuration is clearer across import, reprocess, MCP, sync, and AI control flows.
- The MCP configuration card lists all seven read-only MCP resource URIs and lets users copy the resolved URI for AI client configuration or debugging.
- Desktop and mobile layouts were checked for horizontal overflow.
- Job completion polling now refreshes document/collection state, AnythingLLM sync refreshes local document state, workspace chips can be applied to the current draft, and dirty collection config blocks copy-to-default.
- AI control console now uses the backend dry-run policy before acting. Only read-only local search auto-runs; supported write/test/sync/import commands create a pending action with visible risk and matched tool; unsupported destructive/local-execution commands stay blocked or manual-guided.
- Risky actions now have explicit React confirmation gates: AnythingLLM sync, AnythingLLM cleanup retry, cloud/Paddle OCR tests, installer folder open, installer launch, document delete, and batch delete.
- Electron external-window handling now denies arbitrary protocols and only opens allowlisted HTTP/HTTPS hosts.
- Desktop data-directory selection is available in onboarding/settings and is covered by `smoke:desktop:data-dir`.
- Electron local-action token protection is active for trusted local desktop actions when Electron launches the API. With `VECTOR_FORGE_LOCAL_ACTION_TOKEN` set, all `/api` write requests now require `X-Vector-Forge-Local-Action-Token`.
- AI control can now confirm and execute supported local handlers instead of only pointing at manual buttons.
- Copying current knowledge-base parameters into the global default template now requires confirmation before writing `/api/config/copy-from-collection/:slug`.
- Desktop relaunch after a pending data-directory change now requires confirmation before invoking the relaunch IPC.
- OpenAI-compatible embedding providers now have timeout and response-shape/dimension validation, covered by a fake-provider smoke test.
- AI `应用默认` pending actions now open the same apply-default confirmation dialog as the page button instead of applying immediately.
- Import/reprocess actions now show a risk confirmation before external embedding, cloud OCR, or PaddleOCR execution.
- Risk-confirmed imports and batch reprocesses clear stale local selection state after success, and AI file imports clear attached files after the confirmed upload is queued.
- Document and directory candidate lists now expose all rows through show-all/import-all controls.
- AnythingLLM workspace chips are cleared when switching knowledge bases or changing the visible API URL/key; workspace loading is disabled until both draft URL and key are present.
- Electron UI smoke now proves copy-citation clipboard text, per-entry cleanup queue retry payload, onboarding reset reopening, and AnythingLLM environment refresh through real visible controls.

## Verification Commands

- `npx tsc -p tsconfig.app.json --noEmit`
- `npx tsc -p tsconfig.server.json --noEmit`
- `npm run lint`
- `npm run build`
- `npm run smoke:buttons`
- `npm run smoke`
- `npm run smoke:persistence`
- `npm run smoke:upload`
- `npm run smoke:documents`
- `npm run smoke:directory`
- `npm run smoke:onboarding`
- `npm run smoke:ocr`
- `npm run smoke:ocr:real`
- `npm run smoke:security`
- `npm run smoke:ai-tools`
- `npm run smoke:local-action-token`
- `npm run smoke:mcp:writes`
- `npm run smoke:embedding-provider`
- `npm run smoke:anythingllm`
- `npm run smoke:anythingllm-desktop`
- `npm run smoke:jobs`
- `npm run smoke:ui`
- `npm run smoke:ui:built`
- `npm run smoke:desktop`
- `npm run smoke:desktop:data-dir`
- `npm run smoke:desktop:data-dir:built`
- `npm run smoke:desktop:built`
- `npm run smoke:release`
- `npm run pack:win`
- `npm run smoke:desktop:packaged`
- `npm run smoke:release:artifacts`
- `npm run dist:win`
- `npm run smoke:release:target`

## Key Results

- Directory smoke: scanned 2 files, required a scan session, rejected path-only import, rejected outside-scan import, imported 2 jobs, created 2 documents, and returned 2 search results.
- Persistence smoke: real API state survived intentional primary JSON corruption through `.bak` recovery, malformed audit JSONL lines were ignored, and manifest counts were repaired from document records.
- AnythingLLM sync smoke: first sync uploaded 51 chunks, second sync skipped 51 chunks, reprocess cleanup deleted 51 old locations, sync after reprocess uploaded 51 current chunks, simulated cleanup failure preserved 51 pending records, retry cleanup deleted those 51 pending records, sync after retry uploaded 51 current chunks, document delete sent 51 recorded locations to `update-embeddings` `deletes`, failed remote cleanup after local document delete was retried from the durable queue, and mismatched-baseUrl collection delete kept cleanup intent without calling the wrong endpoint.
- AnythingLLM sync recovery smoke: first sync intentionally failed during add embedding after raw uploads; the second sync reused 51 persisted locations with `uploaded: 0`, `skipped: 51`, and `embedded: 51`, proving duplicate raw uploads are avoided after half-success.
- AnythingLLM Desktop smoke: draft-config workspaces, saved-config workspaces, fake exe, installer dry-run, unsafe path rejection, missing installer rejection, and CORS rejection passed.
- Job cancel/retry smoke: queued TXT job cancelled, running cloud-OCR PDF job cancelled after one fake OCR request, no cancelled documents were created, failed reprocess state persisted, retry reused the same document ID, and search returned the retried document.
- Failed upload retry smoke: processing-stage upload failure persisted a failed document/job link; retry reused the same document ID, rebuilt chunks, and search found the retried content.
- Onboarding smoke: persistence, restart persistence, complete/reset, readiness summaries, and secret redaction passed.
- UI smoke: onboarding completed, `UI Smoke Collection` was created through the React dialog, document show-all expanded a 10-row list, `ui-smoke-delete.txt` was batch-deleted through slug confirmation, `ui-smoke-note.txt` was indexed, `UI_SMOKE_SENTINEL` search returned a result, document detail opened, `nativeDialogCalls` stayed `0`, and no horizontal overflow was detected.
- Upload smoke: upload, indexing, search, document delete, and managed source-copy removal after delete passed.
- Local-action token smoke: missing/wrong token requests were rejected and correct-token requests reached AI dry-run, AnythingLLM environment, collection write, embedding test, search, batch delete, and AnythingLLM sync validation handlers.
- UI safety smoke: AI save/sync/apply-default quick commands produced dry-run calls with no direct write/sync/apply-default calls. The AI strategy/audit panel loaded 8 tool cards and 4 audit rows with no secret text. AnythingLLM connection and desktop test buttons each submitted exactly 1 request. Workspace chips applied and persisted the selected workspace, then stale chips cleared after draft API URL edits. Installer format/download submitted 2 requests and confirmed installer launch submitted the dry-run + launch pair. Installer-folder open, installer launch, OCR test, AnythingLLM sync, document-level AnythingLLM cleanup, global AnythingLLM cleanup queue retry, risky upload, directory import-all, single-document reprocess, and batch reprocess each showed confirmation first and recorded `0` backend side-effect calls before confirmation; confirmed processing-risk actions each sent exactly one backend request.
- Added-button UI smoke: copy citation wrote the expected source/chunk sentinel text; single cleanup queue retry submitted one selected id after React confirmation; onboarding reset from the sidebar and dialog reopened the wizard with finish disabled; AnythingLLM environment refresh updated the visible exe-path input.
- MCP resource smoke: all 7 read-only MCP resources were listed and read, resource payloads were checked for secret redaction, and Electron UI smoke reported 7 resource rows with a clickable copy control.
- MCP write smoke: `allowWrites=false` rejected writes, then token-protected MCP upsert/search/get/delete/search succeeded with no hits after delete.
- Embedding provider smoke: local fake OpenAI-compatible provider success plus 401, bad shape, dimension mismatch, and timeout paths passed.
- UI/data-dir smoke: copy-default confirmation produced exactly one API call after confirmation, and relaunch confirmation produced exactly one dry-run relaunch request.
- Button audit smoke: `npm run smoke:buttons` statically checked 99 React native buttons and reported 0 missing/no-op/native-dialog issues.
- Expanded Electron UI smoke: selected directory import after confirmation, AI free-text search, exact-name single-document delete, and task-center cancel all produced exactly one expected backend request and visible UI state change.
- Expanded config/desktop UI smoke: edited current-collection config controls, saved them through `保存当前`, verified `configControlPayloadMatches: true` and `configControlPersisted: true`, then saved and cleared a fake local `AnythingLLM.exe` path with `anythingExePathSaveCalls: 1` and `anythingExePathClearCalls: 1`.
- Desktop data-dir smoke: verified saved next-launch data root, `pendingRelaunch`, a second desktop launch using the custom root, reset to default, a third launch using the restored default root, persisted `desktop-settings.json` under isolated Electron `userData`, and `VECTOR_FORGE_DATA_DIR` env override lock for UI controls, save/reset IPC, and directory picker.
- Real OCR smoke: `npm run smoke:ocr:real` ran Tesseract OCR against a generated PNG and returned one searchable OCR result.
- Release artifact smoke: verified the unpacked exe, setup exe, portable exe, zip artifact, OCR traineddata resources, zip entries, and zip-embedded package version after the Windows rebuild.
- Browser UI: 14 scanned candidates rendered 12 visible rows, selecting all checked only those 12 rows, and the UI reported 2 hidden candidates.
- Browser UI desktop: search returned 2 results, copy citation wrote real clipboard text, delayed-search busy state disabled query/Top K/refresh/config controls, and no new console errors were produced.
- Browser UI mobile 390px: Top K, search, and copy-citation controls were visible with no horizontal overflow.
- Browser UI AnythingLLM panel: cleanup queue rendered in the right inspector without horizontal overflow, the title stayed horizontal instead of being squeezed into vertical text, and an empty queue kept retry disabled.
- Packaged desktop smoke:

```json
{
  "ok": true,
  "title": "Vector Forge Lab",
  "appVersion": "0.3.0",
  "dataDir": "C:\\Users\\jackwolf-power\\AppData\\Roaming\\vector-forge-lab\\data"
}
```
- Target release gate: `npm run smoke:release:target` passed, including real OCR, desktop data-dir smoke, Windows artifact generation, and packaged desktop smoke.

## Release Artifacts

- `C:\Users\jackwolf-power\Documents\Codex\2026-06-21\r\work\vector-forge-lab\release\win-unpacked\Vector Forge Desktop.exe`
- `C:\Users\jackwolf-power\Documents\Codex\2026-06-21\r\work\vector-forge-lab\release\Vector Forge Desktop-Setup-0.3.0-x64.exe`
- `C:\Users\jackwolf-power\Documents\Codex\2026-06-21\r\work\vector-forge-lab\release\Vector Forge Desktop-Portable-0.3.0-x64.exe`
- `C:\Users\jackwolf-power\Documents\Codex\2026-06-21\r\work\vector-forge-lab\release\Vector Forge Desktop-0.3.0-x64.zip`
- Support artifacts: `release\Vector Forge Desktop-Setup-0.3.0-x64.exe.blockmap`, `release\builder-debug.yml`.

## Source Backup

- `C:\Users\jackwolf-power\Documents\Codex\2026-06-21\r\outputs\project-backups\vector-forge-lab-v0.3.0-20260625-103607.zip`
- Backup verification: 48 zip entries, 0 excluded directory entries. Archive entries are rooted at the project file level, not wrapped in a `vector-forge-lab/` parent directory.

## Known Remaining Work

- Data-directory switching remains startup-bound; the app saves the next-launch root and does not hot-swap the active data root at runtime.
- Use `npm run smoke:release:target` for mandatory real-OCR plus packaged-artifact target validation.
- Add AnythingLLM archive cleanup and raw custom-document deletion semantics where API support allows it.
- AI control is dry-run-policy gated and can confirm supported local actions, but remains a local command router; a model-backed planner is future work.
- Add branded app icon, signing strategy, and revisit `asar`.

## Handoff Notes

- Use `npm run dev` for browser development.
- Use `npm run desktop` for development desktop launch.
- Use `npm run smoke:release` before source delivery.
- Use `npm run smoke:release:target` before binary delivery when OCR must be validated on the target machine.
- Use `npm run smoke:buttons` when adding or changing native React buttons, then add an Electron UI smoke path for any new side-effect button.
- Use `npm run dist:win` before binary delivery.
- Use `npm run smoke:desktop:packaged` after generating `win-unpacked`.
