import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const rootDir = process.cwd();
const tempDir = await mkdtemp(path.join(os.tmpdir(), "vector-forge-anythingllm-smoke-"));
const port = 61988;
const anythingPort = 61989;
const tsxCli = path.join(rootDir, "node_modules", "tsx", "dist", "cli.mjs");

type SyncResponse = {
  workspace: { slug: string };
  uploaded: number;
  skipped: number;
  embedded: number;
  remaining: number;
};

type CleanupSummary = {
  deleted: number;
  skipped: number;
  workspaces: Array<{ workspaceSlug: string; deleted: number }>;
  queued?: number;
  pending?: number;
  failed?: number;
};

type CleanupQueueResponse = {
  counts: { total: number; prepared: number; pending: number };
  entries: Array<{
    id: string;
    status: string;
    source: string;
    collectionSlug: string;
    documentId: string;
    baseUrl: string;
    apiKeyConfigured: boolean;
    workspaceSlug: string;
    locations: string[];
    locationCount: number;
    lastError: string;
  }>;
};

type Job = {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  error?: string;
  result?: {
    anythingCleanup?: CleanupSummary;
    anythingCleanupWarning?: string;
  };
};

type UploadResponse = {
  results: Array<{
    ok: boolean;
    chunks?: number;
    document?: { id: string };
    error?: string;
  }>;
};

type UploadBody = {
  textContent?: string;
  metadata?: Record<string, unknown>;
};

type EmbeddingCall = {
  slug: string;
  adds: string[];
  deletes: string[];
};

type SyncedDocument = {
  id: string;
  chunkCount: number;
  anythingLocations: string[];
  anythingSync?: {
    chunks: Array<{
      syncKey: string;
      location: string;
      chunkId: string;
      chunkIndex: number;
      textHash: string;
      baseUrl: string;
      workspaceSlug: string;
      uploadedAt: string;
      embeddedAt?: string;
      cleanupPending?: boolean;
      cleanupError?: string;
      cleanupLastAttemptAt?: string;
    }>;
  };
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function expectRejected(action: () => Promise<unknown>, message: string) {
  try {
    await action();
  } catch (error) {
    return error;
  }
  throw new Error(message);
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown) {
  response.writeHead(statusCode, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function readJson(request: IncomingMessage) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("error", reject);
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text) as Record<string, unknown>);
      } catch (error) {
        reject(error);
      }
    });
  });
}

const workspace = { id: 1, name: "Anything Sync Smoke", slug: "anything-sync-smoke" };
let workspaceCreated = false;
const uploadBodies: UploadBody[] = [];
const embeddingCalls: EmbeddingCall[] = [];
let failNextAddEmbeddingUpdates = 0;
let failNextDeleteEmbeddingUpdates = 0;

const anythingServer = createServer((request, response) => {
  void (async () => {
    const route = request.url ?? "/";
    if (request.method === "GET" && route === "/v1/workspaces") {
      sendJson(response, 200, { workspaces: workspaceCreated ? [workspace] : [] });
      return;
    }
    if (request.method === "POST" && route === "/v1/workspace/new") {
      await readJson(request);
      workspaceCreated = true;
      sendJson(response, 200, { workspace });
      return;
    }
    if (request.method === "POST" && route === "/v1/document/raw-text") {
      const body = await readJson(request) as UploadBody;
      uploadBodies.push(body);
      const syncKey = String(body.metadata?.vectorForgeSyncKey ?? `missing-${uploadBodies.length}`);
      const location = `custom-documents/vector-forge/${createHash("sha256").update(syncKey).digest("hex").slice(0, 40)}.json`;
      sendJson(response, 200, { success: true, error: null, documents: [{ location, title: body.metadata?.title ?? "Untitled" }] });
      return;
    }
    const embeddingMatch = route.match(/^\/v1\/workspace\/([^/]+)\/update-embeddings$/);
    if (request.method === "POST" && embeddingMatch) {
      const body = await readJson(request);
      embeddingCalls.push({
        slug: decodeURIComponent(embeddingMatch[1] ?? ""),
        adds: Array.isArray(body.adds) ? body.adds.filter((item): item is string => typeof item === "string") : [],
        deletes: Array.isArray(body.deletes) ? body.deletes.filter((item): item is string => typeof item === "string") : [],
      });
      const embeddingCall = embeddingCalls[embeddingCalls.length - 1];
      if (embeddingCall?.adds.length && failNextAddEmbeddingUpdates > 0) {
        failNextAddEmbeddingUpdates -= 1;
        sendJson(response, 500, { error: "Simulated AnythingLLM add failure" });
        return;
      }
      if (embeddingCall?.deletes.length && failNextDeleteEmbeddingUpdates > 0) {
        failNextDeleteEmbeddingUpdates -= 1;
        sendJson(response, 500, { error: "Simulated AnythingLLM delete failure" });
        return;
      }
      sendJson(response, 200, { success: true });
      return;
    }
    sendJson(response, 404, { error: `Unhandled fake AnythingLLM route: ${request.method} ${route}` });
  })().catch((error) => {
    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  });
});

await new Promise<void>((resolve) => {
  anythingServer.listen(anythingPort, "127.0.0.1", () => resolve());
});

async function fetchJson<T>(route: string, init?: RequestInit) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    ...init,
    headers: init?.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${route} ${response.status}: ${text}`);
  return JSON.parse(text) as T;
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

async function waitForJob(jobId: string) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const { job } = await fetchJson<{ job: Job }>(`/api/jobs/${encodeURIComponent(jobId)}`);
    if (job.status === "succeeded") return job;
    if (job.status === "failed" || job.status === "cancelled") {
      throw new Error(`Job ${jobId} ${job.status}: ${job.error ?? "unknown error"}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Timed out waiting for job ${jobId}.`);
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

try {
  await waitForApi();
  const created = await fetchJson<{ collection: { slug: string } }>("/api/collections", {
    method: "POST",
    body: JSON.stringify({ name: "Anything Sync Smoke", slug: "anything-sync-smoke" }),
  });
  assert(created.collection.slug === "anything-sync-smoke", "Collection was not created with expected slug.");

  await fetchJson("/api/collections/anything-sync-smoke/config", {
    method: "PUT",
    body: JSON.stringify({
      chunking: { targetChars: 300, overlapChars: 0 },
      anythingllm: {
        enabled: true,
        baseUrl: `http://127.0.0.1:${anythingPort}`,
        apiKey: "fake-anythingllm-key",
        workspaceName: workspace.name,
        workspaceSlug: workspace.slug,
      },
    }),
  });

  const text = Array.from({ length: 80 }, (_, index) => (
    `AnythingLLM idempotent sync sentinel ${index}. Vector Forge should upload each chunk once and persist its returned location.`
  )).join("\n");
  const uploadForm = new FormData();
  uploadForm.append("files", new Blob([text], { type: "text/plain" }), "anything-sync.txt");
  const upload = await fetchJson<UploadResponse>("/api/collections/anything-sync-smoke/upload", {
    method: "POST",
    body: uploadForm,
  });
  const indexed = upload.results[0];
  assert(indexed?.ok, `Upload failed: ${indexed?.error ?? "missing result"}`);
  assert(typeof indexed.chunks === "number" && indexed.document?.id, "Upload did not return an indexed document.");
  const indexedDocumentId = indexed.document.id;
  assert(indexed.chunks >= 2, `Expected multiple chunks for sync smoke, got ${indexed.chunks}.`);

  failNextAddEmbeddingUpdates = 1;
  const failedFirstSyncError = await expectRejected(() => fetchJson<SyncResponse>("/api/collections/anything-sync-smoke/sync-anythingllm", {
    method: "POST",
    body: JSON.stringify({ maxChunks: 100 }),
  }), "First sync unexpectedly succeeded after simulated add-embedding failure.");
  assert(errorMessage(failedFirstSyncError).includes("Simulated AnythingLLM add failure"), "First sync failure did not include the simulated add-embedding error.");
  assert(uploadBodies.length === indexed.chunks, "Failed first sync did not upload every indexed chunk before embedding failed.");
  assert(Number(embeddingCalls.length) === 1, "Failed first sync did not call update-embeddings exactly once.");
  assert(embeddingCalls[0]?.adds.length === indexed.chunks, "Failed first sync update-embeddings adds count mismatch.");
  assert(embeddingCalls[0]?.deletes.length === 0, "Failed first sync should not send delete locations.");

  const afterFailedFirst = await fetchJson<{ documents: SyncedDocument[] }>("/api/collections/anything-sync-smoke/documents");
  const documentAfterFailedFirst = afterFailedFirst.documents.find((item) => item.id === indexedDocumentId);
  assert(documentAfterFailedFirst, "Document was not returned after failed first sync.");
  assert(documentAfterFailedFirst.anythingLocations.length === indexed.chunks, "Failed first sync did not persist uploaded AnythingLLM locations.");
  const failedSyncChunks = documentAfterFailedFirst.anythingSync?.chunks ?? [];
  assert(failedSyncChunks.length === indexed.chunks, "Failed first sync did not persist per-chunk sync records.");
  assert(failedSyncChunks.every((chunk) => chunk.workspaceSlug === workspace.slug), "Failed first sync records did not keep the workspace slug.");
  assert(failedSyncChunks.every((chunk) => chunk.baseUrl === `http://127.0.0.1:${anythingPort}`), "Failed first sync records did not keep the AnythingLLM base URL.");
  assert(failedSyncChunks.every((chunk) => chunk.location && chunk.uploadedAt), "Failed first sync records were missing uploadedAt or location.");
  assert(failedSyncChunks.every((chunk) => !chunk.embeddedAt), "Failed first sync marked chunks embedded even though update-embeddings failed.");

  const recoverySync = await fetchJson<SyncResponse>("/api/collections/anything-sync-smoke/sync-anythingllm", {
    method: "POST",
    body: JSON.stringify({ maxChunks: 100 }),
  });
  assert(recoverySync.workspace.slug === workspace.slug, "Recovery sync returned the wrong AnythingLLM workspace slug.");
  assert(recoverySync.uploaded === 0, `Recovery sync uploaded ${recoverySync.uploaded} chunks instead of reusing raw uploads.`);
  assert(recoverySync.skipped === indexed.chunks, `Recovery sync skipped ${recoverySync.skipped}, expected ${indexed.chunks}.`);
  assert(recoverySync.embedded === indexed.chunks, `Recovery sync embedded ${recoverySync.embedded}, expected ${indexed.chunks}.`);
  assert(recoverySync.remaining === 0, "Recovery sync left chunks remaining unexpectedly.");
  assert(uploadBodies.length === indexed.chunks, "Recovery sync called raw-text upload again.");
  assert(Number(embeddingCalls.length) === 2, "Recovery sync did not call update-embeddings exactly once after the failed call.");
  assert(embeddingCalls[1]?.adds.length === indexed.chunks, "Recovery sync update-embeddings adds count mismatch.");
  assert(embeddingCalls[1]?.deletes.length === 0, "Recovery sync should not send delete locations.");

  const uploadedSyncKeys = uploadBodies.map((body) => body.metadata?.vectorForgeSyncKey);
  assert(uploadedSyncKeys.every((key) => typeof key === "string" && key.startsWith("vf:anything-sync-smoke:")), "Uploaded metadata did not include stable Vector Forge sync keys.");
  assert(new Set(uploadedSyncKeys).size === indexed.chunks, "Uploaded sync keys were not unique per chunk.");
  assert(uploadBodies.every((body) => typeof body.metadata?.vectorForgeTextHash === "string"), "Uploaded metadata did not include chunk text hashes.");

  const afterRecovery = await fetchJson<{ documents: SyncedDocument[] }>("/api/collections/anything-sync-smoke/documents");
  const document = afterRecovery.documents.find((item) => item.id === indexedDocumentId);
  assert(document, "Recovered synced document was not returned from documents endpoint.");
  assert(document.anythingLocations.length === indexed.chunks, "Recovery sync changed the persisted location count.");
  assert(document.anythingSync?.chunks.length === indexed.chunks, "Recovery sync did not preserve per-chunk sync records.");
  assert(document.anythingSync.chunks.every((chunk) => chunk.workspaceSlug === workspace.slug), "Recovery sync records did not keep the workspace slug.");
  assert(document.anythingSync.chunks.every((chunk) => chunk.baseUrl === `http://127.0.0.1:${anythingPort}`), "Recovery sync records did not keep the AnythingLLM base URL.");
  assert(document.anythingSync.chunks.every((chunk) => chunk.uploadedAt && chunk.location && chunk.embeddedAt), "Recovery sync did not mark uploaded chunks embedded.");

  const idempotentSync = await fetchJson<SyncResponse>("/api/collections/anything-sync-smoke/sync-anythingllm", {
    method: "POST",
    body: JSON.stringify({ maxChunks: 100 }),
  });
  assert(idempotentSync.uploaded === 0, "Idempotent sync uploaded already-synced chunks.");
  assert(idempotentSync.skipped === indexed.chunks, `Idempotent sync skipped ${idempotentSync.skipped}, expected ${indexed.chunks}.`);
  assert(idempotentSync.embedded === 0, "Idempotent sync embedded already-embedded chunks.");
  assert(idempotentSync.remaining === 0, "Idempotent sync reported unexpected remaining chunks.");
  assert(uploadBodies.length === indexed.chunks, "Idempotent sync called raw-text upload again.");
  assert(Number(embeddingCalls.length) === 2, "Idempotent sync called update-embeddings again.");

  const afterSecond = await fetchJson<{ documents: SyncedDocument[] }>("/api/collections/anything-sync-smoke/documents");
  const documentAfterSecond = afterSecond.documents.find((item) => item.id === indexedDocumentId);
  assert(documentAfterSecond?.anythingLocations.length === indexed.chunks, "Idempotent sync changed the persisted location count.");
  const syncedLocations = documentAfterSecond.anythingSync?.chunks.map((chunk) => chunk.location) ?? [];
  assert(syncedLocations.length === indexed.chunks, "Could not read synced locations for delete cleanup.");

  const reprocess = await fetchJson<{ job: Job }>(`/api/collections/anything-sync-smoke/documents/${encodeURIComponent(indexedDocumentId)}/reprocess`, {
    method: "POST",
  });
  const reprocessJob = await waitForJob(reprocess.job.id);
  assert(reprocessJob.result?.anythingCleanup?.deleted === indexed.chunks, "Reprocess cleanup did not delete all previously synced locations.");
  assert(!reprocessJob.result.anythingCleanupWarning, "Reprocess cleanup reported an unexpected warning.");
  assert(Number(embeddingCalls.length) === 3, "Reprocess cleanup did not call update-embeddings exactly once.");
  assert(embeddingCalls[2]?.slug === workspace.slug, "Reprocess cleanup called update-embeddings for the wrong workspace.");
  assert(embeddingCalls[2]?.adds.length === 0, "Reprocess cleanup should not add embeddings.");
  assert(embeddingCalls[2]?.deletes.length === indexed.chunks, "Reprocess cleanup delete count mismatch.");
  assert(
    new Set(embeddingCalls[2]?.deletes).size === syncedLocations.length
      && syncedLocations.every((location) => embeddingCalls[2]?.deletes.includes(location)),
    "Reprocess cleanup did not send the previously persisted AnythingLLM locations.",
  );

  const afterReprocess = await fetchJson<{ documents: SyncedDocument[] }>("/api/collections/anything-sync-smoke/documents");
  const documentAfterReprocess = afterReprocess.documents.find((item) => item.id === indexedDocumentId);
  assert(documentAfterReprocess, "Reprocessed document was not returned from documents endpoint.");
  assert(documentAfterReprocess.anythingLocations.length === 0, "Reprocess cleanup left stale local AnythingLLM locations.");
  assert(!documentAfterReprocess.anythingSync?.chunks.length, "Reprocess cleanup left stale per-chunk sync records.");

  const syncAfterReprocess = await fetchJson<SyncResponse>("/api/collections/anything-sync-smoke/sync-anythingllm", {
    method: "POST",
    body: JSON.stringify({ maxChunks: 100 }),
  });
  assert(syncAfterReprocess.uploaded === indexed.chunks, "Sync after reprocess did not upload the current chunks.");
  assert(syncAfterReprocess.skipped === 0, "Sync after reprocess skipped chunks that should have needed upload.");
  assert(syncAfterReprocess.embedded === indexed.chunks, "Sync after reprocess did not embed all current chunks.");
  assert(Number(embeddingCalls.length) === 4, "Sync after reprocess did not call update-embeddings exactly once.");
  assert(embeddingCalls[3]?.adds.length === indexed.chunks, "Sync after reprocess adds count mismatch.");
  assert(embeddingCalls[3]?.deletes.length === 0, "Sync after reprocess should not delete locations.");

  const afterThird = await fetchJson<{ documents: SyncedDocument[] }>("/api/collections/anything-sync-smoke/documents");
  const documentAfterThird = afterThird.documents.find((item) => item.id === indexedDocumentId);
  const resyncedLocations = documentAfterThird?.anythingSync?.chunks.map((chunk) => chunk.location) ?? [];
  assert(resyncedLocations.length === indexed.chunks, "Could not read resynced locations for final delete cleanup.");

  failNextDeleteEmbeddingUpdates = 1;
  const failedCleanupReprocess = await fetchJson<{ job: Job }>(`/api/collections/anything-sync-smoke/documents/${encodeURIComponent(indexedDocumentId)}/reprocess`, {
    method: "POST",
  });
  const failedCleanupJob = await waitForJob(failedCleanupReprocess.job.id);
  assert(failedCleanupJob.result?.anythingCleanupWarning, "Failed cleanup reprocess did not report a retry warning.");
  assert(Number(embeddingCalls.length) === 5, "Failed cleanup reprocess did not call update-embeddings exactly once.");
  assert(embeddingCalls[4]?.deletes.length === indexed.chunks, "Failed cleanup reprocess delete count mismatch.");
  assert(
    new Set(embeddingCalls[4]?.deletes).size === resyncedLocations.length
      && resyncedLocations.every((location) => embeddingCalls[4]?.deletes.includes(location)),
    "Failed cleanup reprocess did not try to delete the persisted AnythingLLM locations.",
  );

  const afterFailedCleanup = await fetchJson<{ documents: SyncedDocument[] }>("/api/collections/anything-sync-smoke/documents");
  const documentAfterFailedCleanup = afterFailedCleanup.documents.find((item) => item.id === indexedDocumentId);
  const pendingCleanupChunks = documentAfterFailedCleanup?.anythingSync?.chunks.filter((chunk) => chunk.cleanupPending) ?? [];
  assert(pendingCleanupChunks.length === indexed.chunks, "Failed cleanup did not preserve pending cleanup chunk records.");
  assert(pendingCleanupChunks.every((chunk) => chunk.cleanupError && chunk.cleanupLastAttemptAt), "Pending cleanup chunks did not record error details.");

  const retryCleanup = await fetchJson<{
    ok: boolean;
    pending: number;
    anythingCleanup: { deleted: number; skipped: number };
    document: SyncedDocument;
  }>(`/api/collections/anything-sync-smoke/documents/${encodeURIComponent(indexedDocumentId)}/retry-anythingllm-cleanup`, {
    method: "POST",
  });
  assert(retryCleanup.ok, "Retry AnythingLLM cleanup did not report success.");
  assert(retryCleanup.pending === 0, "Retry AnythingLLM cleanup left pending chunks.");
  assert(retryCleanup.anythingCleanup.deleted === indexed.chunks, "Retry AnythingLLM cleanup did not delete all pending locations.");
  assert(Number(embeddingCalls.length) === 6, "Retry AnythingLLM cleanup did not call update-embeddings exactly once.");
  assert(embeddingCalls[5]?.deletes.length === indexed.chunks, "Retry AnythingLLM cleanup delete count mismatch.");
  assert(
    new Set(embeddingCalls[5]?.deletes).size === resyncedLocations.length
      && resyncedLocations.every((location) => embeddingCalls[5]?.deletes.includes(location)),
    "Retry AnythingLLM cleanup did not send the preserved pending locations.",
  );

  const afterRetryCleanup = await fetchJson<{ documents: SyncedDocument[] }>("/api/collections/anything-sync-smoke/documents");
  const documentAfterRetryCleanup = afterRetryCleanup.documents.find((item) => item.id === indexedDocumentId);
  assert(documentAfterRetryCleanup, "Document disappeared after retry cleanup.");
  assert(!documentAfterRetryCleanup.anythingSync?.chunks.some((chunk) => chunk.cleanupPending), "Retry cleanup left pending cleanup records.");
  assert(documentAfterRetryCleanup.anythingLocations.length === 0, "Retry cleanup left stale AnythingLLM locations.");

  const syncAfterRetryCleanup = await fetchJson<SyncResponse>("/api/collections/anything-sync-smoke/sync-anythingllm", {
    method: "POST",
    body: JSON.stringify({ maxChunks: 100 }),
  });
  assert(syncAfterRetryCleanup.uploaded === indexed.chunks, "Sync after retry cleanup did not upload current chunks.");
  assert(syncAfterRetryCleanup.skipped === 0, "Sync after retry cleanup skipped chunks that needed upload.");
  assert(syncAfterRetryCleanup.embedded === indexed.chunks, "Sync after retry cleanup did not embed current chunks.");
  assert(Number(embeddingCalls.length) === 7, "Sync after retry cleanup did not call update-embeddings exactly once.");
  assert(embeddingCalls[6]?.adds.length === indexed.chunks, "Sync after retry cleanup adds count mismatch.");
  assert(embeddingCalls[6]?.deletes.length === 0, "Sync after retry cleanup should not delete locations.");

  const afterRetrySync = await fetchJson<{ documents: SyncedDocument[] }>("/api/collections/anything-sync-smoke/documents");
  const documentAfterRetrySync = afterRetrySync.documents.find((item) => item.id === indexedDocumentId);
  const finalSyncedLocations = documentAfterRetrySync?.anythingSync?.chunks.map((chunk) => chunk.location) ?? [];
  assert(finalSyncedLocations.length === indexed.chunks, "Could not read final synced locations for delete cleanup.");

  const deleted = await fetchJson<{ deleted: string; anythingCleanup: { deleted: number; skipped: number; workspaces: Array<{ workspaceSlug: string; deleted: number }> } }>(
    `/api/collections/anything-sync-smoke/documents/${encodeURIComponent(indexedDocumentId)}`,
    { method: "DELETE" },
  );
  assert(deleted.deleted === indexedDocumentId, "Delete document returned the wrong id.");
  assert(deleted.anythingCleanup.deleted === indexed.chunks, "Delete cleanup did not report all synced locations.");
  assert(deleted.anythingCleanup.workspaces[0]?.workspaceSlug === workspace.slug, "Delete cleanup used the wrong workspace.");
  const embeddingCallCountAfterDelete: number = embeddingCalls.length;
  assert(embeddingCallCountAfterDelete === 8, "Delete cleanup did not call update-embeddings exactly once.");
  assert(embeddingCalls[7]?.slug === workspace.slug, "Delete cleanup called update-embeddings for the wrong workspace.");
  assert(embeddingCalls[7]?.adds.length === 0, "Delete cleanup should not add embeddings.");
  assert(embeddingCalls[7]?.deletes.length === indexed.chunks, "Delete cleanup delete count mismatch.");
  assert(
    new Set(embeddingCalls[7]?.deletes).size === finalSyncedLocations.length
      && finalSyncedLocations.every((location) => embeddingCalls[7]?.deletes.includes(location)),
    "Delete cleanup did not send the persisted AnythingLLM locations.",
  );

  const afterDelete = await fetchJson<{ documents: SyncedDocument[] }>("/api/collections/anything-sync-smoke/documents");
  assert(!afterDelete.documents.some((item) => item.id === indexedDocumentId), "Deleted document still exists locally.");

  const orphanText = await fetchJson<{ document: { id: string }; chunks: number }>("/api/collections/anything-sync-smoke/text", {
    method: "POST",
    body: JSON.stringify({
      name: "orphan-cleanup.txt",
      text: "AnythingLLM orphan cleanup smoke. This document should be deleted locally even if remote cleanup fails once.",
    }),
  });
  assert(orphanText.document.id && orphanText.chunks >= 1, "Orphan cleanup document was not indexed.");
  const orphanSync = await fetchJson<SyncResponse>("/api/collections/anything-sync-smoke/sync-anythingllm", {
    method: "POST",
    body: JSON.stringify({ maxChunks: 100 }),
  });
  assert(orphanSync.uploaded === orphanText.chunks, "Orphan cleanup sync did not upload the new chunks.");
  assert(orphanSync.embedded === orphanText.chunks, "Orphan cleanup sync did not embed the new chunks.");
  assert(Number(embeddingCalls.length) === 9, "Orphan cleanup sync did not call update-embeddings exactly once.");

  const afterOrphanSync = await fetchJson<{ documents: SyncedDocument[] }>("/api/collections/anything-sync-smoke/documents");
  const orphanDocument = afterOrphanSync.documents.find((item) => item.id === orphanText.document.id);
  const orphanLocations = orphanDocument?.anythingSync?.chunks.map((chunk) => chunk.location) ?? [];
  assert(orphanLocations.length === orphanText.chunks, "Could not read synced locations for orphan cleanup.");

  failNextDeleteEmbeddingUpdates = 1;
  const failedQueuedDelete = await fetchJson<{ deleted: string; anythingCleanup: CleanupSummary }>(
    `/api/collections/anything-sync-smoke/documents/${encodeURIComponent(orphanText.document.id)}`,
    { method: "DELETE" },
  );
  assert(failedQueuedDelete.deleted === orphanText.document.id, "Failed remote cleanup delete returned the wrong local document id.");
  assert(failedQueuedDelete.anythingCleanup.failed === 1, "Failed remote cleanup delete did not preserve a failed queue entry.");
  assert(failedQueuedDelete.anythingCleanup.pending === 1, "Failed remote cleanup delete did not leave one pending queue entry.");
  assert(Number(embeddingCalls.length) === 10, "Failed remote cleanup delete did not attempt update-embeddings exactly once.");
  assert(embeddingCalls[9]?.deletes.length === orphanText.chunks, "Failed remote cleanup delete sent the wrong delete count.");

  const afterFailedQueuedDelete = await fetchJson<{ documents: SyncedDocument[] }>("/api/collections/anything-sync-smoke/documents");
  assert(!afterFailedQueuedDelete.documents.some((item) => item.id === orphanText.document.id), "Failed remote cleanup blocked local document deletion.");
  const queuedAfterFailure = await fetchJson<CleanupQueueResponse>("/api/anythingllm/cleanup-queue");
  assert(queuedAfterFailure.counts.pending === 1, "Cleanup queue did not retain the failed document delete intent.");
  const failedEntry = queuedAfterFailure.entries.find((entry) => entry.documentId === orphanText.document.id);
  assert(failedEntry, "Cleanup queue did not expose the failed document delete entry.");
  assert(failedEntry.apiKeyConfigured === true, "Cleanup queue did not retain a configured API key marker.");
  assert(failedEntry.locations.length === orphanText.chunks, "Cleanup queue entry did not retain all orphan locations.");
  assert(!JSON.stringify(queuedAfterFailure).includes("fake-anythingllm-key"), "Cleanup queue response leaked the AnythingLLM API key.");

  const orphanRetry = await fetchJson<{ ok: boolean; anythingCleanup: CleanupSummary; queue: CleanupQueueResponse }>("/api/anythingllm/cleanup-queue/retry", {
    method: "POST",
    body: JSON.stringify({}),
  });
  assert(orphanRetry.ok, "Global cleanup queue retry did not report success.");
  assert(orphanRetry.anythingCleanup.deleted === orphanText.chunks, "Global cleanup queue retry did not delete all orphan locations.");
  assert(orphanRetry.queue.counts.pending === 0, "Global cleanup queue retry did not clear the pending queue.");
  assert(Number(embeddingCalls.length) === 11, "Global cleanup queue retry did not call update-embeddings exactly once.");
  assert(
    new Set(embeddingCalls[10]?.deletes).size === orphanLocations.length
      && orphanLocations.every((location) => embeddingCalls[10]?.deletes.includes(location)),
    "Global cleanup queue retry did not send the orphan locations.",
  );

  const mismatchCreated = await fetchJson<{ collection: { slug: string } }>("/api/collections", {
    method: "POST",
    body: JSON.stringify({ name: "Mismatch Cleanup", slug: "mismatch-cleanup" }),
  });
  assert(mismatchCreated.collection.slug === "mismatch-cleanup", "Mismatch cleanup collection was not created.");
  await fetchJson("/api/collections/mismatch-cleanup/config", {
    method: "PUT",
    body: JSON.stringify({
      chunking: { targetChars: 300, overlapChars: 0 },
      anythingllm: {
        enabled: true,
        baseUrl: `http://127.0.0.1:${anythingPort}`,
        apiKey: "fake-anythingllm-key",
        workspaceName: workspace.name,
        workspaceSlug: workspace.slug,
      },
    }),
  });
  const mismatchText = await fetchJson<{ document: { id: string }; chunks: number }>("/api/collections/mismatch-cleanup/text", {
    method: "POST",
    body: JSON.stringify({
      name: "mismatch-cleanup.txt",
      text: "AnythingLLM mismatched base URL cleanup smoke. The collection delete should keep cleanup intent even without matching credentials.",
    }),
  });
  const mismatchSync = await fetchJson<SyncResponse>("/api/collections/mismatch-cleanup/sync-anythingllm", {
    method: "POST",
    body: JSON.stringify({ maxChunks: 100 }),
  });
  assert(mismatchSync.uploaded === mismatchText.chunks, "Mismatch cleanup sync did not upload the new chunks.");
  assert(Number(embeddingCalls.length) === 12, "Mismatch cleanup sync did not call update-embeddings exactly once.");
  await fetchJson("/api/collections/mismatch-cleanup/config", {
    method: "PUT",
    body: JSON.stringify({
      anythingllm: {
        enabled: true,
        baseUrl: "http://127.0.0.1:1",
        apiKey: "different-key",
        workspaceName: workspace.name,
        workspaceSlug: workspace.slug,
      },
    }),
  });
  const mismatchedDelete = await fetchJson<{ deleted: string; anythingCleanup: CleanupSummary }>("/api/collections/mismatch-cleanup", {
    method: "DELETE",
    body: JSON.stringify({ confirmSlug: "mismatch-cleanup" }),
  });
  assert(mismatchedDelete.deleted === "mismatch-cleanup", "Mismatched collection delete returned the wrong slug.");
  assert(mismatchedDelete.anythingCleanup.skipped === mismatchText.chunks, "Mismatched collection delete did not report skipped cleanup locations.");
  assert(mismatchedDelete.anythingCleanup.failed === 1, "Mismatched collection delete did not keep a pending credential-blocked entry.");
  assert(Number(embeddingCalls.length) === 12, "Mismatched collection delete unexpectedly called fake AnythingLLM.");

  const collectionsAfterMismatchDelete = await fetchJson<{ collections: Array<{ slug: string }> }>("/api/collections");
  assert(!collectionsAfterMismatchDelete.collections.some((collection) => collection.slug === "mismatch-cleanup"), "Mismatched collection still exists locally after delete.");
  const queueAfterMismatch = await fetchJson<CleanupQueueResponse>("/api/anythingllm/cleanup-queue");
  const mismatchEntry = queueAfterMismatch.entries.find((entry) => entry.collectionSlug === "mismatch-cleanup");
  assert(mismatchEntry, "Cleanup queue did not retain mismatched collection cleanup intent.");
  assert(mismatchEntry.apiKeyConfigured === false, "Mismatched cleanup entry should not expose a configured key for the old base URL.");
  assert(mismatchEntry.baseUrl === `http://127.0.0.1:${anythingPort}`, "Mismatched cleanup entry did not preserve the original synced base URL.");
  assert(mismatchEntry.locationCount === mismatchText.chunks, "Mismatched cleanup entry did not retain all synced locations.");
  assert(queueAfterMismatch.counts.pending === 1, "Mismatched cleanup should leave exactly one non-target pending entry before targeted retry smoke.");

  const targetedText = await fetchJson<{ document: { id: string }; chunks: number }>("/api/collections/anything-sync-smoke/text", {
    method: "POST",
    body: JSON.stringify({
      name: "targeted-cleanup-retry.txt",
      text: "AnythingLLM targeted cleanup retry smoke. This document should produce a pending queue entry that is retried by id only.",
    }),
  });
  assert(targetedText.document.id && targetedText.chunks >= 1, "Targeted cleanup document was not indexed.");
  const targetedSync = await fetchJson<SyncResponse>("/api/collections/anything-sync-smoke/sync-anythingllm", {
    method: "POST",
    body: JSON.stringify({ maxChunks: 100 }),
  });
  assert(targetedSync.uploaded === targetedText.chunks, "Targeted cleanup sync did not upload the new chunks.");
  assert(targetedSync.embedded === targetedText.chunks, "Targeted cleanup sync did not embed the new chunks.");
  assert(Number(embeddingCalls.length) === 13, "Targeted cleanup sync did not call update-embeddings exactly once.");

  const afterTargetedSync = await fetchJson<{ documents: SyncedDocument[] }>("/api/collections/anything-sync-smoke/documents");
  const targetedDocument = afterTargetedSync.documents.find((item) => item.id === targetedText.document.id);
  const targetedLocations = targetedDocument?.anythingSync?.chunks.map((chunk) => chunk.location) ?? [];
  assert(targetedLocations.length === targetedText.chunks, "Could not read synced locations for targeted cleanup retry.");

  failNextDeleteEmbeddingUpdates = 1;
  const failedTargetedDelete = await fetchJson<{ deleted: string; anythingCleanup: CleanupSummary }>(
    `/api/collections/anything-sync-smoke/documents/${encodeURIComponent(targetedText.document.id)}`,
    { method: "DELETE" },
  );
  assert(failedTargetedDelete.deleted === targetedText.document.id, "Failed targeted cleanup delete returned the wrong local document id.");
  assert(failedTargetedDelete.anythingCleanup.failed === 1, "Failed targeted cleanup delete did not preserve a failed queue entry.");
  assert(failedTargetedDelete.anythingCleanup.pending === 2, "Failed targeted cleanup delete did not preserve the non-target pending entry.");
  assert(Number(embeddingCalls.length) === 14, "Failed targeted cleanup delete did not attempt update-embeddings exactly once.");
  assert(embeddingCalls[13]?.deletes.length === targetedText.chunks, "Failed targeted cleanup delete sent the wrong delete count.");

  const queueBeforeTargetedRetry = await fetchJson<CleanupQueueResponse>("/api/anythingllm/cleanup-queue");
  assert(queueBeforeTargetedRetry.counts.pending === 2, "Targeted retry setup did not leave two pending cleanup entries.");
  const targetRetryEntry = queueBeforeTargetedRetry.entries.find((entry) => entry.documentId === targetedText.document.id);
  const retainedNonTargetEntry = queueBeforeTargetedRetry.entries.find((entry) => entry.id === mismatchEntry.id);
  assert(targetRetryEntry, "Targeted retry setup did not expose the target pending cleanup entry.");
  assert(retainedNonTargetEntry, "Targeted retry setup lost the non-target pending cleanup entry.");
  assert(targetRetryEntry.id !== mismatchEntry.id, "Targeted retry entry unexpectedly matched the non-target cleanup entry.");
  assert(targetRetryEntry.apiKeyConfigured === true, "Targeted retry entry did not retain a configured API key marker.");
  assert(retainedNonTargetEntry.apiKeyConfigured === false, "Non-target pending entry should still have no matching API key marker.");
  assert(!JSON.stringify(queueBeforeTargetedRetry).includes("fake-anythingllm-key"), "Cleanup queue response leaked the configured AnythingLLM API key before targeted retry.");
  assert(!JSON.stringify(queueBeforeTargetedRetry).includes("different-key"), "Cleanup queue response leaked the mismatched AnythingLLM API key before targeted retry.");

  const targetedRetry = await fetchJson<{ ok: boolean; anythingCleanup: CleanupSummary; queue: CleanupQueueResponse }>("/api/anythingllm/cleanup-queue/retry", {
    method: "POST",
    body: JSON.stringify({ ids: [targetRetryEntry.id] }),
  });
  assert(targetedRetry.ok, "Targeted cleanup queue retry did not report success.");
  assert(targetedRetry.anythingCleanup.queued === 1, "Targeted cleanup queue retry did not select exactly one entry.");
  assert(targetedRetry.anythingCleanup.deleted === targetedText.chunks, "Targeted cleanup queue retry did not delete the target locations.");
  assert(targetedRetry.anythingCleanup.pending === 1, "Targeted cleanup queue retry did not leave the non-target pending entry.");
  assert(targetedRetry.queue.counts.pending === 1, "Targeted cleanup queue retry returned the wrong pending queue count.");
  assert(!targetedRetry.queue.entries.some((entry) => entry.id === targetRetryEntry.id), "Targeted cleanup queue retry left the processed target entry pending.");
  assert(targetedRetry.queue.entries.some((entry) => entry.id === mismatchEntry.id && entry.status === "pending"), "Targeted cleanup queue retry did not retain the non-target pending entry.");
  assert(Number(embeddingCalls.length) === 15, "Targeted cleanup queue retry did not call update-embeddings exactly once.");
  assert(
    new Set(embeddingCalls[14]?.deletes).size === targetedLocations.length
      && targetedLocations.every((location) => embeddingCalls[14]?.deletes.includes(location)),
    "Targeted cleanup queue retry did not send only the target locations.",
  );
  assert(!targetedLocations.some((location) => retainedNonTargetEntry.locations.includes(location)), "Targeted retry setup mixed target and non-target locations.");
  assert(!JSON.stringify(targetedRetry).includes("fake-anythingllm-key"), "Targeted cleanup queue retry response leaked the configured AnythingLLM API key.");
  assert(!JSON.stringify(targetedRetry).includes("different-key"), "Targeted cleanup queue retry response leaked the mismatched AnythingLLM API key.");

  console.log(
    JSON.stringify(
      {
        ok: true,
        tempDir,
        collection: created.collection.slug,
        chunks: indexed.chunks,
        failedFirstSync: errorMessage(failedFirstSyncError),
        recoverySync,
        idempotentSync,
        reprocessCleanup: reprocessJob.result.anythingCleanup,
        syncAfterReprocess,
        retryCleanup: retryCleanup.anythingCleanup,
        syncAfterRetryCleanup,
        deleteCleanup: deleted.anythingCleanup,
        orphanRetry: orphanRetry.anythingCleanup,
        mismatchedDelete: mismatchedDelete.anythingCleanup,
        targetedRetry: targetedRetry.anythingCleanup,
        cleanupQueue: targetedRetry.queue.counts,
        fakeUploads: uploadBodies.length,
        fakeEmbeddingCalls: embeddingCalls.length,
      },
      null,
      2,
    ),
  );
} finally {
  server.kill();
  await new Promise((resolve) => setTimeout(resolve, 300));
  await new Promise<void>((resolve) => anythingServer.close(() => resolve()));
  await rm(tempDir, { recursive: true, force: true });
}
