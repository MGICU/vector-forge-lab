# GitHub Launch Notes

This file is the launch copy kit for publishing Vector Forge Desktop on GitHub.

## Repository Description

Local-first AI knowledge-base desktop app with OCR, LanceDB vector search, MCP access, and optional AnythingLLM sync.

## Suggested Topics

- `local-first`
- `knowledge-base`
- `rag`
- `vector-search`
- `lancedb`
- `ocr`
- `mcp`
- `anythingllm`
- `electron`
- `desktop-ai`
- `document-ai`
- `ai-tools`

## Short Pitch

Vector Forge Desktop turns messy local files into a private AI-ready knowledge base. Import documents, OCR scanned files, chunk and embed text, search locally with LanceDB, expose read-only MCP tools to AI clients, and optionally sync selected knowledge into AnythingLLM.

## Longer Pitch

Most AI knowledge-base demos skip the hard part: reliable local ingestion. Vector Forge Desktop focuses on the operational layer behind useful RAG workflows. It gives you a desktop workbench for importing files, scanning folders, OCRing documents, managing per-collection embedding and parser settings, inspecting chunks, searching local vectors, and safely exposing the result to AI tools through MCP.

The project is local-first by design. The core data stays in the local managed data directory and LanceDB tables. AnythingLLM integration is optional and downstream, with idempotent sync records and cleanup queues instead of blind repeated uploads.

## Chinese Pitch

Vector Forge Desktop 是一个本地优先的 AI 知识库桌面应用。它把 PDF、Word、图片、Markdown、CSV、JSON、日志和普通文本变成本地可检索、可审计、可接入 MCP 的向量知识库，并且可以选择性同步到 AnythingLLM。

它不是又一个聊天壳，而是 AI 知识库真正需要的底层工作台：导入、OCR、切片、embedding、LanceDB 检索、文档管理、任务状态、MCP 只读访问、AnythingLLM 幂等同步和清理队列。

## Social Post Draft

I am building Vector Forge Desktop: a local-first AI knowledge-base app for Windows.

It handles the boring but critical part of RAG:

- import files and folders
- OCR scanned docs
- chunk and embed text
- store vectors in LanceDB
- search locally with citations
- expose read-only MCP tools to AI clients
- optionally sync into AnythingLLM

The core idea: your local vector library is the source of truth. Cloud or AnythingLLM sync is optional downstream, not the default owner of your data.

## 中文社交文案

我做了一个本地优先的 AI 知识库桌面应用：Vector Forge Desktop。

它不是聊天壳，而是把真正麻烦的 RAG 入库流程做成桌面工作台：

- 文件和目录导入
- PDF/图片 OCR
- 文本切片
- embedding
- LanceDB 本地向量检索
- 来源引用复制
- MCP 给 AI 工具调用
- 可选同步到 AnythingLLM

重点是：本地向量库是主数据，AnythingLLM 只是可选下游。适合想把资料做成 AI 记忆库，但又不想一上来就全丢云端的人。

## GitHub README Angle

Lead with the pain point:

> Local AI knowledge bases fail when ingestion is invisible. Vector Forge Desktop makes ingestion, OCR, chunking, embeddings, retrieval, and sync observable.

Then show the workflow:

```text
Files -> OCR/parse -> chunks -> embeddings -> LanceDB -> local search -> MCP -> optional AnythingLLM
```

Then emphasize safety:

- local API only
- loopback CORS
- MCP read-only by default
- explicit cloud OCR consent
- confirmation before destructive/external/local-execution actions

## Demo Checklist

For a strong public demo:

1. Create a new collection.
2. Import a PDF, a DOCX, and an image.
3. Show the job queue progressing.
4. Open document detail and show extracted text/chunks.
5. Search with a natural-language query.
6. Copy a citation from the result.
7. Open AI Control and run a local search command.
8. Open MCP page and copy a resource URI.
9. Open AnythingLLM page and show optional sync configuration.
10. Show Settings and explain default template vs current collection config.

## Honest Status

This is an engineering workbench with strong smoke coverage, not a polished commercial release. That honesty is useful: the project is valuable because it exposes the local RAG pipeline instead of hiding it behind a chat box.
