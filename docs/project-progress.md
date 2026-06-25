# Vector Forge Lab Project Progress

Current version: `0.3.1`  
Last updated: 2026-06-25  
Project path: `C:\Users\jackwolf-power\Documents\Codex\2026-06-21\r\work\vector-forge-lab`

## Product Direction

The merged product is now positioned as `Vector Forge Desktop`: one Windows desktop entry point for a local knowledge-base workflow. The local vector database, parsing/OCR, chunking, embedding, LanceDB indexing, local search, and MCP server remain the core. AnythingLLM is optional downstream integration for workspace upload/sync and desktop management.

## 0.3.1 Completed

- Split the main UI into page-isolated left-sidebar navigation. Each sidebar button opens a dedicated page instead of keeping search, documents, AI, jobs, settings, MCP, and AnythingLLM surfaces mounted together.
- Added page-specific top-bar copy and page-scoped rendering so the visible content matches the selected workflow.
- Kept AI Control as a dedicated conversational command page. Read-only local search can auto-run and reveal the Search page with results; write/test/sync/import actions still require explicit confirmation.
- Updated Electron UI smoke to navigate through the split pages before interacting with each panel.
- Hardened Electron smoke startup with GPU/proxy/sandbox/readiness/load retry settings for more stable Windows validation.
- Fixed desktop data-directory smoke for the split-page layout by navigating to Settings before validating the data-directory controls.
- Rewrote the GitHub README and added Chinese launch documentation so the public repository clearly communicates purpose, feature set, architecture, security model, and roadmap.

## 0.3.0 Completed

### Desktop Delivery

- Added Electron desktop shell in `electron/main.cjs`.
- Desktop startup launches the local API service and opens the packaged UI.
- Window close cleans up the API child process.
- Desktop data-directory selection now works through a narrow preload bridge: status, choose, save, reset, and relaunch. Saved directories take effect on next launch, and `VECTOR_FORGE_DATA_DIR` remains the lockable override.
- Electron now generates a per-session local-action token and the server requires it for trusted local desktop actions when present.
- Added desktop validation scripts:
  - `npm run desktop`
  - `npm run smoke:desktop`
  - `npm run smoke:desktop:data-dir`
  - `npm run smoke:desktop:packaged`
  - `npm run pack:win`
  - `npm run dist:win`
- Added Electron builder output for:
  - `win-unpacked`
  - NSIS setup exe
  - portable exe
  - zip
- Fixed packaged LanceDB startup by adding `apache-arrow@18.1.0`.
- Set `build.electronDist` to `./node_modules/electron/dist` to avoid Windows packaging rename failures.

### Local Directory Import

- Added `POST /api/collections/:slug/scan-directory`.
- Added `POST /api/collections/:slug/import-paths`.
- Directory scan/import is protected by loopback/local request checks.
- Only absolute local paths are accepted.
- Import now requires a server-side scan session (`scanId`) and only accepts paths or candidate IDs returned by that scan.
- Scan/import uses canonical `realpath` checks, skips symlink entries, rejects UNC/device namespace paths on Windows, and revalidates each candidate immediately before copying.
- Scan uses a document-extension allowlist and a max candidate guard.
- Import copies selected external files into app-managed uploads, then reuses the existing parsing/OCR/chunking/embedding/LanceDB pipeline.
- External source directories are not deleted, moved, or mutated.
- Added `npm run smoke:directory`.

### AnythingLLM Desktop Management

- Added APIs:
  - `GET /api/anythingllm/environment`
  - `PUT /api/anythingllm/exe-path`
  - `POST /api/anythingllm/test`
  - `GET /api/anythingllm/workspaces`
  - `POST /api/anythingllm/download-installer`
  - `POST /api/anythingllm/open-installer-folder`
  - `POST /api/anythingllm/launch-installer`
- Added UI controls for:
  - refreshing environment
  - setting/clearing custom `AnythingLLM.exe`
  - testing desktop/API connectivity
  - reading workspaces
  - validating/downloading installer handoff
  - opening installer folder
  - launching installer
- Added `npm run smoke:anythingllm-desktop`.
- Added `POST /api/anythingllm/workspaces` so the UI can read workspaces with the currently visible draft URL/key/exe path instead of silently using only saved config.
- Document delete, batch delete, and collection delete now de-index recorded AnythingLLM workspace locations before local metadata is removed.
- `npm run smoke:anythingllm` verifies first sync upload, second sync skip, and delete cleanup through fake `update-embeddings` `deletes`.
- Successful document reprocess now de-indexes old recorded AnythingLLM workspace locations before the next sync. Cleanup failures or skipped base URLs preserve the prior sync metadata as document-level pending cleanup, and document detail exposes a retry action.
- AnythingLLM cleanup requests are batched through `VECTOR_FORGE_ANYTHING_CLEANUP_BATCH_SIZE`.
- Added a durable cleanup queue at `data/anythingllm-cleanup-queue.json` so failed or credential-blocked remote cleanup remains retryable after local document/collection deletion or reprocess replacement.
- Added `GET /api/anythingllm/cleanup-queue` and `POST /api/anythingllm/cleanup-queue/retry`; responses redact saved API keys.
- Added a global cleanup queue panel inside the AnythingLLM configuration card. It shows total/prepared/pending counts, per-entry source, collection, document, workspace, base URL, location count, attempts, last error, and API-key availability, and it can retry all or one pending entry after React confirmation.
- `npm run smoke:anythingllm` now also verifies add-embedding half-success recovery without duplicate raw uploads, reprocess cleanup, sync after reprocess, simulated cleanup failure, retry cleanup, sync after retry, final delete cleanup, orphan cleanup retry after local document delete, and cleanup intent preservation when a deleted collection has mismatched AnythingLLM base URL metadata.

### Persistence Reliability

- `config.json`, `manifest.json`, `onboarding.json`, and per-collection `*.documents.json` now use atomic same-directory temp writes with `.bak` recovery.
- `.bak` mirrors the last successful write, so a corrupted primary JSON file can be repaired from the backup on the next read.
- `manifest` document/chunk counts reconcile from `*.documents.json` on load to repair cross-file count drift after interrupted writes.
- `ai-tool-audit.jsonl` remains append-only, but malformed or partial JSONL lines are skipped when reading audit events.
- Added `server/persistence-smoke.ts` and `npm run smoke:persistence`.

### UI And Button Reliability

- Static first-run guidance has been replaced by persisted onboarding state and a real dialog. It covers data/LanceDB readiness, collection selection, embedding test, OCR test or skip, optional AnythingLLM test/skip, completion, dismissal, and reset.
- Added onboarding APIs: `GET /api/onboarding`, `PATCH /api/onboarding`, `POST /api/onboarding/complete`, and `POST /api/onboarding/reset`.
- Added `npm run smoke:onboarding` for state persistence, restart persistence, complete/reset, readiness summaries, and secret redaction.
- Added `npm run smoke:ui`, which uses Electron to click through onboarding, create a collection via the in-app dialog, batch-delete a document via the slug-confirmation dialog, search through the UI, open document detail, and fail if native `prompt`/`confirm`/`alert` dialogs are called.
- Import actions now show a clear error when no knowledge base exists instead of silently returning.
- Import, scan, search, delete confirmation, and copy actions now have disabled states that match their real handler preconditions.
- AI control quick commands are disabled when their required knowledge base/config/sync state is missing.
- AI attachment import no longer clears attached files before confirming a target knowledge base and successful upload.
- Copy citation and copy document ID use a local fallback path, so browser clipboard permission denial no longer turns the button into a silent failure.
- Task cancellation uses an independent `cancellingJobId` state so queued/running jobs can still be cancelled while other UI work is active.
- Current collection config has a dirty-state fingerprint.
- Import/reprocess/sync/MCP copy now distinguishes saved config from draft edits.
- AnythingLLM sync is blocked when the current collection config has unsaved changes.
- AI control sync commands tell the user to save current parameters before syncing.
- AI control commands now call the backend dry-run policy before any action. Only read-only local search is allowed to auto-run; supported import, config writes, OCR/embedding tests, AnythingLLM tests, and AnythingLLM sync create an in-panel pending action; unsupported deletes and local execution classes remain blocked or manual-guided.
- AI control supported write/test/sync/import commands now create an in-panel pending action with `确认执行`; confirmation calls the same real handlers used by page buttons.
- The AI control panel shows the latest policy decision with risk class, matched tool, blocked/confirmation state, and manual action hint.
- The AI control panel now includes a read-only strategy/audit panel that loads the backend tool registry and recent dry-run audit events, with redacted prompts/context and no tool execution.
- AnythingLLM sync, document-level AnythingLLM cleanup retry, global cleanup queue retry, risky OCR tests, installer folder open, and installer launch now require React confirmation before their side-effect endpoints are called.
- Import, scanned-path import, single-document reprocess, and batch reprocess now require a risk confirmation when the current knowledge-base config uses external embedding, cloud OCR, or PaddleOCR local execution.
- The document list can show all documents instead of limiting access to the first 8 rows. Directory scan results can show all candidates and include an `导入全部候选` action.
- Applying the default template to a collection now opens a confirmation dialog that summarizes the current and default embedding/OCR/AnythingLLM settings.
- AI `应用默认` pending actions now open the same apply-default confirmation dialog rather than directly applying the template.
- Electron token protection now covers all `/api` writes when `VECTOR_FORGE_LOCAL_ACTION_TOKEN` is set, including uploads, config writes, provider tests, search POSTs, reprocess/delete, AnythingLLM sync, AI dry-run, and desktop/local actions.
- Single-document delete removes app-managed uploaded source copies under the data root when no remaining document references the same file; external scanned source folders remain untouched.
- AnythingLLM workspace chips are cleared on knowledge-base switch or visible API URL/key edits, and `读取 Workspace` requires both the draft API base URL and key.
- Risk-confirmed imports and batch reprocesses clear their local selection state after the confirmed action succeeds; AI import clears attached files after the confirmed upload is queued.
- Electron external-window handling now only opens allowlisted HTTP/HTTPS hosts and denies arbitrary protocols such as `file:` or custom URL schemes.
- Directory select-all now selects only visible scan candidates and reports how many candidates are hidden when scan results exceed the visible limit.
- Mobile local search keeps Top K, search, and copy-citation controls visible.
- MCP write-toggle copy now explains that a running MCP process must be restarted for default config changes to matter.
- The MCP configuration card now lists all seven read-only resource URIs and provides copy buttons; `{slug}` resources are resolved against the current knowledge base before copying.
- Copying the current knowledge-base parameters into the global default template now requires a React confirmation dialog. Existing knowledge bases still keep independent saved copies.
- Desktop relaunch after data-directory changes now requires a React confirmation dialog; the data-dir smoke uses a dry-run IPC path and verifies exactly one relaunch request after confirmation.
- OpenAI-compatible embedding requests now have a bounded timeout and explicit validation for non-2xx provider responses, malformed payloads, non-numeric vectors, and dimension mismatch.
- Global busy state is now guarded in the refresh handler and document-detail handler; search query/Top K, search-result open, refresh, and the configuration/AnythingLLM form are disabled during in-flight operations to avoid stale response overwrites.
- Running job polling now refreshes document and collection state after the active queue finishes, so upload/reprocess/cancel results do not require manual refresh.
- AnythingLLM sync refreshes document state after successful sync and reports uploaded, skipped, embedded, and remaining counts.
- `复制为默认` is blocked while current collection parameters are dirty, avoiding accidental copy of stale saved config.
- AnythingLLM workspace chips are actionable buttons that copy workspace name/slug into the current collection parameter draft.
- UI file pickers now include XML, LOG, YAML, and YML to match backend-supported formats.
- Desktop and 390px mobile browser checks verified the directory source and AnythingLLM Desktop management sections are visible without horizontal overflow.

### Release Smoke

`npm run smoke:release` now runs:

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
- `npm run smoke:security`
- `npm run smoke:ai-tools`
- `npm run smoke:local-action-token`
- `npm run smoke:mcp:writes`
- `npm run smoke:embedding-provider`
- `npm run smoke:anythingllm`
- `npm run smoke:anythingllm-desktop`
- `npm run smoke:jobs`
- `npm run smoke:ui:built`
- `npm run smoke:desktop:data-dir:built`
- `npm run smoke:desktop:built`

`npm run smoke:release:target` adds mandatory `smoke:ocr:real`, Windows artifact generation, packaged desktop smoke, and `smoke:release:artifacts` for setup/portable/zip/OCR resource validation.

## 0.3.0 Verification

Passed commands:

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
- `npm run smoke:security`
- `npm run smoke:mcp:writes`
- `npm run smoke:embedding-provider`
- `npm run smoke:anythingllm`
- `npm run smoke:anythingllm-desktop`
- `npm run smoke:ai-tools`
- `npm run smoke:local-action-token`
- `npm run smoke:jobs`
- `npm run smoke:ui`
- `npm run smoke:ui:built`
- `npm run smoke:desktop`
- `npm run smoke:desktop:data-dir`
- `npm run smoke:desktop:data-dir:built`
- `npm run smoke:desktop:built`
- `npm run smoke:release`
- `npm run smoke:ocr:real`
- `npm run smoke:release:target`
- `npm run pack:win`
- `npm run smoke:desktop:packaged`
- `npm run smoke:release:artifacts`
- `npm run dist:win`

Selected smoke evidence:

- Directory smoke: scanned 2 files, required a scan session, rejected path-only import, rejected outside-scan import, imported 2 jobs, produced 2 documents, and returned 2 search results.
- Persistence smoke: created real config/onboarding/collection/document/AI-audit state, corrupted primary JSON files, recovered from `.bak`, skipped a malformed audit JSONL line, and reconciled manifest counts from document records.
- AnythingLLM sync smoke: simulated first-sync `update-embeddings` add failure after raw uploads, verified 51 uploaded locations were persisted without `embeddedAt`, recovered on second sync with `uploaded: 0`, `skipped: 51`, and `embedded: 51`, then verified idempotent sync, reprocess cleanup, sync after reprocess, simulated cleanup failure, retry cleanup, sync after retry, final document delete cleanup, orphan cleanup queue retry, and mismatched-baseUrl collection delete queue preservation.
- AnythingLLM Desktop smoke: draft-config workspaces, saved-config workspaces, fake exe, installer dry-run, path rejection, missing installer rejection, and CORS rejection all passed.
- Job cancel/retry smoke: queued TXT job cancelled immediately, running cloud-OCR PDF job cancelled after one OCR request with no documents created, single-document reprocess failed under a 1 MB parser limit, and the same document ID retried successfully after restoring the limit.
- Failed upload retry smoke: a processing-stage failed upload created a failed document with the failed job ID, then retry reused the same document ID, rebuilt chunks, and search returned the sentinel.
- Onboarding smoke: persisted current step/status across API restart, redacted secret-like lastResults, detected collection/default embedding/OCR/AnythingLLM readiness, completed, and reset.
- UI smoke: completed onboarding through real buttons, created `UI Smoke Collection` through the React dialog, expanded a 10-document list through `显示全部`, batch-deleted `ui-smoke-delete.txt` through the slug-confirmation dialog, indexed/searched `ui-smoke-note.txt`, opened document detail, recorded `nativeDialogCalls: 0`, and verified no horizontal overflow.
- UI smoke also verifies AI command safety and dangerous-action confirmation: AI save/apply-default/sync quick commands produced 3 dry-run calls and 0 direct write/apply-default/sync calls; the AI strategy/audit panel loaded `aiToolCards: 8`, `aiAuditRows: 3`, and `aiAuditHasSecret: false`; AnythingLLM connection and desktop test buttons each submitted exactly 1 request; workspace chips applied and persisted the selected workspace before clearing stale chips after a draft API URL change; installer format/download submitted 2 download endpoint requests and confirmed installer launch submitted the expected dry-run + launch pair; installer folder/installer launch, OCR test, AnythingLLM sync, AnythingLLM cleanup, risky upload, directory import-all, single-document reprocess, and batch reprocess each stayed at 0 side-effect calls before React confirmation. Post-confirmation counts were `riskUploadCalls: 1`, `riskImportCalls: 1`, `riskReprocessCalls: 1`, and `riskBatchReprocessCalls: 1`.
- Button audit smoke: `npm run smoke:buttons` checks every React native `<button>` for a real handler or explicit submit semantics and rejects missing handlers, empty/no-op handlers, and native `alert`/`prompt`/`confirm` usage.
- Expanded UI button smoke coverage: selected scanned-path import after risk confirmation, AI free-text search dry-run plus search execution, exact-name single-document delete, and task-center cancel are now covered with exact request-count and visible-state assertions.
- Expanded config/desktop UI smoke coverage: current-collection config controls are edited and persisted through `保存当前`, and the custom `AnythingLLM.exe` path is saved and cleared through the visible desktop-management buttons with persisted UI state checks.
- MCP smoke: `npm run smoke` listed and read 7 resources, including `vectorforge://embedding-provider/status`, `vectorforge://jobs/recent`, `vectorforge://anythingllm/sync-status`, and `vectorforge://documents/quality`; the resource payloads were checked for secret redaction. Electron UI smoke reported `mcpResourceRows: 7`.
- MCP write smoke: `npm run smoke:mcp:writes` verified `allowWrites=false` rejection, token-forwarded `vf_upsert_text`, `vf_search`, `vf_get_document`, `vf_delete_document`, and no hits after delete.
- Embedding provider smoke: `npm run smoke:embedding-provider` used a local fake OpenAI-compatible provider, indexed/searched one document, and verified 401 -> 502, bad shape -> 502, dimension mismatch -> 400, and timeout -> 504.
- UI/data-dir smoke: Electron UI smoke reported `copyDefaultCalls: 1`; desktop data-dir smoke reported `relaunchCalls: 1`.
- Browser UI: 14 directory candidates rendered 12 visible rows, select-all selected those 12 only, and the UI reported 2 hidden candidates.
- Browser UI desktop: local search returned 2 results, copy citation wrote real clipboard text through the fallback path, search busy state disabled query/Top K/refresh/config controls, and no new console errors were produced.
- Browser UI mobile `390x844`: Top K, search, and copy-citation controls were visible with no horizontal overflow.
- Browser UI AnythingLLM panel: global cleanup queue panel rendered in the right inspector without horizontal overflow, the title no longer squeezed vertically, and empty queues kept `重试全部` disabled.
- Desktop data-dir smoke: returned `ok: true`, default active data dir under isolated Electron `userData`, pending data dir `custom-data-root`, reset back to default, persisted `desktop-settings.json`, and verified `VECTOR_FORGE_DATA_DIR` env override locks UI controls plus save/reset IPC and directory picker paths.
- Packaged desktop smoke: returned `ok: true`, title `Vector Forge Lab`, app version `0.3.0`, and an `%APPDATA%\vector-forge-lab\data` data directory.
- Target release gate: `npm run smoke:release:target` passed, including real OCR, desktop data-dir smoke, rebuilt Windows artifacts, packaged desktop smoke, and release artifact smoke.
- Added-button UI smoke: copy citation wrote the expected source/chunk text, single cleanup queue retry submitted one selected id after confirmation, onboarding reset reopened the wizard with finish disabled, and AnythingLLM environment refresh updated the exe-path field.
- Persistence smoke now verifies A/B collection config isolation; AnythingLLM smoke now verifies targeted cleanup queue retry and redacted API-key responses.

## Delivery Artifacts

- `C:\Users\jackwolf-power\Documents\Codex\2026-06-21\r\work\vector-forge-lab\release\win-unpacked\Vector Forge Desktop.exe`
- `C:\Users\jackwolf-power\Documents\Codex\2026-06-21\r\work\vector-forge-lab\release\Vector Forge Desktop-Setup-0.3.0-x64.exe`
- `C:\Users\jackwolf-power\Documents\Codex\2026-06-21\r\work\vector-forge-lab\release\Vector Forge Desktop-Portable-0.3.0-x64.exe`
- `C:\Users\jackwolf-power\Documents\Codex\2026-06-21\r\work\vector-forge-lab\release\Vector Forge Desktop-0.3.0-x64.zip`
- Support artifacts generated but not primary delivery apps:
  - `C:\Users\jackwolf-power\Documents\Codex\2026-06-21\r\work\vector-forge-lab\release\Vector Forge Desktop-Setup-0.3.0-x64.exe.blockmap`
  - `C:\Users\jackwolf-power\Documents\Codex\2026-06-21\r\work\vector-forge-lab\release\builder-debug.yml`

## Source Backup

- Current backup path: `C:\Users\jackwolf-power\Documents\Codex\2026-06-21\r\outputs\project-backups\vector-forge-lab-v0.3.0-20260625-103607.zip`
- Backup verification: 48 zip entries, 0 excluded directory entries. Archive entries are rooted at the project file level, not wrapped in a `vector-forge-lab/` parent directory.

## Remaining Gaps

- First-run onboarding is now persisted and actionable; data-directory selection remains startup-bound and is not hot-swapped at runtime.
- Fast release smoke keeps real OCR optional, but `npm run smoke:ocr:real` and `npm run smoke:release:target` now enforce real Tesseract OCR on target machines.
- AnythingLLM duplicate upload prevention, document/collection delete de-index, reprocess cleanup, document-level cleanup retry, and cleanup batching are complete for recorded workspace locations; archive cleanup and raw custom-document deletion semantics remain follow-up work.
- AI control remains a local deterministic command router, not a model-backed planner.
- App icon is still the default Electron icon.
- `asar` remains disabled to keep LanceDB/OCR packaged-resource behavior stable.

## Historical Summary

- `0.1.0`: initial Web/API/MCP local vector database with LanceDB, local-hash embeddings, text/file upload, document management, search, and basic AnythingLLM upload.
- `0.2.0`: added PDF/DOCX/image OCR parsing, async jobs, document preview/reprocess, OCR config, and a more practical knowledge-base workbench UI.
- `0.2.1`: added the knowledge-base-first UI iteration, AI command console, collection-scoped parameters, document details, batch actions, MCP resources, AnythingLLM idempotent sync, and stronger security smoke.
