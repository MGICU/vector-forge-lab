import { spawn, type ChildProcess } from "node:child_process";
import { appendFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const rootDir = process.cwd();
const tempDir = await mkdtemp(path.join(os.tmpdir(), "vector-forge-persistence-smoke-"));
const port = 62031;
const tsxCli = path.join(rootDir, "node_modules", "tsx", "dist", "cli.mjs");

type CollectionResponse = {
  collection: { slug: string };
};

type CollectionsResponse = {
  collections: Array<{ slug: string; documentCount: number; chunkCount: number }>;
  activeCollectionSlug: string;
};

type ConfigResponse = {
  embedding: { model: string; dimension: number };
};

type CollectionConfigResponse = {
  collection: { slug: string };
  config: {
    embedding: { model: string; dimension: number; batchSize: number };
    chunking: { targetChars: number; overlapChars: number };
    anythingllm: { enabled: boolean; baseUrl: string; workspaceSlug: string };
    mcp: { allowWrites: boolean };
  };
};

type OnboardingPayload = {
  onboarding: {
    currentStep: string;
    steps: Record<string, { status: string; lastError?: string }>;
  };
};

type DocumentsResponse = {
  documents: Array<{ id: string; name: string; chunkCount: number }>;
};

type SmokeManifest = {
  collections?: Array<{ slug?: string; documentCount?: number; chunkCount?: number }>;
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
  for (let i = 0; i < 60; i += 1) {
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

async function assertFile(pathToCheck: string, label: string) {
  await stat(pathToCheck).catch((error) => {
    throw Object.assign(new Error(`${label} was not created: ${error instanceof Error ? error.message : String(error)}`), { cause: error });
  });
}

async function assertValidJson(pathToCheck: string, label: string) {
  try {
    JSON.parse(await readFile(pathToCheck, "utf8"));
  } catch (error) {
    throw Object.assign(new Error(`${label} was not repaired to valid JSON: ${error instanceof Error ? error.message : String(error)}`), { cause: error });
  }
}

async function corruptJson(pathToCorrupt: string) {
  await writeFile(pathToCorrupt, "{ broken json\n", "utf8");
}

const configPath = path.join(tempDir, "config.json");
const manifestPath = path.join(tempDir, "manifest.json");
const onboardingPath = path.join(tempDir, "onboarding.json");
const documentsPath = path.join(tempDir, "smoke.documents.json");
const aiToolAuditPath = path.join(tempDir, "ai-tool-audit.jsonl");
const persistedPaths = [
  { path: configPath, label: "config.json" },
  { path: manifestPath, label: "manifest.json" },
  { path: onboardingPath, label: "onboarding.json" },
  { path: documentsPath, label: "smoke.documents.json" },
];

await mkdir(tempDir, { recursive: true });
let current = startServer();

try {
  await waitForApi();

  const config = await fetchJson<ConfigResponse>("/api/config", {
    method: "PUT",
    body: JSON.stringify({
      embedding: {
        provider: "local-hash",
        model: "persistence-smoke-model",
        dimension: 384,
        batchSize: 5,
      },
    }),
  });
  assert(config.embedding.model === "persistence-smoke-model", "Config write did not persist the smoke embedding model.");

  const onboarding = await fetchJson<OnboardingPayload>("/api/onboarding", {
    method: "PATCH",
    body: JSON.stringify({
      currentStep: "ocr",
      steps: {
        data: { status: "complete" },
        collection: { status: "complete" },
        ocr: { status: "failed", lastError: "persistence smoke marker" },
      },
    }),
  });
  assert(onboarding.onboarding.currentStep === "ocr", "Onboarding patch did not persist the current step.");

  const created = await fetchJson<CollectionResponse>("/api/collections", {
    method: "POST",
    body: JSON.stringify({ name: "Persistence Smoke", slug: "smoke" }),
  });
  assert(created.collection.slug === "smoke", "Collection was not created with the expected slug.");

  const indexed = await fetchJson<{ document: { id: string }; chunks: number }>("/api/collections/smoke/text", {
    method: "POST",
    body: JSON.stringify({
      name: "persistence-note.txt",
      text: "Persistence smoke document. This verifies JSON backup recovery for document manifests and collection metadata.",
    }),
  });
  assert(indexed.document.id && indexed.chunks >= 1, "Smoke document was not indexed.");

  const collectionA = await fetchJson<CollectionResponse>("/api/collections", {
    method: "POST",
    body: JSON.stringify({ name: "Persistence Config A", slug: "config-a" }),
  });
  const collectionB = await fetchJson<CollectionResponse>("/api/collections", {
    method: "POST",
    body: JSON.stringify({ name: "Persistence Config B", slug: "config-b" }),
  });
  assert(collectionA.collection.slug === "config-a", "Config A collection was not created with the expected slug.");
  assert(collectionB.collection.slug === "config-b", "Config B collection was not created with the expected slug.");

  await fetchJson<CollectionConfigResponse>("/api/collections/config-a/config", {
    method: "PUT",
    body: JSON.stringify({
      embedding: { model: "collection-a-model", dimension: 256, batchSize: 3 },
      chunking: { targetChars: 360, overlapChars: 12 },
      anythingllm: {
        enabled: true,
        baseUrl: "http://127.0.0.1:63101/api",
        workspaceName: "Config A Workspace",
        workspaceSlug: "config-a-workspace",
      },
      mcp: { allowWrites: true },
    }),
  });
  await fetchJson<CollectionConfigResponse>("/api/collections/config-b/config", {
    method: "PUT",
    body: JSON.stringify({
      embedding: { model: "collection-b-model", dimension: 768, batchSize: 9 },
      chunking: { targetChars: 620, overlapChars: 24 },
      anythingllm: {
        enabled: true,
        baseUrl: "http://127.0.0.1:63102/api",
        workspaceName: "Config B Workspace",
        workspaceSlug: "config-b-workspace",
      },
      mcp: { allowWrites: false },
    }),
  });

  const configA = await fetchJson<CollectionConfigResponse>("/api/collections/config-a/config");
  const configB = await fetchJson<CollectionConfigResponse>("/api/collections/config-b/config");
  assert(configA.config.embedding.model !== configB.config.embedding.model, "Collection A/B embedding models polluted each other.");
  assert(configA.config.chunking.targetChars !== configB.config.chunking.targetChars, "Collection A/B chunking config polluted each other.");
  assert(configA.config.embedding.model === "collection-a-model", "Collection A config did not persist its embedding model.");
  assert(configA.config.embedding.dimension === 256, "Collection A config did not persist its embedding dimension.");
  assert(configA.config.embedding.batchSize === 3, "Collection A config did not persist its embedding batch size.");
  assert(configA.config.chunking.targetChars === 360, "Collection A config did not persist targetChars.");
  assert(configA.config.chunking.overlapChars === 12, "Collection A config did not persist overlapChars.");
  assert(configA.config.anythingllm.baseUrl === "http://127.0.0.1:63101/api", "Collection A config did not persist its AnythingLLM base URL.");
  assert(configA.config.anythingllm.workspaceSlug === "config-a-workspace", "Collection A config did not persist its AnythingLLM workspace slug.");
  assert(configA.config.mcp.allowWrites === true, "Collection A config did not persist MCP write access.");
  assert(configB.config.embedding.model === "collection-b-model", "Collection B config did not persist its embedding model.");
  assert(configB.config.embedding.dimension === 768, "Collection B config did not persist its embedding dimension.");
  assert(configB.config.embedding.batchSize === 9, "Collection B config did not persist its embedding batch size.");
  assert(configB.config.chunking.targetChars === 620, "Collection B config did not persist targetChars.");
  assert(configB.config.chunking.overlapChars === 24, "Collection B config did not persist overlapChars.");
  assert(configB.config.anythingllm.baseUrl === "http://127.0.0.1:63102/api", "Collection B config did not persist its AnythingLLM base URL.");
  assert(configB.config.anythingllm.workspaceSlug === "config-b-workspace", "Collection B config did not persist its AnythingLLM workspace slug.");
  assert(configB.config.mcp.allowWrites === false, "Collection B config did not persist MCP write access.");
  const defaultAfterCollectionConfig = await fetchJson<ConfigResponse>("/api/config");
  assert(defaultAfterCollectionConfig.embedding.model === "persistence-smoke-model", "Collection config write polluted the default config.");

  await fetchJson<{ id: string }>("/api/ai/tools/dry-run", {
    method: "POST",
    body: JSON.stringify({
      prompt: "Search the persistence smoke collection",
      requestedToolId: "local.search",
    }),
  });
  await assertFile(aiToolAuditPath, "ai-tool-audit.jsonl");

  for (const item of persistedPaths) {
    await assertFile(item.path, item.label);
    await assertFile(`${item.path}.bak`, `${item.label}.bak`);
    await assertValidJson(item.path, item.label);
    await assertValidJson(`${item.path}.bak`, `${item.label}.bak`);
  }

  await stopServer(current.server);

  for (const item of persistedPaths) {
    await corruptJson(item.path);
  }
  await appendFile(aiToolAuditPath, "{\"partial\"\n", "utf8");

  current = startServer();
  await waitForApi();

  const recoveredConfig = await fetchJson<ConfigResponse>("/api/config");
  assert(recoveredConfig.embedding.model === "persistence-smoke-model", "Config did not recover from backup.");

  const recoveredCollections = await fetchJson<CollectionsResponse>("/api/collections");
  assert(recoveredCollections.activeCollectionSlug === "smoke", "Manifest active collection did not recover from backup.");
  const recoveredCollection = recoveredCollections.collections.find((collection) => collection.slug === "smoke");
  assert(recoveredCollection, "Recovered manifest did not include the smoke collection.");
  assert(recoveredCollection.documentCount === 1, "Recovered collection document count is incorrect.");
  assert(recoveredCollections.collections.some((collection) => collection.slug === "config-a"), "Recovered manifest did not include collection A.");
  assert(recoveredCollections.collections.some((collection) => collection.slug === "config-b"), "Recovered manifest did not include collection B.");

  const recoveredConfigA = await fetchJson<CollectionConfigResponse>("/api/collections/config-a/config");
  const recoveredConfigB = await fetchJson<CollectionConfigResponse>("/api/collections/config-b/config");
  assert(recoveredConfigA.config.embedding.model === "collection-a-model", "Collection A config did not recover from persisted manifest.");
  assert(recoveredConfigA.config.chunking.targetChars === 360, "Collection A chunking config did not recover from persisted manifest.");
  assert(recoveredConfigA.config.anythingllm.workspaceSlug === "config-a-workspace", "Collection A AnythingLLM config did not recover from persisted manifest.");
  assert(recoveredConfigB.config.embedding.model === "collection-b-model", "Collection B config did not recover from persisted manifest.");
  assert(recoveredConfigB.config.chunking.targetChars === 620, "Collection B chunking config did not recover from persisted manifest.");
  assert(recoveredConfigB.config.anythingllm.workspaceSlug === "config-b-workspace", "Collection B AnythingLLM config did not recover from persisted manifest.");

  const recoveredOnboarding = await fetchJson<OnboardingPayload>("/api/onboarding");
  assert(recoveredOnboarding.onboarding.currentStep === "ocr", "Onboarding state did not recover from backup.");
  assert(recoveredOnboarding.onboarding.steps.ocr.status === "failed", "Onboarding step status did not recover from backup.");

  const recoveredDocuments = await fetchJson<DocumentsResponse>("/api/collections/smoke/documents");
  assert(recoveredDocuments.documents.length === 1, "Documents file did not recover from backup.");
  assert(recoveredDocuments.documents[0]?.name === "persistence-note.txt", "Recovered document name is incorrect.");
  assert(recoveredDocuments.documents[0]?.chunkCount === indexed.chunks, "Recovered document chunk count is incorrect.");

  const recoveredAudit = await fetchJson<{ events: unknown[] }>("/api/ai/tools/audit?limit=20");
  assert(recoveredAudit.events.length === 1, "AI tool audit did not ignore the malformed JSONL line.");

  for (const item of persistedPaths) {
    await assertValidJson(item.path, item.label);
    await assertValidJson(`${item.path}.bak`, `${item.label}.bak`);
  }

  const manifestWithBadCounts = JSON.parse(await readFile(manifestPath, "utf8")) as SmokeManifest;
  const smokeCollection = manifestWithBadCounts.collections?.find((collection) => collection.slug === "smoke");
  assert(smokeCollection, "Recovered manifest lost the smoke collection before count reconciliation.");
  smokeCollection.documentCount = 999;
  smokeCollection.chunkCount = 999;
  await writeFile(manifestPath, `${JSON.stringify(manifestWithBadCounts, null, 2)}\n`, "utf8");

  const reconciledCollections = await fetchJson<CollectionsResponse>("/api/collections");
  const reconciledCollection = reconciledCollections.collections.find((collection) => collection.slug === "smoke");
  assert(reconciledCollection?.documentCount === 1, "Manifest document count was not reconciled from documents.");
  assert(reconciledCollection.chunkCount === indexed.chunks, "Manifest chunk count was not reconciled from documents.");
  await assertValidJson(manifestPath, "manifest.json after count reconciliation");

  console.log(JSON.stringify({
    ok: true,
    tempDir,
    recovered: {
      configModel: recoveredConfig.embedding.model,
      activeCollectionSlug: recoveredCollections.activeCollectionSlug,
      documentCount: recoveredDocuments.documents.length,
      onboardingStep: recoveredOnboarding.onboarding.currentStep,
      auditEvents: recoveredAudit.events.length,
      reconciledChunkCount: reconciledCollection.chunkCount,
      collectionConfigs: {
        a: recoveredConfigA.config.embedding.model,
        b: recoveredConfigB.config.embedding.model,
      },
    },
  }, null, 2));
} finally {
  await stopServer(current.server);
  await rm(tempDir, { recursive: true, force: true });
}
