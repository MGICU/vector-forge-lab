import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import PDFDocument from "pdfkit";

const rootDir = process.cwd();
const tempDir = await mkdtemp(path.join(os.tmpdir(), "vector-forge-jobs-smoke-"));
const port = 61990;
const ocrPort = 61991;
const tsxCli = path.join(rootDir, "node_modules", "tsx", "dist", "cli.mjs");

type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

type Job = {
  id: string;
  kind: "upload" | "reprocess";
  collectionSlug: string;
  documentId?: string;
  fileName: string;
  status: JobStatus;
  phase: "queued" | "extracting" | "ocr" | "chunking" | "embedding" | "indexed" | "failed" | "cancelled";
  progress: number;
  error?: string;
  cancelRequested?: boolean;
};

type UploadJobsResponse = {
  jobs: Job[];
};

type DocumentSummary = {
  id: string;
  name: string;
  status: "indexed" | "failed" | "archived";
  extractionStatus?: "indexed" | "failed" | "archived";
  chunkCount: number;
  jobId?: string;
  error?: string;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown) {
  response.writeHead(statusCode, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function readRequest(request: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("error", reject);
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function waitForApi() {
  for (let i = 0; i < 60; i += 1) {
    try {
      return await fetchJson<{ ok: boolean }>("/api/health");
    } catch {
      await delay(300);
    }
  }
  throw new Error("API did not become ready.");
}

async function waitForJobPredicate(jobId: string, predicate: (job: Job) => boolean, label: string, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  let last: Job | undefined;
  while (Date.now() < deadline) {
    const { job } = await fetchJson<{ job: Job }>(`/api/jobs/${encodeURIComponent(jobId)}`);
    last = job;
    if (predicate(job)) return job;
    await delay(300);
  }
  throw new Error(`Timed out waiting for ${label}. Last job: ${JSON.stringify(last)}`);
}

async function waitForJobStatus(jobId: string, expected: JobStatus, timeoutMs = 180_000) {
  return waitForJobPredicate(jobId, (job) => job.status === expected, `job ${jobId} to become ${expected}`, timeoutMs);
}

function createBlankPdf(pageCount: number) {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 72 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    for (let index = 1; index < pageCount; index += 1) {
      doc.addPage();
    }
    doc.end();
  });
}

function createOcrServer() {
  let ocrRequests = 0;
  let resolveFirstRequest: (() => void) | undefined;
  const firstRequestStarted = new Promise<void>((resolve) => {
    resolveFirstRequest = resolve;
  });
  const server = createServer((request, response) => {
    void (async () => {
      if (request.method === "POST" && request.url === "/chat/completions") {
        ocrRequests += 1;
        resolveFirstRequest?.();
        await readRequest(request);
        await delay(800);
        sendJson(response, 200, {
          choices: [
            {
              message: {
                content: `CANCEL OCR SENTINEL PAGE ${ocrRequests}`,
              },
            },
          ],
        });
        return;
      }
      sendJson(response, 404, { error: `Unhandled fake OCR route: ${request.method} ${request.url}` });
    })().catch((error) => {
      sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
    });
  });
  return {
    server,
    firstRequestStarted,
    get requestCount() {
      return ocrRequests;
    },
  };
}

async function waitForPromise<T>(promise: Promise<T>, label: string, timeoutMs = 120_000) {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${label}.`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function uploadFiles(slug: string, files: Array<{ name: string; type: string; body: Buffer | string }>) {
  const form = new FormData();
  for (const file of files) {
    form.append("files", new Blob([file.body], { type: file.type }), file.name);
  }
  return fetchJson<UploadJobsResponse>(`/api/collections/${encodeURIComponent(slug)}/upload-jobs`, {
    method: "POST",
    body: form,
  });
}

const fakeOcr = createOcrServer();
await new Promise<void>((resolve) => {
  fakeOcr.server.listen(ocrPort, "127.0.0.1", () => resolve());
});

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

const serverLog: string[] = [];
server.stdout?.on("data", (chunk: Buffer) => serverLog.push(String(chunk)));
server.stderr?.on("data", (chunk: Buffer) => serverLog.push(String(chunk)));

try {
  await waitForApi();

  const cancelCollection = await fetchJson<{ collection: { slug: string } }>("/api/collections", {
    method: "POST",
    body: JSON.stringify({ name: "Job Cancel Smoke", slug: "job-cancel-smoke" }),
  });
  assert(cancelCollection.collection.slug === "job-cancel-smoke", "Cancel collection slug mismatch.");
  await fetchJson("/api/collections/job-cancel-smoke/config", {
    method: "PUT",
    body: JSON.stringify({
      embedding: { provider: "local-hash", model: "local-hash-v1", dimension: 384 },
      parsers: {
        pdf: { textFirst: false, maxPages: 2, renderScale: 0.5, ocrTextThreshold: 500 },
        ocr: {
          mode: "cloud",
          language: "eng",
          timeoutMs: 30000,
          allowCloudOcr: true,
          cloudBaseUrl: `http://127.0.0.1:${ocrPort}`,
          cloudApiKey: "fake-cloud-ocr-key",
          cloudModel: "fake-ocr",
        },
      },
    }),
  });

  const cancelUpload = await uploadFiles("job-cancel-smoke", [
    { name: "slow-ocr.pdf", type: "application/pdf", body: await createBlankPdf(2) },
    { name: "queued.txt", type: "text/plain", body: "QUEUED CANCEL SENTINEL should never be indexed." },
  ]);
  assert(cancelUpload.jobs.length === 2, "Cancel smoke upload did not create two jobs.");
  const slowJob = cancelUpload.jobs.find((job) => job.fileName === "slow-ocr.pdf");
  const queuedJob = cancelUpload.jobs.find((job) => job.fileName === "queued.txt");
  assert(slowJob && queuedJob, "Cancel smoke did not return expected job names.");

  await waitForPromise(fakeOcr.firstRequestStarted, "fake OCR request");
  const runningSlow = await waitForJobPredicate(slowJob.id, (job) => job.status === "running" && job.phase === "ocr", "slow OCR job to run OCR");
  assert(runningSlow.cancelRequested === false, "Slow job was already marked cancelRequested before cancel.");
  const queuedBeforeCancel = await fetchJson<{ job: Job }>(`/api/jobs/${encodeURIComponent(queuedJob.id)}`);
  assert(queuedBeforeCancel.job.status === "queued", `Expected queued job to still be queued, got ${queuedBeforeCancel.job.status}.`);

  const queuedCancel = await fetchJson<{ job: Job }>(`/api/jobs/${encodeURIComponent(queuedJob.id)}/cancel`, { method: "POST" });
  assert(queuedCancel.job.cancelRequested === true, "Queued cancel did not set cancelRequested.");
  assert(queuedCancel.job.status === "cancelled", "Queued cancel did not immediately mark the job cancelled.");
  assert(queuedCancel.job.phase === "cancelled", "Queued cancel did not mark phase cancelled.");
  assert(queuedCancel.job.progress === 1, "Queued cancel did not finish progress.");

  const runningCancel = await fetchJson<{ job: Job }>(`/api/jobs/${encodeURIComponent(slowJob.id)}/cancel`, { method: "POST" });
  assert(runningCancel.job.cancelRequested === true, "Running cancel did not set cancelRequested.");
  const cancelledSlow = await waitForJobStatus(slowJob.id, "cancelled");
  assert(cancelledSlow.phase === "cancelled", "Running cancel did not end in cancelled phase.");
  assert(cancelledSlow.progress === 1, "Running cancel did not finish progress.");
  assert(cancelledSlow.error, "Running cancel did not record a cancellation error.");

  await waitForJobStatus(queuedJob.id, "cancelled", 10_000);
  assert(fakeOcr.requestCount === 1, `Expected one OCR request before cooperative cancellation, got ${fakeOcr.requestCount}.`);
  const cancelDocs = await fetchJson<{ documents: DocumentSummary[] }>("/api/collections/job-cancel-smoke/documents");
  assert(!cancelDocs.documents.some((doc) => doc.name === "slow-ocr.pdf"), "Cancelled running job created a document.");
  assert(!cancelDocs.documents.some((doc) => doc.name === "queued.txt"), "Cancelled queued job created a document.");

  const retryCollection = await fetchJson<{ collection: { slug: string } }>("/api/collections", {
    method: "POST",
    body: JSON.stringify({ name: "Job Retry Smoke", slug: "job-retry-smoke" }),
  });
  assert(retryCollection.collection.slug === "job-retry-smoke", "Retry collection slug mismatch.");
  await fetchJson("/api/collections/job-retry-smoke/config", {
    method: "PUT",
    body: JSON.stringify({
      embedding: { provider: "local-hash", model: "local-hash-v1", dimension: 384 },
      chunking: { targetChars: 8000, overlapChars: 0 },
      parsers: { maxFileSizeMb: 100 },
    }),
  });

  const retryText = "RETRY_SENTINEL ".repeat(70000);
  const retryUpload = await uploadFiles("job-retry-smoke", [
    { name: "retry-large.txt", type: "text/plain", body: retryText },
  ]);
  assert(retryUpload.jobs.length === 1, "Retry smoke upload did not create one job.");
  const initialJob = await waitForJobStatus(retryUpload.jobs[0]!.id, "succeeded");
  assert(initialJob.documentId, "Initial retry upload job did not record documentId.");
  const documentId = initialJob.documentId;

  await fetchJson("/api/collections/job-retry-smoke/config", {
    method: "PUT",
    body: JSON.stringify({ parsers: { maxFileSizeMb: 1 } }),
  });
  const failingReprocess = await fetchJson<{ job: Job }>(`/api/collections/job-retry-smoke/documents/${encodeURIComponent(documentId)}/reprocess`, {
    method: "POST",
  });
  const failedReprocessJob = await waitForJobStatus(failingReprocess.job.id, "failed");
  assert(failedReprocessJob.kind === "reprocess", "Failed retry job kind mismatch.");
  assert(failedReprocessJob.documentId === documentId, "Failed retry job did not keep the original documentId.");
  assert(failedReprocessJob.error, "Failed retry job did not record an error.");

  const afterFailure = await fetchJson<{ documents: DocumentSummary[] }>("/api/collections/job-retry-smoke/documents");
  const failedDocument = afterFailure.documents.find((doc) => doc.id === documentId);
  assert(failedDocument, "Failed reprocess removed the original document.");
  assert(failedDocument.status === "failed", `Expected failed document status, got ${failedDocument.status}.`);
  assert(failedDocument.extractionStatus === "failed", `Expected failed extraction status, got ${failedDocument.extractionStatus ?? "missing"}.`);
  assert(failedDocument.jobId === failedReprocessJob.id, "Failed document did not record failed job id.");

  await fetchJson("/api/collections/job-retry-smoke/config", {
    method: "PUT",
    body: JSON.stringify({ parsers: { maxFileSizeMb: 100 } }),
  });
  const retryReprocess = await fetchJson<{ job: Job }>(`/api/collections/job-retry-smoke/documents/${encodeURIComponent(documentId)}/reprocess`, {
    method: "POST",
  });
  const retryJob = await waitForJobStatus(retryReprocess.job.id, "succeeded");
  assert(retryJob.documentId === documentId, "Successful retry job changed the documentId.");

  const afterRetry = await fetchJson<{ documents: DocumentSummary[] }>("/api/collections/job-retry-smoke/documents");
  const retryMatches = afterRetry.documents.filter((doc) => doc.id === documentId);
  assert(retryMatches.length === 1, "Retry created duplicate document records.");
  const retriedDocument = retryMatches[0]!;
  assert(retriedDocument.status === "indexed", `Expected indexed document status after retry, got ${retriedDocument.status}.`);
  assert(retriedDocument.extractionStatus === "indexed", `Expected indexed extraction status after retry, got ${retriedDocument.extractionStatus ?? "missing"}.`);
  assert(retriedDocument.chunkCount >= 1, "Retried document did not rebuild chunks.");
  assert(retriedDocument.jobId === retryJob.id, "Retried document did not record retry job id.");

  const retrySearch = await fetchJson<{ results: Array<{ documentId: string; sourceName: string; text: string }> }>("/api/collections/job-retry-smoke/search", {
    method: "POST",
    body: JSON.stringify({ query: "RETRY_SENTINEL", topK: 3 }),
  });
  assert(retrySearch.results.some((result) => result.documentId === documentId), "Retried document was not searchable.");

  const failedUploadCollection = await fetchJson<{ collection: { slug: string } }>("/api/collections", {
    method: "POST",
    body: JSON.stringify({ name: "Failed Upload Retry Smoke", slug: "failed-upload-retry-smoke" }),
  });
  assert(failedUploadCollection.collection.slug === "failed-upload-retry-smoke", "Failed-upload retry collection slug mismatch.");
  await fetchJson("/api/collections/failed-upload-retry-smoke/config", {
    method: "PUT",
    body: JSON.stringify({
      embedding: { provider: "local-hash", model: "local-hash-v1", dimension: 384 },
      chunking: { targetChars: 8000, overlapChars: 0 },
      parsers: { maxFileSizeMb: 1 },
    }),
  });

  const failedUploadText = "UPLOAD_RETRY_SENTINEL ".repeat(70000);
  const failedUpload = await uploadFiles("failed-upload-retry-smoke", [
    { name: "failed-upload-large.txt", type: "text/plain", body: failedUploadText },
  ]);
  assert(failedUpload.jobs.length === 1, "Failed-upload smoke did not create one job.");
  const failedUploadJob = await waitForJobStatus(failedUpload.jobs[0]!.id, "failed");
  assert(failedUploadJob.kind === "upload", "Failed-upload job kind mismatch.");
  assert(failedUploadJob.documentId, "Failed-upload job did not record the retryable failed documentId.");
  assert(failedUploadJob.error, "Failed-upload job did not record an error.");
  const failedUploadDocumentId = failedUploadJob.documentId;

  const afterFailedUpload = await fetchJson<{ documents: DocumentSummary[] }>("/api/collections/failed-upload-retry-smoke/documents");
  const failedUploadDocument = afterFailedUpload.documents.find((doc) => doc.id === failedUploadDocumentId);
  assert(failedUploadDocument, "Failed-upload document was not saved for retry.");
  assert(failedUploadDocument.name === "failed-upload-large.txt", "Failed-upload document name mismatch.");
  assert(failedUploadDocument.status === "failed", `Expected failed-upload document status failed, got ${failedUploadDocument.status}.`);
  assert(failedUploadDocument.extractionStatus === "failed", `Expected failed-upload extraction status failed, got ${failedUploadDocument.extractionStatus ?? "missing"}.`);
  assert(failedUploadDocument.jobId === failedUploadJob.id, "Failed-upload document did not record the failed job id.");

  await fetchJson("/api/collections/failed-upload-retry-smoke/config", {
    method: "PUT",
    body: JSON.stringify({ parsers: { maxFileSizeMb: 100 } }),
  });
  const failedUploadRetry = await fetchJson<{ job: Job }>(`/api/collections/failed-upload-retry-smoke/documents/${encodeURIComponent(failedUploadDocumentId)}/reprocess`, {
    method: "POST",
  });
  const failedUploadRetryJob = await waitForJobStatus(failedUploadRetry.job.id, "succeeded");
  assert(failedUploadRetryJob.documentId === failedUploadDocumentId, "Failed-upload retry changed the documentId.");

  const afterFailedUploadRetry = await fetchJson<{ documents: DocumentSummary[] }>("/api/collections/failed-upload-retry-smoke/documents");
  const failedUploadRetryMatches = afterFailedUploadRetry.documents.filter((doc) => doc.id === failedUploadDocumentId);
  assert(failedUploadRetryMatches.length === 1, "Failed-upload retry created duplicate document records.");
  const retriedFailedUploadDocument = failedUploadRetryMatches[0]!;
  assert(retriedFailedUploadDocument.status === "indexed", `Expected failed-upload retry status indexed, got ${retriedFailedUploadDocument.status}.`);
  assert(retriedFailedUploadDocument.extractionStatus === "indexed", `Expected failed-upload retry extraction status indexed, got ${retriedFailedUploadDocument.extractionStatus ?? "missing"}.`);
  assert(retriedFailedUploadDocument.chunkCount >= 1, "Failed-upload retry did not rebuild chunks.");

  const failedUploadRetrySearch = await fetchJson<{ results: Array<{ documentId: string; sourceName: string; text: string }> }>("/api/collections/failed-upload-retry-smoke/search", {
    method: "POST",
    body: JSON.stringify({ query: "UPLOAD_RETRY_SENTINEL", topK: 3 }),
  });
  assert(failedUploadRetrySearch.results.some((result) => result.documentId === failedUploadDocumentId), "Failed-upload retried document was not searchable.");

  console.log(JSON.stringify({
    ok: true,
    tempDir,
    cancel: {
      slowJob: slowJob.id,
      queuedJob: queuedJob.id,
      ocrRequests: fakeOcr.requestCount,
      documents: cancelDocs.documents.length,
    },
    retry: {
      documentId,
      initialJob: initialJob.id,
      failedJob: failedReprocessJob.id,
      retryJob: retryJob.id,
      chunkCount: retriedDocument.chunkCount,
      searchResults: retrySearch.results.length,
    },
    failedUploadRetry: {
      documentId: failedUploadDocumentId,
      failedJob: failedUploadJob.id,
      retryJob: failedUploadRetryJob.id,
      chunkCount: retriedFailedUploadDocument.chunkCount,
      searchResults: failedUploadRetrySearch.results.length,
    },
  }, null, 2));
} catch (error) {
  if (serverLog.length) {
    console.error(serverLog.slice(-20).join(""));
  }
  throw error;
} finally {
  server.kill();
  await delay(300);
  await new Promise<void>((resolve) => fakeOcr.server.close(() => resolve()));
  await rm(tempDir, { recursive: true, force: true });
}
