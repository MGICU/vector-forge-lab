import { spawn } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const rootDir = process.cwd();
const tempDir = await mkdtemp(path.join(os.tmpdir(), "vector-forge-directory-smoke-"));
const dataDir = path.join(tempDir, "data");
const sourceDir = path.join(tempDir, "source");
const nestedDir = path.join(sourceDir, "nested");
const port = 61988;
const tsxCli = path.join(rootDir, "node_modules", "tsx", "dist", "cli.mjs");

type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function pathKey(input: string) {
  const resolved = path.resolve(input);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

async function fetchJson<T>(route: string, init?: RequestInit) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${route} ${response.status}: ${text}`);
  return JSON.parse(text) as T;
}

async function fetchRaw(route: string, init?: RequestInit) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  return { response, text: await response.text() };
}

async function waitForApi() {
  for (let i = 0; i < 50; i += 1) {
    try {
      return await fetchJson<{ ok: boolean }>("/api/health");
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw new Error("API did not become ready.");
}

async function waitForJobs(collectionSlug: string, expected: number) {
  for (let i = 0; i < 80; i += 1) {
    const payload = await fetchJson<{ jobs: Array<{ id: string; status: JobStatus; error?: string }> }>(
      `/api/jobs?collectionSlug=${encodeURIComponent(collectionSlug)}`,
    );
    if (payload.jobs.length >= expected && payload.jobs.slice(0, expected).every((job) => job.status === "succeeded")) return payload.jobs;
    const failed = payload.jobs.find((job) => job.status === "failed");
    if (failed) throw new Error(`Directory import job failed: ${failed.error ?? failed.id}`);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("Directory import jobs did not finish.");
}

await mkdir(nestedDir, { recursive: true });
const firstFile = path.join(sourceDir, "directory-smoke.txt");
const secondFile = path.join(nestedDir, "nested-reference.md");
const outsideFile = path.join(tempDir, "outside-scan.txt");
const ignoredFile = path.join(sourceDir, "ignore.exe");
await writeFile(firstFile, "Directory scan import smoke test. Local path import should index this document.", "utf8");
await writeFile(secondFile, "# Nested reference\n\nRecursive directory scanning should discover this markdown document.", "utf8");
await writeFile(outsideFile, "This file is supported but was not returned by the directory scan.", "utf8");
await writeFile(ignoredFile, "not an importable document", "utf8");
const canonicalFirstFile = await realpath(firstFile);

const server = spawn(process.execPath, [tsxCli, "server/index.ts"], {
  cwd: rootDir,
  env: {
    ...process.env,
    VECTOR_FORGE_ROOT_DIR: rootDir,
    VECTOR_FORGE_DATA_DIR: dataDir,
    VECTOR_FORGE_PORT: String(port),
  },
  stdio: ["ignore", "pipe", "pipe"],
});

try {
  await waitForApi();
  const created = await fetchJson<{ collection: { slug: string } }>("/api/collections", {
    method: "POST",
    body: JSON.stringify({ name: "Directory Smoke Collection", slug: "directory-smoke" }),
  });
  assert(created.collection.slug === "directory-smoke", "Collection was not created with expected slug.");

  const flatScan = await fetchJson<{
    scanId: string;
    candidates: Array<{ id: string; path: string; name: string; contentHash?: string }>;
    scanned: number;
    truncated: boolean;
  }>("/api/collections/directory-smoke/scan-directory", {
    method: "POST",
    body: JSON.stringify({ directoryPath: sourceDir, recursive: false, maxFiles: 10 }),
  });
  assert(flatScan.candidates.length === 1, "Flat scan should include one supported top-level file.");
  assert(Boolean(flatScan.scanId), "Flat scan should return a scanId.");
  assert(Boolean(flatScan.candidates[0]?.id), "Flat scan candidates should include stable ids for this scan.");
  assert(pathKey(flatScan.candidates[0]?.path ?? "") === pathKey(canonicalFirstFile), "Flat scan returned the wrong file.");
  assert(Boolean(flatScan.candidates[0]?.contentHash), "Flat scan should include a small-file content hash.");

  const recursiveScan = await fetchJson<{
    scanId: string;
    candidates: Array<{ id: string; path: string; name: string; extension: string }>;
  }>("/api/collections/directory-smoke/scan-directory", {
    method: "POST",
    body: JSON.stringify({ directoryPath: sourceDir, recursive: true, maxFiles: 10 }),
  });
  assert(recursiveScan.candidates.length === 2, "Recursive scan should include top-level and nested supported files.");
  assert(Boolean(recursiveScan.scanId), "Recursive scan should return a scanId.");
  assert(recursiveScan.candidates.every((candidate) => candidate.extension !== ".exe"), "Scan included unsupported executable.");

  const oldPathOnlyImport = await fetchRaw("/api/collections/directory-smoke/import-paths", {
    method: "POST",
    body: JSON.stringify({ paths: recursiveScan.candidates.map((candidate) => candidate.path) }),
  });
  assert(oldPathOnlyImport.response.status === 400, "Import without scanId was accepted.");

  const outsideScanImport = await fetchRaw("/api/collections/directory-smoke/import-paths", {
    method: "POST",
    body: JSON.stringify({ scanId: recursiveScan.scanId, paths: [outsideFile] }),
  });
  assert(outsideScanImport.response.status === 400, "Path outside the scan results was accepted.");

  if (process.platform === "win32") {
    const uncImport = await fetchRaw("/api/collections/directory-smoke/import-paths", {
      method: "POST",
      body: JSON.stringify({ scanId: recursiveScan.scanId, paths: ["\\\\server\\share\\document.txt"] }),
    });
    assert(uncImport.response.status === 400, "UNC path import was accepted.");
  }

  const imported = await fetchJson<{
    jobs: Array<{ id: string; fileName: string }>;
    failures: Array<{ path: string; error: string }>;
  }>("/api/collections/directory-smoke/import-paths", {
    method: "POST",
    body: JSON.stringify({
      scanId: recursiveScan.scanId,
      candidateIds: recursiveScan.candidates.map((candidate) => candidate.id),
    }),
  });
  assert(imported.jobs.length === 2, "Import paths should create two jobs.");
  assert(imported.failures.length === 0, `Import paths had failures: ${JSON.stringify(imported.failures)}`);

  await waitForJobs("directory-smoke", 2);
  const docs = await fetchJson<{ documents: Array<{ id: string; name: string; chunkCount: number }> }>(
    "/api/collections/directory-smoke/documents",
  );
  assert(docs.documents.length === 2, "Directory import should create two documents.");
  assert(docs.documents.every((document) => document.chunkCount >= 1), "Directory imported documents should be chunked.");

  const search = await fetchJson<{ results: Array<{ documentId: string; text: string }> }>("/api/collections/directory-smoke/search", {
    method: "POST",
    body: JSON.stringify({ query: "recursive markdown directory scanning", topK: 3 }),
  });
  assert(search.results.length >= 1, "Search returned no directory-imported result.");

  console.log(
    JSON.stringify(
      {
        ok: true,
        scanned: recursiveScan.candidates.length,
        scanSession: Boolean(recursiveScan.scanId),
        rejectedPathOnlyImport: oldPathOnlyImport.response.status,
        rejectedOutsidePath: outsideScanImport.response.status,
        importedJobs: imported.jobs.length,
        documents: docs.documents.length,
        searchResults: search.results.length,
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
