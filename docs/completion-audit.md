# Vector Forge Lab Completion Audit

Audit date: 2026-06-25  
Audited version: `0.3.1`  
Scope: current repository state after desktop packaging, desktop data-directory persistence, atomic JSON metadata recovery, hardened directory ingestion, AnythingLLM Desktop management, durable AnythingLLM cleanup queue, full write-route trusted local-action token protection in Electron mode, delete/reprocess cleanup, managed upload-copy cleanup on document delete, document-level and global AnythingLLM cleanup retry, AI dry-run UI policy plus confirmed local actions, dangerous-action confirmation gates, job cancel/retry smoke, static button audit smoke, expanded Electron UI button-path smoke, real-OCR target gate, release smoke, browser QA, and packaged exe smoke.

## Summary

v0.3.1 is the current repository iteration. It keeps the v0.3.0 desktop/vector-search baseline and adds the split-page UI architecture, page-by-page Electron UI smoke coverage, data-directory smoke adaptation for the new Settings page, and public GitHub documentation polish.

The strongest completed areas are local LanceDB ingestion/search, PDF/DOCX/image OCR parsing, collection-scoped configuration, document detail/reprocess/delete flows, managed uploaded source-copy cleanup on document delete, atomic JSON metadata recovery, persisted onboarding, restart-bound desktop data-directory selection, MCP read resources, AnythingLLM idempotent upload tracking, AnythingLLM delete and reprocess de-index for recorded locations, durable orphan cleanup retry after local deletion, document-level and global AnythingLLM cleanup retry UI, scan-session-bound local directory ingestion, AnythingLLM Desktop management, trusted local-action token protection for Electron write routes, AI dry-run policy enforcement with confirmed local actions, React confirmation gates for external/local/destructive actions, deterministic job cancel/retry coverage, Electron packaging, static button audit smoke, expanded UI button-path smoke coverage, real-OCR target-machine smoke, and packaged-app smoke validation.

The main remaining gaps are hot-swapped runtime data-directory switching, AnythingLLM archive cleanup and raw custom-document file deletion semantics, app icon/asar polish, and making the AI control console a real model-backed planner rather than a local command router.

## Gap Matrix

| Plan area | Status after v0.3.0 | Evidence in current repo | Remaining gap / next action |
|---|---|---|---|
| Web/API/MCP baseline | Complete | `package.json` version `0.3.0`; `server/index.ts`; `server/mcp.ts`; `src/main.tsx`; `CHANGELOG.md` 0.3.0 section. | Keep this as the stable product baseline. |
| Document ingestion and parsing | Complete for planned first slice | `server/document-processing.ts`; upload/document/reprocess routes in `server/index.ts`; `server/upload-smoke.ts` now verifies managed source-copy removal after document delete; `server/document-smoke.ts`. | Add XLSX/PPTX/EPUB later as separate format work. |
| OCR support | Complete for current engines and target-machine validation | `auto`, `tesseract`, `paddleocr`, and `cloud` configuration exist; `server/ocr-smoke.ts`; `server/ocr-real-smoke.ts`; `npm run smoke:ocr:real`; `npm run smoke:release:target`. | Fast `smoke:release` keeps real OCR optional for speed; use target gate when OCR must be mandatory. |
| Collection configuration UI | Complete for current/default parameter split | `src/main.tsx` exposes current collection parameters and default template behavior; backend collection config read/write/apply-default routes exist. Electron UI smoke edits current-collection config controls, clicks `保存当前`, and verifies the submitted payload plus persisted config. | Add config migration notes before changing schema. |
| Dirty config safety | Complete | UI blocks AnythingLLM sync when draft collection config is unsaved and clarifies import/reprocess/MCP behavior. | Keep testing this with future config fields. |
| Embedding provider management | Complete for local-hash plus OpenAI-compatible first slice | `server/index.ts` validates OpenAI-compatible provider timeout, response shape, numeric vectors, and dimensions; `server/embedding-provider-smoke.ts` verifies fake-provider success/index/search plus 401, bad shape, dimension mismatch, and timeout statuses. | Add provider presets/test history UI later if needed. |
| First-run wizard and data directory | Complete for first slice | `data/onboarding.json`; `/api/onboarding` routes; `src/main.tsx` onboarding dialog/sidebar/settings data-dir UI; `electron/preload.cjs`; `electron/smoke-data-dir.cjs`; `server/onboarding-smoke.ts`; `electron/smoke-ui.cjs`. | Data-directory selection is restart-bound; add hot-swap/migration only if explicitly required. |
| Directory scanning/import | Complete for local manual scan/import | `POST /api/collections/:slug/scan-directory`; `POST /api/collections/:slug/import-paths`; `server/directory-smoke.ts` now verifies scanId-bound import, rejected path-only import, and rejected outside-scan import. | Add watch mode, ignore patterns, incremental rescan, source manifest, and UI conflict resolution later. |
| AnythingLLM upload sync idempotency | Complete for duplicate upload prevention and add-embedding recovery | `server/index.ts` stores per-chunk sync metadata; `server/anythingllm-sync-smoke.ts` proves raw-upload persistence after add-embedding failure, recovery without duplicate raw uploads, and second skip behavior. | Keep scope as append/upload idempotency, not full bidirectional sync. |
| AnythingLLM remote cleanup | Complete for recorded delete/reprocess/retry/orphan locations | Document delete, batch delete, collection delete, successful reprocess cleanup, failed reprocess cleanup preservation, document-level retry, durable global cleanup queue, global cleanup queue UI, and cleanup batching are implemented; `server/anythingllm-sync-smoke.ts` verifies first sync, idempotent second sync, reprocess cleanup, simulated cleanup failure, retry cleanup, sync after retry, delete cleanup, orphan cleanup retry after local deletion, and mismatched-baseUrl collection delete preservation. Electron UI smoke verifies the global cleanup queue panel displays orphan state and blocks retry before confirmation. | Add archive cleanup and clearer raw-file deletion semantics if AnythingLLM API supports them. |
| Local JSON persistence | Complete for current metadata files | `server/index.ts` uses atomic temp writes and `.bak` recovery for config, manifest, onboarding, and documents files; `server/persistence-smoke.ts` corrupts primary JSON files and verifies recovery, audit JSONL bad-line tolerance, and manifest count reconciliation. | Add deeper corruption telemetry or user-facing repair UI only if needed. |
| AnythingLLM Desktop management | Complete for first slice | Routes in `server/index.ts`; UI in `src/main.tsx`; `server/anythingllm-desktop-smoke.ts`; `POST /api/anythingllm/workspaces` supports draft config reads. Electron UI smoke saves and clears a fake local `AnythingLLM.exe` path through the visible buttons and verifies the request payloads plus UI state. | Add real installed-version detection and richer API capability detection later. |
| AI control safety | Complete for deterministic local command router | `src/main.tsx` calls `/api/ai/tools/dry-run` before AI commands and requires `确认执行` for supported write/test/sync/import actions; AI apply-default opens the same React confirmation dialog as the page button; `server/ai-tools-policy-smoke.ts`; `electron/main.cjs` UI smoke verifies dry-run calls and 0 direct write/sync/apply-default calls before confirmation. | A model-backed planner remains future work and must keep explicit tool authorization. |
| Dangerous UI actions | Complete for current high-risk buttons | React confirmation dialogs cover AnythingLLM sync, document-level AnythingLLM cleanup retry, global cleanup queue retry, risky OCR tests, installer-folder open, installer launch, upload/import/reprocess external-send/local-execution risks, apply-default overwrite, document delete, and batch delete; UI smoke verifies key side-effect endpoints are not called before confirmation and that confirmed upload/import/reprocess/batch-reprocess each send exactly one backend request. | Keep adding UI smoke when new side-effect buttons are introduced. |
| Native button reliability | Complete for current React button surface | `server/button-audit-smoke.ts`; `npm run smoke:buttons`; current audit result checks 99 native buttons and reports 0 missing/no-op/native-dialog issues. | Add matching UI smoke paths for new side-effect buttons; static audit proves handlers exist but does not replace rendered interaction testing. |
| Task cancel coverage | Complete for queued/running cooperative cancel | `POST /api/jobs/:jobId/cancel`; UI cancel for queued/running jobs; `server/job-cancel-retry-smoke.ts` verifies queued cancel, running cloud-OCR cooperative cancel, no document creation, and one OCR request before cancellation. | Add deeper cancellation checks only if new long-running embedding/indexing stages are introduced. |
| Task retry coverage | Complete for indexed reprocess and processing-stage failed uploads | Reprocess and batch reprocess work for indexed documents with original uploaded copies; `server/job-cancel-retry-smoke.ts` verifies failed reprocess retry and processing-stage failed upload retry on the same document ID. | Save-copy failures and cancelled jobs intentionally may not create retryable documents. |
| MCP management surface | Complete for read resources and current write-tool lifecycle | `server/mcp.ts` read tools/resources; write tools gated by `mcp.allowWrites`; MCP forwards `VECTOR_FORGE_LOCAL_ACTION_TOKEN` for local API writes; the UI lists all seven read-only resource URIs with copy buttons; `server/smoke.ts` lists/reads 7 resources and checks secret redaction; `server/mcp-write-smoke.ts` verifies disabled writes plus token-protected upsert/search/get/delete; Electron UI smoke reports `mcpResourceRows: 7`. | Add MCP resources/tools for scan jobs and cleanup status only after those workflows mature. |
| Electron exe / portable zip | Complete | `electron/main.cjs`; `electron/preload.cjs`; `electron/smoke.cjs`; `electron/smoke-data-dir.cjs`; `electron/smoke-packaged.cjs`; `package.json` builder config. | Add custom icon, signing strategy, and asar optimization later. |
| Desktop packaging validation | Complete for launch/readiness smoke | `npm run pack:win`; `npm run dist:win`; `npm run smoke:desktop:packaged`. | Add installer install/uninstall smoke if release process needs it. |
| Release smoke gating | Strong fast gate plus target-machine gate | `smoke:release` runs lint, build, static button audit, local smokes, persistence recovery, onboarding, security, AI tools policy, local-action token boundary, AnythingLLM, AnythingLLM Desktop, job retry, UI smoke, desktop data-dir smoke, and desktop smoke. `smoke:release:target` adds `smoke:ocr:real`, artifact generation, packaged desktop smoke, and `smoke:release:artifacts`. | Keep using the target gate before binary delivery when OCR and artifacts must be proven on the target machine. |

## Delivered Artifacts

- `C:\Users\jackwolf-power\Documents\Codex\2026-06-21\r\work\vector-forge-lab\release\win-unpacked\Vector Forge Desktop.exe`
- `C:\Users\jackwolf-power\Documents\Codex\2026-06-21\r\work\vector-forge-lab\release\Vector Forge Desktop-Setup-0.3.0-x64.exe`
- `C:\Users\jackwolf-power\Documents\Codex\2026-06-21\r\work\vector-forge-lab\release\Vector Forge Desktop-Portable-0.3.0-x64.exe`
- `C:\Users\jackwolf-power\Documents\Codex\2026-06-21\r\work\vector-forge-lab\release\Vector Forge Desktop-0.3.0-x64.zip`
- Support artifacts generated for traceability: `release\Vector Forge Desktop-Setup-0.3.0-x64.exe.blockmap`, `release\builder-debug.yml`.

## Source Backup

- `C:\Users\jackwolf-power\Documents\Codex\2026-06-21\r\outputs\project-backups\vector-forge-lab-v0.3.0-20260625-103607.zip`
- Backup verification: 48 zip entries, 0 excluded directory entries. Archive entries are rooted at the project file level, not wrapped in a `vector-forge-lab/` parent directory.

## Tests Passed

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
- `npm run smoke:release:target`
- `npm run pack:win`
- `npm run smoke:desktop:packaged`
- `npm run smoke:release:artifacts`
- `npm run dist:win`

Additional browser checks passed:

- Desktop `http://127.0.0.1:5184/`: onboarding completed through real scoped buttons, reload did not reopen the completed wizard, local search returned results, and no page console errors were produced.
- Mobile `390x844`: no horizontal overflow; primary controls stayed visible with correct disabled states.
- Busy-state browser check: delaying `/search` disabled query, Top K, refresh, and configuration controls while the request was in flight, then restored them after completion.
- Electron UI smoke: onboarding, collection creation dialog, config-control edit/save persistence, custom `AnythingLLM.exe` save/clear persistence, document show-all, directory candidate show-all/import-all, MCP resource list/copy control, copy-default confirmation, AI strategy/audit panel loading, AnythingLLM connection/desktop test buttons, AnythingLLM environment refresh, workspace-chip apply/save persistence, stale workspace-chip clearing, installer format/download/confirmed-launch request sequence, batch delete confirmation dialog, AI dry-run guard, dangerous-action confirmation guard, global cleanup queue confirmation guard, per-entry cleanup queue retry confirmation/payload, processing-risk confirmation for upload/import/reprocess/batch-reprocess, citation copy, onboarding reset, text indexing, search, and document-detail open passed through real UI buttons, with `mcpResourceRows: 7`, `copyDefaultCalls: 1`, `nativeDialogCalls: 0`, `aiBlockedDirectCalls: 0`, `aiToolCards: 8`, `aiAuditRows: 4`, `aiAuditHasSecret: false`, `configControlPayloadMatches: true`, `configControlPersisted: true`, `anythingEnvironmentRefreshCalls: 1`, `anythingEnvironmentRefreshUpdatedInput: true`, `anythingExePathSaveCalls: 1`, `anythingExePathClearCalls: 1`, `desktopActionCallsBeforeConfirm: 0`, `ocrTestCallsBeforeConfirm: 0`, `syncCallsBeforeConfirm: 0`, `cleanupCallsBeforeConfirm: 0`, `cleanupQueueCallsBeforeConfirm: 0`, `cleanupQueueSingleRetrySubmitCalls: 1`, `cleanupQueueSingleRetryPayloadMatches: true`, `citationCopyMatches: true`, `onboardingResetDialogCalls: 1`, `anythingConnectionTestCalls: 1`, `anythingDesktopTestCalls: 1`, `workspaceChipClicked: true`, `workspaceChipPersisted: true`, `workspaceChipsClearedAfterDraftChange: true`, `installerDownloadCalls: 2`, `installerLaunchCallsAfterConfirm: 2`, `riskUploadCalls: 1`, `riskImportCalls: 1`, `riskReprocessCalls: 1`, and `riskBatchReprocessCalls: 1`.
- Button audit smoke: checked 99 native React buttons and reported 0 missing/no-op/native-dialog issues.
- Expanded Electron UI button-path smoke: selected scanned-path import after risk confirmation, AI free-text search dry-run plus search execution, exact-name single-document delete, and task-center cancel each produced exactly one expected backend request plus the expected visible state change.
- Electron data-dir smoke: saved a custom next-launch data root, verified `pendingRelaunch`, verified a second launch used the custom root, reset back to default, verified a third launch used the restored default root, verified `desktop-settings.json` persistence under isolated Electron `userData`, and verified `VECTOR_FORGE_DATA_DIR` env override locks UI controls plus save/reset IPC and directory picker.
- Persistence smoke: corrupted primary config, manifest, onboarding, and document JSON files, recovered each from `.bak`, skipped a malformed AI audit JSONL line, and repaired manifest document/chunk counts from document records.
- AnythingLLM cleanup queue smoke: after simulated remote delete failure, local document deletion still completed, the orphan locations stayed in the durable cleanup queue, global retry deleted them, and mismatched-baseUrl collection deletion preserved cleanup intent without calling the wrong endpoint.
- Release artifact smoke: verified setup exe, portable exe, zip, unpacked exe, OCR traineddata resources, selected zip entries, and zip-embedded package version after target Windows rebuild.
- Browser UI AnythingLLM cleanup queue check: the queue panel rendered in the right inspector with no horizontal overflow, the header stayed horizontal at narrow inspector width, and the empty-queue state kept retry disabled.

## Browser QA Added After Audit

- Directory scan with 14 supported files showed 12 visible candidates and a warning for 2 hidden candidates.
- The directory select-all checkbox selected only the 12 visible candidates; hidden candidates were not queued by the UI.
- Mobile width `390x820` kept Top K, search, and copy-citation controls visible without horizontal overflow.
- Browser console remained free of new errors/warnings during the final copy/search checks.

## High-Value Next Slice

1. Decide whether desktop data-root changes should support hot-swap/migration, or keep the current restart-bound model.
2. Finish AnythingLLM archive cleanup and raw custom-document deletion semantics where the downstream API supports them.
3. Replace the local AI command router with a model-backed planner only after tool safety boundaries are explicit.
4. Add branded icon, optional signing, and revisit `asar` once packaged LanceDB/OCR resource paths are stable.
