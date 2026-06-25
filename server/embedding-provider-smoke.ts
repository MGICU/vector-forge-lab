import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const rootDir = process.cwd();
const tempDir = await mkdtemp(path.join(os.tmpdir(), "vector-forge-embedding-smoke-"));
const apiPort = 62021;
const providerPort = 62022;
const tsxCli = path.join(rootDir, "node_modules", "tsx", "dist", "cli.mjs");
const providerUrl = `http://127.0.0.1:${providerPort}/v1/embeddings`;
const dimension = 64;
const apiKey = "embedding-smoke-secret";

type FakeProviderCall = {
  model: string;
  inputCount: number;
  authorization: string;
};

const providerCalls: FakeProviderCall[] = [];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function stableVector(text: string, length = dimension) {
  const vector = new Array<number>(length).fill(0);
  for (let index = 0; index < Math.max(1, text.length); index += 1) {
    const code = text.charCodeAt(index % text.length) || 1;
    vector[(code + index) % length] += ((code % 17) + 1) / 100;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / norm);
}

function readRequestJson(request: IncomingMessage) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("error", reject);
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<string, unknown>);
      } catch (error) {
        reject(error);
      }
    });
  });
}

function writeJson(response: ServerResponse, statusCode: number, payload: unknown) {
  response.writeHead(statusCode, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

async function handleProviderRequest(request: IncomingMessage, response: ServerResponse) {
  if (request.method !== "POST" || request.url !== "/v1/embeddings") {
    writeJson(response, 404, { error: "not found" });
    return;
  }
  const body = await readRequestJson(request);
  const model = typeof body.model === "string" ? body.model : "";
  const rawInput = body.input;
  const inputs = Array.isArray(rawInput) ? rawInput.map(String) : [String(rawInput ?? "")];
  providerCalls.push({
    model,
    inputCount: inputs.length,
    authorization: String(request.headers.authorization ?? ""),
  });

  if (model === "embedding-smoke-unauthorized") {
    writeJson(response, 401, { error: "invalid key" });
    return;
  }
  if (model === "embedding-smoke-bad-shape") {
    writeJson(response, 200, { data: [{ object: "embedding" }] });
    return;
  }
  if (model === "embedding-smoke-bad-dimension") {
    writeJson(response, 200, { data: inputs.map((input) => ({ embedding: stableVector(input, dimension - 1) })) });
    return;
  }
  if (model === "embedding-smoke-slow") {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  writeJson(response, 200, { data: inputs.map((input) => ({ embedding: stableVector(input) })) });
}

async function listen(server: ReturnType<typeof createServer>, port: number) {
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
}

async function fetchJson<T>(route: string, init?: RequestInit) {
  const response = await fetch(`http://127.0.0.1:${apiPort}${route}`, {
    ...init,
    headers: init?.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${route} ${response.status}: ${text}`);
  return JSON.parse(text) as T;
}

async function fetchError(route: string, init?: RequestInit) {
  const response = await fetch(`http://127.0.0.1:${apiPort}${route}`, {
    ...init,
    headers: init?.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await response.text();
  assert(!response.ok, `${route} unexpectedly succeeded: ${text}`);
  return { status: response.status, text };
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

const embeddingConfig = (model = "embedding-smoke-success") => ({
  embedding: {
    provider: "openai-compatible",
    baseUrl: providerUrl,
    apiKey,
    model,
    dimension,
    batchSize: 2,
  },
});

const providerServer = createServer((request, response) => {
  void handleProviderRequest(request, response).catch((error) => {
    writeJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  });
});

await listen(providerServer, providerPort);

const apiServer = spawn(process.execPath, [tsxCli, "server/index.ts"], {
  cwd: rootDir,
  env: {
    ...process.env,
    VECTOR_FORGE_ROOT_DIR: rootDir,
    VECTOR_FORGE_DATA_DIR: tempDir,
    VECTOR_FORGE_PORT: String(apiPort),
    VECTOR_FORGE_EMBEDDING_TIMEOUT_MS: "250",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

try {
  await waitForApi();

  const test = await fetchJson<{ ok: boolean; provider: string; model: string; dimension: number }>("/api/test-embedding", {
    method: "POST",
    body: JSON.stringify(embeddingConfig()),
  });
  assert(test.ok === true, "Embedding test did not return ok.");
  assert(test.provider === "openai-compatible", "Embedding test used the wrong provider.");
  assert(test.dimension === dimension, "Embedding test returned the wrong dimension.");
  assert(providerCalls.at(-1)?.authorization === `Bearer ${apiKey}`, "Embedding provider did not receive the API key header.");

  await fetchJson("/api/config", { method: "PUT", body: JSON.stringify(embeddingConfig()) });
  const created = await fetchJson<{ collection: { slug: string; dimension: number; embeddingProvider: string } }>("/api/collections", {
    method: "POST",
    body: JSON.stringify({ name: "OpenAI Compatible Smoke", slug: "embedding-smoke" }),
  });
  assert(created.collection.slug === "embedding-smoke", "Collection slug mismatch.");
  assert(created.collection.dimension === dimension, "Collection did not copy the configured embedding dimension.");
  assert(created.collection.embeddingProvider === "openai-compatible", "Collection did not copy the configured provider.");

  const ingest = await fetchJson<{ document: { id: string; chunkCount: number } }>("/api/collections/embedding-smoke/text", {
    method: "POST",
    body: JSON.stringify({
      name: "embedding-smoke.txt",
      text: "OpenAI compatible embedding fake provider smoke sentinel. Search should find this indexed document.",
    }),
  });
  assert(ingest.document.chunkCount >= 1, "OpenAI-compatible ingest did not create chunks.");

  const search = await fetchJson<{ results: Array<{ documentId: string; score: number }> }>("/api/collections/embedding-smoke/search", {
    method: "POST",
    body: JSON.stringify({ query: "fake provider sentinel", topK: 3 }),
  });
  assert(search.results.length >= 1, "OpenAI-compatible search returned no results.");
  assert(search.results[0]?.documentId === ingest.document.id, "Search did not return the indexed document.");

  const unauthorized = await fetchError("/api/test-embedding", {
    method: "POST",
    body: JSON.stringify(embeddingConfig("embedding-smoke-unauthorized")),
  });
  assert(unauthorized.status === 502, `Unauthorized provider error should map to 502, got ${unauthorized.status}.`);
  assert(unauthorized.text.includes("Embedding provider returned 401"), "Unauthorized error was not clear.");

  const badShape = await fetchError("/api/test-embedding", {
    method: "POST",
    body: JSON.stringify(embeddingConfig("embedding-smoke-bad-shape")),
  });
  assert(badShape.status === 502, `Bad response shape should map to 502, got ${badShape.status}.`);
  assert(badShape.text.includes("unexpected response shape"), "Bad response shape error was not clear.");

  const badDimension = await fetchError("/api/test-embedding", {
    method: "POST",
    body: JSON.stringify(embeddingConfig("embedding-smoke-bad-dimension")),
  });
  assert(badDimension.status === 400, `Dimension mismatch should map to 400, got ${badDimension.status}.`);
  assert(badDimension.text.includes("Embedding dimension mismatch"), "Dimension mismatch error was not clear.");

  const timedOut = await fetchError("/api/test-embedding", {
    method: "POST",
    body: JSON.stringify(embeddingConfig("embedding-smoke-slow")),
  });
  assert(timedOut.status === 504, `Slow provider should map to 504, got ${timedOut.status}.`);
  assert(timedOut.text.includes("timed out"), "Timeout error was not clear.");

  console.log(
    JSON.stringify(
      {
        ok: true,
        tempDir,
        providerCalls: providerCalls.length,
        collection: created.collection.slug,
        indexedChunks: ingest.document.chunkCount,
        searchResults: search.results.length,
        failures: {
          unauthorized: unauthorized.status,
          badShape: badShape.status,
          badDimension: badDimension.status,
          timeout: timedOut.status,
        },
      },
      null,
      2,
    ),
  );
} finally {
  apiServer.kill();
  providerServer.close();
  await new Promise((resolve) => setTimeout(resolve, 300));
  await rm(tempDir, { recursive: true, force: true });
}
