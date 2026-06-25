# Vector Forge Lab Development Log

Last updated: 2026-06-25  
Current version: `0.3.1`

## 0.3.1 - GitHub Launch Preparation And Split-Page UI Stabilization

- Reworked the React shell so left-sidebar navigation opens independent pages instead of one combined multi-panel surface.
- Added page-scoped rendering for AI Control, Local Search, Documents, Import Jobs, Collections, OCR/Parser, MCP, AnythingLLM, and Settings.
- Preserved AI Control safety behavior while making it a dedicated page: dry-run first, read-only local search can reveal results, risky actions still require confirmation.
- Updated Electron UI smoke to navigate page-by-page before exercising controls, which keeps button coverage aligned with the new UI architecture.
- Hardened Electron smoke startup settings for Windows validation stability.
- Fixed desktop data-directory smoke by navigating to Settings before looking for data-directory controls.
- Rewrote the public README and added Chinese launch-oriented documentation so the repository is ready for GitHub presentation.

## 0.3.0 - Desktop Delivery And Real Workflow Completion

### Change Summary

- Added a Windows desktop shell:
  - `electron/main.cjs`
  - API child-process lifecycle
  - packaged UI loading
  - graceful cleanup on window/app close
- Added desktop smoke scripts:
  - `electron/smoke.cjs`
  - `electron/smoke-packaged.cjs`
- Added Electron builder scripts and config:
  - `desktop`
  - `smoke:desktop`
  - `smoke:desktop:packaged`
  - `pack:win`
  - `dist:win`
- Added `apache-arrow@18.1.0` for packaged LanceDB compatibility.
- Added local directory scan/import APIs and smoke coverage.
- Hardened directory import with scanId-bound sessions, canonical path validation, Windows UNC/device namespace rejection, symlink skipping, and import-time realpath revalidation.
- Added AnythingLLM Desktop management APIs, UI controls, and smoke coverage.
- Added AnythingLLM de-index cleanup for document delete, batch delete, and collection delete using persisted per-chunk locations.
- Added AnythingLLM reprocess cleanup for old synced locations, with preserved retry metadata and warnings when cleanup fails or is skipped.
- Added batched AnythingLLM cleanup calls through `VECTOR_FORGE_ANYTHING_CLEANUP_BATCH_SIZE`.
- Added document-level AnythingLLM cleanup retry for failed reprocess cleanup: pending chunks are marked for cleanup, document detail exposes a retry button, and retry calls only the preserved locations.
- Expanded `smoke:anythingllm` to cover add-embedding half-success recovery without duplicate raw uploads, reprocess cleanup, sync after reprocess, simulated cleanup failure, retry cleanup, sync after retry, and final delete cleanup.
- Added `server/job-cancel-retry-smoke.ts` and `npm run smoke:jobs` for queued cancel, running OCR cooperative cancel, reprocess failure state, same-document retry, and post-retry search.
- Added persisted onboarding APIs and state file:
  - `data/onboarding.json`
  - `GET /api/onboarding`
  - `PATCH /api/onboarding`
  - `POST /api/onboarding/complete`
  - `POST /api/onboarding/reset`
- Replaced the static first-run checklist with a real onboarding dialog and sidebar status. The dialog can confirm data/LanceDB readiness, confirm or create a collection, test embedding, test or skip OCR, test or skip AnythingLLM, complete, dismiss, and reset.
- Added `server/onboarding-smoke.ts` and `npm run smoke:onboarding` for persistence, restart persistence, complete/reset, readiness, and secret redaction.
- Added `electron/smoke-ui.cjs`, `VECTOR_FORGE_UI_SMOKE`, and `npm run smoke:ui` to click through the Electron-rendered UI.
- Replaced remaining native collection-create and batch-delete dialogs with React dialogs. UI smoke now guards against native `prompt`/`confirm`/`alert` calls, creates a collection through the dialog, and batch-deletes a document through slug confirmation.
- Added `server/button-audit-smoke.ts` and `npm run smoke:buttons` to statically reject native React buttons with missing handlers, no-op handlers, or direct `alert`/`prompt`/`confirm` usage.
- Added a stable OCR skip path in onboarding so first-run setup can complete when real OCR is intentionally deferred.
- Added failed-upload retry coverage before indexed document creation to `smoke:jobs`.
- Added job-finish refresh, AnythingLLM-sync refresh, dirty-config blocking for copy-to-default, clickable workspace chips, search/copy guards, detail-load degradation, and UI format accept-list parity.
- Hardened UI copy and control states around unsaved collection config.
- Aligned visible button disabled states with real handler preconditions for import, scan, search, copy, delete, AI quick commands, task cancel, and installer launch/check-format controls.
- Hardened global busy state around refresh, search-result document opening, search query/Top K edits, and configuration/AnythingLLM form edits.
- Added clipboard fallback for copy citation and copy document ID.
- Added `POST /api/anythingllm/workspaces` and updated the UI to read workspaces with the current draft AnythingLLM URL/key/exe path.
- Fixed directory select-all so it only selects visible scan candidates.
- Fixed narrow mobile search layout so Top K and copy-citation remain available.
- Expanded `smoke:release` to cover directory import, security, AnythingLLM sync, AnythingLLM Desktop, and desktop smoke.
- Expanded `smoke:release` again to include onboarding smoke and UI smoke.
- Added `smoke:ocr:real`, `smoke:ui:built`, `smoke:desktop:built`, `dist:win:built`, and `smoke:release:target`. The target release gate requires real Tesseract OCR, generates Windows artifacts, and runs packaged desktop smoke.
- Added React-side AI dry-run policy integration. AI commands now call `/api/ai/tools/dry-run`; only read-only local search auto-runs, supported write/test/sync/import actions require in-panel confirmation, and unsupported destructive/local-execution tool classes stop with manual-confirmation guidance and an auditable policy decision.
- Added visible AI policy state in the control panel and stable smoke selectors for AI quick commands.
- Added React confirmation dialogs for AnythingLLM sync, document-level AnythingLLM cleanup retry, risky OCR tests, installer-folder open, and installer launch.
- Restricted Electron `shell.openExternal` handling to an explicit HTTP/HTTPS host allowlist.
- Expanded UI smoke to intercept risky endpoints and prove they are not called before confirmation: AI write/sync direct calls, installer-folder open, installer launch, OCR test, AnythingLLM sync, and AnythingLLM cleanup.
- Expanded UI smoke to cover document show-all, directory candidate show-all, import-all candidate submission, stale AnythingLLM workspace chip clearing after draft API changes, risky upload confirmation, scanned-path import confirmation, single-document reprocess confirmation, and batch reprocess confirmation/selection reset.
- Expanded UI smoke to cover selected scanned-path import, AI free-text search, exact-name single-document delete, task-center cancel, current-collection config-control save persistence, and custom `AnythingLLM.exe` path save/clear persistence.
- Isolated `smoke:ui:built` with a temporary Electron `userData` directory and widened the onboarding-dialog wait to avoid profile/localStorage timing noise.
- Added desktop data-directory selection and persistence through Electron preload IPC, with restart-required UI and a dedicated `smoke:desktop:data-dir` regression test. The smoke now covers save, pending relaunch, reset, and `VECTOR_FORGE_DATA_DIR` env override lock across UI and IPC.
- Added Electron top-level navigation hardening and froze the preload API object.
- Added a per-session Electron local-action token for trusted local actions. When set, AI policy, AnythingLLM Desktop management, directory scan, and local-path import endpoints require `X-Vector-Forge-Local-Action-Token`.
- Expanded the Electron local-action token gate to all `/api` write requests when `VECTOR_FORGE_LOCAL_ACTION_TOKEN` is set, and added `server/local-action-token-smoke.ts` / `npm run smoke:local-action-token` for missing/wrong/correct token coverage.
- Upgraded the AI control panel from dry-run-only guidance to confirmed execution for supported local handlers: attachment import, config save/apply/copy default, OCR test, embedding test, AnythingLLM test, and AnythingLLM sync.
- Routed AI `应用默认` pending actions through the same React apply-default confirmation dialog as the page button.
- Added processing-risk confirmation for import, scanned-path import, single-document reprocess, and batch reprocess when external embedding, cloud OCR, or PaddleOCR local execution is configured.
- Added post-confirmation state cleanup for risk-confirmed imports/batch reprocesses and AI file imports.
- Removed UI access cutoffs: document management can show all documents, directory scan can show all candidates, and scanned candidates can be imported all at once.
- Cleared stale AnythingLLM workspace chips on knowledge-base/API credential changes and disabled workspace loading until both draft base URL and API key are present.
- Deleted app-managed uploaded source copies during single-document delete when they are not referenced by remaining documents; `smoke:upload` now verifies this.
- Added confirmation for applying default parameters to a collection.
- Added atomic `.tmp` + `.bak` JSON persistence for config, manifest, onboarding, and per-collection documents files; manifest counts now reconcile from document manifests, and AI audit JSONL reads tolerate malformed trailing lines.
- Added `server/persistence-smoke.ts` / `npm run smoke:persistence` and included it in both release gates.
- Added durable AnythingLLM cleanup queue persistence in `data/anythingllm-cleanup-queue.json`, with queue inspection/retry APIs and redacted responses.
- Reworked document delete, collection delete, and reprocess cleanup to prepare queue intent before local destructive commits, activate after commit, and retain failed or credential-blocked cleanup entries for retry.
- Expanded `server/anythingllm-sync-smoke.ts` to cover orphan cleanup retry after local document deletion and mismatched-baseUrl collection delete cleanup preservation.
- Added the global AnythingLLM cleanup queue UI in the AnythingLLM configuration card, including counts, per-entry metadata, missing-key badges, refresh, retry-all, per-entry retry, and a React confirmation dialog for `POST /api/anythingllm/cleanup-queue/retry`.
- Expanded Electron UI smoke to seed an orphan cleanup queue entry, verify it appears in the UI, verify the missing-key state is visible, and verify global cleanup retry does not call the backend before confirmation.
- Browser QA found the cleanup queue title could be squeezed into vertical text in the narrow right inspector; the queue header was changed to a single-column layout and rechecked with no horizontal overflow.
- Added an MCP resource catalog in the configuration card with seven read-only resource URIs and copy buttons, and expanded `server/smoke.ts` plus Electron UI smoke to verify resource listing, reading, redaction, and UI row count.
- Added `server/mcp-write-smoke.ts` and token forwarding in `server/mcp.ts` so MCP write tools work when the desktop API enforces `VECTOR_FORGE_LOCAL_ACTION_TOKEN`.
- Added `server/embedding-provider-smoke.ts` and explicit OpenAI-compatible embedding request timeout/response validation.
- Added confirmation dialogs for copy-current-to-default and desktop relaunch, with Electron UI/data-dir smoke coverage.
- Generated Windows release artifacts under `release/`.
- Expanded Electron UI smoke to cover visible copy-citation clipboard text, per-entry AnythingLLM cleanup queue retry payload `{ ids: [...] }`, sidebar/dialog onboarding reset, and AnythingLLM environment refresh.
- Expanded `smoke:persistence` with A/B collection config isolation across backup recovery.
- Expanded `smoke:anythingllm` with targeted cleanup queue retry and API-key redaction checks.
- Added `server/release-artifacts-smoke.ts` / `npm run smoke:release:artifacts`, then wired it into the target release gate after Windows artifact generation and packaged exe smoke.
- Expanded `smoke:desktop:data-dir:built` to verify a saved custom data root on the next desktop launch and default-root restoration after reset.

### Important Implementation Notes

- `build.electronDist` is pinned to `./node_modules/electron/dist`. This avoids Windows `EPERM` rename failures seen during electron-builder's default Electron download/extract path.
- `asar` remains disabled. This is intentional for the current delivery because LanceDB native/runtime files and OCR resources are easier to validate unbundled.
- Packaged exe smoke writes a JSON result file through `VECTOR_FORGE_DESKTOP_SMOKE_RESULT`; GUI executables on Windows do not reliably emit stdout.
- Directory import copies selected files into app-managed storage before parsing. The app does not mutate the user's external source directory, and import must be tied to a fresh server-side scan session.
- AnythingLLM installer launch/download/open-folder APIs are local-only and guarded; smoke covers unsafe path rejection and CORS rejection.
- Electron desktop sessions set `VECTOR_FORGE_LOCAL_ACTION_TOKEN`; browser development sessions do not set it, so they keep the existing loopback-only workflow.
- Desktop data-directory changes are intentionally restart-bound. The app persists the selected next-launch data root outside the data directory at Electron `userData/desktop-settings.json`.
- AnythingLLM delete cleanup de-indexes workspace records through `update-embeddings` `deletes`. It does not prove AnythingLLM physically removes raw custom document JSON files.
- The durable cleanup queue is not drained by a background timer; drain happens only during the initiating delete/reprocess flow or explicit `POST /api/anythingllm/cleanup-queue/retry`. This keeps smoke tests deterministic and avoids surprising external calls.
- Cleanup queue responses expose locations and status for operator review, but only expose `apiKeyConfigured`; raw API keys are never returned.
- The cleanup queue UI follows the same deterministic model: refresh only reads local queue state, and retry actions require explicit confirmation before remote AnythingLLM deletion calls.

### Verification Summary

Passed:

- `npx tsc -p tsconfig.app.json --noEmit`
- `npx tsc -p tsconfig.server.json --noEmit`
- `npm run lint`
- `npm run build`
- `npm run smoke:buttons`
- `npm run smoke`
- `npm run smoke:persistence`
- `npm run smoke:documents`
- `npm run smoke:directory`
- `npm run smoke:onboarding`
- `npm run smoke:ocr`
- `npm run smoke:security`
- `npm run smoke:mcp:writes`
- `npm run smoke:embedding-provider`
- `npm run smoke:release`
- `npm run smoke:release:target`
- `npm run smoke:upload`
- `npm run smoke:ai-tools`
- `npm run smoke:local-action-token`
- `npm run smoke:anythingllm`
- `npm run smoke:anythingllm-desktop`
- `npm run smoke:jobs`
- `npm run smoke:ui`
- `npm run smoke:ui:built`
- `npm run smoke:desktop:data-dir:built`
- `npm run smoke:desktop:built`
- `npm run pack:win`
- `npm run smoke:desktop:packaged`
- `npm run smoke:release:artifacts`
- `npm run dist:win`
- `npm run smoke:ocr:real`

Additional focused checks passed:

- `npm run smoke:directory`
- `npm run smoke:anythingllm-desktop`
- `npm run smoke:desktop:data-dir`
- Browser UI desktop check at `http://127.0.0.1:5184/`
- Browser UI local search and copy-citation check at `http://127.0.0.1:5184/`
- Browser UI busy-state check with delayed search: query, Top K, refresh, and configuration controls disabled while search was running.
- Browser UI mobile-width check at `390x844`
- Browser UI candidate selection check with 14 scan results: 12 visible candidates selected, 2 hidden candidates reported, no horizontal overflow.
- Browser UI AnythingLLM cleanup queue check: queue panel visible, no horizontal overflow, title width normal after layout fix, empty queue keeps retry disabled.
- Browser UI onboarding check: completed persisted first-run flow through scoped buttons; reload did not re-open the completed wizard; desktop and mobile had no horizontal overflow and no page console errors.
- Electron UI smoke check: completed onboarding, created a collection through the React dialog, batch-deleted a document through slug confirmation, indexed/search/opened a document detail through real UI buttons, reported `nativeDialogCalls: 0`, and reported no horizontal overflow.
- Electron UI safety check: AI save/sync/apply-default quick commands produced dry-run decisions and no direct write/sync/apply-default calls; the AI strategy/audit panel loaded 8 tool cards and 4 audit rows with no secret text; AnythingLLM connection and desktop test buttons each submitted exactly 1 request; current-collection config controls saved with `configControlPayloadMatches: true` and `configControlPersisted: true`; custom `AnythingLLM.exe` save/clear produced exactly one request each and cleared the UI field; workspace chips applied and persisted the selected workspace, then cleared after draft API URL edits; installer format/download submitted 2 requests and confirmed installer launch submitted the dry-run + launch pair; installer-folder open, installer launch, risky OCR test, AnythingLLM sync, document-level AnythingLLM cleanup, global AnythingLLM cleanup queue retry, risky upload, directory import-all, single-document reprocess, and batch reprocess each stayed at 0 backend side-effect calls before React confirmation. Confirmed processing-risk actions then produced one backend request per action.
- Electron UI added-button check: copy-citation wrote the expected `ui-smoke-note.txt #1` sentinel text, single cleanup queue retry confirmed one selected id payload, onboarding reset reopened and closed the wizard with finish disabled, and AnythingLLM environment refresh updated the visible exe-path input.
- MCP resource smoke: `npm run smoke` read 7 resources with secret redaction checks, and Electron UI smoke reported `mcpResourceRows: 7`.
- MCP write smoke passed with `allowWritesFalseRejected: true`, `searchHitsBeforeDelete: 1`, and `searchHitsAfterDelete: 0`.
- Embedding provider smoke passed with `providerCalls: 7`, `searchResults: 1`, and expected failure statuses `502/502/400/504`.
- UI smoke reported `copyDefaultCalls: 1`; data-dir smoke reported `relaunchCalls: 1`.
- Electron data-dir smoke: saved a custom next-launch data root, verified `pendingRelaunch`, verified a second desktop launch used the custom root, verified reset restored the default root on a third launch, verified `desktop-settings.json` persistence under isolated Electron `userData`, and verified env override lock for UI controls, save/reset IPC, and directory picker.
- Release artifact smoke passed after rebuild: setup exe, portable exe, zip, unpacked exe, OCR traineddata, and zip-embedded app package version were all verified.
- Target release gate: `npm run smoke:release:target` passed with real OCR, desktop data-dir smoke, Windows artifact generation, packaged desktop smoke, and release artifact smoke.

### Source Backup

- `C:\Users\jackwolf-power\Documents\Codex\2026-06-21\r\outputs\project-backups\vector-forge-lab-v0.3.0-20260625-103607.zip`
- Backup verification: 48 zip entries, 0 excluded directory entries. Archive entries are rooted at the project file level, not wrapped in a `vector-forge-lab/` parent directory.

### Known Development Tradeoffs

- Fast release smoke keeps real OCR optional because it is slower and machine-dependent. Use this when real OCR must be proved:

```powershell
npm run smoke:ocr:real
```

- First-run onboarding has real state now, but data-directory selection remains startup-bound and is not a runtime data-directory switcher.
- AnythingLLM archive cleanup and raw custom-document deletion semantics still need explicit downstream API confirmation.
- AI control is now dry-run-policy gated, but remains a local deterministic command router rather than a model-backed planner.

## Historical Summary

- `0.2.1`: UI completeness, AI command console, collection-scoped config, document details, batch actions, MCP observability resources, AnythingLLM idempotent sync, and security smoke.
- `0.2.0`: PDF/DOCX/OCR parsing, job queue, reprocess flow, OCR/parser settings, document preview, and redesigned workbench UI.
- `0.1.0`: initial local LanceDB, Web/API/MCP, text/file ingest, search, document management, local-hash embeddings, and optional AnythingLLM API upload.
