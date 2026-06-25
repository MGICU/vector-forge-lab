import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const rootDir = process.cwd();
const tempDir = await mkdtemp(path.join(os.tmpdir(), "vector-forge-token-smoke-"));
const port = 61991;
const token = "local-action-token-smoke-secret";
const tsxCli = path.join(rootDir, "node_modules", "tsx", "dist", "cli.mjs");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function jsonHeaders(extra: Record<string, string> = {}) {
  return { "Content-Type": "application/json", ...extra };
}

function tokenHeader(value = token) {
  return { "X-Vector-Forge-Local-Action-Token": value };
}

async function fetchRaw(route: string, init?: RequestInit & { headers?: Record<string, string> }) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    ...init,
    headers: jsonHeaders(init?.headers ?? {}),
  });
  return { response, text: await response.text() };
}

async function fetchJson<T>(route: string, init?: RequestInit & { headers?: Record<string, string> }) {
  const { response, text } = await fetchRaw(route, init);
  if (!response.ok) throw new Error(`${route} ${response.status}: ${text}`);
  return JSON.parse(text) as T;
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

async function expectStatus(label: string, expected: number, route: string, init?: RequestInit & { headers?: Record<string, string> }) {
  const { response, text } = await fetchRaw(route, init);
  assert(response.status === expected, `${label} expected HTTP ${expected}, got ${response.status}: ${text}`);
  return text;
}

async function expectRejected(label: string, route: string, init?: RequestInit & { headers?: Record<string, string> }) {
  const text = await expectStatus(label, 403, route, init);
  assert(text.includes("Trusted local action token"), `${label} did not return the token boundary error: ${text}`);
}

await mkdir(tempDir, { recursive: true });
const server = spawn(process.execPath, [tsxCli, "server/index.ts"], {
  cwd: rootDir,
  env: {
    ...process.env,
    VECTOR_FORGE_ROOT_DIR: rootDir,
    VECTOR_FORGE_DATA_DIR: tempDir,
    VECTOR_FORGE_PORT: String(port),
    VECTOR_FORGE_LOCAL_ACTION_TOKEN: token,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

try {
  await waitForApi();

  await expectRejected("AI dry-run without token", "/api/ai/tools/dry-run", {
    method: "POST",
    body: JSON.stringify({ prompt: "search local documents", requestedToolId: "local.search" }),
  });
  await expectRejected("AI dry-run with wrong token", "/api/ai/tools/dry-run", {
    method: "POST",
    headers: tokenHeader("wrong-token"),
    body: JSON.stringify({ prompt: "search local documents", requestedToolId: "local.search" }),
  });
  const dryRun = await fetchJson<{ matchedToolIds: string[]; willExecute: false }>("/api/ai/tools/dry-run", {
    method: "POST",
    headers: tokenHeader(),
    body: JSON.stringify({ prompt: "search local documents", requestedToolId: "local.search" }),
  });
  assert(dryRun.matchedToolIds.includes("local.search"), "Authorized dry-run did not match local.search.");
  assert(dryRun.willExecute === false, "Authorized dry-run should still be no-execute.");

  await expectRejected("AnythingLLM environment without token", "/api/anythingllm/environment");
  const environment = await fetchJson<{ desktop: { candidates: unknown[] } }>("/api/anythingllm/environment", {
    headers: tokenHeader(),
  });
  assert(Array.isArray(environment.desktop.candidates), "Authorized AnythingLLM environment response was malformed.");

  await expectRejected("Collection create without token", "/api/collections", {
    method: "POST",
    body: JSON.stringify({ name: "Token Smoke Collection", slug: "token-smoke" }),
  });
  const created = await fetchJson<{ collection: { slug: string } }>("/api/collections", {
    method: "POST",
    headers: tokenHeader(),
    body: JSON.stringify({ name: "Token Smoke Collection", slug: "token-smoke" }),
  });
  assert(created.collection.slug === "token-smoke", "Authorized collection create returned the wrong slug.");

  await expectRejected("Embedding test without token", "/api/test-embedding", {
    method: "POST",
    body: JSON.stringify({ embedding: { provider: "local-hash", model: "token-smoke", dimension: 384 } }),
  });
  const embedding = await fetchJson<{ ok: boolean; provider: string }>("/api/test-embedding", {
    method: "POST",
    headers: tokenHeader(),
    body: JSON.stringify({ embedding: { provider: "local-hash", model: "token-smoke", dimension: 384 } }),
  });
  assert(embedding.ok && embedding.provider === "local-hash", "Authorized embedding test did not succeed.");

  await expectRejected("Search without token", "/api/collections/token-smoke/search", {
    method: "POST",
    body: JSON.stringify({ query: "anything", topK: 3 }),
  });
  const search = await fetchJson<{ results: unknown[] }>("/api/collections/token-smoke/search", {
    method: "POST",
    headers: tokenHeader(),
    body: JSON.stringify({ query: "anything", topK: 3 }),
  });
  assert(Array.isArray(search.results), "Authorized search response was malformed.");

  await expectRejected("Batch delete without token", "/api/collections/token-smoke/documents/batch-delete", {
    method: "POST",
    body: JSON.stringify({ documentIds: ["missing-document"] }),
  });
  const batchDelete = await fetchJson<{ failed: number }>("/api/collections/token-smoke/documents/batch-delete", {
    method: "POST",
    headers: tokenHeader(),
    body: JSON.stringify({ documentIds: ["missing-document"] }),
  });
  assert(batchDelete.failed === 1, "Authorized batch delete should reach the handler and report the missing document.");

  await expectRejected("AnythingLLM sync without token", "/api/collections/token-smoke/sync-anythingllm", {
    method: "POST",
    body: JSON.stringify({ maxChunks: 1 }),
  });
  const syncDisabled = await fetchRaw("/api/collections/token-smoke/sync-anythingllm", {
    method: "POST",
    headers: tokenHeader(),
    body: JSON.stringify({ maxChunks: 1 }),
  });
  assert(syncDisabled.response.status === 400, `Authorized disabled AnythingLLM sync should reach config validation, got ${syncDisabled.response.status}.`);
  assert(syncDisabled.text.includes("AnythingLLM sync is disabled"), "Authorized disabled sync returned an unexpected error.");

  console.log(
    JSON.stringify(
      {
        ok: true,
        tempDir,
        tokenBoundary: {
          rejectedMissing: true,
          rejectedWrong: true,
          authorizedDryRun: true,
          authorizedCollectionWrite: true,
          authorizedExternalTest: true,
          authorizedDestructiveRoute: true,
          authorizedSyncRoute: true,
        },
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
