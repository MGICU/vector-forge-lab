# Vector Forge Desktop

Version: `0.3.1`

Vector Forge Desktop is a local-first knowledge base for people who want to turn messy files into searchable AI-ready memory without handing every document to a cloud service.

It combines document ingestion, OCR, chunking, embeddings, LanceDB vector search, MCP access, and optional AnythingLLM sync into one Windows desktop workflow. The core database stays local. AnythingLLM is treated as an optional downstream destination, not as the source of truth.

中文介绍见 [README.zh-CN.md](README.zh-CN.md). Launch copy, GitHub topics, and social-post ideas are in [docs/github-launch.md](docs/github-launch.md).

## Why It Exists

Most personal knowledge-base tools force a hard choice:

- easy cloud upload, but weak privacy control
- local files, but no usable vector search workflow
- RAG demos, but no real document management
- chatbot UI, but no visibility into OCR, chunks, embeddings, or sync state

Vector Forge Desktop is built for the missing middle: a practical local workbench where you can import files, see what happened, search the resulting chunks, expose the library to AI tools through MCP, and sync selected knowledge into AnythingLLM only when you choose.

## Highlights

- Local-first by default: API binds to `127.0.0.1`, data is stored locally, and MCP writes are disabled unless explicitly enabled.
- One Windows desktop entry point: Electron starts the local API and opens the unified UI.
- Knowledge-base-first workflow: choose a collection first, then edit that collection's embedding, chunking, OCR/parser, MCP, and AnythingLLM settings.
- Per-collection config snapshots: new collections copy the default template, then keep independent parameters so later default changes do not silently mutate existing indexes.
- File ingestion pipeline: upload files, scan local directories, extract text, OCR when needed, clean text, chunk, embed, and index into LanceDB.
- Broad format support: TXT, Markdown, HTML, JSON, CSV, TSV, XML, LOG, YAML/YML, PDF, DOCX, PNG, JPG/JPEG, WebP, TIFF, and BMP.
- OCR options: local Tesseract.js, configured PaddleOCR command, or explicit OpenAI-compatible cloud OCR.
- Local vector search: top-K retrieval with document source, chunk text, score, parser metadata, page/OCR information, and copyable citations.
- AI control console: conversational command panel with dry-run policy checks, confirmation gates for risky actions, attachment import, local search, and audit visibility.
- MCP integration: read-only tools/resources for collections, search, document details, stats, embedding status, recent jobs, AnythingLLM sync status, and OCR/document quality.
- AnythingLLM bridge: optional workspace sync, idempotent upload tracking, desktop environment checks, custom executable path, installer handoff, and cleanup retry queues.
- Safety rails: local-action token in Electron mode, loopback CORS, API-key redaction, dangerous-action confirmations, and no native browser prompt/confirm flow for destructive operations.
- Delivery checks: TypeScript, ESLint, Vite/server builds, API smokes, UI button audit, Electron UI smoke, MCP write smoke, security smoke, persistence recovery smoke, and packaged desktop smoke.

## Product Positioning

Use Vector Forge Desktop when you want:

- a private document memory layer for AI tools
- a local RAG workbench that shows the ingestion pipeline instead of hiding it
- OCR-heavy knowledge-base processing before sending selected results anywhere else
- MCP-accessible local search for Claude Desktop, Cursor, Codex, or other MCP clients
- AnythingLLM synchronization without making AnythingLLM the only place your knowledge lives

This is not trying to be another generic chat app. The first-class experience is building and operating the local vector library: import, inspect, search, reprocess, sync, and audit.

## Screens And Workflow

The UI is organized as independent pages from the left sidebar:

- Overview: health, active collection, document/chunk totals, and task status
- AI Control: conversational command handling with policy dry-run and confirmation
- Collections: create, choose, inspect, and manage local knowledge bases
- Local Search: query the current collection and copy citations
- Import Jobs: watch queued/running/failed/cancelled processing tasks
- Documents: inspect documents, chunks, text previews, OCR warnings, and delete/reprocess actions
- OCR / Parser: tune duplicate strategy, PDF limits, OCR mode, OCR language, confidence, and engine settings
- MCP: inspect read-only resources and copy resource URIs
- AnythingLLM: configure API/workspace sync, desktop executable, installer handoff, and cleanup queue
- Settings: desktop data directory, embedding provider, default parameter template, and system integration

## Architecture

```text
Electron Desktop
  -> local Express API on 127.0.0.1
  -> React/Vite UI
  -> managed local data directory
  -> LanceDB vector tables
  -> MCP stdio server
  -> optional AnythingLLM API sync
```

Core ownership:

- `src/`: React UI and desktop workbench
- `server/`: API, document pipeline, LanceDB integration, MCP, and smoke tests
- `electron/`: desktop shell, preload bridge, lifecycle management, and Electron smokes
- `docs/`: delivery logs, project progress, audit notes, and MCP setup guide

## Quick Start

Requirements:

- Windows is the primary desktop target.
- Node.js and npm.
- Optional: Tesseract language data is included for packaged OCR resources.
- Optional: AnythingLLM if you want downstream workspace sync.

Install dependencies:

```powershell
npm install
```

Run local API and browser UI:

```powershell
npm run dev
```

Default local endpoints:

- UI: `http://127.0.0.1:5184`
- API: `http://127.0.0.1:5183`

Run the desktop app in development:

```powershell
npm run desktop
```

## Build And Package

Build UI and server:

```powershell
npm run build
```

Build Windows installer, portable exe, and zip:

```powershell
npm run dist:win
```

Generated desktop artifacts are written to:

```text
release/
```

Expected artifact names:

- `release/win-unpacked/Vector Forge Desktop.exe`
- `release/Vector Forge Desktop-Setup-<version>-x64.exe`
- `release/Vector Forge Desktop-Portable-<version>-x64.exe`
- `release/Vector Forge Desktop-<version>-x64.zip`

## Verification

Fast source gate:

```powershell
npm run smoke:release
```

Target-machine gate with real OCR and packaged artifact validation:

```powershell
npm run smoke:release:target
```

Useful individual checks:

```powershell
npx tsc -p tsconfig.app.json --noEmit
npx tsc -p tsconfig.server.json --noEmit
npm run lint
npm run build
npm run smoke:buttons
npm run smoke:ui:built
npm run smoke:desktop:data-dir:built
npm run smoke:desktop:built
npm run smoke:release:artifacts
```

Real OCR is intentionally separate from the fastest loop:

```powershell
npm run smoke:ocr:real
```

## MCP Usage

Run the MCP stdio server:

```powershell
npm run mcp
```

MCP is read-only by default. Write/delete tools are only available when `mcp.allowWrites` is explicitly `true`.

See [docs/mcp-integration.md](docs/mcp-integration.md) for Claude Desktop, Cursor, Codex, and other MCP clients.

For a beginner-friendly Chinese tutorial that explains `stdio` vs Streamable HTTP and gives copyable client configs, see [docs/mcp-ai-client-guide.zh-CN.md](docs/mcp-ai-client-guide.zh-CN.md).

## Security Model

- The API binds to `127.0.0.1`.
- CORS allows only loopback origins.
- `/api/health`, config responses, and MCP resources redact secrets.
- Electron mode uses a per-session local-action token for write and side-effect routes.
- MCP write tools are disabled by default.
- Cloud OCR requires explicit user authorization.
- Local execution actions and external-send actions require React confirmation.
- Destructive operations use in-app confirmation flows instead of native browser prompts.

## Roadmap

High-impact next slices:

- model-backed AI planner that still respects dry-run and confirmation policies
- stronger retrieval evaluation sets for comparing embedding providers
- XLSX, PPTX, and EPUB ingestion
- richer document tagging, filters, notes, and review queues
- Qdrant or sqlite-vec adapters for alternate vector backends
- branded app icon, signing, and installer polish

## Status

`0.3.1` is an active desktop-oriented iteration. The app already has a broad local smoke suite and packaged Windows workflow, but this repository should still be treated as an engineering workbench rather than a polished commercial release.

The current design priority is practical reliability: every visible button should either perform a real action, open a confirmation, show a clear disabled reason, or be covered by smoke tests.

## License

No license has been selected yet. Add a license before publishing this as open source for external reuse.
