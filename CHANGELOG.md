## 0.3.2 - 2026-06-25

- Added keyboard shortcuts modal: press `?` to view all shortcuts (Ctrl+K search, Ctrl+Shift+I import, Esc close, ? toggle panel).
- Added "Clear" chat button in AI Control panel to clear the conversation history.
- Added "????" button on Collections config summary to jump directly to Settings for detailed parameter editing.
- Added `Eraser` icon to lucide-react imports for the AI clear chat feature.

﻿# Changelog

## 0.3.1 - 2026-06-25

- Reworked the main workbench into page-isolated sidebar navigation. Each left-nav entry opens a dedicated page for Overview, AI Control, Collections, Local Search, Import Jobs, Documents, OCR/Parser, MCP, AnythingLLM, or Settings instead of keeping the old combined right-side surface mounted together.
- Added page-scoped title and description copy. Overview metrics stay on the overview page, search/document/AI panels mount only on their own pages, and configuration pages render only the relevant collection/settings/parser/MCP/AnythingLLM controls.
- Kept AI Control as a dry-run-policy-gated local command router, while making it a first-class page. Read-only local search can auto-run and reveal the dedicated search page with results; write/test/sync/import actions still require explicit confirmation and call the same real handlers used by visible page buttons.
- Updated Electron UI smoke for the split-page model. The smoke now navigates page-by-page before interacting with documents, search, AI, settings, parser/OCR, MCP, jobs, and AnythingLLM controls, so coverage no longer depends on all panels being mounted at once.
- Hardened Electron smoke startup on Windows with disabled GPU/compositing/rasterization flags, direct proxy mode, smoke-safe sandbox handling, local API readiness waiting, and `loadURL` retry behavior to reduce startup flakiness.
- Fixed desktop data-directory smoke after the split-page UI change by navigating to the Settings page before asserting data-directory controls.
- Rewrote the public GitHub README around the project value proposition, feature set, architecture, quick start, verification, MCP usage, security model, and roadmap.
- Added Chinese GitHub-facing documentation and launch copy for positioning the project as a local-first AI knowledge-base desktop app.

## 0.3.0 - 2026-06-25

- Added the Windows desktop delivery path for the merged app: Electron main process, local API lifecycle, packaged-app smoke test, `win-unpacked`, NSIS setup exe, portable exe, and zip output.
- Added packaged desktop validation scripts: `desktop`, `smoke:desktop`, `smoke:desktop:packaged`, `pack:win`, and `dist:win`.
- Fixed packaged LanceDB startup by shipping the required `apache-arrow` dependency and setting `build.electronDist` to the local Electron runtime to avoid Windows rename failures during packaging.
- Added local directory ingestion: `POST /api/collections/:slug/scan-directory` and `POST /api/collections/:slug/import-paths`, with loopback protection, absolute-path validation, extension allowlist, flat/recursive scan, max candidate guard, metadata preview, and import into the existing managed upload/parser/OCR/embedding/LanceDB pipeline.
- Hardened directory import with server-side scan sessions: imports now require a `scanId`, support candidate IDs, re-resolve paths with `realpath` immediately before copying, reject stale/outside/UNC/device paths, and only import files returned by the current scan.
- Added `smoke:directory` to verify scanning, importing, indexing, and searching files copied from an external local directory without deleting or moving the source files.
- Added AnythingLLM Desktop management APIs and UI: environment refresh, custom `AnythingLLM.exe` path save/clear, desktop/API test, workspace fetch, official installer URL validation/download handoff, installer folder open, and installer launch.
- Added `smoke:anythingllm-desktop` with fake API and fake executable coverage for safe local execution, path validation, installer dry-run behavior, CORS rejection, and unsafe-path rejection.
- Tightened collection-config UX: import, reprocess, MCP, AI control, and AnythingLLM sync now distinguish draft edits from saved collection config; sync is blocked until current collection parameters are saved.
- Added draft-config workspace loading for AnythingLLM Desktop management; the UI now posts the currently visible AnythingLLM URL/key/exe draft when reading workspaces, and `smoke:anythingllm-desktop` verifies this path before saved config exists.
- Fixed directory candidate selection so select-all only selects visible candidate rows; when scans return more than the displayed limit, the UI shows how many candidates are not currently displayed.
- Restored mobile search controls so Top K and copy-citation remain visible at narrow widths without horizontal overflow.
- Added clearer disabled-state explanations for AI attachment import and AnythingLLM sync buttons.
- Tightened front-end button behavior so navigation, import, scan, search, copy, delete, task cancel, AI quick commands, and installer actions no longer appear active when the underlying handler would no-op.
- Added clipboard fallback for copy-citation and copy-document-ID actions so browser clipboard permission denial does not make copy buttons silently fail.
- Clarified MCP write-setting behavior in the UI: collection config alone does not mutate a running MCP process; the user must save config, copy it as default where needed, and restart MCP.
- Added an MCP resource catalog to the UI with copy buttons for all seven read-only resource URIs, including embedding status, recent jobs, AnythingLLM sync status, and OCR/document quality.
- Added AnythingLLM workspace de-index cleanup for document delete, batch delete, and collection delete using persisted per-chunk locations. `smoke:anythingllm` now verifies first sync, second-sync idempotency, and delete cleanup through fake `update-embeddings` `deletes`.
- Added AnythingLLM reprocess cleanup: successful local reprocess deletes old recorded workspace embeddings before allowing a fresh sync; cleanup failures or skipped base URLs preserve prior sync metadata with a warning so later delete/retry still has locations.
- Added cleanup batching for AnythingLLM de-index calls through `KNOWLEDGE_FORGE_ANYTHING_CLEANUP_BATCH_SIZE`.
- Added document-level AnythingLLM cleanup retry: failed reprocess cleanup now marks old sync chunks as `cleanupPending`, document detail exposes a retry button, and `POST /api/collections/:slug/documents/:documentId/retry-anythingllm-cleanup` retries only the preserved locations.
- Expanded `smoke:anythingllm` to cover upload sync, add-embedding half-success recovery without duplicate raw uploads, second-sync idempotency, reprocess cleanup, sync after reprocess, simulated cleanup failure, retry cleanup, sync after retry, and final delete cleanup.
- Added `smoke:jobs` for deterministic queued-job cancel, running OCR cooperative cancel, single-document reprocess failure, failed-document state persistence, retry success with the same document ID, and post-retry search.
- Added persisted onboarding state and APIs: `GET /api/onboarding`, `PATCH /api/onboarding`, `POST /api/onboarding/complete`, and `POST /api/onboarding/reset`.
- Replaced the static first-run checklist with a real onboarding dialog that confirms data/LanceDB readiness, collection selection, embedding test, OCR test or skip, optional AnythingLLM test/skip, completion, dismissal, and reset.
- Added `smoke:onboarding` to verify onboarding persistence across restart, complete/reset behavior, readiness summaries, and secret redaction.
- Added `smoke:ui`, an Electron-rendered UI smoke that clicks through onboarding, creates a collection through the in-app dialog, verifies native `prompt`/`confirm`/`alert` are not used, batch-deletes a document through the slug-confirmation dialog, searches from the UI, and opens document detail.
- Added `smoke:buttons`, a TypeScript AST audit for React native buttons. It fails release validation when a button has no handler, an empty/no-op handler, or direct native dialog usage instead of the app confirmation flow.
- Expanded Electron UI smoke to exercise additional real button paths: selected directory import after risk confirmation, AI free-text search dry-run plus search execution, exact-name single-document deletion, and task-center cancellation.
- Expanded Electron UI smoke again to edit current-collection config controls, save them through the real `保存当前` button, verify the persisted config payload, then save and clear a custom `AnythingLLM.exe` path through the visible desktop-management buttons.
- Added retry coverage for processing-stage failed uploads before an indexed document exists; failed upload jobs now keep a retryable failed document ID and `smoke:jobs` verifies successful retry on the same document ID.
- Improved UI state refresh after async jobs and AnythingLLM sync, so document/collection counts and sync metadata are refreshed when background work finishes.
- Hardened parameter/default UX: `复制为默认` is blocked while current collection parameters are dirty, workspace chips now apply workspace name/slug to the current parameter draft, and file picker formats now include XML/LOG/YAML/YML.
- Added an OCR skip path in onboarding so first-run setup can complete on machines where real OCR validation is deferred.
- Tightened global busy behavior in the UI: refresh, search-result open, search query/Top K inputs, and configuration/AnythingLLM form fields are now blocked during in-flight operations to avoid stale response overwrites.
- Added `smoke:ocr:real` and `smoke:release:target` so target-machine validation can require real Tesseract OCR, rebuild Windows artifacts, and run packaged desktop smoke. The fast `smoke:release` still uses the default skip-capable OCR smoke.
- Added AI control dry-run policy integration in the React UI: natural-language commands call `/api/ai/tools/dry-run` first, only read-only `local.search` can auto-run, supported write/test/sync/import commands require an in-panel `确认执行`, and unsupported destructive/local-execution commands stop with manual-action guidance.
- Added UI policy visibility for the AI control console, including the last matched tool, risk class, blocked/confirmation state, and stable smoke selectors for quick commands.
- Added an AI strategy/audit panel that loads the backend tool registry and recent dry-run audit records without executing any tool actions.
- Added React confirmation gates for AnythingLLM sync, document-level AnythingLLM cleanup retry, risky OCR tests, installer-folder open, and installer launch.
- Hardened Electron external-window handling with an explicit HTTP/HTTPS host allowlist instead of opening arbitrary protocols through `shell.openExternal`.
- Added desktop data-directory selection through a narrow Electron preload API. Users can choose/save/reset a data root, see the pending-relaunch state, and relaunch the app; `KNOWLEDGE_FORGE_DATA_DIR` remains the highest-priority override and locks desktop edits.
- Added `smoke:desktop:data-dir` / `smoke:desktop:data-dir:built` and included the built data-dir smoke in both fast and target release gates. The smoke now verifies save, pending relaunch, reset back to default, `KNOWLEDGE_FORGE_DATA_DIR` env-lock UI, env-lock IPC rejection, and env-lock directory picker behavior.
- Added a per-session Electron local-action token for trusted local actions. When Electron sets `KNOWLEDGE_FORGE_LOCAL_ACTION_TOKEN`, AI policy, AnythingLLM Desktop management, directory scan, and local-path import endpoints require `X-knowledge-forge-Local-Action-Token` in addition to loopback access.
- AI control quick commands now create a visible pending action for supported write/test/sync/import commands. The user must click `确认执行`, then the panel calls the same real handlers used by the page buttons.
- Import, scanned-path import, single-document reprocess, and batch reprocess now show a risk confirmation when the current knowledge-base config uses external embedding, cloud OCR, or PaddleOCR local execution.
- Document management no longer hard-cuts access at 8 rows: users can show all documents, and directory scan results can show all candidates or import all candidates.
- The `应用默认` action now opens a confirmation dialog summarizing the current/default embedding, OCR, and AnythingLLM settings before overwriting the collection config.
- Expanded the per-session local-action token boundary so, when Electron sets `KNOWLEDGE_FORGE_LOCAL_ACTION_TOKEN`, all `/api` write requests require `X-knowledge-forge-Local-Action-Token`; this covers uploads, config writes, provider tests, reprocess/delete, search POSTs, AnythingLLM sync, AI dry-runs, and desktop/local actions.
- Added `smoke:local-action-token` to verify missing/wrong token rejection and correct-token authorization for AI dry-run, AnythingLLM environment, collection writes, embedding test, search, destructive batch delete, and AnythingLLM sync validation.
- Added `smoke:mcp:writes` to verify MCP forwards `KNOWLEDGE_FORGE_LOCAL_ACTION_TOKEN` for local API write requests, rejects `vf_upsert_text` while `mcp.allowWrites=false`, and completes the token-protected `vf_upsert_text` -> `vf_search` -> `vf_get_document` -> `vf_delete_document` lifecycle.
- Added OpenAI-compatible embedding provider timeout and response validation. `smoke:embedding-provider` now uses a local fake provider to verify test/index/search success plus 401, bad response shape, dimension mismatch, and timeout error paths.
- Added React confirmation gates for copying current knowledge-base parameters into the global default template and for desktop relaunch after data-directory changes. UI smoke verifies copy-default makes no API call before confirmation and one call after confirmation; data-dir smoke verifies relaunch confirmation with one dry-run relaunch request.
- Single-document delete now removes the app-managed uploaded source copy under the data root when no other document references it; external source directories scanned by the user are still never deleted.
- AI `config.applyDefault` pending actions now open the same React apply-default confirmation dialog used by the page button instead of directly applying the default template.
- AnythingLLM workspace chips are cleared when the user switches knowledge bases or edits the visible AnythingLLM API URL/key, and `读取 Workspace` now requires both the draft base URL and API key.
- Risk-confirmed imports and batch reprocesses now clear the relevant local selection state after successful confirmation; AI import with processing-risk confirmation clears attached files after the confirmed upload is queued.
- Expanded Electron UI smoke to prove AI write/sync/apply-default commands use dry-run only and that OCR test, AnythingLLM sync, AnythingLLM cleanup, installer-folder open, installer launch, AI apply-default, risky upload, scanned-path import-all, single-document reprocess, and batch reprocess do not call backend side-effect endpoints before React confirmation. The same smoke now verifies document show-all, directory candidate show-all, import-all submits all candidates, AI strategy/audit panel loading with no secret leak, AnythingLLM connection/desktop test buttons, workspace-chip apply/save persistence, stale workspace-chip clearing after draft API changes, installer format/download/confirmed-launch request sequence, and risk-confirmed batch reprocess clears selection.
- Isolated Electron UI smoke under a temporary `KNOWLEDGE_FORGE_USER_DATA_DIR` and widened the onboarding wait to remove profile/localStorage timing noise from release validation.
- Added atomic JSON persistence with `.tmp` + `.bak` recovery for `config.json`, `manifest.json`, `onboarding.json`, and per-collection `*.documents.json`; `manifest` counts now reconcile from document records on load, and malformed trailing AI audit JSONL lines are ignored instead of breaking `/api/ai/tools/audit`.
- Added `smoke:persistence` and included it in both release gates. It creates real API state, corrupts primary JSON files, verifies backup recovery, verifies AI audit bad-line tolerance, and verifies manifest document/chunk count reconciliation.
- Added a durable top-level AnythingLLM cleanup queue at `data/anythingllm-cleanup-queue.json`. Document delete, collection delete, and reprocess now prepare cleanup intent before local destructive commits, activate it after local commit, and keep failed or credential-blocked cleanup entries retryable even after the local document or collection is gone.
- Added `GET /api/anythingllm/cleanup-queue` and `POST /api/anythingllm/cleanup-queue/retry` with local-action protection and API-key redaction.
- Added a global AnythingLLM cleanup queue panel in the AnythingLLM configuration card. Users can refresh queue status, inspect pending/prepared counts, see source/workspace/base URL/document/error/key-state metadata, and retry all or individual pending cleanup entries through a React confirmation dialog.
- Expanded Electron UI smoke to seed a global orphan cleanup entry, verify the queue panel displays the entry and missing-key state, and prove `POST /api/anythingllm/cleanup-queue/retry` is not called before the React confirmation dialog.
- Expanded MCP smoke coverage: `npm run smoke` now lists and reads all seven resources and checks that resource payloads do not leak embedding, AnythingLLM, or cloud OCR secrets; Electron UI smoke verifies the seven-row resource list and copy control.
- Fixed the cleanup queue panel header layout so the right-side inspector no longer squeezes the Chinese title into vertical text at narrow widths.
- Expanded `smoke:anythingllm` to verify failed remote document-delete cleanup still deletes the local document, stores orphan locations in the durable cleanup queue, retries them globally, and preserves cleanup intent when collection delete encounters a mismatched AnythingLLM base URL.
- Expanded `smoke:upload` to verify document delete removes the managed uploaded source copy.
- Expanded `smoke:release` to run lint, build, static button audit, base smoke, persistence smoke, upload smoke, document smoke, directory smoke, onboarding smoke, OCR smoke, security smoke, AI tools policy smoke, local-action token smoke, MCP write smoke, OpenAI-compatible embedding provider smoke, AnythingLLM idempotency/reprocess/retry/orphan-cleanup smoke, AnythingLLM Desktop smoke, job cancel/retry smoke, UI smoke, desktop data-dir smoke, and Electron desktop smoke.
- Expanded Electron UI smoke to prove copy-citation writes the expected source/chunk text, per-entry AnythingLLM cleanup queue retry submits only the selected entry id after React confirmation, onboarding reset buttons reopen the wizard with completion disabled, and AnythingLLM environment refresh updates the visible exe-path field.
- Expanded persistence smoke to verify two collections keep independent embedding/chunking/MCP/AnythingLLM configs across backup recovery, without polluting the global default config.
- Expanded AnythingLLM smoke to verify targeted cleanup-queue retry `{ ids: [...] }` deletes only the selected entry, keeps non-target pending cleanup intact, and redacts saved API keys in responses.
- Added `smoke:release:artifacts` and included it at the end of `smoke:release:target` after `dist:win:built` and packaged desktop smoke. It verifies setup exe, portable exe, zip, unpacked exe, OCR traineddata, and zip-embedded package version.
- Expanded desktop data-dir smoke to launch a second desktop process with the saved custom data root, then a third process after reset to prove the default data root is restored.
- Generated Windows artifacts:
  - `release/win-unpacked/Knowledge Forge.exe`
  - `release/Knowledge Forge-Setup-0.3.0-x64.exe`
  - `release/Knowledge Forge-Portable-0.3.0-x64.exe`
  - `release/Knowledge Forge-0.3.0-x64.zip`
- Generated support artifacts:
  - `release/Knowledge Forge-Setup-0.3.0-x64.exe.blockmap`
  - `release/builder-debug.yml`
- Packaged exe smoke passed with app version `0.3.0` and data directory under `%APPDATA%/knowledge-forge/data`.
- Latest source backup verified at `outputs/project-backups/knowledge-forge-v0.3.0-20260625-103607.zip` with 48 zip entries and 0 excluded directory entries.
- Known remaining gaps: data-directory changes are restart-bound rather than hot-swapped at runtime, AnythingLLM archive cleanup and raw custom-document file deletion semantics remain partial, the AI control console is still a local command router rather than a model-backed planner, and the app still uses the default Electron icon with `asar` disabled.

## 0.2.1 - 2026-06-24

- Implemented the knowledge-base-first UI iteration against the new design: real sidebar navigation, AI control console, collection-scoped configuration, document details, batch actions, and mobile-safe responsive layout.
- Added complete current-collection configuration controls for embedding base URL/API key/batch size, parser duplicate strategy, PDF/OCR limits, Tesseract/Paddle/cloud OCR settings, MCP writes, and AnythingLLM base URL/API key/workspace.
- Replaced the unsupported browser `prompt()` delete confirmation with an in-app confirmation dialog that requires the full document filename before calling the real document delete API.
- Added document detail workflow: open from search results or document rows, inspect metadata/text/chunks/warnings, copy document ID, trigger reprocess, and request delete.
- Completed batch document operations in the UI and API: batch delete and batch reprocess with per-document result reporting.
- Added AnythingLLM per-chunk idempotent sync manifest data with stable sync keys, uploaded locations, skipped counts, and a `smoke:anythingllm` regression test.
- Added MCP read-only resources for embedding provider status, recent jobs, AnythingLLM sync status, and OCR/document quality, with recursive secret redaction.
- Added `smoke:security` and strengthened local security checks for loopback CORS, strict booleans, health redaction, and disabled AnythingLLM sync boundaries.
- Verified all visible React buttons have click handlers, and browser-tested key workflows: navigation, OCR test, AnythingLLM test error path, document details, reprocess, filename-confirmed delete, desktop layout, and 390px mobile layout.
- Version backup created under `outputs/project-backups/` using the `knowledge-forge-v0.2.1-<YYYYMMDD-HHMMSS>.zip` naming convention.

## 0.2.0 - 2026-06-24

- 新增 PDF/DOCX/OCR 入库能力：PDF 优先抽取文本层，文本层过少时进入 OCR；DOCX 使用 Mammoth 抽取正文；图片文件直接进入 OCR。
- 明确当前 OCR 配置值：默认 `auto`，可指定 `tesseract`、`paddleocr` 或 `cloud`；当前没有 `off`/`force` 模式。
- 新增异步上传任务、任务轮询、取消任务、解析状态、文本预览、失败原因和重新处理流程。
- 更新支持格式说明，覆盖 TXT、Markdown、HTML、JSON、CSV/TSV、XML、LOG、YAML、PDF、DOCX 和图片 OCR 输入 PNG/JPEG/WebP/TIFF/BMP。
- UI 重新设计为更稳定的知识库工作台：左侧知识库列表固定，主区聚焦导入/任务/文档/检索，右侧检查器承载文档详情和配置。
- 修复 UI 文案乱码和常见桌面宽度下的拥挤问题；普通桌面默认两栏，超宽屏才启用常驻三栏。
- 补充 v0.2.0 验证命令：`npx tsc -p tsconfig.server.json --noEmit`、`npx tsc -p tsconfig.app.json --noEmit`、`npm run lint`、`npm run build`、`npm run smoke`、`npm run smoke:upload`、`npm run smoke:documents`/`npm run smoke:formats`、`npm run smoke:ocr`；真实 OCR smoke 需设置 `KNOWLEDGE_FORGE_RUN_OCR_SMOKE=1`。
- 增加 v0.2.0 备份路径约定：`outputs/project-backups/knowledge-forge-v0.2.0-<YYYYMMDD-HHMMSS>.zip`。
- 补充已知风险：OCR 准确率、PDF/图片 OCR 性能成本、复杂 DOCX 还原限制、AnythingLLM 追加同步重复风险，以及 OCR 低置信度阈值尚未用于拒绝结果。

## 0.1.0 - 2026-06-24

- 创建独立项目 `knowledge-forge`，默认使用 LanceDB 做本地持久化向量库。
- 实现 Web UI、Express API、文本入库、文件上传入库、集合管理、文档管理和本地检索。
- 实现离线可用的 `local-hash` embedding provider，并支持 OpenAI-compatible embedding endpoint。
- 实现 AnythingLLM API 鉴权测试和“追加上传到 AnythingLLM”能力。
- 实现 MCP stdio server，提供集合列表、检索、文档读取，以及默认关闭的写入/删除工具。
- 增加 MCP 写权限严格布尔校验，`allowWrites` 只有布尔 `true` 才会开启。
- `/api/health` 对 API key 脱敏，MCP resource 不暴露密钥。
- CORS 限制为本机 loopback 来源，API 仍只绑定 `127.0.0.1`。
- UI 补强：文件拖拽、已选文件显示、文档删除确认、搜索空态区分、上传后清空、按钮互斥 busy、防止长文本撑宽。
- 新增 `npm run smoke:upload`，真实验证 multipart 文件上传、切片、写入和检索。
