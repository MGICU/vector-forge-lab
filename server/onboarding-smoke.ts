import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const rootDir = process.cwd();
const tempDir = await mkdtemp(path.join(os.tmpdir(), "vector-forge-onboarding-smoke-"));
const port = 61992;
const tsxCli = path.join(rootDir, "node_modules", "tsx", "dist", "cli.mjs");

type OnboardingPayload = {
  onboarding: {
    completed: boolean;
    dismissed: boolean;
    currentStep: string;
    steps: Record<string, { status: string; lastError?: string }>;
    lastResults?: Record<string, unknown>;
  };
  readiness: {
    dataDir: string;
    lanceDir: string;
    lanceDbReady: boolean;
    tableCount: number;
    hasCollection: boolean;
    collectionCount: number;
    activeCollectionSlug: string;
    defaultEmbedding: {
      provider: string;
      model: string;
      dimension: number;
      batchSize: number;
    };
    defaultOcr: {
      mode: string;
      language: string;
      minConfidence: number;
    };
    anythingllmConfigured: boolean;
    anythingllmEnabled: boolean;
    cloudOcrEnabled: boolean;
  };
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
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
  for (let i = 0; i < 50; i += 1) {
    try {
      return await fetchJson<{ ok: boolean }>("/api/health");
    } catch {
      await delay(300);
    }
  }
  throw new Error("API did not become ready.");
}

function startServer() {
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
  return { server, stderr };
}

async function stopServer(server: ChildProcess) {
  if (server.exitCode !== null || server.killed) return;
  server.kill();
  await Promise.race([
    new Promise((resolve) => server.once("exit", resolve)),
    delay(5000).then(() => {
      if (server.exitCode === null && !server.killed) server.kill("SIGKILL");
    }),
  ]);
}

await mkdir(tempDir, { recursive: true });
let current = startServer();

try {
  await waitForApi();

  const initial = await fetchJson<OnboardingPayload>("/api/onboarding");
  assert(initial.onboarding.completed === false, "Initial onboarding should not be completed.");
  assert(initial.onboarding.dismissed === false, "Initial onboarding should not be dismissed.");
  assert(initial.onboarding.currentStep === "data", "Initial onboarding currentStep should be data.");
  assert(initial.readiness.dataDir === tempDir, "Readiness did not report the temporary data directory.");
  assert(initial.readiness.lanceDbReady === true, "Readiness did not report LanceDB as ready.");
  assert(initial.readiness.defaultEmbedding.provider === "local-hash", "Readiness did not report default embedding provider.");

  const configured = await fetchJson("/api/config", {
    method: "PUT",
    body: JSON.stringify({
      embedding: {
        provider: "openai-compatible",
        model: "smoke-secret-model",
        dimension: 1536,
        baseUrl: "https://api.example.test/v1/embeddings",
        apiKey: "embedding-secret-should-not-leak",
        batchSize: 7,
      },
      parsers: {
        ocr: {
          mode: "cloud",
          allowCloudOcr: true,
          cloudBaseUrl: "https://api.example.test/v1",
          cloudApiKey: "ocr-secret-should-not-leak",
          cloudModel: "vision-smoke",
        },
      },
      anythingllm: {
        enabled: true,
        baseUrl: "http://127.0.0.1:3001/api",
        apiKey: "anything-secret-should-not-leak",
        workspaceName: "Smoke Workspace",
        workspaceSlug: "smoke-workspace",
      },
    }),
  });
  assert(configured, "Config update failed.");

  const created = await fetchJson<{ collection: { slug: string } }>("/api/collections", {
    method: "POST",
    body: JSON.stringify({ name: "Onboarding Smoke", slug: "onboarding-smoke" }),
  });
  assert(created.collection.slug === "onboarding-smoke", "Onboarding smoke collection was not created.");

  const patched = await fetchJson<OnboardingPayload>("/api/onboarding", {
    method: "PATCH",
    body: JSON.stringify({
      currentStep: "embedding",
      steps: {
        data: { status: "complete" },
        collection: { status: "complete" },
        embedding: { status: "failed", lastError: "expected smoke failure" },
      },
      lastResults: {
        embedding: {
          ok: false,
          apiKey: "embedding-secret-should-not-leak",
          token: "token-should-not-leak",
          nested: { authorization: "bearer should-not-leak", model: "smoke" },
        },
      },
    }),
  });
  const patchedJson = JSON.stringify(patched);
  assert(patched.onboarding.currentStep === "embedding", "PATCH did not update currentStep.");
  assert(patched.onboarding.steps.data.status === "complete", "PATCH did not complete data step.");
  assert(patched.onboarding.steps.collection.status === "complete", "PATCH did not complete collection step.");
  assert(patched.onboarding.steps.embedding.status === "failed", "PATCH did not update embedding step status.");
  assert(patched.readiness.hasCollection === true, "Readiness did not detect created collection.");
  assert(patched.readiness.collectionCount === 1, "Readiness did not report collection count.");
  assert(patched.readiness.defaultEmbedding.model === "smoke-secret-model", "Readiness did not reflect updated embedding model.");
  assert(patched.readiness.defaultEmbedding.batchSize === 7, "Readiness did not reflect updated batch size.");
  assert(patched.readiness.anythingllmConfigured === true, "Readiness did not detect AnythingLLM configuration.");
  assert(patched.readiness.cloudOcrEnabled === true, "Readiness did not detect cloud OCR configuration.");
  assert(!patchedJson.includes("embedding-secret-should-not-leak"), "Onboarding response leaked embedding API key.");
  assert(!patchedJson.includes("ocr-secret-should-not-leak"), "Onboarding response leaked OCR API key.");
  assert(!patchedJson.includes("anything-secret-should-not-leak"), "Onboarding response leaked AnythingLLM API key.");
  assert(!patchedJson.includes("token-should-not-leak"), "Onboarding response leaked token.");
  assert(!patchedJson.includes("bearer should-not-leak"), "Onboarding response leaked authorization value.");

  await stopServer(current.server);
  current = startServer();
  await waitForApi();

  const persisted = await fetchJson<OnboardingPayload>("/api/onboarding");
  assert(persisted.onboarding.currentStep === "embedding", "Onboarding currentStep was not persisted across restart.");
  assert(persisted.onboarding.steps.embedding.status === "failed", "Onboarding step status was not persisted across restart.");
  assert(persisted.readiness.hasCollection === true, "Readiness collection state was not persisted across restart.");

  const completed = await fetchJson<OnboardingPayload>("/api/onboarding/complete", { method: "POST", body: "{}" });
  assert(completed.onboarding.completed === true, "Complete endpoint did not mark onboarding completed.");
  assert(completed.onboarding.dismissed === true, "Complete endpoint did not dismiss onboarding.");
  assert(completed.onboarding.currentStep === "finish", "Complete endpoint did not move to finish step.");

  const reset = await fetchJson<OnboardingPayload>("/api/onboarding/reset", { method: "POST", body: "{}" });
  assert(reset.onboarding.completed === false, "Reset endpoint did not clear completed.");
  assert(reset.onboarding.dismissed === false, "Reset endpoint did not clear dismissed.");
  assert(reset.onboarding.currentStep === "data", "Reset endpoint did not return to data step.");
  assert(reset.onboarding.steps.embedding.status === "pending", "Reset endpoint did not clear step statuses.");

  console.log(JSON.stringify({
    ok: true,
    onboarding: {
      persistedStep: persisted.onboarding.currentStep,
      collectionCount: reset.readiness.collectionCount,
      defaultEmbedding: reset.readiness.defaultEmbedding,
      anythingllmConfigured: reset.readiness.anythingllmConfigured,
      cloudOcrEnabled: reset.readiness.cloudOcrEnabled,
    },
  }, null, 2));
} finally {
  await stopServer(current.server);
  await rm(tempDir, { recursive: true, force: true });
}
