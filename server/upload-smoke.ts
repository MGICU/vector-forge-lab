import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const rootDir = process.cwd();
const tempDir = await mkdtemp(path.join(os.tmpdir(), "vector-forge-upload-smoke-"));
const port = 61984;
const tsxCli = path.join(rootDir, "node_modules", "tsx", "dist", "cli.mjs");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function exists(targetPath: string) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
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
  for (let i = 0; i < 40; i += 1) {
    try {
      return await fetchJson<{ ok: boolean }>("/api/health");
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw new Error("API did not become ready.");
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
    body: JSON.stringify({ name: "Upload Smoke Collection", slug: "upload-smoke" }),
  });
  assert(created.collection.slug === "upload-smoke", "Collection was not created with expected slug.");

  const form = new FormData();
  form.append(
    "files",
    new Blob(["Uploaded file smoke test. Vector Forge should chunk, embed, store, and search this file."], { type: "text/plain" }),
    "upload-smoke.txt",
  );
  const uploaded = await fetchJson<{
    results: Array<{ ok: boolean; file: string; chunks?: number; error?: string }>;
    documents: Array<{ id: string; name: string; chunkCount: number; sourcePath: string }>;
  }>("/api/collections/upload-smoke/upload", { method: "POST", body: form });
  assert(uploaded.results.length === 1, "Upload did not return one result.");
  assert(uploaded.results[0]?.ok, `Upload failed: ${uploaded.results[0]?.error ?? "unknown error"}`);
  assert(uploaded.documents.length === 1, "Uploaded document was not recorded.");
  assert((uploaded.documents[0]?.chunkCount ?? 0) >= 1, "Uploaded document was not chunked.");
  const sourcePath = uploaded.documents[0]?.sourcePath ?? "";
  assert(Boolean(sourcePath), "Uploaded document did not record a managed sourcePath.");
  assert(await exists(sourcePath), "Uploaded managed source copy was not written.");

  const search = await fetchJson<{ results: Array<{ documentId: string; text: string }> }>("/api/collections/upload-smoke/search", {
    method: "POST",
    body: JSON.stringify({ query: "uploaded file chunk embed search", topK: 3 }),
  });
  assert(search.results.length >= 1, "Search returned no uploaded file result.");
  assert(search.results[0]?.documentId === uploaded.documents[0]?.id, "Search did not return the uploaded document.");

  const deleted = await fetchJson<{ deleted: string }>(`/api/collections/upload-smoke/documents/${encodeURIComponent(uploaded.documents[0].id)}`, {
    method: "DELETE",
  });
  assert(deleted.deleted === uploaded.documents[0].id, "Delete endpoint returned the wrong document id.");
  assert(!(await exists(sourcePath)), "Deleted document left behind its managed source copy.");

  console.log(
    JSON.stringify(
      {
        ok: true,
        tempDir,
        collection: created.collection.slug,
        uploadedFile: uploaded.results[0]?.file,
        indexedChunks: uploaded.documents[0]?.chunkCount,
        searchResults: search.results.length,
        sourceCopyRemovedAfterDelete: true,
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
