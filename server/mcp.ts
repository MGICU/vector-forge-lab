import { readFile } from "node:fs/promises";
import type { Server as HttpServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult, ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";

import { startServer } from "./index.js";

type JsonValue = null | string | number | boolean | JsonValue[] | { [key: string]: JsonValue };
type EmbeddingStatus = {
  provider: string;
  model: string;
  dimension: number;
};
type PublicHealthResponse = {
  ok: boolean;
  appVersion: string;
  dataDir: string;
  lanceDir: string;
  tableNames: string[];
  config: {
    embedding: EmbeddingStatus & {
      baseUrl: string;
      apiKey: string;
      batchSize: number;
    };
    chunking: {
      targetChars: number;
      overlapChars: number;
    };
    parsers: {
      duplicateStrategy: string;
      maxFileSizeMb: number;
      pdf: {
        maxPages: number;
        textFirst: boolean;
        ocrTextThreshold: number;
        renderScale: number;
        keepPageNumbers: boolean;
      };
      docx: {
        includeHeadings: boolean;
        includeTables: boolean;
      };
      ocr: {
        mode: string;
        language: string;
        minConfidence: number;
        timeoutMs: number;
        tesseractLangPath: string;
        paddleCommand: string;
        paddleArgs: string;
        allowCloudOcr: boolean;
        cloudBaseUrl: string;
        cloudApiKey: string;
        cloudModel: string;
      };
    };
    anythingllm: {
      enabled: boolean;
      baseUrl: string;
      apiKey: string;
      workspaceName: string;
      workspaceSlug: string;
    };
    mcp: {
      allowWrites: boolean;
    };
  };
};
type CollectionSummary = {
  id: string;
  name: string;
  slug: string;
  description: string;
  tableName: string;
  dimension: number;
  metric: string;
  embeddingProvider: string;
  embeddingModel: string;
  createdAt: string;
  updatedAt: string;
  documentCount: number;
  chunkCount: number;
};
type CollectionsResponse = {
  collections: CollectionSummary[];
  activeCollectionSlug: string;
};
type CollectionConfigResponse = {
  collection: CollectionSummary;
  configStatus: {
    usesDefaultSnapshot: boolean;
    isCustomized: boolean;
    embeddingChangedRequiresRebuild: boolean;
    embeddingMatchesIndex: boolean;
    canUpdateEmbeddingIndex: boolean;
    chunkCount: number;
    indexedEmbedding: EmbeddingStatus;
    configEmbedding: EmbeddingStatus;
  };
};
type AnythingSyncState = {
  updatedAt?: string;
  chunks?: Array<{
    location?: string;
    chunkId?: string;
    chunkIndex?: number;
    baseUrl?: string;
    workspaceSlug?: string;
    uploadedAt?: string;
    embeddedAt?: string;
  }>;
};
type DocumentSummary = {
  id: string;
  collectionSlug: string;
  name: string;
  mime: string;
  sizeBytes: number;
  chunkCount: number;
  status: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  anythingLocations?: string[];
  anythingSync?: AnythingSyncState;
  parserType?: string;
  parserVersion?: string;
  extractionStatus?: string;
  pageCount?: number;
  ocrEngine?: string;
  ocrLanguage?: string;
  ocrConfidence?: number | null;
  warnings?: string[];
  processingStartedAt?: string;
  processingFinishedAt?: string;
  jobId?: string;
  originalName?: string;
  originalSizeBytes?: number;
  extractedTextBytes?: number;
  duplicateOf?: string;
};
type DocumentsResponse = {
  documents: DocumentSummary[];
};
type ProcessingJob = {
  id: string;
  kind: string;
  collectionSlug: string;
  documentId?: string;
  fileName: string;
  status: string;
  phase: string;
  progress: number;
  message: string;
  createdAt: string;
  updatedAt: string;
  cancelRequested: boolean;
  error?: string;
};
type JobsResponse = {
  jobs: ProcessingJob[];
};
type CollectionDocuments = {
  collection: CollectionSummary;
  documents: DocumentSummary[];
};
type DocumentEntry = {
  collection: CollectionSummary;
  document: DocumentSummary;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const inferredRootDir =
  path.basename(path.resolve(__dirname, "..")) === "dist-server" ? path.resolve(__dirname, "..", "..") : path.resolve(__dirname, "..");
const rootDir = process.env.KNOWLEDGE_FORGE_ROOT_DIR ? path.resolve(process.env.KNOWLEDGE_FORGE_ROOT_DIR) : inferredRootDir;
let apiBaseUrl = normalizeBaseUrl(process.env.KNOWLEDGE_FORGE_API_URL || "http://127.0.0.1:5183");
let ownedApiServer: HttpServer | null = null;
let ensureApiPromise: Promise<string> | null = null;
const localActionToken = process.env.KNOWLEDGE_FORGE_LOCAL_ACTION_TOKEN?.trim() || "";

function normalizeBaseUrl(input: string) {
  return input.replace(/\/+$/, "");
}

async function readAppVersion() {
  const packageJson = JSON.parse(await readFile(path.join(rootDir, "package.json"), "utf8")) as { version?: string };
  return packageJson.version || "0.0.0";
}

async function fetchWithTimeout(input: string, init: RequestInit = {}, timeoutMs = 20_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function apiAvailable(baseUrl: string) {
  try {
    const response = await fetchWithTimeout(`${baseUrl}/api/health`, {}, 2_000);
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureApiBaseUrl() {
  if (ensureApiPromise) return ensureApiPromise;
  ensureApiPromise = (async () => {
    if (await apiAvailable(apiBaseUrl)) return apiBaseUrl;
    if (process.env.KNOWLEDGE_FORGE_MCP_AUTOSTART === "false") {
      throw new Error(`Knowledge Forge API is not reachable at ${apiBaseUrl}.`);
    }
    const requestedPort = Number(process.env.KNOWLEDGE_FORGE_MCP_PORT ?? 0);
    ownedApiServer = await startServer(Number.isFinite(requestedPort) ? requestedPort : 0, { silent: true });
    const address = ownedApiServer.address();
    if (!address || typeof address === "string") throw new Error("Unable to determine auto-started API port.");
    apiBaseUrl = `http://127.0.0.1:${address.port}`;
    if (!(await apiAvailable(apiBaseUrl))) throw new Error(`Auto-started API did not become healthy at ${apiBaseUrl}.`);
    console.error(`[knowledge-forge-mcp] Auto-started API at ${apiBaseUrl}`);
    return apiBaseUrl;
  })();
  try {
    return await ensureApiPromise;
  } catch (error) {
    ensureApiPromise = null;
    throw error;
  }
}

async function api<T>(route: string, init: RequestInit = {}) {
  const baseUrl = await ensureApiBaseUrl();
  const response = await fetchWithTimeout(`${baseUrl}${route}`, withLocalActionToken(init), 120_000);
  const text = await response.text();
  if (!response.ok) throw new Error(`Knowledge Forge API ${response.status} ${route}: ${text || response.statusText}`);
  if (!text.trim()) return {} as T;
  return JSON.parse(text) as T;
}

function withLocalActionToken(init: RequestInit) {
  const method = (init.method ?? "GET").toUpperCase();
  if (!localActionToken || ["GET", "HEAD", "OPTIONS"].includes(method)) return init;
  const headers = new Headers(init.headers);
  headers.set("X-knowledge-forge-Local-Action-Token", localActionToken);
  return { ...init, headers };
}

function jsonInit(method: "POST" | "PUT" | "DELETE", body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function jsonText(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSensitiveKey(key: string) {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (normalized.endsWith("configured")) return false;
  return normalized === "authorization"
    || normalized === "cookie"
    || normalized.includes("apikey")
    || normalized.includes("token")
    || normalized.includes("secret")
    || normalized.includes("password");
}

function redactString(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/((?:api[_-]?key|token|secret|password)\s*[:=]\s*)[^\s"',;]+/gi, "$1[redacted]");
}

function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item));
  if (!isRecord(value)) return typeof value === "string" ? redactString(value) : value;
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = isSensitiveKey(key) ? (entry ? "[redacted]" : "") : redactSecrets(entry);
  }
  return output;
}

function resourceJson(uri: string, value: unknown): ReadResourceResult {
  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: jsonText(redactSecrets(value)),
      },
    ],
  };
}

function toolResult(value: unknown): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: jsonText(value),
      },
    ],
  };
}

function variable(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value || "";
}

function configured(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function roundMetric(value: number) {
  return Math.round(value * 100) / 100;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function countValues(values: Array<string | undefined | null>) {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const key = value?.trim() || "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function sumValues(values: number[]) {
  return values.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
}

function average(values: number[]) {
  return values.length ? roundMetric(sumValues(values) / values.length) : null;
}

function lowest(values: number[]) {
  return values.length ? roundMetric(Math.min(...values)) : null;
}

function nonEmptyStrings(values: Array<string | undefined | null>) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function latestIso(values: Array<string | undefined | null>) {
  return nonEmptyStrings(values).sort().at(-1) ?? null;
}

function compactText(value: string | undefined, maxLength = 360) {
  if (!value) return undefined;
  const compact = redactString(value).replace(/\s+/g, " ").trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength)}...` : compact;
}

function isOcrDocument(document: DocumentSummary) {
  const parserType = document.parserType || "";
  return parserType.includes("ocr")
    || Boolean(document.ocrEngine)
    || Boolean(document.ocrLanguage)
    || isFiniteNumber(document.ocrConfidence);
}

function documentWarnings(document: DocumentSummary) {
  return Array.isArray(document.warnings) ? document.warnings.filter((warning) => warning.trim()) : [];
}

function anythingStatsForDocument(document: DocumentSummary) {
  const locations = Array.isArray(document.anythingLocations) ? document.anythingLocations : [];
  const chunks = Array.isArray(document.anythingSync?.chunks) ? document.anythingSync.chunks : [];
  const chunkDates = chunks.flatMap((chunk) => [chunk.uploadedAt, chunk.embeddedAt]);
  return {
    locationCount: locations.length,
    syncedChunks: chunks.length,
    lastSyncedAt: latestIso([document.anythingSync?.updatedAt, ...chunkDates]),
    workspaceSlugs: nonEmptyStrings(chunks.map((chunk) => chunk.workspaceSlug)),
    baseUrls: nonEmptyStrings(chunks.map((chunk) => chunk.baseUrl)),
  };
}

async function readCollections() {
  return api<CollectionsResponse>("/api/collections");
}

async function readCollectionConfigs(collections: CollectionSummary[]) {
  return Promise.all(
    collections.map(async (collection) => {
      const response = await api<CollectionConfigResponse>(`/api/collections/${encodeURIComponent(collection.slug)}/config`);
      return {
        collection: response.collection,
        configStatus: response.configStatus,
      };
    }),
  );
}

async function readCollectionDocuments(collections: CollectionSummary[]): Promise<CollectionDocuments[]> {
  return Promise.all(
    collections.map(async (collection) => ({
      collection,
      documents: (await api<DocumentsResponse>(`/api/collections/${encodeURIComponent(collection.slug)}/documents`)).documents,
    })),
  );
}

async function embeddingProviderStatus() {
  const [baseUrl, health, collections] = await Promise.all([
    ensureApiBaseUrl(),
    api<PublicHealthResponse>("/api/health"),
    readCollections(),
  ]);
  const collectionConfigs = await readCollectionConfigs(collections.collections);
  const embedding = health.config.embedding;
  const collectionStatuses = collectionConfigs.map(({ collection, configStatus }) => ({
    slug: collection.slug,
    name: collection.name,
    documentCount: collection.documentCount,
    chunkCount: collection.chunkCount,
    indexedEmbedding: configStatus.indexedEmbedding,
    configuredEmbedding: configStatus.configEmbedding,
    embeddingMatchesIndex: configStatus.embeddingMatchesIndex,
    embeddingChangedRequiresRebuild: configStatus.embeddingChangedRequiresRebuild,
    usesDefaultSnapshot: configStatus.usesDefaultSnapshot,
    isCustomized: configStatus.isCustomized,
  }));
  return {
    apiBaseUrl: baseUrl,
    appVersion: health.appVersion,
    provider: embedding.provider,
    model: embedding.model,
    dimension: embedding.dimension,
    batchSize: embedding.batchSize,
    baseUrl: embedding.provider === "openai-compatible" ? embedding.baseUrl : "",
    apiKeyConfigured: configured(embedding.apiKey),
    localProvider: embedding.provider === "local-hash",
    externalCheck: "not_performed_by_read_only_resource",
    tableCount: health.tableNames.length,
    tableNames: health.tableNames,
    activeCollectionSlug: collections.activeCollectionSlug,
    summary: {
      totalCollections: collectionStatuses.length,
      customizedCollections: collectionStatuses.filter((collection) => collection.isCustomized).length,
      collectionsNeedingRebuild: collectionStatuses.filter((collection) => collection.embeddingChangedRequiresRebuild).length,
    },
    collections: collectionStatuses,
  };
}

async function recentJobsStatus() {
  const [baseUrl, response] = await Promise.all([ensureApiBaseUrl(), api<JobsResponse>("/api/jobs")]);
  const jobs = response.jobs.map((job) => ({
    id: job.id,
    kind: job.kind,
    collectionSlug: job.collectionSlug,
    documentId: job.documentId,
    fileName: job.fileName,
    status: job.status,
    phase: job.phase,
    progress: roundMetric(job.progress),
    message: compactText(job.message, 240),
    cancelRequested: job.cancelRequested,
    error: compactText(job.error, 360),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  }));
  return {
    apiBaseUrl: baseUrl,
    maxReturned: 100,
    returned: jobs.length,
    statusCounts: countValues(jobs.map((job) => job.status)),
    phaseCounts: countValues(jobs.map((job) => job.phase)),
    activeJobs: jobs.filter((job) => job.status === "queued" || job.status === "running").length,
    jobs,
  };
}

async function anythingLlmSyncStatus() {
  const [baseUrl, health, collections] = await Promise.all([
    ensureApiBaseUrl(),
    api<PublicHealthResponse>("/api/health"),
    readCollections(),
  ]);
  const collectionDocs = await readCollectionDocuments(collections.collections);
  const anythingConfig = health.config.anythingllm;
  const perCollection = collectionDocs.map(({ collection, documents }) => {
    const stats = documents.map((document) => anythingStatsForDocument(document));
    const syncedDocuments = stats.filter((stat) => stat.locationCount > 0 || stat.syncedChunks > 0);
    return {
      slug: collection.slug,
      name: collection.name,
      documentCount: documents.length,
      chunkCount: collection.chunkCount,
      documentsWithRecordedSync: syncedDocuments.length,
      unsyncedIndexedDocuments: documents.filter((document, index) =>
        document.status === "indexed"
        && document.chunkCount > 0
        && stats[index]
        && stats[index].locationCount === 0
        && stats[index].syncedChunks === 0,
      ).length,
      recordedLocations: sumValues(stats.map((stat) => stat.locationCount)),
      recordedSyncedChunks: sumValues(stats.map((stat) => stat.syncedChunks)),
      lastSyncedAt: latestIso(stats.map((stat) => stat.lastSyncedAt)),
      workspaces: nonEmptyStrings(stats.flatMap((stat) => stat.workspaceSlugs)),
    };
  });
  const allEntries = collectionDocs.flatMap(({ collection, documents }) => documents.map((document) => ({ collection, document })));
  const recentSyncedDocuments = allEntries
    .map(({ collection, document }) => ({ collection, document, stats: anythingStatsForDocument(document) }))
    .filter((entry) => entry.stats.locationCount > 0 || entry.stats.syncedChunks > 0)
    .sort((left, right) => (right.stats.lastSyncedAt || "").localeCompare(left.stats.lastSyncedAt || ""))
    .slice(0, 25)
    .map(({ collection, document, stats }) => ({
      collectionSlug: collection.slug,
      collectionName: collection.name,
      documentId: document.id,
      name: document.name,
      chunkCount: document.chunkCount,
      recordedLocations: stats.locationCount,
      recordedSyncedChunks: stats.syncedChunks,
      lastSyncedAt: stats.lastSyncedAt,
      workspaces: stats.workspaceSlugs,
      baseUrls: stats.baseUrls,
    }));
  return {
    apiBaseUrl: baseUrl,
    enabled: anythingConfig.enabled,
    readiness: !anythingConfig.enabled ? "disabled" : configured(anythingConfig.apiKey) ? "configured" : "missing_api_key",
    target: {
      baseUrl: anythingConfig.baseUrl,
      workspaceName: anythingConfig.workspaceName,
      workspaceSlug: anythingConfig.workspaceSlug,
      apiKeyConfigured: configured(anythingConfig.apiKey),
    },
    externalCheck: "not_performed_by_read_only_resource",
    totals: {
      collections: perCollection.length,
      documents: sumValues(perCollection.map((collection) => collection.documentCount)),
      chunks: sumValues(perCollection.map((collection) => collection.chunkCount)),
      documentsWithRecordedSync: sumValues(perCollection.map((collection) => collection.documentsWithRecordedSync)),
      unsyncedIndexedDocuments: sumValues(perCollection.map((collection) => collection.unsyncedIndexedDocuments)),
      recordedLocations: sumValues(perCollection.map((collection) => collection.recordedLocations)),
      recordedSyncedChunks: sumValues(perCollection.map((collection) => collection.recordedSyncedChunks)),
      lastSyncedAt: latestIso(perCollection.map((collection) => collection.lastSyncedAt)),
    },
    collections: perCollection,
    recentSyncedDocuments,
  };
}

function qualitySummary(entries: DocumentEntry[], minConfidence: number) {
  const documents = entries.map((entry) => entry.document);
  const ocrEntries = entries.filter((entry) => isOcrDocument(entry.document));
  const confidenceValues = ocrEntries
    .map((entry) => entry.document.ocrConfidence)
    .filter(isFiniteNumber);
  const lowConfidenceEntries = ocrEntries.filter((entry) =>
    isFiniteNumber(entry.document.ocrConfidence) && entry.document.ocrConfidence < minConfidence,
  );
  const warningEntries = entries.filter((entry) => documentWarnings(entry.document).length > 0);
  const failedEntries = entries.filter((entry) => entry.document.status === "failed" || entry.document.extractionStatus === "failed");
  const zeroChunkIndexedEntries = entries.filter((entry) => entry.document.status === "indexed" && entry.document.chunkCount === 0);
  const duplicateEntries = entries.filter((entry) => Boolean(entry.document.duplicateOf));
  const issueMap = new Map<string, DocumentEntry>();
  for (const entry of [...failedEntries, ...lowConfidenceEntries, ...warningEntries, ...zeroChunkIndexedEntries, ...duplicateEntries]) {
    issueMap.set(`${entry.collection.slug}:${entry.document.id}`, entry);
  }
  return {
    totalDocuments: documents.length,
    totalChunks: sumValues(documents.map((document) => document.chunkCount)),
    statusCounts: countValues(documents.map((document) => document.status)),
    extractionStatusCounts: countValues(documents.map((document) => document.extractionStatus)),
    parserTypeCounts: countValues(documents.map((document) => document.parserType)),
    byteTotals: {
      sizeBytes: sumValues(documents.map((document) => document.sizeBytes)),
      originalSizeBytes: sumValues(documents.map((document) => document.originalSizeBytes ?? 0)),
      extractedTextBytes: sumValues(documents.map((document) => document.extractedTextBytes ?? 0)),
    },
    pageTotals: {
      pages: sumValues(documents.map((document) => document.pageCount ?? 0)),
      documentsWithPageCounts: documents.filter((document) => isFiniteNumber(document.pageCount)).length,
    },
    ocr: {
      documents: ocrEntries.length,
      confidenceSamples: confidenceValues.length,
      averageConfidence: average(confidenceValues),
      lowestConfidence: lowest(confidenceValues),
      belowMinConfidence: lowConfidenceEntries.length,
      engineCounts: countValues(ocrEntries.map((entry) => entry.document.ocrEngine)),
      languageCounts: countValues(ocrEntries.map((entry) => entry.document.ocrLanguage)),
    },
    warnings: {
      documents: warningEntries.length,
      count: sumValues(warningEntries.map((entry) => documentWarnings(entry.document).length)),
    },
    issues: Array.from(issueMap.values())
      .sort((left, right) => right.document.updatedAt.localeCompare(left.document.updatedAt))
      .slice(0, 25)
      .map(({ collection, document }) => ({
        collectionSlug: collection.slug,
        collectionName: collection.name,
        documentId: document.id,
        name: document.name,
        status: document.status,
        extractionStatus: document.extractionStatus,
        parserType: document.parserType,
        chunkCount: document.chunkCount,
        ocrConfidence: isFiniteNumber(document.ocrConfidence) ? document.ocrConfidence : null,
        warnings: documentWarnings(document).slice(0, 5).map((warning) => compactText(warning, 180)),
        error: compactText(document.error, 300),
        duplicateOf: document.duplicateOf,
        updatedAt: document.updatedAt,
      })),
  };
}

async function documentQualityOverview() {
  const [baseUrl, health, collections] = await Promise.all([
    ensureApiBaseUrl(),
    api<PublicHealthResponse>("/api/health"),
    readCollections(),
  ]);
  const collectionDocs = await readCollectionDocuments(collections.collections);
  const allEntries = collectionDocs.flatMap(({ collection, documents }) => documents.map((document) => ({ collection, document })));
  const minConfidence = health.config.parsers.ocr.minConfidence;
  return {
    apiBaseUrl: baseUrl,
    generatedAt: new Date().toISOString(),
    parserConfig: {
      duplicateStrategy: health.config.parsers.duplicateStrategy,
      maxFileSizeMb: health.config.parsers.maxFileSizeMb,
      pdf: health.config.parsers.pdf,
      docx: health.config.parsers.docx,
      ocr: {
        mode: health.config.parsers.ocr.mode,
        language: health.config.parsers.ocr.language,
        minConfidence,
        timeoutMs: health.config.parsers.ocr.timeoutMs,
        tesseractLangPathConfigured: configured(health.config.parsers.ocr.tesseractLangPath),
        paddleCommandConfigured: configured(health.config.parsers.ocr.paddleCommand),
        allowCloudOcr: health.config.parsers.ocr.allowCloudOcr,
        cloudBaseUrl: health.config.parsers.ocr.cloudBaseUrl,
        cloudApiKeyConfigured: configured(health.config.parsers.ocr.cloudApiKey),
        cloudModel: health.config.parsers.ocr.cloudModel,
      },
    },
    summary: qualitySummary(allEntries, minConfidence),
    collections: collectionDocs.map(({ collection, documents }) => ({
      slug: collection.slug,
      name: collection.name,
      ...qualitySummary(documents.map((document) => ({ collection, document })), minConfidence),
    })),
  };
}

function registerResources(server: McpServer) {
  server.registerResource(
    "vf_health",
    "knowledgeforge://health",
    {
      title: "Knowledge Forge Health",
      description: "API health, app version, configured embedding provider, and LanceDB tables.",
      mimeType: "application/json",
    },
    async (uri) => resourceJson(uri.href, { apiBaseUrl: await ensureApiBaseUrl(), health: await api<JsonValue>("/api/health") }),
  );

  server.registerResource(
    "vf_collections",
    "knowledgeforge://collections",
    {
      title: "Knowledge Forge Collections",
      description: "All local vector collections.",
      mimeType: "application/json",
    },
    async (uri) => resourceJson(uri.href, await api<JsonValue>("/api/collections")),
  );

  server.registerResource(
    "vf_collection_documents",
    new ResourceTemplate("knowledgeforge://collections/{slug}/documents", { list: undefined }),
    {
      title: "Knowledge Forge Collection Documents",
      description: "Documents indexed into one collection.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const slug = variable(variables.slug);
      return resourceJson(uri.href, await api<JsonValue>(`/api/collections/${encodeURIComponent(slug)}/documents`));
    },
  );

  server.registerResource(
    "vf_embedding_provider_status",
    "knowledgeforge://embedding-provider/status",
    {
      title: "Knowledge Forge Embedding Provider Status",
      description: "Current embedding provider configuration and per-collection embedding/index compatibility status.",
      mimeType: "application/json",
    },
    async (uri) => resourceJson(uri.href, await embeddingProviderStatus()),
  );

  server.registerResource(
    "vf_recent_jobs",
    "knowledgeforge://jobs/recent",
    {
      title: "Knowledge Forge Recent Jobs",
      description: "Recent local upload and reprocess jobs with status, phase, and progress.",
      mimeType: "application/json",
    },
    async (uri) => resourceJson(uri.href, await recentJobsStatus()),
  );

  server.registerResource(
    "vf_anythingllm_sync_status",
    "knowledgeforge://anythingllm/sync-status",
    {
      title: "Knowledge Forge AnythingLLM Sync Status",
      description: "Local AnythingLLM sync configuration and recorded per-collection sync metadata without contacting AnythingLLM.",
      mimeType: "application/json",
    },
    async (uri) => resourceJson(uri.href, await anythingLlmSyncStatus()),
  );

  server.registerResource(
    "vf_document_quality_overview",
    "knowledgeforge://documents/quality",
    {
      title: "Knowledge Forge OCR and Document Quality",
      description: "OCR configuration, parser coverage, warnings, failures, low-confidence OCR, and document quality overview.",
      mimeType: "application/json",
    },
    async (uri) => resourceJson(uri.href, await documentQualityOverview()),
  );
}

function registerTools(server: McpServer) {
  server.registerTool(
    "vf_stats",
    {
      title: "Knowledge Forge stats",
      description: "Return health, collection list, storage tables, and embedding provider status.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => toolResult({ apiBaseUrl: await ensureApiBaseUrl(), health: await api<JsonValue>("/api/health"), collections: await api<JsonValue>("/api/collections") }),
  );

  server.registerTool(
    "vf_list_collections",
    {
      title: "List vector collections",
      description: "List collections available in Knowledge Forge.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => toolResult(await api<JsonValue>("/api/collections")),
  );

  server.registerTool(
    "vf_search",
    {
      title: "Search a vector collection",
      description: "Embed a query with the configured provider and search a LanceDB-backed local collection.",
      inputSchema: {
        collection: z.string().min(1),
        query: z.string().min(1),
        topK: z.number().int().min(1).max(50).default(8),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ collection, query, topK }) =>
      toolResult(await api<JsonValue>(`/api/collections/${encodeURIComponent(collection)}/search`, jsonInit("POST", { query, topK }))),
  );

  server.registerTool(
    "vf_upsert_text",
    {
      title: "Upsert text into a collection",
      description: "Create chunks, embed them, and add the text to a collection. Disabled unless Knowledge Forge mcp.allowWrites is true.",
      inputSchema: {
        collection: z.string().min(1),
        name: z.string().min(1),
        text: z.string().min(1),
        metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
      },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ collection, ...body }) => {
      const health = await api<{ config: { mcp: { allowWrites: boolean } } }>("/api/health");
      if (!health.config.mcp.allowWrites) throw new Error("MCP write tools are disabled. Enable mcp.allowWrites in Knowledge Forge config first.");
      return toolResult(await api<JsonValue>(`/api/collections/${encodeURIComponent(collection)}/text`, jsonInit("POST", body)));
    },
  );

  server.registerTool(
    "vf_get_document",
    {
      title: "Get indexed document",
      description: "Return document metadata and stored chunks.",
      inputSchema: {
        collection: z.string().min(1),
        documentId: z.string().min(1),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ collection, documentId }) =>
      toolResult(await api<JsonValue>(`/api/collections/${encodeURIComponent(collection)}/documents/${encodeURIComponent(documentId)}`)),
  );

  server.registerTool(
    "vf_delete_document",
    {
      title: "Delete indexed document",
      description: "Delete a document and all of its chunks from the local vector collection. Disabled unless mcp.allowWrites is true.",
      inputSchema: {
        collection: z.string().min(1),
        documentId: z.string().min(1),
      },
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ collection, documentId }) => {
      const health = await api<{ config: { mcp: { allowWrites: boolean } } }>("/api/health");
      if (!health.config.mcp.allowWrites) throw new Error("MCP delete tools are disabled. Enable mcp.allowWrites in Knowledge Forge config first.");
      return toolResult(await api<JsonValue>(`/api/collections/${encodeURIComponent(collection)}/documents/${encodeURIComponent(documentId)}`, jsonInit("DELETE", {})));
    },
  );
}

async function main() {
  const server = new McpServer({
    name: "knowledge-forge",
    version: await readAppVersion(),
  });
  registerResources(server);
  registerTools(server);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[knowledge-forge-mcp] MCP stdio ready. API target: ${apiBaseUrl}`);
}

process.stdin.on("close", () => {
  ownedApiServer?.close();
});

main().catch((error) => {
  console.error("[knowledge-forge-mcp] Fatal error", error);
  ownedApiServer?.close();
  process.exit(1);
});
