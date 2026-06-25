import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const rootDir = process.cwd();
const tempDir = await mkdtemp(path.join(os.tmpdir(), "vector-forge-security-smoke-"));
const port = 61987;
const tsxCli = path.join(rootDir, "node_modules", "tsx", "dist", "cli.mjs");

const embeddingSecret = "security-embedding-secret-should-not-leak";
const anythingSecret = "security-anything-secret-should-not-leak";
const cloudOcrSecret = "security-cloud-ocr-secret-should-not-leak";

type HealthResponse = {
  config: {
    embedding: { apiKey: string };
    anythingllm: { apiKey: string; enabled: boolean };
    mcp: { allowWrites: boolean };
    parsers: { ocr: { allowCloudOcr: boolean; cloudApiKey: string } };
  };
};

type ConfigResponse = {
  embedding: { apiKey: string };
  anythingllm: { apiKey: string; enabled: boolean };
  mcp: { allowWrites: boolean };
  parsers: { ocr: { allowCloudOcr: boolean; cloudApiKey: string } };
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function fetchRaw(route: string, init?: RequestInit) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  return { response, text: await response.text() };
}

async function fetchJson<T>(route: string, init?: RequestInit) {
  const { response, text } = await fetchRaw(route, init);
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

  const localCors = await fetchRaw("/api/health", {
    headers: { Origin: "http://localhost:5184" },
  });
  assert(localCors.response.ok, `Localhost CORS health request failed: ${localCors.response.status}`);
  assert(
    localCors.response.headers.get("access-control-allow-origin") === "http://localhost:5184",
    "Localhost CORS origin was not reflected.",
  );

  const rejectedCors = await fetchRaw("/api/health", {
    headers: { Origin: "https://example.com" },
  });
  assert(rejectedCors.response.status >= 400, "Non-loopback CORS origin was accepted.");
  assert(!rejectedCors.response.headers.has("access-control-allow-origin"), "Rejected CORS origin still received an allow-origin header.");

  const updatedConfig = await fetchJson<ConfigResponse>("/api/config", {
    method: "PUT",
    body: JSON.stringify({
      embedding: {
        provider: "local-hash",
        model: "security-smoke-local",
        dimension: 384,
        apiKey: embeddingSecret,
      },
      anythingllm: {
        enabled: "true",
        baseUrl: "http://127.0.0.1:1/api",
        apiKey: anythingSecret,
        workspaceName: "Security Smoke",
        workspaceSlug: "security-smoke",
      },
      mcp: {
        allowWrites: "true",
      },
      parsers: {
        ocr: {
          allowCloudOcr: "true",
          cloudApiKey: cloudOcrSecret,
        },
      },
    }),
  });
  assert(updatedConfig.anythingllm.enabled === false, "String true enabled AnythingLLM unexpectedly.");
  assert(updatedConfig.mcp.allowWrites === false, "String true enabled MCP writes unexpectedly.");
  assert(updatedConfig.parsers.ocr.allowCloudOcr === false, "String true enabled cloud OCR unexpectedly.");

  const health = await fetchJson<HealthResponse>("/api/health");
  const healthJson = JSON.stringify(health);
  assert(health.config.embedding.apiKey === "[configured]", "Health endpoint did not redact embedding API key.");
  assert(health.config.anythingllm.apiKey === "[configured]", "Health endpoint did not redact AnythingLLM API key.");
  assert(health.config.parsers.ocr.cloudApiKey === "[configured]", "Health endpoint did not redact cloud OCR API key.");
  assert(!healthJson.includes(embeddingSecret), "Health response leaked raw embedding API key.");
  assert(!healthJson.includes(anythingSecret), "Health response leaked raw AnythingLLM API key.");
  assert(!healthJson.includes(cloudOcrSecret), "Health response leaked raw cloud OCR API key.");
  assert(health.config.anythingllm.enabled === false, "Health reported AnythingLLM enabled after string input.");
  assert(health.config.mcp.allowWrites === false, "Health reported MCP writes enabled after string input.");
  assert(health.config.parsers.ocr.allowCloudOcr === false, "Health reported cloud OCR enabled after string input.");

  const created = await fetchJson<{ collection: { slug: string } }>("/api/collections", {
    method: "POST",
    body: JSON.stringify({ name: "Security Smoke Collection", slug: "security-smoke" }),
  });
  assert(created.collection.slug === "security-smoke", "Security smoke collection was not created with expected slug.");

  const syncResponse = await fetchRaw("/api/collections/security-smoke/sync-anythingllm", {
    method: "POST",
    body: JSON.stringify({ maxChunks: 1 }),
  });
  assert(syncResponse.response.status === 400, `Disabled AnythingLLM sync returned ${syncResponse.response.status}.`);
  assert(syncResponse.text.includes("AnythingLLM sync is disabled"), "Disabled AnythingLLM sync did not return the expected boundary error.");

  console.log(
    JSON.stringify(
      {
        ok: true,
        tempDir,
        cors: { localhostAllowed: true, nonLoopbackRejected: true },
        redaction: { embedding: true, anythingllm: true, cloudOcr: true },
        strictBooleans: { anythingllm: true, mcpWrites: true, cloudOcr: true },
        disabledAnythingSync: true,
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
