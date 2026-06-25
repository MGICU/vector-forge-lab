import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const rootDir = process.cwd();
const tempDir = await mkdtemp(path.join(os.tmpdir(), "vector-forge-mcp-write-smoke-"));
const token = "mcp-write-smoke-local-action-token";
const collectionSlug = "mcp-write-smoke";
const tsxCli = path.join(rootDir, "node_modules", "tsx", "dist", "cli.mjs");

type HealthResponse = {
  config: {
    mcp: { allowWrites: boolean };
  };
};

type ConfigResponse = {
  mcp: { allowWrites: boolean };
};

type UpsertResponse = {
  chunks: number;
  document: { id: string; name: string };
};

type SearchResponse = {
  results: Array<{ documentId: string; text: string; sourceName?: string }>;
};

type DocumentDetailResponse = {
  document: { id: string; name: string };
  chunks: unknown[];
};

type ToolResultLike = {
  content: Array<{ type?: string; text?: string }>;
  isError?: boolean;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function findFreePort() {
  return await new Promise<number>((resolve, reject) => {
    const probe = createNetServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") {
        probe.close(() => reject(new Error("Unable to allocate a local API port.")));
        return;
      }
      const { port } = address;
      probe.close(() => resolve(port));
    });
  });
}

const port = await findFreePort();
const apiBaseUrl = `http://127.0.0.1:${port}`;

function needsToken(method: string | undefined) {
  return !["GET", "HEAD", "OPTIONS"].includes((method ?? "GET").toUpperCase());
}

function requestHeaders(init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (needsToken(init.method)) headers.set("X-Vector-Forge-Local-Action-Token", token);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return headers;
}

async function fetchJson<T>(route: string, init: RequestInit = {}) {
  const response = await fetch(`${apiBaseUrl}${route}`, {
    ...init,
    headers: requestHeaders(init),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${route} ${response.status}: ${text}`);
  if (!text.trim()) return {} as T;
  return JSON.parse(text) as T;
}

async function waitForApi() {
  for (let i = 0; i < 50; i += 1) {
    try {
      return await fetchJson<HealthResponse>("/api/health");
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw new Error("API did not become ready.");
}

function asToolResult(label: string, result: unknown): ToolResultLike {
  assert(isRecord(result) && Array.isArray(result.content), `${label} returned an unexpected MCP result shape: ${JSON.stringify(result)}`);
  return {
    content: result.content as ToolResultLike["content"],
    isError: result.isError === true,
  };
}

function toolText(result: ToolResultLike) {
  return result.content.map((item) => (item.type === "text" ? item.text ?? "" : JSON.stringify(item))).join("\n");
}

function parseToolJson<T>(label: string, rawResult: unknown) {
  const result = asToolResult(label, rawResult);
  const text = toolText(result);
  assert(!result.isError, `${label} returned MCP error: ${text}`);
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error(`${label} returned non-JSON content: ${error instanceof Error ? error.message : String(error)}\n${text}`, { cause: error });
  }
}

async function expectToolRejected(label: string, call: () => Promise<unknown>, expectedText: string) {
  try {
    const result = asToolResult(label, await call());
    const text = toolText(result);
    assert(result.isError === true || text.includes(expectedText), `${label} unexpectedly succeeded: ${text}`);
    assert(text.includes(expectedText), `${label} returned the wrong error: ${text}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert(message.includes(expectedText), `${label} returned the wrong thrown error: ${message}`);
  }
}

async function connectMcpClient(name: string) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [tsxCli, "server/mcp.ts"],
    cwd: rootDir,
    stderr: "pipe",
    env: {
      ...process.env,
      VECTOR_FORGE_ROOT_DIR: rootDir,
      VECTOR_FORGE_DATA_DIR: tempDir,
      VECTOR_FORGE_API_URL: apiBaseUrl,
      VECTOR_FORGE_MCP_AUTOSTART: "false",
      VECTOR_FORGE_LOCAL_ACTION_TOKEN: token,
    },
  });
  const client = new Client({ name, version: "0.1.0" });
  await client.connect(transport);
  await client.ping();
  return client;
}

await mkdir(tempDir, { recursive: true });
const apiProcess = spawn(process.execPath, [tsxCli, "server/index.ts"], {
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

const apiStdout: string[] = [];
const apiStderr: string[] = [];
apiProcess.stdout.on("data", (chunk) => apiStdout.push(String(chunk)));
apiProcess.stderr.on("data", (chunk) => apiStderr.push(String(chunk)));

let readOnlyClient: Client | undefined;
let writeClient: Client | undefined;

try {
  const initialHealth = await waitForApi();
  assert(initialHealth.config.mcp.allowWrites === false, "Fresh API did not start with mcp.allowWrites=false.");

  const created = await fetchJson<{ collection: { slug: string } }>("/api/collections", {
    method: "POST",
    body: JSON.stringify({ name: "MCP Write Smoke", slug: collectionSlug }),
  });
  assert(created.collection.slug === collectionSlug, "Collection was not created with expected slug.");

  readOnlyClient = await connectMcpClient("vector-forge-mcp-write-smoke-readonly");
  await expectToolRejected(
    "vf_upsert_text with allowWrites=false",
    () => readOnlyClient!.callTool({
      name: "vf_upsert_text",
      arguments: {
        collection: collectionSlug,
        name: "blocked.txt",
        text: "This MCP write should remain blocked while allowWrites is false.",
      },
    }),
    "MCP write tools are disabled",
  );
  await readOnlyClient.close();
  readOnlyClient = undefined;

  const config = await fetchJson<ConfigResponse>("/api/config", {
    method: "PUT",
    body: JSON.stringify({ mcp: { allowWrites: true } }),
  });
  assert(config.mcp.allowWrites === true, "Config response did not enable MCP writes.");
  const enabledHealth = await fetchJson<HealthResponse>("/api/health");
  assert(enabledHealth.config.mcp.allowWrites === true, "Health did not report mcp.allowWrites=true.");

  writeClient = await connectMcpClient("vector-forge-mcp-write-smoke");
  const sentinel = `MCP_WRITE_SMOKE_SENTINEL_${Date.now()}`;
  const upsert = parseToolJson<UpsertResponse>("vf_upsert_text", await writeClient.callTool({
    name: "vf_upsert_text",
    arguments: {
      collection: collectionSlug,
      name: "mcp-write-smoke.txt",
      text: `Vector Forge MCP write smoke document. ${sentinel} should be searchable until the document is deleted.`,
      metadata: { smoke: true, sentinel },
    },
  }));
  assert(upsert.chunks >= 1, "vf_upsert_text did not create chunks.");
  assert(upsert.document.id, "vf_upsert_text did not return a document id.");

  const search = parseToolJson<SearchResponse>("vf_search", await writeClient.callTool({
    name: "vf_search",
    arguments: { collection: collectionSlug, query: sentinel, topK: 5 },
  }));
  assert(search.results.some((result) => result.documentId === upsert.document.id), "vf_search did not return the upserted document.");

  const detail = parseToolJson<DocumentDetailResponse>("vf_get_document", await writeClient.callTool({
    name: "vf_get_document",
    arguments: { collection: collectionSlug, documentId: upsert.document.id },
  }));
  assert(detail.document.id === upsert.document.id, "vf_get_document returned the wrong document.");
  assert(detail.chunks.length >= 1, "vf_get_document returned no chunks.");

  parseToolJson("vf_delete_document", await writeClient.callTool({
    name: "vf_delete_document",
    arguments: { collection: collectionSlug, documentId: upsert.document.id },
  }));

  const afterDeleteSearch = parseToolJson<SearchResponse>("vf_search after delete", await writeClient.callTool({
    name: "vf_search",
    arguments: { collection: collectionSlug, query: sentinel, topK: 5 },
  }));
  assert(
    !afterDeleteSearch.results.some((result) => result.documentId === upsert.document.id || result.text.includes(sentinel)),
    "Deleted document still appeared in search results.",
  );

  console.log(JSON.stringify({
    ok: true,
    tempDir,
    apiPort: port,
    collection: collectionSlug,
    allowWritesFalseRejected: true,
    upsertedDocumentId: upsert.document.id,
    searchHitsBeforeDelete: search.results.length,
    searchHitsAfterDelete: afterDeleteSearch.results.length,
  }, null, 2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  throw new Error(`${message}\nAPI stdout:\n${apiStdout.join("")}\nAPI stderr:\n${apiStderr.join("")}`, { cause: error });
} finally {
  await readOnlyClient?.close().catch(() => undefined);
  await writeClient?.close().catch(() => undefined);
  if (apiProcess.exitCode === null) {
    apiProcess.kill();
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  await rm(tempDir, { recursive: true, force: true });
}
