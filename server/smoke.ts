import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const rootDir = process.cwd();
const tempDir = await mkdtemp(path.join(os.tmpdir(), "vector-forge-smoke-"));
const port = 61983;
const tsxCli = path.join(rootDir, "node_modules", "tsx", "dist", "cli.mjs");

type ConfigResponse = {
  collection: {
    slug: string;
    dimension: number;
    embeddingModel: string;
  };
  config: {
    embedding: { model: string; dimension: number };
  };
  defaultConfig: {
    embedding: { model: string; dimension: number };
  };
  configStatus: {
    usesDefaultSnapshot: boolean;
    isCustomized: boolean;
    embeddingChangedRequiresRebuild: boolean;
    indexedEmbedding: { model: string; dimension: number };
    configEmbedding: { model: string; dimension: number };
  };
};

type CollectionsResponse = {
  collections: Array<Record<string, unknown>>;
  activeCollectionSlug: string;
};

type Job = {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  error?: string;
};

type DocumentSummary = {
  id: string;
  name: string;
  chunkCount: number;
};

type BatchDocumentResponse = {
  ok: boolean;
  requested: number;
  succeeded: number;
  failed: number;
  results: Array<{
    documentId: string;
    ok: boolean;
    deleted?: string;
    job?: Job;
    error?: string;
    statusCode?: number;
  }>;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function fetchJson<T>(route: string, init?: RequestInit) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    ...init,
    headers: init?.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${route} ${response.status}: ${text}`);
  return JSON.parse(text) as T;
}

async function fetchStatus(route: string, init?: RequestInit) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    ...init,
    headers: init?.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  await response.text();
  return response.status;
}

async function waitForApi() {
  for (let i = 0; i < 40; i += 1) {
    try {
      return await fetchJson<{ ok: boolean }>("/api/health");
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw new Error("API did not become ready.");
}

async function waitForJobs(jobIds: string[]) {
  const deadline = Date.now() + 120_000;
  const finished = new Map<string, Job>();
  while (Date.now() < deadline) {
    for (const jobId of jobIds) {
      if (finished.has(jobId)) continue;
      const { job } = await fetchJson<{ job: Job }>(`/api/jobs/${jobId}`);
      if (job.status === "succeeded") finished.set(jobId, job);
      if (job.status === "failed" || job.status === "cancelled") throw new Error(`Job ${jobId} ${job.status}: ${job.error ?? "unknown error"}`);
    }
    if (finished.size === jobIds.length) return Array.from(finished.values());
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for jobs: ${jobIds.join(", ")}`);
}

await mkdir(tempDir, { recursive: true });
const server = spawn(process.execPath, [tsxCli, "server/index.ts"], {
  cwd: rootDir,
  env: {
    ...process.env,
    VECTOR_FORGE_ROOT_DIR: rootDir,
    VECTOR_FORGE_DATA_DIR: tempDir,
    VECTOR_FORGE_PORT: String(port),
  },
  stdio: ["ignore", "pipe", "pipe"],
});

const stderr: string[] = [];
server.stderr.on("data", (chunk) => stderr.push(String(chunk)));

try {
  await waitForApi();
  const created = await fetchJson<{ collection: { slug: string } }>("/api/collections", {
    method: "POST",
    body: JSON.stringify({ name: "Smoke Collection", slug: "smoke" }),
  });
  assert(created.collection.slug === "smoke", "Collection was not created with expected slug.");

  const emptyBatchDeleteStatus = await fetchStatus("/api/collections/smoke/documents/batch-delete", {
    method: "POST",
    body: JSON.stringify({ documentIds: [] }),
  });
  assert(emptyBatchDeleteStatus === 400, "Batch delete accepted an empty documentIds array.");
  const emptyBatchReprocessStatus = await fetchStatus("/api/collections/smoke/documents/batch-reprocess", {
    method: "POST",
    body: JSON.stringify({ documentIds: [] }),
  });
  assert(emptyBatchReprocessStatus === 400, "Batch reprocess accepted an empty documentIds array.");

  const initialCollectionConfig = await fetchJson<ConfigResponse>("/api/collections/smoke/config");
  assert(initialCollectionConfig.configStatus.usesDefaultSnapshot === true, "New collection did not start from the default config snapshot.");
  assert(initialCollectionConfig.config.embedding.model === "local-hash-v1", "New collection did not copy the initial embedding model.");

  await fetchJson("/api/config", {
    method: "PUT",
    body: JSON.stringify({
      embedding: {
        provider: "local-hash",
        model: "smoke-global-default",
        dimension: 384,
        apiKey: "embedding-secret-should-not-leak",
      },
      anythingllm: {
        apiKey: "anything-secret-should-not-leak",
        enabled: "false",
      },
      mcp: {
        allowWrites: "false",
      },
    }),
  });
  const health = await fetchJson<{
    config: {
      embedding: { apiKey: string };
      anythingllm: { apiKey: string; enabled: boolean };
      mcp: { allowWrites: boolean };
    };
  }>("/api/health");
  assert(health.config.embedding.apiKey === "[configured]", "Health endpoint did not redact embedding API key.");
  assert(health.config.anythingllm.apiKey === "[configured]", "Health endpoint did not redact AnythingLLM API key.");
  assert(health.config.anythingllm.enabled === false, "String false enabled AnythingLLM unexpectedly.");
  assert(health.config.mcp.allowWrites === false, "String false enabled MCP writes unexpectedly.");

  const secretDefaultCollection = await fetchJson<{ collection: Record<string, unknown> }>("/api/collections", {
    method: "POST",
    body: JSON.stringify({ name: "Secret Default Collection", slug: "secret-default" }),
  });
  assert(!("config" in secretDefaultCollection.collection), "Collection create response leaked internal config.");
  const secretDefaultConfig = await fetchJson<ConfigResponse>("/api/collections/secret-default/config");
  assert(secretDefaultConfig.config.embedding.model === "smoke-global-default", "New collection did not copy the updated default template.");
  const listedCollections = await fetchJson<CollectionsResponse>("/api/collections");
  assert(listedCollections.collections.length === 2, "Collection list did not include both smoke collections.");
  assert(listedCollections.collections.every((collection) => !("config" in collection)), "Collection list leaked internal config.");
  const listedCollectionsJson = JSON.stringify(listedCollections);
  assert(!listedCollectionsJson.includes("embedding-secret-should-not-leak"), "Collection list leaked embedding API key.");
  assert(!listedCollectionsJson.includes("anything-secret-should-not-leak"), "Collection list leaked AnythingLLM API key.");

  const unchangedCollectionConfig = await fetchJson<ConfigResponse>("/api/collections/smoke/config");
  assert(unchangedCollectionConfig.config.embedding.model === "local-hash-v1", "Global default update changed an existing collection config.");
  assert(unchangedCollectionConfig.defaultConfig.embedding.model === "smoke-global-default", "Collection config response did not include the current global default.");
  assert(unchangedCollectionConfig.configStatus.isCustomized === true, "Collection did not report a snapshot that differs from the current default.");

  const collectionConfig = await fetchJson<ConfigResponse>("/api/collections/smoke/config", {
    method: "PUT",
    body: JSON.stringify({
      embedding: { provider: "local-hash", model: "smoke-collection-256", dimension: 256 },
      chunking: { targetChars: 600 },
    }),
  });
  assert(collectionConfig.collection.dimension === 256, "Empty collection did not sync embedding dimension to the collection index metadata.");
  assert(collectionConfig.configStatus.embeddingChangedRequiresRebuild === false, "Empty collection config change unexpectedly required rebuild.");

  const copiedDefault = await fetchJson<ConfigResponse>("/api/config/copy-from-collection/smoke", { method: "POST", body: JSON.stringify({}) });
  assert(copiedDefault.config.embedding.dimension === 256, "Global default was not copied from the collection config.");
  assert(copiedDefault.configStatus.usesDefaultSnapshot === true, "Copied collection config did not match the global default.");

  const indexed = await fetchJson<{ chunks: number; document: { id: string } }>("/api/collections/smoke/text", {
    method: "POST",
    body: JSON.stringify({
      name: "smoke-note.txt",
      text: "Vector Forge Lab stores local vectors in LanceDB and exposes search through MCP. This smoke document should be searchable.",
    }),
  });
  assert(indexed.chunks >= 1, "Text was not chunked and indexed.");

  const search = await fetchJson<{ results: Array<{ documentId: string; text: string }> }>("/api/collections/smoke/search", {
    method: "POST",
    body: JSON.stringify({ query: "How does Vector Forge expose search?", topK: 3 }),
  });
  assert(search.results.length >= 1, "Search returned no results.");
  assert(search.results[0].documentId === indexed.document.id, "Search did not return the indexed document.");

  const detail = await fetchJson<{ chunks: unknown[] }>(`/api/collections/smoke/documents/${indexed.document.id}`);
  assert(detail.chunks.length >= 1, "Document detail did not include chunks.");

  const changedIndexedEmbedding = await fetchJson<ConfigResponse>("/api/collections/smoke/config", {
    method: "PUT",
    body: JSON.stringify({ embedding: { provider: "local-hash", model: "smoke-collection-512", dimension: 512 } }),
  });
  assert(changedIndexedEmbedding.collection.dimension === 256, "Collection index metadata changed even though chunks already exist.");
  assert(changedIndexedEmbedding.configStatus.embeddingChangedRequiresRebuild === true, "Embedding config change with chunks did not report rebuild requirement.");
  assert(changedIndexedEmbedding.configStatus.indexedEmbedding.dimension === 256, "Indexed embedding status lost the existing dimension.");
  assert(changedIndexedEmbedding.configStatus.configEmbedding.dimension === 512, "Config embedding status did not report the new dimension.");

  const restoredDefault = await fetchJson<ConfigResponse>("/api/collections/smoke/config/apply-default", { method: "POST", body: JSON.stringify({}) });
  assert(restoredDefault.config.embedding.dimension === 256, "Collection did not apply the current global default config.");
  assert(restoredDefault.configStatus.embeddingChangedRequiresRebuild === false, "Applying the matching default still reported rebuild required.");

  const batchForm = new FormData();
  batchForm.append("files", new Blob(["Batch reprocess smoke document alpha. Searchable uploaded source copy."], { type: "text/plain" }), "batch-reprocess-a.txt");
  batchForm.append("files", new Blob(["Batch delete smoke document beta. Searchable uploaded source copy."], { type: "text/plain" }), "batch-delete-b.txt");
  const batchUpload = await fetchJson<{ jobs: Job[] }>("/api/collections/smoke/upload-jobs", { method: "POST", body: batchForm });
  assert(batchUpload.jobs.length === 2, "Batch smoke upload did not create two jobs.");
  await waitForJobs(batchUpload.jobs.map((job) => job.id));

  const batchDocs = await fetchJson<{ documents: DocumentSummary[] }>("/api/collections/smoke/documents");
  const reprocessDoc = batchDocs.documents.find((document) => document.name === "batch-reprocess-a.txt");
  const deleteDoc = batchDocs.documents.find((document) => document.name === "batch-delete-b.txt");
  assert(reprocessDoc, "Batch reprocess smoke document was not recorded.");
  assert(deleteDoc, "Batch delete smoke document was not recorded.");

  const batchReprocess = await fetchJson<BatchDocumentResponse>("/api/collections/smoke/documents/batch-reprocess", {
    method: "POST",
    body: JSON.stringify({ documentIds: [reprocessDoc.id, "missing-batch-document"] }),
  });
  assert(batchReprocess.requested === 2, "Batch reprocess did not report the requested count.");
  assert(batchReprocess.succeeded === 1 && batchReprocess.failed === 1 && batchReprocess.ok === false, "Batch reprocess summary was incorrect.");
  const reprocessJobIds = batchReprocess.results.flatMap((result) => (result.ok && result.job ? [result.job.id] : []));
  assert(reprocessJobIds.length === 1, "Batch reprocess did not return the created job.");
  await waitForJobs(reprocessJobIds);

  const batchDelete = await fetchJson<BatchDocumentResponse>("/api/collections/smoke/documents/batch-delete", {
    method: "POST",
    body: JSON.stringify({ documentIds: [reprocessDoc.id, deleteDoc.id, "missing-batch-document"] }),
  });
  assert(batchDelete.requested === 3, "Batch delete did not report the requested count.");
  assert(batchDelete.succeeded === 2 && batchDelete.failed === 1 && batchDelete.ok === false, "Batch delete summary was incorrect.");
  assert(batchDelete.results.some((result) => !result.ok && result.statusCode === 404), "Batch delete did not include missing-document failure detail.");
  const afterBatchDelete = await fetchJson<{ documents: DocumentSummary[] }>("/api/collections/smoke/documents");
  assert(afterBatchDelete.documents.length === 1, "Batch delete removed the wrong number of documents.");
  assert(afterBatchDelete.documents[0]?.id === indexed.document.id, "Batch delete removed the original smoke document.");

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [tsxCli, "server/mcp.ts"],
    cwd: rootDir,
    stderr: "pipe",
    env: {
      ...process.env,
      VECTOR_FORGE_ROOT_DIR: rootDir,
      VECTOR_FORGE_DATA_DIR: tempDir,
      VECTOR_FORGE_API_URL: `http://127.0.0.1:${port}`,
      VECTOR_FORGE_MCP_AUTOSTART: "false",
    },
  });
  const client = new Client({ name: "vector-forge-smoke", version: "0.1.0" });
  await client.connect(transport);
  await client.ping();
  const tools = await client.listTools();
  assert(tools.tools.some((tool) => tool.name === "vf_search"), "MCP vf_search tool missing.");
  const resourceUris = [
    "vectorforge://health",
    "vectorforge://collections",
    "vectorforge://collections/smoke/documents",
    "vectorforge://embedding-provider/status",
    "vectorforge://jobs/recent",
    "vectorforge://anythingllm/sync-status",
    "vectorforge://documents/quality",
  ];
  const listedResources = await client.listResources();
  const listedResourceJson = JSON.stringify(listedResources.resources);
  assert(listedResourceJson.includes("vectorforge://health"), "MCP health resource missing from listResources.");
  assert(listedResourceJson.includes("vectorforge://embedding-provider/status"), "MCP embedding status resource missing from listResources.");
  const readResources = [];
  for (const uri of resourceUris) {
    const resource = await client.readResource({ uri });
    const resourceText = JSON.stringify(resource.contents);
    assert(resourceText.includes("application/json"), `MCP resource ${uri} did not return JSON content.`);
    assert(!resourceText.includes("embedding-secret-should-not-leak"), `MCP resource ${uri} leaked embedding API key.`);
    assert(!resourceText.includes("anything-secret-should-not-leak"), `MCP resource ${uri} leaked AnythingLLM API key.`);
    assert(!resourceText.includes("cloud-secret-should-not-leak"), `MCP resource ${uri} leaked cloud OCR API key.`);
    readResources.push(uri);
  }
  const mcpCollections = await client.callTool({ name: "vf_list_collections", arguments: {} });
  const mcpCollectionsJson = JSON.stringify(mcpCollections.content);
  assert(!mcpCollectionsJson.includes("\"config\""), "MCP collection list leaked internal config.");
  assert(!mcpCollectionsJson.includes("embedding-secret-should-not-leak"), "MCP collection list leaked embedding API key.");
  assert(!mcpCollectionsJson.includes("anything-secret-should-not-leak"), "MCP collection list leaked AnythingLLM API key.");
  const mcpSearch = await client.callTool({ name: "vf_search", arguments: { collection: "smoke", query: "MCP search", topK: 2 } });
  assert(JSON.stringify(mcpSearch.content).includes(indexed.document.id), "MCP search did not return indexed document.");
  let writeRejected = false;
  try {
    const writeResult = await client.callTool({ name: "vf_upsert_text", arguments: { collection: "smoke", name: "blocked.txt", text: "This write must be blocked." } });
    writeRejected = Boolean((writeResult as { isError?: boolean }).isError) || JSON.stringify(writeResult.content).includes("disabled");
  } catch {
    writeRejected = true;
  }
  assert(writeRejected, "MCP write tool was not blocked when allowWrites was false.");
  await client.close();

  await fetchJson(`/api/collections/smoke/documents/${indexed.document.id}`, { method: "DELETE", body: JSON.stringify({}) });
  const afterDelete = await fetchJson<{ documents: unknown[] }>("/api/collections/smoke/documents");
  assert(afterDelete.documents.length === 0, "Document was not deleted.");

  console.log(
    JSON.stringify(
      {
        ok: true,
        tempDir,
        collection: created.collection.slug,
        indexedChunks: indexed.chunks,
        searchResults: search.results.length,
        mcpTools: tools.tools.length,
        mcpResources: readResources.length,
      },
      null,
      2,
    ),
  );
} finally {
  server.kill();
  await new Promise((resolve) => setTimeout(resolve, 300));
  await rm(tempDir, { recursive: true, force: true });
}
