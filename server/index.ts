import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import * as lancedb from "@lancedb/lancedb";
import multer from "multer";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { appendFile, copyFile, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import {
  defaultParserConfig,
  extractDocument,
  hashBuffer,
  normalizeParserConfig,
  testOcr,
  type ExtractionPage,
  type ParserConfig,
  type ParserType,
} from "./document-processing.js";
import { lookup as mimeLookup } from "mime-types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const inferredRootDir =
  path.basename(path.resolve(__dirname, "..")) === "dist-server" ? path.resolve(__dirname, "..", "..") : path.resolve(__dirname, "..");
const rootDir = process.env.VECTOR_FORGE_ROOT_DIR ? path.resolve(process.env.VECTOR_FORGE_ROOT_DIR) : inferredRootDir;
const dataDir = process.env.VECTOR_FORGE_DATA_DIR ? path.resolve(process.env.VECTOR_FORGE_DATA_DIR) : path.join(rootDir, "data");
const uploadsDir = path.join(dataDir, "uploads");
const extractedDir = path.join(dataDir, "extracted");
const lanceDir = path.join(dataDir, "lancedb");
const anythingInstallerDir = path.join(dataDir, "anythingllm-installers");
const manifestPath = path.join(dataDir, "manifest.json");
const configPath = path.join(dataDir, "config.json");
const onboardingPath = path.join(dataDir, "onboarding.json");
const aiToolAuditPath = path.join(dataDir, "ai-tool-audit.jsonl");
const anythingCleanupQueuePath = path.join(dataDir, "anythingllm-cleanup-queue.json");
const staticDir = process.env.VECTOR_FORGE_STATIC_DIR ? path.resolve(process.env.VECTOR_FORGE_STATIC_DIR) : path.join(rootDir, "dist");
const appVersion = readPackageVersion();
const defaultPort = Number(process.env.VECTOR_FORGE_PORT ?? 5183);
const requestTimeoutMs = 60_000;
const directoryScanSessionTtlMs = 15 * 60_000;
const directoryScanSessions = new Map<string, DirectoryScanSession>();
const anythingCleanupBatchSize = Math.max(1, Math.min(500, Number(process.env.VECTOR_FORGE_ANYTHING_CLEANUP_BATCH_SIZE ?? 100) || 100));
const aiAuditPreviewChars = 420;
const aiToolRiskRank: Record<AiToolRisk, number> = {
  read: 1,
  write: 2,
  "external-send": 3,
  "local-execution": 4,
  destructive: 5,
};
const aiToolRegistry: AiToolDefinition[] = [
  {
    id: "local.search",
    label: "Local vector search",
    category: "search",
    risk: "read",
    requiresConfirmation: false,
    execution: "dry-run-only",
    patterns: [/search|query|find|检索|搜索|查找|查询/i],
  },
  {
    id: "documents.import",
    label: "Import user-selected files",
    category: "document",
    risk: "write",
    requiresConfirmation: true,
    execution: "dry-run-only",
    patterns: [/import|upload|index|ocr|导入|上传|入库|索引|解析/i],
  },
  {
    id: "collections.create",
    label: "Create a collection",
    category: "collection",
    risk: "write",
    requiresConfirmation: true,
    execution: "dry-run-only",
    patterns: [/create.*collection|new.*collection|新建.*知识库|创建.*知识库|建立.*知识库/i],
  },
  {
    id: "documents.scanDirectory",
    label: "Scan a local directory",
    category: "document",
    risk: "local-execution",
    requiresConfirmation: true,
    execution: "dry-run-only",
    patterns: [/scan.*directory|directory.*scan|扫描.*目录|目录.*扫描/i],
  },
  {
    id: "documents.delete",
    label: "Delete documents",
    category: "document",
    risk: "destructive",
    requiresConfirmation: true,
    execution: "dry-run-only",
    patterns: [/delete.*document|remove.*document|删除.*文档|移除.*文档/i],
  },
  {
    id: "collections.delete",
    label: "Delete a collection",
    category: "collection",
    risk: "destructive",
    requiresConfirmation: true,
    execution: "dry-run-only",
    patterns: [/delete.*collection|drop.*collection|删除.*知识库|删除.*collection|清空.*知识库/i],
  },
  {
    id: "config.save",
    label: "Save collection parameters",
    category: "config",
    risk: "write",
    requiresConfirmation: true,
    execution: "dry-run-only",
    patterns: [/save.*config|save.*parameter|保存.*配置|保存.*参数/i],
  },
  {
    id: "config.applyDefault",
    label: "Apply default parameters to the current collection",
    category: "config",
    risk: "write",
    requiresConfirmation: true,
    execution: "dry-run-only",
    patterns: [/apply.*default|restore.*default|应用.*默认|恢复.*默认|使用.*默认/i],
  },
  {
    id: "config.copyToDefault",
    label: "Copy current collection parameters to defaults",
    category: "config",
    risk: "write",
    requiresConfirmation: true,
    execution: "dry-run-only",
    patterns: [/copy.*default|save.*as.*default|复制.*默认|设为默认|保存为默认/i],
  },
  {
    id: "embedding.test",
    label: "Test embedding provider",
    category: "config",
    risk: "external-send",
    requiresConfirmation: true,
    execution: "dry-run-only",
    patterns: [/test.*embedding|embedding.*test|测试.*embedding|测试.*嵌入|测试.*向量/i],
  },
  {
    id: "ocr.test",
    label: "Test OCR/parser provider",
    category: "ocr",
    risk: "external-send",
    requiresConfirmation: true,
    execution: "dry-run-only",
    patterns: [/test.*ocr|ocr.*test|测试.*ocr|测试.*解析/i],
  },
  {
    id: "ocr.cloud",
    label: "Send content to cloud OCR",
    category: "ocr",
    risk: "external-send",
    requiresConfirmation: true,
    execution: "dry-run-only",
    patterns: [/cloud.*ocr|vision.*ocr|云.*ocr|外部.*ocr/i],
  },
  {
    id: "anythingllm.test",
    label: "Test AnythingLLM connection",
    category: "anythingllm",
    risk: "external-send",
    requiresConfirmation: true,
    execution: "dry-run-only",
    patterns: [/test.*anythingllm|anythingllm.*test|测试.*anythingllm|检查.*anythingllm/i],
  },
  {
    id: "anythingllm.sync",
    label: "Sync chunks to AnythingLLM",
    category: "anythingllm",
    risk: "external-send",
    requiresConfirmation: true,
    execution: "dry-run-only",
    patterns: [/anythingllm.*sync|sync.*anythingllm|同步.*anythingllm|anythingllm.*同步/i],
  },
  {
    id: "anythingllm.launchInstaller",
    label: "Launch AnythingLLM installer",
    category: "desktop",
    risk: "local-execution",
    requiresConfirmation: true,
    execution: "dry-run-only",
    patterns: [/launch.*installer|start.*installer|run.*installer|启动.*安装器|运行.*安装器/i],
  },
];
const aiPromptInjectionPatterns = [
  /ignore (all )?(previous|above|system|developer) instructions/i,
  /disregard (all )?(previous|above) instructions/i,
  /delete (the )?(collection|documents?|database)/i,
  /launch .*installer/i,
  /run .*exe/i,
  /exfiltrate|steal|leak|send .*api key|send .*secret/i,
  /rm -rf|powershell|cmd\.exe/i,
  /忽略.*(指令|规则|限制)/i,
  /删除.*(知识库|文档|数据库)/i,
  /启动.*安装器/i,
  /泄露|窃取|发送.*(密钥|key|secret|token)/i,
];

function readPackageVersion() {
  try {
    const packageJson = JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf8")) as { version?: unknown };
    return typeof packageJson.version === "string" && packageJson.version.trim() ? packageJson.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

type EmbeddingProviderType = "local-hash" | "openai-compatible";
type Metric = "l2" | "cosine" | "dot";

type AppConfig = {
  embedding: {
    provider: EmbeddingProviderType;
    model: string;
    dimension: number;
    baseUrl: string;
    apiKey: string;
    batchSize: number;
  };
  chunking: {
    targetChars: number;
    overlapChars: number;
  };
  parsers: ParserConfig;
  anythingllm: {
    enabled: boolean;
    baseUrl: string;
    apiKey: string;
    workspaceName: string;
    workspaceSlug: string;
    desktopExePath: string;
  };
  mcp: {
    allowWrites: boolean;
  };
};

type AiToolRisk = "read" | "write" | "destructive" | "external-send" | "local-execution";
type AiToolDecision = {
  id: string;
  createdAt: string;
  mode: "dry-run";
  promptPreview: string;
  contextSource: "user" | "retrieved" | "mixed";
  matchedToolIds: string[];
  highestRisk: AiToolRisk;
  requiresConfirmation: boolean;
  blocked: boolean;
  willExecute: false;
  reason: string;
  confirmation?: {
    required: true;
    token: string;
    expiresAt: string;
  };
};

type AiToolDefinition = {
  id: string;
  label: string;
  category: "search" | "document" | "collection" | "config" | "ocr" | "anythingllm" | "desktop";
  risk: AiToolRisk;
  requiresConfirmation: boolean;
  execution: "dry-run-only";
  patterns: RegExp[];
};

type OnboardingStepId = "data" | "collection" | "embedding" | "ocr" | "anythingllm" | "finish";
type OnboardingTrackedStepId = Exclude<OnboardingStepId, "finish">;
type OnboardingStepStatus = "pending" | "complete" | "skipped" | "failed";
type OnboardingStepState = {
  status: OnboardingStepStatus;
  updatedAt?: string;
  lastError?: string;
};
type OnboardingState = {
  schemaVersion: 1;
  completed: boolean;
  dismissed: boolean;
  currentStep: OnboardingStepId;
  steps: Record<OnboardingTrackedStepId, OnboardingStepState>;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  dismissedAt?: string;
  lastResults?: {
    embedding?: Record<string, unknown>;
    ocr?: Record<string, unknown>;
    anythingllm?: Record<string, unknown>;
  };
};

type CollectionRecord = {
  id: string;
  name: string;
  slug: string;
  description: string;
  tableName: string;
  dimension: number;
  metric: Metric;
  embeddingProvider: EmbeddingProviderType;
  embeddingModel: string;
  createdAt: string;
  updatedAt: string;
  documentCount: number;
  chunkCount: number;
  config: AppConfig;
};

type CollectionSummary = Omit<CollectionRecord, "config">;

type Manifest = {
  version: string;
  activeCollectionSlug: string;
  collections: CollectionRecord[];
};

type CollectionConfigStatus = {
  usesDefaultSnapshot: boolean;
  isCustomized: boolean;
  embeddingChangedRequiresRebuild: boolean;
  embeddingMatchesIndex: boolean;
  canUpdateEmbeddingIndex: boolean;
  chunkCount: number;
  indexedEmbedding: {
    provider: EmbeddingProviderType;
    model: string;
    dimension: number;
  };
  configEmbedding: {
    provider: EmbeddingProviderType;
    model: string;
    dimension: number;
  };
};

type AnythingSyncChunk = {
  syncKey: string;
  location: string;
  chunkId: string;
  chunkIndex: number;
  textHash: string;
  baseUrl: string;
  workspaceSlug: string;
  uploadedAt: string;
  embeddedAt?: string;
  title?: string;
  sourceName?: string;
  cleanupPending?: boolean;
  cleanupError?: string;
  cleanupLastAttemptAt?: string;
};

type AnythingSyncState = {
  version: 1;
  updatedAt?: string;
  chunks: AnythingSyncChunk[];
};

type AnythingCleanupSummary = {
  deleted: number;
  skipped: number;
  workspaces: Array<{ workspaceSlug: string; deleted: number }>;
  queued?: number;
  pending?: number;
  failed?: number;
};

type AnythingCleanupQueueStatus = "prepared" | "pending";
type AnythingCleanupSource = "document-delete" | "collection-delete" | "reprocess";

type AnythingCleanupActivationGuard =
  | { kind: "document-deleted"; documentId: string }
  | { kind: "collection-deleted"; collectionSlug: string }
  | { kind: "document-replaced"; documentId: string; oldSyncKeys: string[] };

type AnythingCleanupQueueEntry = {
  id: string;
  status: AnythingCleanupQueueStatus;
  source: AnythingCleanupSource;
  collectionSlug: string;
  collectionId?: string;
  documentId?: string;
  documentName?: string;
  baseUrl: string;
  apiKey?: string;
  workspaceSlug: string;
  locations: string[];
  syncKeys: string[];
  createdAt: string;
  updatedAt: string;
  attempts: number;
  lastAttemptAt?: string;
  lastError?: string;
  activationGuard: AnythingCleanupActivationGuard;
};

type AnythingCleanupQueueFile = {
  version: 1;
  entries: AnythingCleanupQueueEntry[];
};

type DocumentRecord = {
  id: string;
  collectionSlug: string;
  name: string;
  sourcePath: string;
  mime: string;
  sizeBytes: number;
  chunkCount: number;
  status: "pending" | "extracting" | "ocr" | "chunking" | "embedding" | "indexed" | "failed" | "skipped";
  error?: string;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, string | number | boolean>;
  anythingLocations: string[];
  anythingSync?: AnythingSyncState;
  contentHash?: string;
  parserType?: ParserType;
  parserVersion?: string;
  extractionStatus?: "pending" | "extracting" | "ocr" | "chunking" | "embedding" | "indexed" | "failed" | "skipped";
  extractedTextPath?: string;
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

type VectorRow = {
  id: string;
  collectionSlug: string;
  documentId: string;
  chunkIndex: number;
  title: string;
  text: string;
  sourceName: string;
  sourcePath: string;
  mime: string;
  metadataJson: string;
  createdAt: string;
  vector: number[];
};

type DirectoryScanCandidate = {
  id: string;
  path: string;
  name: string;
  extension: string;
  mime: string;
  sizeBytes: number;
  modifiedAt: string;
  contentHash?: string;
};

type DirectoryScanSession = {
  id: string;
  collectionSlug: string;
  rootPath: string;
  recursive: boolean;
  createdAt: string;
  expiresAt: number;
  candidates: DirectoryScanCandidate[];
  candidatePathKeys: Set<string>;
};

type AnythingWorkspace = { id: number; name: string; slug: string };

const defaultConfig: AppConfig = {
  embedding: {
    provider: "local-hash",
    model: "local-hash-v1",
    dimension: 384,
    baseUrl: "https://api.openai.com/v1/embeddings",
    apiKey: "",
    batchSize: 32,
  },
  chunking: {
    targetChars: 900,
    overlapChars: 120,
  },
  parsers: defaultParserConfig,
  anythingllm: {
    enabled: false,
    baseUrl: "http://127.0.0.1:3001/api",
    apiKey: "",
    workspaceName: "Vector Forge Lab",
    workspaceSlug: "vector-forge-lab",
    desktopExePath: "",
  },
  mcp: {
    allowWrites: false,
  },
};

const app = express();
const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const localActionToken = process.env.VECTOR_FORGE_LOCAL_ACTION_TOKEN?.trim() || "";
const allowedInstallerExtensions = new Set([".exe", ".msi", ".dmg", ".zip", ".appimage"]);
const launchableInstallerExtensions = new Set([".exe", ".msi", ".dmg", ".appimage"]);
const allowedInstallerHosts = new Set(["github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com", "github-releases.githubusercontent.com"]);
const maxInstallerBytes = 500 * 1024 * 1024;
const supportedImportExtensions = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".html",
  ".htm",
  ".csv",
  ".tsv",
  ".xml",
  ".log",
  ".yaml",
  ".yml",
  ".pdf",
  ".docx",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".tif",
  ".tiff",
  ".bmp",
]);
app.use(cors({
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }
    try {
      const parsed = new URL(origin);
      if ((parsed.protocol === "http:" || parsed.protocol === "https:") && loopbackHosts.has(parsed.hostname)) {
        callback(null, true);
        return;
      }
    } catch {
      // Fall through to rejection below.
    }
    callback(new Error(`CORS origin not allowed: ${origin}`));
  },
}));
app.use(express.json({ limit: "25mb" }));
app.use((request: Request, response: Response, next: NextFunction) => {
  if (
    request.path.startsWith("/api/")
    && !["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())
  ) {
    try {
      assertTrustedLocalActionRequest(request);
    } catch (error) {
      response.status(statusCodeForError(error)).json({ error: messageForError(error) });
      return;
    }
  }
  next();
});

const upload = multer({
  dest: path.join(dataDir, "tmp-upload"),
  limits: {
    fileSize: 250 * 1024 * 1024,
    files: 20,
  },
});

function nowIso() {
  return new Date().toISOString();
}

function normalizeBaseUrl(input: string) {
  return input.replace(/\/+$/, "");
}

function normalizeOptionalPath(input: unknown) {
  return typeof input === "string" ? input.trim() : "";
}

function isLoopbackAddress(input: string | undefined) {
  if (!input) return false;
  const address = input.toLowerCase();
  return address === "::1"
    || address === "127.0.0.1"
    || address.startsWith("127.")
    || address.startsWith("::ffff:127.");
}

function assertLoopbackRequest(request: Request) {
  if (!isLoopbackAddress(request.socket.remoteAddress)) {
    throw Object.assign(new Error("AnythingLLM desktop management is only available from loopback clients."), { statusCode: 403 });
  }
}

function assertTrustedLocalActionRequest(request: Request) {
  assertLoopbackRequest(request);
  if (!localActionToken) return;
  const provided = request.get("X-Vector-Forge-Local-Action-Token")?.trim() || "";
  if (provided !== localActionToken) {
    throw Object.assign(new Error("Trusted local action token is required for this desktop endpoint."), { statusCode: 403 });
  }
}

function slugify(input: string) {
  const cleaned = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return cleaned || `collection-${Date.now()}`;
}

function tableNameForCollectionId(id: string) {
  return `vf_${id.replace(/-/g, "_")}`;
}

function publicConfig(config: AppConfig): AppConfig {
  const normalized = normalizeConfig(config);
  return {
    ...normalized,
    embedding: {
      ...normalized.embedding,
      apiKey: normalized.embedding.apiKey ? "[configured]" : "",
    },
    anythingllm: {
      ...normalized.anythingllm,
      apiKey: normalized.anythingllm.apiKey ? "[configured]" : "",
    },
    parsers: {
      ...normalized.parsers,
      ocr: {
        ...normalized.parsers.ocr,
        cloudApiKey: normalized.parsers.ocr.cloudApiKey ? "[configured]" : "",
      },
    },
  };
}

function publicCollection(collection: CollectionRecord): CollectionSummary {
  return {
    id: collection.id,
    name: collection.name,
    slug: collection.slug,
    description: collection.description,
    tableName: collection.tableName,
    dimension: collection.dimension,
    metric: collection.metric,
    embeddingProvider: collection.embeddingProvider,
    embeddingModel: collection.embeddingModel,
    createdAt: collection.createdAt,
    updatedAt: collection.updatedAt,
    documentCount: collection.documentCount,
    chunkCount: collection.chunkCount,
  };
}

const aiToolDryRunSchema = z.object({
  prompt: z.string().max(20_000).default(""),
  requestedToolId: z.string().optional(),
  context: z.object({
    source: z.enum(["user", "retrieved", "mixed"]).optional(),
    snippets: z.array(z.string().max(5_000)).max(20).optional(),
  }).optional(),
});

function publicAiTool(tool: AiToolDefinition) {
  return {
    id: tool.id,
    label: tool.label,
    category: tool.category,
    risk: tool.risk,
    requiresConfirmation: tool.requiresConfirmation,
    execution: tool.execution,
  };
}

function configuredSecrets(config: AppConfig) {
  return [
    config.embedding.apiKey,
    config.anythingllm.apiKey,
    config.parsers.ocr.cloudApiKey,
  ].filter((value) => value.trim().length >= 4);
}

function redactAiText(input: string, secrets: string[] = []) {
  let output = input;
  for (const secret of secrets) {
    output = output.split(secret).join("[redacted-secret]");
  }
  return output
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted-openai-key]")
    .replace(/(?:api[_-]?key|token|secret|authorization|password)\s*[:=]\s*["']?[^"'\s,;]+/gi, "$1=[redacted]")
    .replace(/[A-Za-z0-9_-]{32,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[redacted-token]");
}

function compactAiPreview(input: string, secrets: string[] = []) {
  const redacted = redactAiText(input, secrets).replace(/\s+/g, " ").trim();
  return redacted.length > aiAuditPreviewChars ? `${redacted.slice(0, aiAuditPreviewChars)}...` : redacted;
}

function hashAiText(input: string) {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function highestAiRisk(tools: AiToolDefinition[]) {
  return tools.reduce<AiToolRisk>((risk, tool) => (aiToolRiskRank[tool.risk] > aiToolRiskRank[risk] ? tool.risk : risk), "read");
}

function matchAiTools(prompt: string, requestedToolId?: string) {
  if (requestedToolId) {
    const requested = aiToolRegistry.find((tool) => tool.id === requestedToolId);
    if (!requested) throw Object.assign(new Error(`Unknown AI tool id: ${requestedToolId}`), { statusCode: 400 });
    return [requested];
  }
  const matched = aiToolRegistry.filter((tool) => tool.patterns.some((pattern) => pattern.test(prompt)));
  return matched.length ? matched : [aiToolRegistry[0]!];
}

function hasAiPromptInjection(input: string) {
  return aiPromptInjectionPatterns.some((pattern) => pattern.test(input));
}

function evaluateAiToolDryRun(input: z.infer<typeof aiToolDryRunSchema>, config: AppConfig): AiToolDecision {
  const secrets = configuredSecrets(config);
  const prompt = input.prompt.trim();
  const contextSource = input.context?.source ?? "user";
  const contextText = (input.context?.snippets ?? []).join("\n\n");
  const tools = matchAiTools(prompt, input.requestedToolId);
  const matchedToolIds = tools.map((tool) => tool.id);
  const highestRisk = highestAiRisk(tools);
  const requiresConfirmation = tools.some((tool) => tool.requiresConfirmation);
  const contextInjection = contextSource !== "user" && hasAiPromptInjection(contextText);
  const blocked = contextInjection;
  const createdAt = nowIso();
  const decision: AiToolDecision = {
    id: uuidv4(),
    createdAt,
    mode: "dry-run",
    promptPreview: compactAiPreview(prompt, secrets),
    contextSource,
    matchedToolIds,
    highestRisk,
    requiresConfirmation,
    blocked,
    willExecute: false,
    reason: blocked
      ? "Retrieved or mixed context contains tool-like instructions. Context cannot authorize write, delete, local execution, or external-send actions."
      : requiresConfirmation
        ? "This tool class requires explicit user confirmation. Dry-run policy did not execute it."
        : "Read-only tool class is eligible for future execution by a confirmed planner. Dry-run policy did not execute it.",
  };
  if (requiresConfirmation && !blocked) {
    decision.confirmation = {
      required: true,
      token: uuidv4(),
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    };
  }
  return decision;
}

async function appendAiToolAudit(decision: AiToolDecision, input: z.infer<typeof aiToolDryRunSchema>, config: AppConfig) {
  await ensureDirs();
  const secrets = configuredSecrets(config);
  const contextText = (input.context?.snippets ?? []).join("\n\n");
  const event = {
    id: decision.id,
    createdAt: decision.createdAt,
    mode: decision.mode,
    promptPreview: decision.promptPreview,
    promptHash: hashAiText(input.prompt ?? ""),
    contextSource: decision.contextSource,
    contextPreview: compactAiPreview(contextText, secrets),
    contextHash: contextText ? hashAiText(contextText) : "",
    matchedToolIds: decision.matchedToolIds,
    highestRisk: decision.highestRisk,
    requiresConfirmation: decision.requiresConfirmation,
    blocked: decision.blocked,
    willExecute: decision.willExecute,
    reason: decision.reason,
  };
  await appendFile(aiToolAuditPath, `${JSON.stringify(event)}\n`, "utf8");
}

async function readAiToolAudit(limit: number) {
  if (!(await fileExists(aiToolAuditPath))) return [];
  const raw = await readFile(aiToolAuditPath, "utf8");
  const output: Array<Record<string, unknown>> = [];
  const maxEvents = Math.max(1, Math.min(200, limit));
  const lines = raw.split(/\r?\n/).filter(Boolean);
  for (let index = lines.length - 1; index >= 0 && output.length < maxEvents; index -= 1) {
    try {
      output.push(JSON.parse(lines[index]!) as Record<string, unknown>);
    } catch {
      // JSONL append logs can end with a partial line after an interrupted write.
    }
  }
  return output.reverse();
}

const onboardingTrackedSteps = ["data", "collection", "embedding", "ocr", "anythingllm"] as const satisfies OnboardingTrackedStepId[];
const onboardingStepIds = [...onboardingTrackedSteps, "finish"] as const satisfies OnboardingStepId[];
const onboardingResultSecretPattern = /key|token|secret|authorization|password/i;

function isOnboardingStepId(input: unknown): input is OnboardingStepId {
  return typeof input === "string" && (onboardingStepIds as readonly string[]).includes(input);
}

function isOnboardingStepStatus(input: unknown): input is OnboardingStepStatus {
  return input === "pending" || input === "complete" || input === "skipped" || input === "failed";
}

function defaultOnboardingSteps(): Record<OnboardingTrackedStepId, OnboardingStepState> {
  return {
    data: { status: "pending" },
    collection: { status: "pending" },
    embedding: { status: "pending" },
    ocr: { status: "pending" },
    anythingllm: { status: "pending" },
  };
}

function defaultOnboardingState(): OnboardingState {
  const timestamp = nowIso();
  return {
    schemaVersion: 1,
    completed: false,
    dismissed: false,
    currentStep: "data",
    steps: defaultOnboardingSteps(),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function sanitizeOnboardingResult(input: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated]";
  if (input === null || input === undefined) return input;
  if (typeof input === "boolean" || typeof input === "number") return input;
  if (typeof input === "string") return input.length > 240 ? `${input.slice(0, 240)}...` : input;
  if (Array.isArray(input)) return input.slice(0, 20).map((item) => sanitizeOnboardingResult(item, depth + 1));
  if (typeof input !== "object") return String(input);
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>).slice(0, 40)) {
    output[key] = onboardingResultSecretPattern.test(key) ? "[redacted]" : sanitizeOnboardingResult(value, depth + 1);
  }
  return output;
}

function sanitizeOnboardingResults(input: unknown): OnboardingState["lastResults"] | undefined {
  const record = unknownRecord(input);
  if (!record) return undefined;
  const output: NonNullable<OnboardingState["lastResults"]> = {};
  for (const key of ["embedding", "ocr", "anythingllm"] as const) {
    const value = sanitizeOnboardingResult(record[key]);
    if (value && typeof value === "object" && !Array.isArray(value)) output[key] = value as Record<string, unknown>;
  }
  return Object.keys(output).length ? output : undefined;
}

function normalizeOnboardingStep(input: unknown): OnboardingStepState {
  const record = unknownRecord(input);
  const status = isOnboardingStepStatus(record?.status) ? record.status : "pending";
  return {
    status,
    ...(typeof record?.updatedAt === "string" && record.updatedAt ? { updatedAt: record.updatedAt } : {}),
    ...(typeof record?.lastError === "string" && record.lastError ? { lastError: record.lastError.slice(0, 500) } : {}),
  };
}

function normalizeOnboardingState(input: unknown): OnboardingState {
  const fallback = defaultOnboardingState();
  const record = unknownRecord(input);
  if (!record) return fallback;
  const timestamp = typeof record.updatedAt === "string" && record.updatedAt ? record.updatedAt : nowIso();
  const parsedSteps = unknownRecord(record.steps) ?? {};
  const steps = defaultOnboardingSteps();
  for (const stepId of onboardingTrackedSteps) {
    steps[stepId] = normalizeOnboardingStep(parsedSteps[stepId]);
  }
  const completed = record.completed === true;
  const dismissed = record.dismissed === true;
  const currentStep = isOnboardingStepId(record.currentStep) ? record.currentStep : completed ? "finish" : "data";
  return {
    schemaVersion: 1,
    completed,
    dismissed,
    currentStep,
    steps,
    createdAt: typeof record.createdAt === "string" && record.createdAt ? record.createdAt : timestamp,
    updatedAt: timestamp,
    ...(typeof record.completedAt === "string" && record.completedAt ? { completedAt: record.completedAt } : {}),
    ...(typeof record.dismissedAt === "string" && record.dismissedAt ? { dismissedAt: record.dismissedAt } : {}),
    ...(sanitizeOnboardingResults(record.lastResults) ? { lastResults: sanitizeOnboardingResults(record.lastResults) } : {}),
  };
}

async function loadOnboardingState(): Promise<OnboardingState> {
  await ensureDirs();
  if (!(await fileExists(onboardingPath)) && !(await fileExists(jsonBackupPath(onboardingPath)))) {
    const initial = defaultOnboardingState();
    await saveOnboardingState(initial);
    return initial;
  }
  const parsed = await readJsonFileWithBackup<unknown>(onboardingPath, "onboarding state");
  const normalized = normalizeOnboardingState(parsed);
  if (JSON.stringify(parsed) !== JSON.stringify(normalized)) await saveOnboardingState(normalized);
  return normalized;
}

async function saveOnboardingState(state: OnboardingState) {
  await ensureDirs();
  await writeJsonAtomic(onboardingPath, normalizeOnboardingState(state));
}

async function getOnboardingPayload(state?: OnboardingState) {
  const [onboarding, manifest, config] = await Promise.all([
    state ? Promise.resolve(normalizeOnboardingState(state)) : loadOnboardingState(),
    loadManifest(),
    loadConfig(),
  ]);
  const db = await getDb();
  const tableNames = await db.tableNames().catch(() => []);
  const activeCollection = manifest.collections.find((collection) => collection.slug === manifest.activeCollectionSlug) ?? manifest.collections[0] ?? null;
  return {
    onboarding,
    readiness: {
      dataDir,
      lanceDir,
      lanceDbReady: true,
      tableCount: tableNames.length,
      hasCollection: manifest.collections.length > 0,
      collectionCount: manifest.collections.length,
      activeCollectionSlug: activeCollection?.slug ?? "",
      activeCollectionName: activeCollection?.name ?? "",
      defaultEmbedding: {
        provider: config.embedding.provider,
        model: config.embedding.model,
        dimension: config.embedding.dimension,
        batchSize: config.embedding.batchSize,
      },
      defaultOcr: {
        mode: config.parsers.ocr.mode,
        language: config.parsers.ocr.language,
        minConfidence: config.parsers.ocr.minConfidence,
      },
      anythingllmConfigured: Boolean(config.anythingllm.enabled && config.anythingllm.baseUrl && config.anythingllm.apiKey),
      anythingllmEnabled: config.anythingllm.enabled,
      cloudOcrEnabled: Boolean(config.parsers.ocr.allowCloudOcr && config.parsers.ocr.cloudBaseUrl && config.parsers.ocr.cloudApiKey),
    },
  };
}

function sqlString(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function isPathInside(root: string, target: string) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function fileExists(targetPath: string) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

function jsonBackupPath(targetPath: string) {
  return `${targetPath}.bak`;
}

async function parseJsonFile<T>(targetPath: string) {
  return JSON.parse(await readFile(targetPath, "utf8")) as T;
}

async function copyFileAtomic(sourcePath: string, targetPath: string) {
  const parentDir = path.dirname(targetPath);
  await mkdir(parentDir, { recursive: true });
  const tempPath = path.join(
    parentDir,
    `${path.basename(targetPath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  );
  try {
    await copyFile(sourcePath, tempPath);
    await rename(tempPath, targetPath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function writeJsonAtomic(targetPath: string, value: unknown) {
  const parentDir = path.dirname(targetPath);
  await mkdir(parentDir, { recursive: true });
  const backupPath = jsonBackupPath(targetPath);
  const tempPath = path.join(
    parentDir,
    `${path.basename(targetPath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  );
  try {
    const text = `${JSON.stringify(value, null, 2)}\n`;
    JSON.parse(text);
    await writeFile(tempPath, text, "utf8");
    await rename(tempPath, targetPath);
    await copyFileAtomic(targetPath, backupPath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function readJsonFileWithBackup<T>(targetPath: string, label = path.basename(targetPath)) {
  const backupPath = jsonBackupPath(targetPath);
  let primaryError: unknown;
  if (await fileExists(targetPath)) {
    try {
      return await parseJsonFile<T>(targetPath);
    } catch (error) {
      primaryError = error;
    }
  }
  if (await fileExists(backupPath)) {
    try {
      const backupValue = await parseJsonFile<T>(backupPath);
      await writeJsonAtomic(targetPath, backupValue);
      return backupValue;
    } catch (backupError) {
      throw Object.assign(new Error(`Failed to read ${label}; primary JSON and backup are unavailable or invalid.`), {
        statusCode: 500,
        cause: backupError,
        primaryError,
      });
    }
  }
  if (primaryError) {
    throw Object.assign(new Error(`Failed to read ${label}; primary JSON is invalid and no valid backup exists.`), {
      statusCode: 500,
      cause: primaryError,
    });
  }
  throw Object.assign(new Error(`JSON file does not exist: ${label}`), { statusCode: 404 });
}

function executableNameLooksLikeAnythingLLM(targetPath: string) {
  const normalized = path.basename(targetPath).toLowerCase().replace(/[^a-z0-9]/g, "");
  return normalized.includes("anythingllm");
}

function executableExtensionAllowed(targetPath: string) {
  const ext = path.extname(targetPath).toLowerCase();
  if (process.platform === "win32") return ext === ".exe";
  return ext === ".exe" || ext === ".app" || ext === ".appimage" || ext === "";
}

function assertSafeDesktopExePath(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return "";
  if (trimmed.length > 4096 || trimmed.includes("\0")) {
    throw Object.assign(new Error("AnythingLLM executable path is invalid."), { statusCode: 400 });
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    throw Object.assign(new Error("AnythingLLM executable path must be a local absolute path, not a URL."), { statusCode: 400 });
  }
  if (!path.isAbsolute(trimmed)) {
    throw Object.assign(new Error("AnythingLLM executable path must be absolute."), { statusCode: 400 });
  }
  const resolved = path.resolve(trimmed);
  if (!executableExtensionAllowed(resolved)) {
    throw Object.assign(new Error("AnythingLLM executable path must point to an executable file."), { statusCode: 400 });
  }
  if (!executableNameLooksLikeAnythingLLM(resolved)) {
    throw Object.assign(new Error("Executable filename must look like AnythingLLM."), { statusCode: 400 });
  }
  return resolved;
}

async function inspectAnythingExePath(input: string) {
  const exePath = normalizeOptionalPath(input);
  if (!exePath) {
    return {
      path: "",
      configured: false,
      exists: false,
      isFile: false,
      nameLooksValid: false,
      extensionAllowed: false,
      launchable: false,
      error: "",
    };
  }
  const resolved = path.resolve(exePath);
  const extensionAllowed = executableExtensionAllowed(resolved);
  const nameLooksValid = executableNameLooksLikeAnythingLLM(resolved);
  try {
    const item = await stat(resolved);
    const isFile = item.isFile() || (process.platform === "darwin" && item.isDirectory() && path.extname(resolved).toLowerCase() === ".app");
    return {
      path: resolved,
      configured: true,
      exists: true,
      isFile,
      nameLooksValid,
      extensionAllowed,
      launchable: isFile && nameLooksValid && extensionAllowed,
      sizeBytes: item.isFile() ? item.size : 0,
      modifiedAt: item.mtime.toISOString(),
      error: "",
    };
  } catch (error) {
    return {
      path: resolved,
      configured: true,
      exists: false,
      isFile: false,
      nameLooksValid,
      extensionAllowed,
      launchable: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function uniqueNonEmptyStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function anythingExeCandidates() {
  const home = os.homedir();
  if (process.platform === "win32") {
    return uniqueNonEmptyStrings([
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs", "anythingllm-desktop", "AnythingLLM.exe") : "",
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs", "AnythingLLM", "AnythingLLM.exe") : "",
      process.env.APPDATA ? path.join(process.env.APPDATA, "AnythingLLM", "AnythingLLM.exe") : "",
      process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "AnythingLLM", "AnythingLLM.exe") : "",
      process.env["ProgramFiles(x86)"] ? path.join(process.env["ProgramFiles(x86)"], "AnythingLLM", "AnythingLLM.exe") : "",
    ]);
  }
  if (process.platform === "darwin") {
    return uniqueNonEmptyStrings([
      "/Applications/AnythingLLM.app",
      path.join(home, "Applications", "AnythingLLM.app"),
    ]);
  }
  return uniqueNonEmptyStrings([
    "/usr/local/bin/anythingllm",
    "/opt/AnythingLLM/anythingllm",
    path.join(home, "Applications", "AnythingLLM.AppImage"),
  ]);
}

async function getAnythingEnvironment(config?: AppConfig) {
  const currentConfig = config ?? await loadConfig();
  const configuredExe = await inspectAnythingExePath(currentConfig.anythingllm.desktopExePath);
  const candidateStatuses = await Promise.all(anythingExeCandidates().map((candidate) => inspectAnythingExePath(candidate)));
  const detectedExe = configuredExe.launchable ? configuredExe : candidateStatuses.find((candidate) => candidate.launchable) ?? null;
  return {
    os: {
      platform: process.platform,
      arch: process.arch,
    },
    api: {
      enabled: currentConfig.anythingllm.enabled,
      baseUrl: normalizeBaseUrl(currentConfig.anythingllm.baseUrl),
      apiKeyConfigured: Boolean(currentConfig.anythingllm.apiKey),
      workspaceName: currentConfig.anythingllm.workspaceName,
      workspaceSlug: currentConfig.anythingllm.workspaceSlug,
    },
    desktop: {
      configuredExe,
      detectedExe,
      candidates: candidateStatuses,
    },
    installer: {
      folder: anythingInstallerDir,
      allowedExtensions: Array.from(allowedInstallerExtensions).sort(),
      allowedHosts: Array.from(allowedInstallerHosts).sort(),
      maxBytes: maxInstallerBytes,
    },
  };
}

function assertValidInstallerUrl(input: string) {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw Object.assign(new Error("Installer URL is invalid."), { statusCode: 400 });
  }
  if (parsed.protocol !== "https:") {
    throw Object.assign(new Error("Installer URL must use https."), { statusCode: 400 });
  }
  if (parsed.username || parsed.password) {
    throw Object.assign(new Error("Installer URL must not include credentials."), { statusCode: 400 });
  }
  if (!allowedInstallerHosts.has(parsed.hostname)) {
    throw Object.assign(new Error("Installer URL host is not allowed."), { statusCode: 400 });
  }
  if (parsed.hostname === "github.com" && !parsed.pathname.startsWith("/Mintplex-Labs/anything-llm/releases/")) {
    throw Object.assign(new Error("Installer URL must point to the official AnythingLLM GitHub releases."), { statusCode: 400 });
  }
  return parsed;
}

function sanitizeInstallerFileName(input: string) {
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > 180 || trimmed.includes("\0")) {
    throw Object.assign(new Error("Installer file name is invalid."), { statusCode: 400 });
  }
  const fileName = path.basename(trimmed);
  if (fileName !== trimmed || fileName === "." || fileName === "..") {
    throw Object.assign(new Error("Installer file name must not contain path separators."), { statusCode: 400 });
  }
  if (!fileName.toLowerCase().includes("anything")) {
    throw Object.assign(new Error("Installer file name must look like an AnythingLLM installer."), { statusCode: 400 });
  }
  const ext = path.extname(fileName).toLowerCase();
  if (!allowedInstallerExtensions.has(ext)) {
    throw Object.assign(new Error("Installer file extension is not allowed."), { statusCode: 400 });
  }
  return fileName;
}

function installerFileNameFromUrl(url: URL) {
  const decoded = decodeURIComponent(path.basename(url.pathname));
  return sanitizeInstallerFileName(decoded || "AnythingLLM-Desktop-Installer.exe");
}

function installerPathForFileName(fileName: string) {
  const safeFileName = sanitizeInstallerFileName(fileName);
  const targetPath = path.resolve(anythingInstallerDir, safeFileName);
  if (!isPathInside(anythingInstallerDir, targetPath)) {
    throw Object.assign(new Error("Installer path escaped the managed installer folder."), { statusCode: 400 });
  }
  return targetPath;
}

async function uniqueInstallerTargetPath(fileName: string) {
  let targetPath = installerPathForFileName(fileName);
  if (!(await fileExists(targetPath))) return targetPath;
  const ext = path.extname(fileName);
  const base = fileName.slice(0, fileName.length - ext.length);
  for (let index = 1; index <= 100; index += 1) {
    targetPath = installerPathForFileName(`${base}-${Date.now()}-${index}${ext}`);
    if (!(await fileExists(targetPath))) return targetPath;
  }
  throw Object.assign(new Error("Unable to allocate a unique installer file name."), { statusCode: 500 });
}

async function newestInstallerPath() {
  const entries = await readdir(anythingInstallerDir, { withFileTypes: true }).catch(() => []);
  const installers = await Promise.all(entries
    .filter((entry) => entry.isFile())
    .map(async (entry) => {
      try {
        const targetPath = installerPathForFileName(entry.name);
        const item = await stat(targetPath);
        return { path: targetPath, mtimeMs: item.mtimeMs };
      } catch {
        return null;
      }
    }));
  const sorted = installers
    .filter((item): item is { path: string; mtimeMs: number } => Boolean(item))
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  return sorted[0]?.path ?? "";
}

function dryRunCommandForOpeningFolder(folder: string) {
  if (process.platform === "win32") return { command: "explorer.exe", args: [folder] };
  if (process.platform === "darwin") return { command: "open", args: [folder] };
  return { command: "xdg-open", args: [folder] };
}

function commandForInstaller(installerPath: string) {
  const ext = path.extname(installerPath).toLowerCase();
  if (!launchableInstallerExtensions.has(ext)) {
    throw Object.assign(new Error("Installer file type cannot be launched directly."), { statusCode: 400 });
  }
  if (process.platform === "win32" && ext === ".msi") return { command: "msiexec.exe", args: ["/i", installerPath] };
  if (process.platform === "darwin") return { command: "open", args: [installerPath] };
  return { command: installerPath, args: [] };
}

function spawnDetached(command: string, args: string[]) {
  return new Promise<number | null>((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve(child.pid ?? null);
    });
  });
}

async function ensureDirs() {
  await mkdir(dataDir, { recursive: true });
  await mkdir(uploadsDir, { recursive: true });
  await mkdir(extractedDir, { recursive: true });
  await mkdir(lanceDir, { recursive: true });
  await mkdir(anythingInstallerDir, { recursive: true });
  await mkdir(path.join(dataDir, "tmp-upload"), { recursive: true });
}

function normalizeConfig(input: Partial<AppConfig> = {}): AppConfig {
  return {
    embedding: {
      ...defaultConfig.embedding,
      ...(input.embedding ?? {}),
      dimension: Math.min(4096, Math.max(32, Number(input.embedding?.dimension ?? defaultConfig.embedding.dimension) || defaultConfig.embedding.dimension)),
      batchSize: Math.min(128, Math.max(1, Number(input.embedding?.batchSize ?? defaultConfig.embedding.batchSize) || defaultConfig.embedding.batchSize)),
      provider: input.embedding?.provider === "openai-compatible" ? "openai-compatible" : "local-hash",
    },
    chunking: {
      ...defaultConfig.chunking,
      ...(input.chunking ?? {}),
      targetChars: Math.min(8000, Math.max(300, Number(input.chunking?.targetChars ?? defaultConfig.chunking.targetChars) || defaultConfig.chunking.targetChars)),
      overlapChars: Math.min(2000, Math.max(0, Number(input.chunking?.overlapChars ?? defaultConfig.chunking.overlapChars) || defaultConfig.chunking.overlapChars)),
    },
    parsers: normalizeParserConfig({
      ...defaultConfig.parsers,
      ...(input.parsers ?? {}),
      pdf: {
        ...defaultConfig.parsers.pdf,
        ...(input.parsers?.pdf ?? {}),
      },
      docx: {
        ...defaultConfig.parsers.docx,
        ...(input.parsers?.docx ?? {}),
      },
      ocr: {
        ...defaultConfig.parsers.ocr,
        ...(input.parsers?.ocr ?? {}),
      },
    }),
    anythingllm: {
      ...defaultConfig.anythingllm,
      ...(input.anythingllm ?? {}),
      enabled: input.anythingllm?.enabled === true,
      baseUrl: normalizeBaseUrl(input.anythingllm?.baseUrl ?? defaultConfig.anythingllm.baseUrl),
      desktopExePath: normalizeOptionalPath(input.anythingllm?.desktopExePath),
    },
    mcp: {
      ...defaultConfig.mcp,
      ...(input.mcp ?? {}),
      allowWrites: input.mcp?.allowWrites === true,
    },
  };
}

function mergeConfig(base: AppConfig, input: Partial<AppConfig> = {}) {
  return normalizeConfig({
    embedding: {
      ...base.embedding,
      ...(input.embedding ?? {}),
    },
    chunking: {
      ...base.chunking,
      ...(input.chunking ?? {}),
    },
    parsers: {
      ...base.parsers,
      ...(input.parsers ?? {}),
      pdf: {
        ...base.parsers.pdf,
        ...(input.parsers?.pdf ?? {}),
      },
      docx: {
        ...base.parsers.docx,
        ...(input.parsers?.docx ?? {}),
      },
      ocr: {
        ...base.parsers.ocr,
        ...(input.parsers?.ocr ?? {}),
      },
    },
    anythingllm: {
      ...base.anythingllm,
      ...(input.anythingllm ?? {}),
    },
    mcp: {
      ...base.mcp,
      ...(input.mcp ?? {}),
    },
  });
}

function configsEqual(left: AppConfig, right: AppConfig) {
  return JSON.stringify(normalizeConfig(left)) === JSON.stringify(normalizeConfig(right));
}

function normalizeMetric(input: unknown): Metric {
  return input === "cosine" || input === "dot" || input === "l2" ? input : "l2";
}

function normalizeEmbeddingProvider(input: unknown, fallback: EmbeddingProviderType): EmbeddingProviderType {
  return input === "openai-compatible" || input === "local-hash" ? input : fallback;
}

function normalizeCollectionRecord(input: Partial<CollectionRecord>, defaultSnapshot: AppConfig): CollectionRecord {
  const config = normalizeConfig(input.config ?? defaultSnapshot);
  const id = input.id || uuidv4();
  const timestamp = input.updatedAt || input.createdAt || nowIso();
  return {
    id,
    name: input.name?.trim() || "Untitled collection",
    slug: input.slug?.trim() || slugify(input.name || id),
    description: input.description?.trim() ?? "",
    tableName: input.tableName || tableNameForCollectionId(id),
    dimension: Math.min(4096, Math.max(32, Number(input.dimension ?? config.embedding.dimension) || config.embedding.dimension)),
    metric: normalizeMetric(input.metric),
    embeddingProvider: normalizeEmbeddingProvider(input.embeddingProvider, config.embedding.provider),
    embeddingModel: input.embeddingModel?.trim() || config.embedding.model,
    createdAt: input.createdAt || timestamp,
    updatedAt: timestamp,
    documentCount: Math.max(0, Number(input.documentCount ?? 0) || 0),
    chunkCount: Math.max(0, Number(input.chunkCount ?? 0) || 0),
    config,
  };
}

function normalizeManifest(input: Partial<Manifest>, defaultSnapshot: AppConfig): Manifest {
  const collections = Array.isArray(input.collections)
    ? input.collections.map((collection) => normalizeCollectionRecord(collection, defaultSnapshot))
    : [];
  return {
    version: input.version || appVersion,
    activeCollectionSlug: input.activeCollectionSlug || collections[0]?.slug || "",
    collections,
  };
}

async function reconcileManifestCounts(manifest: Manifest) {
  let dirty = false;
  const timestamp = nowIso();
  for (const collection of manifest.collections) {
    const docs = await loadDocuments(collection.slug);
    const documentCount = docs.length;
    const chunkCount = docs.reduce((sum, doc) => sum + doc.chunkCount, 0);
    if (collection.documentCount !== documentCount || collection.chunkCount !== chunkCount) {
      collection.documentCount = documentCount;
      collection.chunkCount = chunkCount;
      collection.updatedAt = timestamp;
      dirty = true;
    }
  }
  return dirty;
}

function collectionEmbeddingMatchesIndex(collection: CollectionRecord, config = collection.config) {
  return collection.embeddingProvider === config.embedding.provider
    && collection.embeddingModel === config.embedding.model
    && collection.dimension === config.embedding.dimension;
}

function syncCollectionEmbeddingIndex(collection: CollectionRecord, config = collection.config) {
  collection.embeddingProvider = config.embedding.provider;
  collection.embeddingModel = config.embedding.model;
  collection.dimension = config.embedding.dimension;
}

async function loadConfig() {
  await ensureDirs();
  if (!(await fileExists(configPath)) && !(await fileExists(jsonBackupPath(configPath)))) {
    await saveConfig(defaultConfig);
    return defaultConfig;
  }
  const parsed = await readJsonFileWithBackup<Partial<AppConfig>>(configPath, "app config");
  return normalizeConfig(parsed);
}

async function saveConfig(config: AppConfig) {
  await ensureDirs();
  await writeJsonAtomic(configPath, normalizeConfig(config));
}

async function loadManifest(): Promise<Manifest> {
  await ensureDirs();
  const defaultSnapshot = await loadConfig();
  if (!(await fileExists(manifestPath)) && !(await fileExists(jsonBackupPath(manifestPath)))) {
    const initial: Manifest = {
      version: appVersion,
      activeCollectionSlug: "",
      collections: [],
    };
    await saveManifest(initial);
    return initial;
  }
  const parsed = await readJsonFileWithBackup<Partial<Manifest>>(manifestPath, "collection manifest");
  const manifest = normalizeManifest(parsed, defaultSnapshot);
  const needsConfigBackfill = Array.isArray(parsed.collections) && parsed.collections.some((collection) => !collection.config);
  const countsReconciled = await reconcileManifestCounts(manifest);
  if (needsConfigBackfill || countsReconciled) await saveManifest(manifest);
  return manifest;
}

async function saveManifest(manifest: Manifest) {
  await ensureDirs();
  const normalized = normalizeManifest({ ...manifest, version: appVersion }, await loadConfig());
  await writeJsonAtomic(manifestPath, normalized);
}

function documentsPath(slug: string) {
  return path.join(dataDir, `${slug}.documents.json`);
}

function extractedTextPath(slug: string, documentId: string) {
  return path.join(extractedDir, slug, `${documentId}.txt`);
}

function uniqueStrings(input: unknown) {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const values: string[] = [];
  for (const item of input) {
    if (typeof item !== "string" || !item.trim() || seen.has(item)) continue;
    seen.add(item);
    values.push(item);
  }
  return values;
}

function unknownRecord(input: unknown): Record<string, unknown> | null {
  return typeof input === "object" && input !== null && !Array.isArray(input) ? input as Record<string, unknown> : null;
}

function normalizeAnythingSync(input: unknown): AnythingSyncState | undefined {
  const record = unknownRecord(input);
  if (!record || !Array.isArray(record.chunks)) return undefined;
  const chunks: AnythingSyncChunk[] = [];
  for (const item of record.chunks) {
    const chunk = unknownRecord(item);
    if (!chunk) continue;
    const syncKey = typeof chunk.syncKey === "string" ? chunk.syncKey : "";
    const location = typeof chunk.location === "string" ? chunk.location : "";
    const chunkId = typeof chunk.chunkId === "string" ? chunk.chunkId : "";
    const chunkIndex = Number(chunk.chunkIndex);
    const textHash = typeof chunk.textHash === "string" ? chunk.textHash : "";
    const baseUrl = typeof chunk.baseUrl === "string" ? normalizeBaseUrl(chunk.baseUrl) : "";
    const workspaceSlug = typeof chunk.workspaceSlug === "string" ? chunk.workspaceSlug : "";
    const uploadedAt = typeof chunk.uploadedAt === "string" ? chunk.uploadedAt : "";
    if (!syncKey || !location || !Number.isFinite(chunkIndex)) continue;
    chunks.push({
      syncKey,
      location,
      chunkId,
      chunkIndex,
      textHash,
      baseUrl,
      workspaceSlug,
      uploadedAt,
      ...(typeof chunk.embeddedAt === "string" && chunk.embeddedAt ? { embeddedAt: chunk.embeddedAt } : {}),
      ...(typeof chunk.title === "string" && chunk.title ? { title: chunk.title } : {}),
      ...(typeof chunk.sourceName === "string" && chunk.sourceName ? { sourceName: chunk.sourceName } : {}),
      ...(chunk.cleanupPending === true ? { cleanupPending: true } : {}),
      ...(typeof chunk.cleanupError === "string" && chunk.cleanupError ? { cleanupError: chunk.cleanupError } : {}),
      ...(typeof chunk.cleanupLastAttemptAt === "string" && chunk.cleanupLastAttemptAt ? { cleanupLastAttemptAt: chunk.cleanupLastAttemptAt } : {}),
    });
  }
  return {
    version: 1,
    ...(typeof record.updatedAt === "string" && record.updatedAt ? { updatedAt: record.updatedAt } : {}),
    chunks,
  };
}

function normalizeDocumentRecord(slug: string, input: Partial<DocumentRecord>): DocumentRecord {
  const timestamp = input.updatedAt || input.createdAt || nowIso();
  const anythingSync = normalizeAnythingSync(input.anythingSync);
  return {
    id: input.id || uuidv4(),
    collectionSlug: input.collectionSlug || slug,
    name: input.name || "Untitled document",
    sourcePath: input.sourcePath || input.name || "Untitled document",
    mime: input.mime || "text/plain",
    sizeBytes: Number(input.sizeBytes ?? input.extractedTextBytes ?? input.originalSizeBytes ?? 0) || 0,
    chunkCount: Number(input.chunkCount ?? 0) || 0,
    status: input.status || "indexed",
    error: input.error,
    createdAt: input.createdAt || timestamp,
    updatedAt: timestamp,
    metadata: input.metadata ?? {},
    anythingLocations: uniqueStrings(input.anythingLocations),
    anythingSync,
    contentHash: input.contentHash,
    parserType: input.parserType,
    parserVersion: input.parserVersion,
    extractionStatus: input.extractionStatus || input.status || "indexed",
    extractedTextPath: input.extractedTextPath,
    pageCount: input.pageCount,
    ocrEngine: input.ocrEngine,
    ocrLanguage: input.ocrLanguage,
    ocrConfidence: input.ocrConfidence,
    warnings: Array.isArray(input.warnings) ? input.warnings : [],
    processingStartedAt: input.processingStartedAt,
    processingFinishedAt: input.processingFinishedAt,
    jobId: input.jobId,
    originalName: input.originalName,
    originalSizeBytes: input.originalSizeBytes,
    extractedTextBytes: input.extractedTextBytes,
    duplicateOf: input.duplicateOf,
  };
}

async function loadDocuments(slug: string): Promise<DocumentRecord[]> {
  const target = documentsPath(slug);
  if (!(await fileExists(target)) && !(await fileExists(jsonBackupPath(target)))) return [];
  const parsed = await readJsonFileWithBackup<Array<Partial<DocumentRecord>>>(target, `${slug} documents`);
  return Array.isArray(parsed) ? parsed.map((item) => normalizeDocumentRecord(slug, item)) : [];
}

async function saveDocuments(slug: string, docs: DocumentRecord[]) {
  await writeJsonAtomic(documentsPath(slug), docs);
}

async function getDb() {
  await ensureDirs();
  return lancedb.connect(lanceDir);
}

async function getCollection(slug: string) {
  const manifest = await loadManifest();
  const collection = manifest.collections.find((item) => item.slug === slug);
  if (!collection) throw Object.assign(new Error(`Collection not found: ${slug}`), { statusCode: 404 });
  return { manifest, collection };
}

async function collectionHasIndexedChunks(collection: CollectionRecord) {
  if (collection.chunkCount > 0) return true;
  const documents = await loadDocuments(collection.slug);
  if (documents.some((document) => document.chunkCount > 0)) return true;
  const db = await getDb();
  if (!(await db.tableNames()).includes(collection.tableName)) return false;
  const table = await db.openTable(collection.tableName);
  const rows = await table.query().select(["id"]).limit(1).toArray();
  return rows.length > 0;
}

async function dropCollectionTableIfExists(collection: CollectionRecord) {
  const db = await getDb();
  if ((await db.tableNames()).includes(collection.tableName)) {
    await db.dropTable(collection.tableName);
  }
}

async function getCollectionConfigStatus(collection: CollectionRecord, currentDefault: AppConfig): Promise<CollectionConfigStatus> {
  const hasChunks = await collectionHasIndexedChunks(collection);
  const embeddingMatchesIndex = collectionEmbeddingMatchesIndex(collection);
  const usesDefaultSnapshot = configsEqual(collection.config, currentDefault);
  return {
    usesDefaultSnapshot,
    isCustomized: !usesDefaultSnapshot,
    embeddingChangedRequiresRebuild: hasChunks && !embeddingMatchesIndex,
    embeddingMatchesIndex,
    canUpdateEmbeddingIndex: !hasChunks,
    chunkCount: collection.chunkCount,
    indexedEmbedding: {
      provider: collection.embeddingProvider,
      model: collection.embeddingModel,
      dimension: collection.dimension,
    },
    configEmbedding: {
      provider: collection.config.embedding.provider,
      model: collection.config.embedding.model,
      dimension: collection.config.embedding.dimension,
    },
  };
}

async function setCollectionConfig(collectionSlug: string, nextConfig: AppConfig) {
  const { manifest, collection } = await getCollection(collectionSlug);
  collection.config = normalizeConfig(nextConfig);
  if (!collectionEmbeddingMatchesIndex(collection) && !(await collectionHasIndexedChunks(collection))) {
    await dropCollectionTableIfExists(collection);
    syncCollectionEmbeddingIndex(collection);
  }
  collection.updatedAt = nowIso();
  await saveManifest(manifest);
  const currentDefault = await loadConfig();
  return {
    collection: publicCollection(collection),
    config: collection.config,
    defaultConfig: currentDefault,
    configStatus: await getCollectionConfigStatus(collection, currentDefault),
  };
}

function summarizeText(text: string, length = 220) {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > length ? `${compact.slice(0, length)}...` : compact;
}

function splitText(text: string, targetChars: number, overlapChars: number) {
  const clean = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];
  const blocks = clean.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const block of blocks.length ? blocks : [clean]) {
    if ((current + "\n\n" + block).length > targetChars && current.length > 0) {
      chunks.push(current.trim());
      const overlap = current.slice(Math.max(0, current.length - overlapChars));
      current = overlap ? `${overlap}\n\n${block}` : block;
    } else {
      current = current ? `${current}\n\n${block}` : block;
    }
    while (current.length > targetChars * 1.8) {
      chunks.push(current.slice(0, targetChars).trim());
      current = current.slice(Math.max(0, targetChars - overlapChars));
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

type PreparedChunk = {
  text: string;
  pageNumber?: number;
  sectionTitle?: string;
  extractor?: string;
  confidence?: number | null;
};

function splitExtractedPages(pages: ExtractionPage[] | undefined, fallbackText: string, targetChars: number, overlapChars: number): PreparedChunk[] {
  const sourcePages = pages?.length ? pages : [{ text: fallbackText, extractor: "text" }];
  const chunks: PreparedChunk[] = [];
  for (const page of sourcePages) {
    const pageChunks = splitText(page.text, targetChars, overlapChars);
    for (const chunk of pageChunks) {
      chunks.push({
        text: chunk,
        pageNumber: page.pageNumber,
        sectionTitle: page.sectionTitle,
        extractor: page.extractor,
        confidence: page.confidence,
      });
    }
  }
  return chunks;
}

function fnv1a(input: string) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function localHashEmbedding(text: string, dimension: number) {
  const vector = new Array<number>(dimension).fill(0);
  const normalized = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const tokens = normalized ? normalized.split(/\s+/) : [text.slice(0, 64)];
  for (const token of tokens) {
    const parts = token.length > 4 ? [token, ...Array.from({ length: Math.max(0, token.length - 2) }, (_, index) => token.slice(index, index + 3))] : [token];
    for (const part of parts) {
      const hash = fnv1a(part);
      const index = hash % dimension;
      const sign = hash & 1 ? 1 : -1;
      vector[index] += sign * Math.min(2, Math.sqrt(part.length));
    }
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / norm);
}

function embeddingRequestTimeoutMs() {
  const configured = Number(process.env.VECTOR_FORGE_EMBEDDING_TIMEOUT_MS ?? 30_000);
  if (!Number.isFinite(configured) || configured <= 0) return 30_000;
  return Math.min(120_000, Math.max(100, Math.trunc(configured)));
}

function isFiniteNumberVector(input: unknown): input is number[] {
  return Array.isArray(input) && input.every((value) => typeof value === "number" && Number.isFinite(value));
}

async function embedWithOpenAICompatible(config: AppConfig, texts: string[]) {
  if (!config.embedding.apiKey.trim()) throw new Error("OpenAI-compatible embedding provider requires an API key.");
  const timeoutMs = embeddingRequestTimeoutMs();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: globalThis.Response;
  try {
    response = await fetch(config.embedding.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.embedding.apiKey}`,
      },
      body: JSON.stringify({ model: config.embedding.model, input: texts }),
      signal: controller.signal,
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && (error as { name?: string }).name === "AbortError") {
      throw Object.assign(new Error(`Embedding provider timed out after ${timeoutMs}ms.`), { statusCode: 504 });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  const body = await response.text();
  if (!response.ok) throw Object.assign(new Error(`Embedding provider returned ${response.status}: ${body || response.statusText}`), { statusCode: 502 });
  let parsed: { data?: Array<{ embedding?: unknown }> };
  try {
    parsed = JSON.parse(body) as { data?: Array<{ embedding?: unknown }> };
  } catch {
    throw Object.assign(new Error("Embedding provider returned invalid JSON."), { statusCode: 502 });
  }
  const vectors = parsed.data?.map((item) => item.embedding).filter(isFiniteNumberVector);
  if (!vectors || vectors.length !== texts.length) throw Object.assign(new Error("Embedding provider returned an unexpected response shape."), { statusCode: 502 });
  const mismatch = vectors.find((vector) => vector.length !== config.embedding.dimension);
  if (mismatch) {
    throw Object.assign(new Error(`Embedding dimension mismatch. Config expects ${config.embedding.dimension}, provider returned ${mismatch.length}.`), { statusCode: 400 });
  }
  return vectors;
}

async function embedTexts(config: AppConfig, texts: string[]) {
  if (config.embedding.provider === "local-hash") {
    return texts.map((text) => localHashEmbedding(text, config.embedding.dimension));
  }
  const batches: number[][] = [];
  for (let offset = 0; offset < texts.length; offset += config.embedding.batchSize) {
    const batch = texts.slice(offset, offset + config.embedding.batchSize);
    batches.push(...(await embedWithOpenAICompatible(config, batch)));
  }
  return batches;
}

async function upsertRows(collection: CollectionRecord, rows: VectorRow[]) {
  if (!rows.length) return;
  const db = await getDb();
  const tableNames = await db.tableNames();
  const tableExists = tableNames.includes(collection.tableName);
  if (!tableExists) {
    await db.createTable(collection.tableName, rows, { mode: "create", existOk: true });
    return;
  }
  const table = await db.openTable(collection.tableName);
  const docIds = Array.from(new Set(rows.map((row) => row.documentId)));
  if (docIds.length) await table.delete(`documentId IN (${docIds.map(sqlString).join(",")})`);
  await table.add(rows);
}

type IngestInput = {
  documentId?: string;
  name: string;
  text: string;
  pages?: ExtractionPage[];
  sourcePath?: string;
  mime?: string;
  metadata?: Record<string, string | number | boolean>;
  originalName?: string;
  originalSizeBytes?: number;
  extractedTextBytes?: number;
  contentHash?: string;
  parserType?: ParserType;
  parserVersion?: string;
  extractedTextPath?: string;
  pageCount?: number;
  ocrEngine?: string;
  ocrLanguage?: string;
  ocrConfidence?: number | null;
  warnings?: string[];
  jobId?: string;
  processingStartedAt?: string;
};

async function ingestText(collectionSlug: string, input: IngestInput) {
  const { manifest, collection } = await getCollection(collectionSlug);
  const config = collection.config;
  const chunks = splitExtractedPages(input.pages, input.text, config.chunking.targetChars, config.chunking.overlapChars);
  if (!chunks.length) throw Object.assign(new Error("No indexable text was found."), { statusCode: 400 });
  const vectors = await embedTexts(config, chunks.map((chunk) => chunk.text));
  for (const vector of vectors) {
    if (vector.length !== collection.dimension) {
      throw Object.assign(new Error(`Embedding dimension mismatch. Collection uses ${collection.dimension}, provider returned ${vector.length}.`), { statusCode: 400 });
    }
  }
  const documentId = input.documentId ?? uuidv4();
  const timestamp = nowIso();
  const metadataBase = input.metadata ?? {};
  const rows: VectorRow[] = chunks.map((chunk, index) => ({
    id: uuidv4(),
    collectionSlug,
    documentId,
    chunkIndex: index,
    title: input.name,
    text: chunk.text,
    sourceName: input.name,
    sourcePath: input.sourcePath ?? input.name,
    mime: input.mime ?? "text/plain",
    metadataJson: JSON.stringify({
      ...metadataBase,
      parserType: input.parserType ?? metadataBase.parserType,
      pageNumber: chunk.pageNumber ?? "",
      sectionTitle: chunk.sectionTitle ?? "",
      extractor: chunk.extractor ?? input.parserType ?? "",
      confidence: typeof chunk.confidence === "number" ? chunk.confidence : "",
    }),
    createdAt: timestamp,
    vector: vectors[index],
  }));
  const artifactPath = input.extractedTextPath ?? extractedTextPath(collectionSlug, documentId);
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${input.text}\n`, "utf8");
  await upsertRows(collection, rows);
  const docs = (await loadDocuments(collectionSlug)).filter((doc) => doc.id !== documentId);
  const record: DocumentRecord = {
    id: documentId,
    collectionSlug,
    name: input.name,
    sourcePath: input.sourcePath ?? input.name,
    mime: input.mime ?? "text/plain",
    sizeBytes: input.originalSizeBytes ?? Buffer.byteLength(input.text, "utf8"),
    chunkCount: chunks.length,
    status: "indexed",
    createdAt: timestamp,
    updatedAt: timestamp,
    metadata: metadataBase,
    anythingLocations: [],
    contentHash: input.contentHash,
    parserType: input.parserType ?? "text",
    parserVersion: input.parserVersion,
    extractionStatus: "indexed",
    extractedTextPath: artifactPath,
    pageCount: input.pageCount,
    ocrEngine: input.ocrEngine,
    ocrLanguage: input.ocrLanguage,
    ocrConfidence: input.ocrConfidence,
    warnings: input.warnings ?? [],
    processingStartedAt: input.processingStartedAt ?? timestamp,
    processingFinishedAt: timestamp,
    jobId: input.jobId,
    originalName: input.originalName ?? input.name,
    originalSizeBytes: input.originalSizeBytes,
    extractedTextBytes: input.extractedTextBytes ?? Buffer.byteLength(input.text, "utf8"),
  };
  docs.push(record);
  await saveDocuments(collectionSlug, docs);
  collection.documentCount = docs.length;
  collection.chunkCount = docs.reduce((sum, doc) => sum + doc.chunkCount, 0);
  collection.updatedAt = timestamp;
  await saveManifest(manifest);
  return { document: record, chunks: rows.length };
}

async function listCollections() {
  const manifest = await loadManifest();
  return manifest.collections.map(publicCollection);
}

async function createCollection(input: { name: string; slug?: string; description?: string; metric?: Metric }) {
  const config = await loadConfig();
  const manifest = await loadManifest();
  const baseSlug = slugify(input.slug || input.name);
  let slug = baseSlug;
  let suffix = 2;
  while (manifest.collections.some((item) => item.slug === slug)) {
    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }
  const id = uuidv4();
  const timestamp = nowIso();
  const collection: CollectionRecord = {
    id,
    name: input.name.trim(),
    slug,
    description: input.description?.trim() ?? "",
    tableName: tableNameForCollectionId(id),
    dimension: config.embedding.dimension,
    metric: input.metric ?? "l2",
    embeddingProvider: config.embedding.provider,
    embeddingModel: config.embedding.model,
    createdAt: timestamp,
    updatedAt: timestamp,
    documentCount: 0,
    chunkCount: 0,
    config: normalizeConfig(config),
  };
  manifest.collections.push(collection);
  if (!manifest.activeCollectionSlug) manifest.activeCollectionSlug = slug;
  await saveManifest(manifest);
  await saveDocuments(slug, []);
  return collection;
}

async function deleteCollection(slug: string, confirmSlug: string) {
  if (slug !== confirmSlug) throw Object.assign(new Error("confirmSlug must match the collection slug."), { statusCode: 400 });
  const manifest = await loadManifest();
  const collection = manifest.collections.find((item) => item.slug === slug);
  if (!collection) throw Object.assign(new Error(`Collection not found: ${slug}`), { statusCode: 404 });
  const docs = await loadDocuments(slug);
  const cleanupIntent = await prepareAnythingCleanupIntents({
    source: "collection-delete",
    collection,
    config: collection.config,
    documents: docs,
  });
  const db = await getDb();
  const tableNames = await db.tableNames();
  if (tableNames.includes(collection.tableName)) await db.dropTable(collection.tableName);
  const docsPath = documentsPath(slug);
  if (isPathInside(dataDir, docsPath)) await rm(docsPath, { force: true });
  const collectionUploadDir = path.join(uploadsDir, slug);
  if (isPathInside(uploadsDir, collectionUploadDir)) await rm(collectionUploadDir, { recursive: true, force: true });
  const collectionExtractedDir = path.join(extractedDir, slug);
  if (isPathInside(extractedDir, collectionExtractedDir)) await rm(collectionExtractedDir, { recursive: true, force: true });
  const nextCollections = manifest.collections.filter((item) => item.slug !== slug);
  await saveManifest({
    ...manifest,
    collections: nextCollections,
    activeCollectionSlug: manifest.activeCollectionSlug === slug ? nextCollections[0]?.slug ?? "" : manifest.activeCollectionSlug,
  });
  await activateAnythingCleanupIntents(cleanupIntent.ids);
  const anythingCleanup = await drainAnythingCleanupQueue({ ids: cleanupIntent.ids });
  return { deleted: slug, anythingCleanup };
}

async function getDocumentChunks(collection: CollectionRecord, documentId: string) {
  const db = await getDb();
  if (!(await db.tableNames()).includes(collection.tableName)) return [];
  const table = await db.openTable(collection.tableName);
  const chunks = (await table
    .query()
    .where(`documentId = ${sqlString(documentId)}`)
    .select(["id", "chunkIndex", "title", "text", "sourceName", "sourcePath", "mime", "metadataJson", "createdAt"])
    .limit(5000)
    .toArray()) as Array<Omit<VectorRow, "vector" | "collectionSlug" | "documentId">>;
  return chunks.map((chunk) => {
    const metadata = safeJson(chunk.metadataJson);
    return {
      ...chunk,
      metadata,
      pageNumber: optionalNumber(metadata.pageNumber),
      sectionTitle: optionalString(metadata.sectionTitle),
      extractor: optionalString(metadata.extractor),
      confidence: optionalNumber(metadata.confidence),
    };
  });
}

async function removeManagedSourceCopyIfUnused(targetDoc: DocumentRecord, remainingDocs: DocumentRecord[]) {
  if (!targetDoc.sourcePath || !isPathInside(uploadsDir, targetDoc.sourcePath)) return false;
  const targetPath = path.resolve(targetDoc.sourcePath);
  const stillReferenced = remainingDocs.some((doc) => doc.id !== targetDoc.id && path.resolve(doc.sourcePath) === targetPath);
  if (stillReferenced) return false;
  await rm(targetPath, { force: true }).catch(() => undefined);
  return true;
}

async function deleteDocument(collectionSlug: string, documentId: string) {
  const { manifest, collection } = await getCollection(collectionSlug);
  const docs = await loadDocuments(collectionSlug);
  const targetDoc = docs.find((doc) => doc.id === documentId);
  if (!targetDoc) throw Object.assign(new Error(`Document not found: ${documentId}`), { statusCode: 404 });
  const cleanupIntent = await prepareAnythingCleanupIntents({
    source: "document-delete",
    collection,
    config: collection.config,
    documents: targetDoc,
  });
  const db = await getDb();
  if ((await db.tableNames()).includes(collection.tableName)) {
    const table = await db.openTable(collection.tableName);
    await table.delete(`documentId = ${sqlString(documentId)}`);
  }
  if (targetDoc?.extractedTextPath && isPathInside(extractedDir, targetDoc.extractedTextPath)) {
    await rm(targetDoc.extractedTextPath, { force: true }).catch(() => undefined);
  }
  const nextDocs = docs.filter((doc) => doc.id !== documentId);
  await removeManagedSourceCopyIfUnused(targetDoc, nextDocs);
  await saveDocuments(collectionSlug, nextDocs);
  collection.documentCount = nextDocs.length;
  collection.chunkCount = nextDocs.reduce((sum, doc) => sum + doc.chunkCount, 0);
  collection.updatedAt = nowIso();
  await saveManifest(manifest);
  await activateAnythingCleanupIntents(cleanupIntent.ids);
  const anythingCleanup = await drainAnythingCleanupQueue({ ids: cleanupIntent.ids });
  return { deleted: documentId, anythingCleanup };
}

async function preserveAnythingSyncForRetry(collectionSlug: string, documentId: string, previousDocument: DocumentRecord, warning: string) {
  const { manifest, collection } = await getCollection(collectionSlug);
  const docs = await loadDocuments(collectionSlug);
  const attemptAt = nowIso();
  const nextDocs = docs.map((doc) => {
    if (doc.id !== documentId) return doc;
    const previousChunks = (previousDocument.anythingSync?.chunks ?? []).map((chunk) => ({
      ...chunk,
      cleanupPending: true,
      cleanupError: warning,
      cleanupLastAttemptAt: attemptAt,
    }));
    const existingChunks = doc.anythingSync?.chunks ?? [];
    const chunksByKey = new Map<string, AnythingSyncChunk>();
    for (const chunk of [...previousChunks, ...existingChunks]) {
      chunksByKey.set(`${chunk.baseUrl}|${chunk.workspaceSlug}|${chunk.location}|${chunk.syncKey}`, chunk);
    }
    const locations = new Set([...doc.anythingLocations, ...previousChunks.map((chunk) => chunk.location)].filter(Boolean));
    const warnings = Array.from(new Set([...(doc.warnings ?? []), warning]));
    return {
      ...doc,
      anythingLocations: Array.from(locations),
      anythingSync: previousChunks.length || existingChunks.length
        ? { version: 1 as const, updatedAt: attemptAt, chunks: Array.from(chunksByKey.values()) }
        : doc.anythingSync,
      warnings,
      updatedAt: attemptAt,
    };
  });
  await saveDocuments(collectionSlug, nextDocs);
  collection.updatedAt = nowIso();
  await saveManifest(manifest);
  return nextDocs.find((doc) => doc.id === documentId);
}

function withoutAnythingCleanupWarnings(warnings: string[] = []) {
  return warnings.filter((warning) => !warning.startsWith("AnythingLLM cleanup"));
}

async function retryDocumentAnythingCleanup(collectionSlug: string, documentId: string) {
  const { manifest, collection } = await getCollection(collectionSlug);
  const docs = await loadDocuments(collectionSlug);
  const target = docs.find((doc) => doc.id === documentId);
  if (!target) throw Object.assign(new Error(`Document not found: ${documentId}`), { statusCode: 404 });
  const pendingChunks = target.anythingSync?.chunks.filter((chunk) => chunk.cleanupPending) ?? [];
  if (!pendingChunks.length) {
    return {
      ok: true,
      pending: 0,
      anythingCleanup: { deleted: 0, skipped: 0, workspaces: [] } satisfies AnythingCleanupSummary,
      document: target,
    };
  }

  let cleanup: AnythingCleanupSummary;
  try {
    const queuedCleanup = await drainAnythingCleanupQueue({ collectionSlug, documentId });
    cleanup = queuedCleanup.queued ? queuedCleanup : await cleanupAnythingLLMSyncLocations(collection.config, target, { onlyCleanupPending: true });
    if ((cleanup.failed ?? 0) > 0) {
      throw new Error(`AnythingLLM cleanup retry failed for ${cleanup.failed} queued cleanup entr${cleanup.failed === 1 ? "y" : "ies"}.`);
    }
  } catch (error) {
    const message = `AnythingLLM cleanup retry failed: ${error instanceof Error ? error.message : String(error)}`;
    const attemptedAt = nowIso();
    for (const chunk of pendingChunks) {
      chunk.cleanupError = message;
      chunk.cleanupLastAttemptAt = attemptedAt;
    }
    target.warnings = Array.from(new Set([...withoutAnythingCleanupWarnings(target.warnings), message]));
    target.updatedAt = attemptedAt;
    if (target.anythingSync) target.anythingSync.updatedAt = attemptedAt;
    await saveDocuments(collectionSlug, docs);
    collection.updatedAt = attemptedAt;
    await saveManifest(manifest);
    throw error;
  }

  const attemptedAt = nowIso();
  if (cleanup.skipped > 0) {
    const message = `AnythingLLM cleanup skipped ${cleanup.skipped} synced chunks; check the saved AnythingLLM base URL and workspace.`;
    for (const chunk of pendingChunks) {
      chunk.cleanupError = message;
      chunk.cleanupLastAttemptAt = attemptedAt;
    }
    target.warnings = Array.from(new Set([...withoutAnythingCleanupWarnings(target.warnings), message]));
    target.updatedAt = attemptedAt;
    if (target.anythingSync) target.anythingSync.updatedAt = attemptedAt;
    await saveDocuments(collectionSlug, docs);
    collection.updatedAt = attemptedAt;
    await saveManifest(manifest);
    return { ok: false, pending: pendingChunks.length, anythingCleanup: cleanup, document: target };
  }

  const pendingKeySet = new Set(pendingChunks.map((chunk) => `${chunk.baseUrl}|${chunk.workspaceSlug}|${chunk.location}|${chunk.syncKey}`));
  const remainingChunks = (target.anythingSync?.chunks ?? []).filter((chunk) => !pendingKeySet.has(`${chunk.baseUrl}|${chunk.workspaceSlug}|${chunk.location}|${chunk.syncKey}`));
  target.anythingSync = remainingChunks.length ? { version: 1, updatedAt: attemptedAt, chunks: remainingChunks } : undefined;
  target.anythingLocations = remainingChunks.map((chunk) => chunk.location).filter(Boolean);
  target.warnings = withoutAnythingCleanupWarnings(target.warnings);
  target.updatedAt = attemptedAt;
  await saveDocuments(collectionSlug, docs);
  collection.updatedAt = attemptedAt;
  await saveManifest(manifest);
  return { ok: true, pending: 0, anythingCleanup: cleanup, document: target };
}

async function searchCollection(collectionSlug: string, query: string, topK: number) {
  const { collection } = await getCollection(collectionSlug);
  const config = collection.config;
  const db = await getDb();
  if (!(await db.tableNames()).includes(collection.tableName)) return [];
  const [vector] = await embedTexts(config, [query]);
  if (vector.length !== collection.dimension) {
    throw Object.assign(new Error(`Embedding dimension mismatch. Collection uses ${collection.dimension}, provider returned ${vector.length}.`), { statusCode: 400 });
  }
  const table = await db.openTable(collection.tableName);
  const rows = (await table
    .vectorSearch(vector)
    .limit(Math.min(50, Math.max(1, topK)))
    .select(["id", "documentId", "chunkIndex", "title", "text", "sourceName", "sourcePath", "mime", "metadataJson", "createdAt", "_distance"])
    .toArray()) as Array<VectorRow & { _distance?: number }>;
  return rows.map((row) => {
    const metadata = safeJson(row.metadataJson);
    return {
      ...row,
      metadata,
      pageNumber: optionalNumber(metadata.pageNumber),
      sectionTitle: optionalString(metadata.sectionTitle),
      extractor: optionalString(metadata.extractor),
      confidence: optionalNumber(metadata.confidence),
      preview: summarizeText(row.text),
      score: typeof row._distance === "number" ? 1 / (1 + row._distance) : null,
    };
  });
}

function safeJson(value: string) {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function optionalNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

type ProcessingJob = {
  id: string;
  kind: "upload" | "reprocess";
  collectionSlug: string;
  documentId?: string;
  fileName: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  phase: "queued" | "extracting" | "ocr" | "chunking" | "embedding" | "indexed" | "failed" | "cancelled";
  progress: number;
  message: string;
  createdAt: string;
  updatedAt: string;
  cancelRequested: boolean;
  result?: Record<string, unknown>;
  error?: string;
};

type StoredFileInput = {
  collectionSlug: string;
  storedPath: string;
  originalName: string;
  mime?: string;
  jobId: string;
  kind: ProcessingJob["kind"];
  documentId?: string;
};

const maxBatchDocumentIds = 100;
const batchDocumentIdsSchema = z.object({
  documentIds: z.array(z.string().trim().min(1)).min(1).max(maxBatchDocumentIds),
}).strict();

const jobs = new Map<string, ProcessingJob>();
const pendingJobRuns: Array<() => Promise<void>> = [];
let activeJobRuns = 0;
const maxConcurrentProcessingJobs = 1;

function createJob(input: Pick<ProcessingJob, "kind" | "collectionSlug" | "fileName"> & { documentId?: string }) {
  const timestamp = nowIso();
  const job: ProcessingJob = {
    id: uuidv4(),
    kind: input.kind,
    collectionSlug: input.collectionSlug,
    documentId: input.documentId,
    fileName: input.fileName,
    status: "queued",
    phase: "queued",
    progress: 0,
    message: "等待处理",
    createdAt: timestamp,
    updatedAt: timestamp,
    cancelRequested: false,
  };
  jobs.set(job.id, job);
  return job;
}

function updateJob(jobId: string, patch: Partial<ProcessingJob>) {
  const current = jobs.get(jobId);
  if (!current) return null;
  const next = { ...current, ...patch, updatedAt: nowIso() };
  jobs.set(jobId, next);
  return next;
}

function getJobOrThrow(jobId: string) {
  const job = jobs.get(jobId);
  if (!job) throw Object.assign(new Error(`Job not found: ${jobId}`), { statusCode: 404 });
  return job;
}

function parseBatchDocumentIds(input: unknown) {
  const parsed = batchDocumentIdsSchema.safeParse(input ?? {});
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
      .join("; ");
    throw Object.assign(new Error(message || "Invalid documentIds."), { statusCode: 400 });
  }
  const seen = new Set<string>();
  for (const documentId of parsed.data.documentIds) {
    if (seen.has(documentId)) {
      throw Object.assign(new Error(`Duplicate documentId: ${documentId}`), { statusCode: 400 });
    }
    seen.add(documentId);
  }
  return parsed.data.documentIds;
}

function documentNotFoundError(documentId: string) {
  return Object.assign(new Error(`Document not found: ${documentId}`), { statusCode: 404 });
}

function statusCodeForError(error: unknown) {
  if (typeof error === "object" && error !== null && typeof (error as { statusCode?: unknown }).statusCode === "number") {
    return (error as { statusCode: number }).statusCode;
  }
  return 500;
}

function messageForError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function batchFailure(documentId: string, error: unknown) {
  return {
    documentId,
    ok: false as const,
    error: messageForError(error),
    statusCode: statusCodeForError(error),
  };
}

function batchResponse<T extends { ok: boolean }>(results: T[]) {
  const succeeded = results.filter((result) => result.ok).length;
  const failed = results.length - succeeded;
  return {
    ok: failed === 0,
    requested: results.length,
    succeeded,
    failed,
    results,
  };
}

function enqueueProcessingJob(run: () => Promise<void>) {
  pendingJobRuns.push(run);
  void drainProcessingQueue();
}

async function drainProcessingQueue() {
  if (activeJobRuns >= maxConcurrentProcessingJobs) return;
  const run = pendingJobRuns.shift();
  if (!run) return;
  activeJobRuns += 1;
  try {
    await run();
  } finally {
    activeJobRuns -= 1;
    void drainProcessingQueue();
  }
}

function sanitizeStoredFileName(name: string) {
  return Array.from(name)
    .map((char) => (char.charCodeAt(0) < 32 ? "_" : char))
    .join("")
    .replace(/[<>:"/\\|?*]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140) || "upload.bin";
}

function isWindowsNetworkOrDevicePath(input: string) {
  if (process.platform !== "win32") return false;
  const normalized = input.replace(/\//g, "\\");
  return normalized.startsWith("\\\\");
}

function assertAbsoluteLocalPath(input: string) {
  const trimmed = input.trim();
  if (trimmed.includes("\0")) {
    throw Object.assign(new Error("Path contains an invalid null byte."), { statusCode: 400 });
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    throw Object.assign(new Error("Path must be a local filesystem path, not a URL."), { statusCode: 400 });
  }
  if (!trimmed || !path.isAbsolute(trimmed)) {
    throw Object.assign(new Error("Path must be an absolute local filesystem path."), { statusCode: 400 });
  }
  if (isWindowsNetworkOrDevicePath(trimmed) || isWindowsNetworkOrDevicePath(path.resolve(trimmed))) {
    throw Object.assign(new Error("UNC, network, and Windows device namespace paths are not allowed for local directory import."), { statusCode: 400 });
  }
  const resolved = path.resolve(trimmed);
  return resolved;
}

function pathKey(input: string) {
  const resolved = path.resolve(input);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

async function canonicalLocalPath(input: string) {
  const resolved = assertAbsoluteLocalPath(input);
  try {
    const canonical = await realpath(resolved);
    if (isWindowsNetworkOrDevicePath(canonical)) {
      throw Object.assign(new Error("UNC, network, and Windows device namespace paths are not allowed for local directory import."), { statusCode: 400 });
    }
    return canonical;
  } catch (error) {
    if (error instanceof Error && "statusCode" in error) throw error;
    throw Object.assign(new Error(`Path does not exist or cannot be resolved: ${path.basename(resolved)}`), { statusCode: 400 });
  }
}

function pruneDirectoryScanSessions(now = Date.now()) {
  for (const [id, session] of directoryScanSessions) {
    if (session.expiresAt <= now) directoryScanSessions.delete(id);
  }
}

function rememberDirectoryScanSession(collectionSlug: string, input: {
  directoryPath: string;
  recursive: boolean;
  candidates: DirectoryScanCandidate[];
}) {
  pruneDirectoryScanSessions();
  const id = uuidv4();
  const expiresAt = Date.now() + directoryScanSessionTtlMs;
  directoryScanSessions.set(id, {
    id,
    collectionSlug,
    rootPath: input.directoryPath,
    recursive: input.recursive,
    createdAt: nowIso(),
    expiresAt,
    candidates: input.candidates,
    candidatePathKeys: new Set(input.candidates.map((candidate) => pathKey(candidate.path))),
  });
  return { scanId: id, expiresAt: new Date(expiresAt).toISOString() };
}

function getDirectoryScanSession(collectionSlug: string, scanId: string) {
  pruneDirectoryScanSessions();
  const session = directoryScanSessions.get(scanId);
  if (!session) {
    throw Object.assign(new Error("Directory scan has expired. Scan the directory again before importing."), { statusCode: 400 });
  }
  if (session.collectionSlug !== collectionSlug) {
    throw Object.assign(new Error("Directory scan belongs to a different knowledge base."), { statusCode: 400 });
  }
  return session;
}

async function assertPathBelongsToScan(session: DirectoryScanSession, sourcePath: string) {
  const resolved = await canonicalLocalPath(sourcePath);
  if (!isPathInside(session.rootPath, resolved)) {
    throw Object.assign(new Error(`Path is outside the scanned directory: ${path.basename(resolved)}`), { statusCode: 400 });
  }
  if (!session.candidatePathKeys.has(pathKey(resolved))) {
    throw Object.assign(new Error(`Path is not part of the current directory scan: ${path.basename(resolved)}`), { statusCode: 400 });
  }
  return resolved;
}

function extensionForFile(filePath: string) {
  return path.extname(filePath).toLowerCase();
}

function isSupportedImportFile(filePath: string) {
  return supportedImportExtensions.has(extensionForFile(filePath));
}

function mimeForFile(filePath: string) {
  return mimeLookup(filePath) || "application/octet-stream";
}

async function hashSmallFile(filePath: string, sizeBytes: number) {
  if (sizeBytes > 8 * 1024 * 1024) return undefined;
  return hashBuffer(await readFile(filePath));
}

async function storeUploadedFile(slug: string, file: Express.Multer.File) {
  const collectionUploadDir = path.join(uploadsDir, slug);
  await mkdir(collectionUploadDir, { recursive: true });
  const storedPath = path.join(collectionUploadDir, `${uuidv4()}-${sanitizeStoredFileName(file.originalname)}`);
  await copyFile(file.path, storedPath);
  await rm(file.path, { force: true });
  return storedPath;
}

async function storeLocalSourceFile(slug: string, sourcePath: string, scanSession: DirectoryScanSession) {
  const resolved = await assertPathBelongsToScan(scanSession, sourcePath);
  const item = await stat(resolved);
  if (!item.isFile()) {
    throw Object.assign(new Error("Only files can be imported from a scanned directory."), { statusCode: 400 });
  }
  if (!isSupportedImportFile(resolved)) {
    throw Object.assign(new Error(`Unsupported file type: ${path.basename(resolved)}`), { statusCode: 400 });
  }
  const collectionUploadDir = path.join(uploadsDir, slug);
  await mkdir(collectionUploadDir, { recursive: true });
  const storedPath = path.join(collectionUploadDir, `${uuidv4()}-${sanitizeStoredFileName(path.basename(resolved))}`);
  await copyFile(resolved, storedPath);
  return {
    storedPath,
    sourcePath: resolved,
    originalName: path.basename(resolved),
    mime: mimeForFile(resolved),
    sizeBytes: item.size,
  };
}

async function scanDirectoryForCandidates(input: { directoryPath: string; recursive: boolean; maxFiles: number }) {
  const rootPath = await canonicalLocalPath(input.directoryPath);
  const rootStat = await stat(rootPath);
  if (!rootStat.isDirectory()) {
    throw Object.assign(new Error("Directory path must point to an existing directory."), { statusCode: 400 });
  }

  const maxFiles = Math.max(1, Math.min(500, input.maxFiles));
  const candidates: DirectoryScanCandidate[] = [];
  let scanned = 0;
  let truncated = false;
  const pending = [rootPath];

  while (pending.length) {
    const currentDir = pending.shift()!;
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (input.recursive) {
          const canonicalDir = await canonicalLocalPath(entryPath).catch(() => "");
          if (canonicalDir && isPathInside(rootPath, canonicalDir)) pending.push(canonicalDir);
        }
        continue;
      }
      if (!entry.isFile()) continue;
      scanned += 1;
      if (!isSupportedImportFile(entryPath)) continue;
      const candidatePath = await canonicalLocalPath(entryPath);
      if (!isPathInside(rootPath, candidatePath)) continue;
      const item = await stat(candidatePath);
      if (!item.isFile()) continue;
      candidates.push({
        id: uuidv4(),
        path: candidatePath,
        name: path.basename(candidatePath),
        extension: extensionForFile(candidatePath),
        mime: mimeForFile(candidatePath),
        sizeBytes: item.size,
        modifiedAt: item.mtime.toISOString(),
        contentHash: await hashSmallFile(candidatePath, item.size),
      });
      if (candidates.length >= maxFiles) {
        truncated = true;
        pending.length = 0;
        break;
      }
    }
  }

  return { directoryPath: rootPath, recursive: input.recursive, maxFiles, scanned, truncated, candidates };
}

async function processStoredFile(input: StoredFileInput) {
  const job = getJobOrThrow(input.jobId);
  if (job.cancelRequested) throw Object.assign(new Error("任务已取消。"), { statusCode: 499 });
  const startedAt = nowIso();
  let preparedAnythingCleanupIds: string[] = [];
  let reprocessReplacementCommitted = false;
  updateJob(input.jobId, { status: "running", phase: "extracting", progress: 0.05, message: "开始解析文件" });
  try {
    const { collection } = await getCollection(input.collectionSlug);
    const config = collection.config;
    const extracted = await extractDocument({
      filePath: input.storedPath,
      originalName: input.originalName,
      mime: input.mime,
      config: config.parsers,
      shouldCancel: () => Boolean(jobs.get(input.jobId)?.cancelRequested),
      onProgress(progress) {
        updateJob(input.jobId, {
          phase: progress.phase === "done" ? "chunking" : progress.phase,
          progress: Math.max(0.05, Math.min(0.86, progress.progress)),
          message: progress.message || "处理中",
        });
      },
    });
    if (!extracted.text.trim()) throw new Error("解析完成，但没有可入库文本。");

    const existingDocs = await loadDocuments(input.collectionSlug);
    const duplicates = existingDocs.filter((doc) => doc.contentHash && doc.contentHash === extracted.contentHash && doc.id !== input.documentId);
    if (duplicates.length && config.parsers.duplicateStrategy === "skip" && input.kind !== "reprocess") {
      const duplicate = duplicates[0];
      updateJob(input.jobId, {
        status: "succeeded",
        phase: "indexed",
        progress: 1,
        message: `检测到重复文件，已跳过：${duplicate?.name ?? duplicate?.id}`,
        result: { ok: true, skipped: true, duplicateOf: duplicate?.id, file: input.originalName, chunks: 0 },
      });
      return { ok: true, skipped: true, duplicateOf: duplicate?.id, file: input.originalName, chunks: 0, jobId: input.jobId };
    }
    if (duplicates.length && config.parsers.duplicateStrategy === "replace") {
      for (const duplicate of duplicates) {
        await deleteDocument(input.collectionSlug, duplicate.id);
      }
    }

    const documentId = input.documentId ?? uuidv4();
    const previousReprocessDocument = input.kind === "reprocess" && input.documentId
      ? existingDocs.find((doc) => doc.id === input.documentId)
      : undefined;
    if (previousReprocessDocument?.anythingSync?.chunks.length) {
      const cleanupIntent = await prepareAnythingCleanupIntents({
        source: "reprocess",
        collection,
        config,
        documents: previousReprocessDocument,
      });
      preparedAnythingCleanupIds = cleanupIntent.ids;
    }
    const artifactPath = extractedTextPath(input.collectionSlug, documentId);
    updateJob(input.jobId, { phase: "embedding", progress: 0.9, message: "切片并写入 LanceDB" });
    const result = await ingestText(input.collectionSlug, {
      documentId,
      name: input.originalName,
      text: extracted.text,
      pages: extracted.pages,
      sourcePath: input.storedPath,
      mime: extracted.mime,
      metadata: {
        parserType: extracted.parserType,
        parserVersion: extracted.parserVersion,
        contentHash: extracted.contentHash,
        ocrEngine: extracted.ocrEngine ?? "",
        ocrLanguage: extracted.ocrLanguage ?? "",
      },
      originalName: input.originalName,
      originalSizeBytes: extracted.originalSizeBytes,
      extractedTextBytes: extracted.extractedTextBytes,
      contentHash: extracted.contentHash,
      parserType: extracted.parserType,
      parserVersion: extracted.parserVersion,
      extractedTextPath: artifactPath,
      pageCount: extracted.pageCount,
      ocrEngine: extracted.ocrEngine,
      ocrLanguage: extracted.ocrLanguage,
      ocrConfidence: extracted.ocrConfidence,
      warnings: extracted.warnings,
      jobId: input.jobId,
      processingStartedAt: startedAt,
    });
    reprocessReplacementCommitted = Boolean(previousReprocessDocument?.anythingSync?.chunks.length);
    let indexedDocument = result.document;
    let anythingCleanup: AnythingCleanupSummary | undefined;
    let anythingCleanupWarning = "";
    if (previousReprocessDocument?.anythingSync?.chunks.length) {
      await activateAnythingCleanupIntents(preparedAnythingCleanupIds);
      anythingCleanup = await drainAnythingCleanupQueue({ ids: preparedAnythingCleanupIds });
      if (anythingCleanup.skipped > 0 || (anythingCleanup.failed ?? 0) > 0 || (anythingCleanup.pending ?? 0) > 0) {
        const cleanupReason = anythingCleanup.failed
          ? `failed for ${anythingCleanup.failed} queued cleanup entr${anythingCleanup.failed === 1 ? "y" : "ies"}`
          : `skipped ${anythingCleanup.skipped} old synced chunks`;
        anythingCleanupWarning = `AnythingLLM cleanup ${cleanupReason}; metadata was preserved for retry.`;
        indexedDocument = await preserveAnythingSyncForRetry(input.collectionSlug, documentId, previousReprocessDocument, anythingCleanupWarning) ?? indexedDocument;
      }
    }
    updateJob(input.jobId, {
      status: "succeeded",
      phase: "indexed",
      progress: 1,
      documentId: indexedDocument.id,
      message: anythingCleanupWarning ? "Indexed; AnythingLLM cleanup needs review." : "Indexed",
      result: {
        ok: true,
        file: input.originalName,
        chunks: result.chunks,
        document: indexedDocument,
        ...(anythingCleanup ? { anythingCleanup } : {}),
        ...(anythingCleanupWarning ? { anythingCleanupWarning } : {}),
      },
    });
    return {
      ok: true,
      file: input.originalName,
      chunks: result.chunks,
      document: indexedDocument,
      jobId: input.jobId,
      parserType: extracted.parserType,
      ...(anythingCleanup ? { anythingCleanup } : {}),
      ...(anythingCleanupWarning ? { anythingCleanupWarning } : {}),
    };
  } catch (error) {
    if (preparedAnythingCleanupIds.length && !reprocessReplacementCommitted) {
      await cancelAnythingCleanupIntents(preparedAnythingCleanupIds).catch(() => undefined);
    }
    const isCancelled = jobs.get(input.jobId)?.cancelRequested;
    const message = error instanceof Error ? error.message : String(error);
    if (isCancelled) {
      updateJob(input.jobId, {
        status: "cancelled",
        phase: "cancelled",
        progress: 1,
        message: "任务已取消",
        error: message,
      });
    } else if (input.kind === "reprocess" && input.documentId) {
      await markDocumentFailed(input.collectionSlug, input.documentId, message, input.jobId).catch(() => undefined);
      updateJob(input.jobId, {
        status: "failed",
        phase: "failed",
        progress: jobs.get(input.jobId)?.progress ?? 0,
        message: "处理失败",
        error: message,
        documentId: input.documentId,
      });
    } else {
      const failedDocument = await saveFailedDocument(input.collectionSlug, {
        documentId: input.documentId,
        name: input.originalName,
        sourcePath: input.storedPath,
        mime: input.mime || "application/octet-stream",
        error: message,
        jobId: input.jobId,
        processingStartedAt: startedAt,
      }).catch(() => undefined);
      updateJob(input.jobId, {
        status: "failed",
        phase: "failed",
        progress: jobs.get(input.jobId)?.progress ?? 0,
        message: "处理失败",
        error: message,
        ...(failedDocument?.id ? { documentId: failedDocument.id } : {}),
      });
    }
    throw error;
  }
}

async function createReprocessJob(collection: CollectionRecord, document: DocumentRecord) {
  if (!(await fileExists(document.sourcePath))) {
    throw Object.assign(new Error("Original uploaded file copy does not exist, cannot reprocess."), { statusCode: 400 });
  }
  const job = createJob({ kind: "reprocess", collectionSlug: collection.slug, fileName: document.originalName || document.name, documentId: document.id });
  enqueueProcessingJob(async () => {
    try {
      await processStoredFile({
        collectionSlug: collection.slug,
        storedPath: document.sourcePath,
        originalName: document.originalName || document.name,
        mime: document.mime,
        jobId: job.id,
        kind: "reprocess",
        documentId: document.id,
      });
    } catch {
      // Job state already records the error.
    }
  });
  return job;
}

async function markDocumentFailed(collectionSlug: string, documentId: string, error: string, jobId?: string) {
  const { manifest, collection } = await getCollection(collectionSlug);
  const docs = await loadDocuments(collectionSlug);
  const timestamp = nowIso();
  const nextDocs = docs.map((doc) =>
    doc.id === documentId
      ? {
          ...doc,
          status: "failed" as const,
          extractionStatus: "failed" as const,
          error,
          jobId,
          updatedAt: timestamp,
          processingFinishedAt: timestamp,
        }
      : doc,
  );
  await saveDocuments(collectionSlug, nextDocs);
  collection.documentCount = nextDocs.length;
  collection.chunkCount = nextDocs.reduce((sum, doc) => sum + doc.chunkCount, 0);
  collection.updatedAt = timestamp;
  await saveManifest(manifest);
}

async function saveFailedDocument(collectionSlug: string, input: { documentId?: string; name: string; sourcePath: string; mime: string; error: string; jobId?: string; processingStartedAt?: string }) {
  const { manifest, collection } = await getCollection(collectionSlug);
  const documentId = input.documentId ?? uuidv4();
  const timestamp = nowIso();
  const docs = (await loadDocuments(collectionSlug)).filter((doc) => doc.id !== documentId);
  const size = await stat(input.sourcePath).then((item) => item.size).catch(() => 0);
  const record: DocumentRecord = {
    id: documentId,
    collectionSlug,
    name: input.name,
    sourcePath: input.sourcePath,
    mime: input.mime,
    sizeBytes: size,
    chunkCount: 0,
    status: "failed",
    error: input.error,
    createdAt: timestamp,
    updatedAt: timestamp,
    metadata: {},
    anythingLocations: [],
    extractionStatus: "failed",
    warnings: [],
    processingStartedAt: input.processingStartedAt ?? timestamp,
    processingFinishedAt: timestamp,
    jobId: input.jobId,
    originalName: input.name,
    originalSizeBytes: size,
  };
  docs.push(record);
  await saveDocuments(collectionSlug, docs);
  collection.documentCount = docs.length;
  collection.chunkCount = docs.reduce((sum, doc) => sum + doc.chunkCount, 0);
  collection.updatedAt = timestamp;
  await saveManifest(manifest);
  return record;
}

class AnythingLLMClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(config: AppConfig["anythingllm"]) {
    this.baseUrl = normalizeBaseUrl(config.baseUrl);
    this.apiKey = config.apiKey;
  }

  private async request<T>(route: string, init: RequestInit = {}, timeoutMs = requestTimeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${route}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          ...(init.headers ?? {}),
        },
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        let message = text || response.statusText;
        try {
          const parsed = JSON.parse(text) as { error?: string; message?: string };
          message = parsed.error || parsed.message || message;
        } catch {
          // Keep raw response text.
        }
        throw new Error(`AnythingLLM ${response.status}: ${message}`);
      }
      if (!text.trim()) return {} as T;
      return JSON.parse(text) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  auth() {
    return this.request<{ authenticated: boolean }>("/v1/auth", {}, 8_000);
  }

  workspaces() {
    return this.request<{ workspaces: AnythingWorkspace[] }>("/v1/workspaces", {}, 8_000);
  }

  async ensureWorkspace(name: string, slug: string) {
    const list = await this.workspaces();
    const existing = list.workspaces.find((workspace) => workspace.slug === slug || workspace.name === name);
    if (existing) return existing;
    const created = await this.request<{ workspace: AnythingWorkspace }>("/v1/workspace/new", {
      method: "POST",
      body: JSON.stringify({
        name,
        similarityThreshold: 0.25,
        openAiTemp: 0.2,
        openAiHistory: 8,
        chatMode: "query",
        topN: 6,
      }),
    });
    return created.workspace;
  }

  uploadRawText(input: { title: string; text: string; metadata: Record<string, string | number | boolean> }) {
    return this.request<{ success: boolean; error: string | null; documents: Array<{ location: string; title: string }> }>("/v1/document/raw-text", {
      method: "POST",
      body: JSON.stringify({
        textContent: input.text,
        metadata: {
          title: input.title,
          docAuthor: "Vector Forge Lab",
          docSource: "vector-forge-lab",
          ...input.metadata,
        },
      }),
    });
  }

  updateEmbeddings(slug: string, adds: string[] = [], deletes: string[] = []) {
    return this.request<Record<string, unknown>>(`/v1/workspace/${encodeURIComponent(slug)}/update-embeddings`, {
      method: "POST",
      body: JSON.stringify({ adds, deletes }),
    });
  }
}

function hashAnythingText(text: string) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function buildAnythingSyncIdentity(collectionSlug: string, row: VectorRow) {
  const textHash = hashAnythingText(row.text);
  return {
    textHash,
    syncKey: `vf:${collectionSlug}:${row.documentId}:${row.chunkIndex}:${textHash.slice(0, 24)}`,
  };
}

function scalarMetadata(input: Record<string, unknown>) {
  const output: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      output[key] = value;
    }
  }
  return output;
}

function anythingMetadata(collection: CollectionRecord, row: VectorRow, syncKey: string, textHash: string) {
  return {
    ...scalarMetadata(safeJson(row.metadataJson)),
    collection: collection.slug,
    documentId: row.documentId,
    chunkId: row.id,
    chunkIndex: row.chunkIndex,
    sourceName: row.sourceName,
    sourcePath: row.sourcePath,
    mime: row.mime,
    vectorForgeCollectionSlug: collection.slug,
    vectorForgeDocumentId: row.documentId,
    vectorForgeChunkId: row.id,
    vectorForgeChunkIndex: row.chunkIndex,
    vectorForgeSyncKey: syncKey,
    vectorForgeTextHash: textHash,
  };
}

function getOrCreateAnythingSync(document: DocumentRecord) {
  if (!document.anythingSync) document.anythingSync = { version: 1, chunks: [] };
  return document.anythingSync;
}

function findAnythingSyncChunk(document: DocumentRecord, input: { syncKey: string; baseUrl: string; workspaceSlug: string }) {
  return document.anythingSync?.chunks.find((chunk) => (
    chunk.syncKey === input.syncKey
    && chunk.baseUrl === input.baseUrl
    && chunk.workspaceSlug === input.workspaceSlug
    && Boolean(chunk.location)
    && !chunk.cleanupPending
  ));
}

function upsertAnythingSyncChunk(document: DocumentRecord, entry: AnythingSyncChunk) {
  const state = getOrCreateAnythingSync(document);
  const existingIndex = state.chunks.findIndex((chunk) => (
    chunk.syncKey === entry.syncKey
    && chunk.baseUrl === entry.baseUrl
    && chunk.workspaceSlug === entry.workspaceSlug
  ));
  if (existingIndex >= 0) {
    state.chunks[existingIndex] = {
      ...state.chunks[existingIndex],
      ...entry,
    };
  } else {
    state.chunks.push(entry);
  }
  const locationSet = new Set(document.anythingLocations);
  locationSet.add(entry.location);
  document.anythingLocations = Array.from(locationSet);
  document.updatedAt = entry.uploadedAt;
  state.updatedAt = entry.uploadedAt;
  return state.chunks[existingIndex >= 0 ? existingIndex : state.chunks.length - 1];
}

function markAnythingSyncEmbedded(document: DocumentRecord, entry: AnythingSyncChunk, embeddedAt: string) {
  const state = getOrCreateAnythingSync(document);
  entry.embeddedAt = embeddedAt;
  state.updatedAt = embeddedAt;
  document.updatedAt = embeddedAt;
}

function defaultAnythingCleanupQueue(): AnythingCleanupQueueFile {
  return { version: 1, entries: [] };
}

function isAnythingCleanupQueueStatus(input: unknown): input is AnythingCleanupQueueStatus {
  return input === "prepared" || input === "pending";
}

function isAnythingCleanupSource(input: unknown): input is AnythingCleanupSource {
  return input === "document-delete" || input === "collection-delete" || input === "reprocess";
}

function normalizeAnythingCleanupActivationGuard(input: unknown): AnythingCleanupActivationGuard | undefined {
  const record = unknownRecord(input);
  if (!record || typeof record.kind !== "string") return undefined;
  if (record.kind === "document-deleted" && typeof record.documentId === "string" && record.documentId) {
    return { kind: "document-deleted", documentId: record.documentId };
  }
  if (record.kind === "collection-deleted" && typeof record.collectionSlug === "string" && record.collectionSlug) {
    return { kind: "collection-deleted", collectionSlug: record.collectionSlug };
  }
  if (record.kind === "document-replaced" && typeof record.documentId === "string" && record.documentId) {
    return { kind: "document-replaced", documentId: record.documentId, oldSyncKeys: uniqueStrings(record.oldSyncKeys) };
  }
  return undefined;
}

function normalizeAnythingCleanupQueue(input: unknown): AnythingCleanupQueueFile {
  const record = unknownRecord(input);
  if (!record || !Array.isArray(record.entries)) return defaultAnythingCleanupQueue();
  const entries: AnythingCleanupQueueEntry[] = [];
  for (const item of record.entries) {
    const entry = unknownRecord(item);
    if (!entry) continue;
    const guard = normalizeAnythingCleanupActivationGuard(entry.activationGuard);
    const id = typeof entry.id === "string" && entry.id ? entry.id : uuidv4();
    const status = isAnythingCleanupQueueStatus(entry.status) ? entry.status : "pending";
    const source = isAnythingCleanupSource(entry.source) ? entry.source : "document-delete";
    const collectionSlug = typeof entry.collectionSlug === "string" ? entry.collectionSlug : "";
    const baseUrl = typeof entry.baseUrl === "string" ? normalizeBaseUrl(entry.baseUrl) : "";
    const workspaceSlug = typeof entry.workspaceSlug === "string" ? entry.workspaceSlug : "";
    const locations = uniqueStrings(entry.locations);
    if (!collectionSlug || !baseUrl || !workspaceSlug || !locations.length || !guard) continue;
    const timestamp = typeof entry.updatedAt === "string" && entry.updatedAt ? entry.updatedAt : nowIso();
    entries.push({
      id,
      status,
      source,
      collectionSlug,
      ...(typeof entry.collectionId === "string" && entry.collectionId ? { collectionId: entry.collectionId } : {}),
      ...(typeof entry.documentId === "string" && entry.documentId ? { documentId: entry.documentId } : {}),
      ...(typeof entry.documentName === "string" && entry.documentName ? { documentName: entry.documentName } : {}),
      baseUrl,
      ...(typeof entry.apiKey === "string" && entry.apiKey ? { apiKey: entry.apiKey } : {}),
      workspaceSlug,
      locations,
      syncKeys: uniqueStrings(entry.syncKeys),
      createdAt: typeof entry.createdAt === "string" && entry.createdAt ? entry.createdAt : timestamp,
      updatedAt: timestamp,
      attempts: Math.max(0, Number(entry.attempts ?? 0) || 0),
      ...(typeof entry.lastAttemptAt === "string" && entry.lastAttemptAt ? { lastAttemptAt: entry.lastAttemptAt } : {}),
      ...(typeof entry.lastError === "string" && entry.lastError ? { lastError: entry.lastError } : {}),
      activationGuard: guard,
    });
  }
  return { version: 1, entries };
}

async function loadAnythingCleanupQueue() {
  await ensureDirs();
  if (!(await fileExists(anythingCleanupQueuePath)) && !(await fileExists(jsonBackupPath(anythingCleanupQueuePath)))) {
    return defaultAnythingCleanupQueue();
  }
  return normalizeAnythingCleanupQueue(await readJsonFileWithBackup<unknown>(anythingCleanupQueuePath, "AnythingLLM cleanup queue"));
}

async function saveAnythingCleanupQueue(queue: AnythingCleanupQueueFile) {
  await writeJsonAtomic(anythingCleanupQueuePath, normalizeAnythingCleanupQueue(queue));
}

function anythingCleanupEntryKey(entry: Pick<AnythingCleanupQueueEntry, "source" | "collectionSlug" | "documentId" | "baseUrl" | "workspaceSlug" | "syncKeys">) {
  return [
    entry.source,
    entry.collectionSlug,
    entry.documentId ?? "",
    entry.baseUrl,
    entry.workspaceSlug,
    [...entry.syncKeys].sort().join(","),
  ].join("|");
}

function publicAnythingCleanupEntry(entry: AnythingCleanupQueueEntry) {
  return {
    id: entry.id,
    status: entry.status,
    source: entry.source,
    collectionSlug: entry.collectionSlug,
    collectionId: entry.collectionId ?? "",
    documentId: entry.documentId ?? "",
    documentName: entry.documentName ?? "",
    baseUrl: entry.baseUrl,
    apiKeyConfigured: Boolean(entry.apiKey),
    workspaceSlug: entry.workspaceSlug,
    locations: entry.locations,
    syncKeys: entry.syncKeys,
    locationCount: entry.locations.length,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    attempts: entry.attempts,
    lastAttemptAt: entry.lastAttemptAt ?? "",
    lastError: entry.lastError ?? "",
    activationGuard: entry.activationGuard,
  };
}

async function getAnythingCleanupQueuePayload() {
  const queue = await reconcileAnythingCleanupQueue();
  return {
    version: queue.version,
    counts: {
      total: queue.entries.length,
      prepared: queue.entries.filter((entry) => entry.status === "prepared").length,
      pending: queue.entries.filter((entry) => entry.status === "pending").length,
    },
    entries: queue.entries.map(publicAnythingCleanupEntry),
  };
}

function addWorkspaceDeleted(summary: AnythingCleanupSummary, workspaceSlug: string, deleted: number) {
  const existing = summary.workspaces.find((workspace) => workspace.workspaceSlug === workspaceSlug);
  if (existing) existing.deleted += deleted;
  else summary.workspaces.push({ workspaceSlug, deleted });
}

function anythingConfigForCleanupEntry(entry: AnythingCleanupQueueEntry): AppConfig["anythingllm"] {
  return {
    enabled: true,
    baseUrl: entry.baseUrl,
    apiKey: entry.apiKey ?? "",
    workspaceName: "",
    workspaceSlug: entry.workspaceSlug,
    desktopExePath: "",
  };
}

function collectAnythingCleanupEntries(input: {
  source: AnythingCleanupSource;
  collection: CollectionRecord;
  config: AppConfig;
  documents: DocumentRecord | DocumentRecord[];
}): AnythingCleanupQueueEntry[] {
  const docs = Array.isArray(input.documents) ? input.documents : [input.documents];
  const currentBaseUrl = normalizeBaseUrl(input.config.anythingllm.baseUrl);
  const currentApiKey = input.config.anythingllm.apiKey.trim();
  const timestamp = nowIso();
  const groups = new Map<string, {
    baseUrl: string;
    workspaceSlug: string;
    locations: Set<string>;
    syncKeys: Set<string>;
    documentIds: Set<string>;
    documentNames: Set<string>;
  }>();

  for (const document of docs) {
    for (const chunk of document.anythingSync?.chunks ?? []) {
      const location = chunk.location.trim();
      const workspaceSlug = chunk.workspaceSlug.trim();
      const baseUrl = chunk.baseUrl ? normalizeBaseUrl(chunk.baseUrl) : "";
      if (!location || !workspaceSlug || !baseUrl) continue;
      const key = `${baseUrl}|${workspaceSlug}`;
      const group = groups.get(key) ?? {
        baseUrl,
        workspaceSlug,
        locations: new Set<string>(),
        syncKeys: new Set<string>(),
        documentIds: new Set<string>(),
        documentNames: new Set<string>(),
      };
      group.locations.add(location);
      if (chunk.syncKey) group.syncKeys.add(chunk.syncKey);
      group.documentIds.add(document.id);
      group.documentNames.add(document.name);
      groups.set(key, group);
    }
  }

  return Array.from(groups.values()).map((group) => {
    const documentIds = Array.from(group.documentIds);
    const documentNames = Array.from(group.documentNames);
    const syncKeys = Array.from(group.syncKeys);
    const documentId = documentIds.length === 1 ? documentIds[0] : undefined;
    const documentName = documentNames.length === 1 ? documentNames[0] : `${documentNames.length} documents`;
    const activationGuard: AnythingCleanupActivationGuard = input.source === "collection-delete"
      ? { kind: "collection-deleted", collectionSlug: input.collection.slug }
      : input.source === "reprocess" && documentId
        ? { kind: "document-replaced", documentId, oldSyncKeys: syncKeys }
        : { kind: "document-deleted", documentId: documentId ?? documentIds[0] ?? "" };
    return {
      id: uuidv4(),
      status: "prepared" as const,
      source: input.source,
      collectionSlug: input.collection.slug,
      collectionId: input.collection.id,
      ...(documentId ? { documentId } : {}),
      ...(documentName ? { documentName } : {}),
      baseUrl: group.baseUrl,
      ...(group.baseUrl === currentBaseUrl && currentApiKey ? { apiKey: currentApiKey } : {}),
      workspaceSlug: group.workspaceSlug,
      locations: Array.from(group.locations),
      syncKeys,
      createdAt: timestamp,
      updatedAt: timestamp,
      attempts: 0,
      activationGuard,
    };
  }).filter((entry) => {
    if (entry.activationGuard.kind === "document-deleted" && !entry.activationGuard.documentId) return false;
    return entry.locations.length > 0;
  });
}

async function prepareAnythingCleanupIntents(input: {
  source: AnythingCleanupSource;
  collection: CollectionRecord;
  config: AppConfig;
  documents: DocumentRecord | DocumentRecord[];
}) {
  const entries = collectAnythingCleanupEntries(input);
  if (!entries.length) return { ids: [] as string[], queued: 0 };
  const queue = await loadAnythingCleanupQueue();
  const ids: string[] = [];
  const byKey = new Map(queue.entries.map((entry) => [anythingCleanupEntryKey(entry), entry]));
  const timestamp = nowIso();
  for (const entry of entries) {
    const key = anythingCleanupEntryKey(entry);
    const existing = byKey.get(key);
    if (existing) {
      existing.locations = Array.from(new Set([...existing.locations, ...entry.locations]));
      existing.syncKeys = Array.from(new Set([...existing.syncKeys, ...entry.syncKeys]));
      existing.updatedAt = timestamp;
      existing.lastError = existing.lastError ?? entry.lastError;
      if (!existing.apiKey && entry.apiKey) existing.apiKey = entry.apiKey;
      ids.push(existing.id);
    } else {
      queue.entries.push(entry);
      byKey.set(key, entry);
      ids.push(entry.id);
    }
  }
  await saveAnythingCleanupQueue(queue);
  return { ids, queued: entries.length };
}

async function activateAnythingCleanupIntents(ids: string[]) {
  if (!ids.length) return;
  const idSet = new Set(ids);
  const queue = await loadAnythingCleanupQueue();
  const timestamp = nowIso();
  let dirty = false;
  for (const entry of queue.entries) {
    if (!idSet.has(entry.id) || entry.status !== "prepared") continue;
    entry.status = "pending";
    entry.updatedAt = timestamp;
    dirty = true;
  }
  if (dirty) await saveAnythingCleanupQueue(queue);
}

async function cancelAnythingCleanupIntents(ids: string[]) {
  if (!ids.length) return;
  const idSet = new Set(ids);
  const queue = await loadAnythingCleanupQueue();
  const nextEntries = queue.entries.filter((entry) => !(idSet.has(entry.id) && entry.status === "prepared"));
  if (nextEntries.length !== queue.entries.length) await saveAnythingCleanupQueue({ ...queue, entries: nextEntries });
}

async function shouldActivatePreparedCleanup(entry: AnythingCleanupQueueEntry) {
  const guard = entry.activationGuard;
  if (guard.kind === "collection-deleted") {
    const manifest = await loadManifest();
    return !manifest.collections.some((collection) => collection.slug === guard.collectionSlug);
  }
  const docs = await loadDocuments(entry.collectionSlug);
  if (guard.kind === "document-deleted") {
    return !docs.some((document) => document.id === guard.documentId);
  }
  const document = docs.find((item) => item.id === guard.documentId);
  if (!document) return true;
  const currentSyncKeys = new Set((document.anythingSync?.chunks ?? []).map((chunk) => chunk.syncKey));
  return guard.oldSyncKeys.some((syncKey) => syncKey && !currentSyncKeys.has(syncKey));
}

async function reconcileAnythingCleanupQueue() {
  const queue = await loadAnythingCleanupQueue();
  const timestamp = nowIso();
  let dirty = false;
  for (const entry of queue.entries) {
    if (entry.status !== "prepared") continue;
    if (await shouldActivatePreparedCleanup(entry)) {
      entry.status = "pending";
      entry.updatedAt = timestamp;
      dirty = true;
    }
  }
  if (dirty) await saveAnythingCleanupQueue(queue);
  return dirty ? await loadAnythingCleanupQueue() : queue;
}

function matchesAnythingCleanupDrainFilter(entry: AnythingCleanupQueueEntry, filter: { ids?: string[]; collectionSlug?: string; documentId?: string }) {
  if (filter.ids?.length && !filter.ids.includes(entry.id)) return false;
  if (filter.collectionSlug && entry.collectionSlug !== filter.collectionSlug) return false;
  if (filter.documentId && entry.documentId !== filter.documentId) return false;
  return true;
}

async function drainAnythingCleanupQueue(filter: { ids?: string[]; collectionSlug?: string; documentId?: string } = {}): Promise<AnythingCleanupSummary> {
  if (filter.ids && !filter.ids.length) {
    return { deleted: 0, skipped: 0, workspaces: [], queued: 0, pending: 0, failed: 0 };
  }
  const queue = await reconcileAnythingCleanupQueue();
  const selectedIds = new Set(queue.entries
    .filter((entry) => entry.status === "pending" && matchesAnythingCleanupDrainFilter(entry, filter))
    .map((entry) => entry.id));
  const summary: AnythingCleanupSummary = { deleted: 0, skipped: 0, workspaces: [], queued: selectedIds.size, pending: 0, failed: 0 };
  if (!selectedIds.size) return summary;
  const timestamp = nowIso();
  const nextEntries: AnythingCleanupQueueEntry[] = [];

  for (const entry of queue.entries) {
    if (!selectedIds.has(entry.id)) {
      nextEntries.push(entry);
      continue;
    }
    if (!entry.apiKey?.trim()) {
      entry.lastAttemptAt = timestamp;
      entry.lastError = "AnythingLLM cleanup is waiting for a matching API key for the saved base URL.";
      entry.updatedAt = timestamp;
      summary.skipped += entry.locations.length;
      summary.failed = (summary.failed ?? 0) + 1;
      nextEntries.push(entry);
      continue;
    }
    try {
      const client = new AnythingLLMClient(anythingConfigForCleanupEntry(entry));
      let entryDeleted = 0;
      for (let offset = 0; offset < entry.locations.length; offset += anythingCleanupBatchSize) {
        const batch = entry.locations.slice(offset, offset + anythingCleanupBatchSize);
        await client.updateEmbeddings(entry.workspaceSlug, [], batch);
        entryDeleted += batch.length;
      }
      summary.deleted += entryDeleted;
      addWorkspaceDeleted(summary, entry.workspaceSlug, entryDeleted);
    } catch (error) {
      entry.attempts += 1;
      entry.lastAttemptAt = timestamp;
      entry.lastError = error instanceof Error ? error.message : String(error);
      entry.updatedAt = timestamp;
      summary.failed = (summary.failed ?? 0) + 1;
      nextEntries.push(entry);
    }
  }

  summary.pending = nextEntries.filter((entry) => entry.status === "pending").length;
  await saveAnythingCleanupQueue({ version: 1, entries: nextEntries });
  return summary;
}

async function cleanupAnythingLLMSyncLocations(
  config: AppConfig,
  documents: DocumentRecord | DocumentRecord[],
  options: { onlyCleanupPending?: boolean } = {},
): Promise<AnythingCleanupSummary> {
  const docs = Array.isArray(documents) ? documents : [documents];
  const targetBaseUrl = normalizeBaseUrl(config.anythingllm.baseUrl);
  const byWorkspace = new Map<string, Set<string>>();
  let skipped = 0;

  for (const document of docs) {
    for (const chunk of document.anythingSync?.chunks ?? []) {
      if (options.onlyCleanupPending && !chunk.cleanupPending) continue;
      const location = chunk.location.trim();
      const workspaceSlug = chunk.workspaceSlug.trim();
      const baseUrl = chunk.baseUrl ? normalizeBaseUrl(chunk.baseUrl) : "";
      if (!location || !workspaceSlug || !baseUrl) {
        skipped += 1;
        continue;
      }
      if (baseUrl !== targetBaseUrl) {
        skipped += 1;
        continue;
      }
      const locations = byWorkspace.get(workspaceSlug) ?? new Set<string>();
      locations.add(location);
      byWorkspace.set(workspaceSlug, locations);
    }
  }

  if (!byWorkspace.size) return { deleted: 0, skipped, workspaces: [] };
  if (!config.anythingllm.enabled || !config.anythingllm.apiKey.trim()) {
    throw Object.assign(new Error("AnythingLLM cleanup requires the saved AnythingLLM integration to be enabled with an API key."), { statusCode: 400 });
  }

  const client = new AnythingLLMClient(config.anythingllm);
  const workspaces: AnythingCleanupSummary["workspaces"] = [];
  let deleted = 0;
  for (const [workspaceSlug, locations] of byWorkspace) {
    const deletes = Array.from(locations);
    let workspaceDeleted = 0;
    for (let offset = 0; offset < deletes.length; offset += anythingCleanupBatchSize) {
      const batch = deletes.slice(offset, offset + anythingCleanupBatchSize);
      await client.updateEmbeddings(workspaceSlug, [], batch);
      workspaceDeleted += batch.length;
    }
    deleted += workspaceDeleted;
    workspaces.push({ workspaceSlug, deleted: workspaceDeleted });
  }
  return { deleted, skipped, workspaces };
}

async function syncCollectionToAnythingLLM(collectionSlug: string, maxChunks: number) {
  const { collection } = await getCollection(collectionSlug);
  const config = collection.config;
  if (!config.anythingllm.enabled) throw Object.assign(new Error("AnythingLLM sync is disabled in config."), { statusCode: 400 });
  const db = await getDb();
  if (!(await db.tableNames()).includes(collection.tableName)) return { uploaded: 0, skipped: 0, embedded: 0 };
  const table = await db.openTable(collection.tableName);
  const rows = (await table
    .query()
    .select(["id", "documentId", "chunkIndex", "title", "text", "sourceName", "sourcePath", "mime", "metadataJson"])
    .limit(5000)
    .toArray()) as VectorRow[];
  const docs = await loadDocuments(collection.slug);
  const docsById = new Map(docs.map((document) => [document.id, document]));
  const client = new AnythingLLMClient(config.anythingllm);
  const workspace = await client.ensureWorkspace(config.anythingllm.workspaceName || collection.name, config.anythingllm.workspaceSlug || collection.slug);
  const target = {
    baseUrl: normalizeBaseUrl(config.anythingllm.baseUrl),
    workspaceSlug: workspace.slug,
  };
  const uploadLimit = Math.min(5000, Math.max(1, maxChunks));
  const embeddingTargets: Array<{ document: DocumentRecord; entry: AnythingSyncChunk }> = [];
  const embeddingLocations = new Set<string>();
  let uploaded = 0;
  let skipped = 0;
  let remaining = 0;
  let docsDirty = false;
  try {
    for (const row of rows) {
      const document = docsById.get(row.documentId);
      if (!document) {
        throw Object.assign(new Error(`Document record not found for AnythingLLM chunk: ${row.documentId}`), { statusCode: 409 });
      }
      const { syncKey, textHash } = buildAnythingSyncIdentity(collection.slug, row);
      const existing = findAnythingSyncChunk(document, { syncKey, ...target });
      if (existing) {
        skipped += 1;
        if (!existing.embeddedAt) {
          embeddingTargets.push({ document, entry: existing });
          embeddingLocations.add(existing.location);
        }
        continue;
      }
      if (uploaded >= uploadLimit) {
        remaining += 1;
        continue;
      }
      const title = `${row.title} #${row.chunkIndex + 1}`;
      const response = await client.uploadRawText({
        title,
        text: row.text,
        metadata: anythingMetadata(collection, row, syncKey, textHash),
      });
      const location = response.documents?.find((document) => document.location)?.location;
      if (!location) throw new Error(`AnythingLLM upload did not return a document location for chunk ${row.id}.`);
      const uploadedAt = nowIso();
      const entry = upsertAnythingSyncChunk(document, {
        syncKey,
        location,
        chunkId: row.id,
        chunkIndex: row.chunkIndex,
        textHash,
        baseUrl: target.baseUrl,
        workspaceSlug: target.workspaceSlug,
        uploadedAt,
        title,
        sourceName: row.sourceName,
      });
      embeddingTargets.push({ document, entry });
      embeddingLocations.add(location);
      uploaded += 1;
      docsDirty = true;
    }
  } catch (error) {
    if (docsDirty) await saveDocuments(collection.slug, docs);
    throw error;
  }
  if (docsDirty) await saveDocuments(collection.slug, docs);

  const locations = Array.from(embeddingLocations);
  let embedded = 0;
  if (locations.length) {
    await client.updateEmbeddings(workspace.slug, locations);
    embedded = embeddingTargets.length;
    const embeddedAt = nowIso();
    for (const { document, entry } of embeddingTargets) {
      markAnythingSyncEmbedded(document, entry, embeddedAt);
    }
    await saveDocuments(collection.slug, docs);
  }
  return { workspace, uploaded, skipped, embedded, remaining };
}

function asyncRoute(handler: (request: Request, response: Response) => Promise<void>) {
  return (request: Request, response: Response) => {
    handler(request, response).catch((error) => {
      if (error instanceof z.ZodError) {
        const message = error.issues
          .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
          .join("; ");
        response.status(400).json({ error: message || "Invalid request body." });
        return;
      }
      const statusCode = typeof error?.statusCode === "number" ? error.statusCode : 500;
      response.status(statusCode).json({ error: error instanceof Error ? error.message : String(error) });
    });
  };
}

const anythingEndpointConfigSchema = z.object({
  enabled: z.boolean().optional(),
  baseUrl: z.string().trim().min(1).optional(),
  apiKey: z.string().optional(),
  workspaceName: z.string().optional(),
  workspaceSlug: z.string().optional(),
  desktopExePath: z.string().optional(),
}).strict();

const anythingTestBodySchema = z.object({
  anythingllm: anythingEndpointConfigSchema.optional(),
  baseUrl: z.string().trim().min(1).optional(),
  apiKey: z.string().optional(),
  workspaceName: z.string().optional(),
  workspaceSlug: z.string().optional(),
  desktopExePath: z.string().optional(),
}).strict();

const anythingExePathBodySchema = z.object({
  exePath: z.union([z.string(), z.null()]).optional(),
  clear: z.boolean().optional(),
}).strict();

const anythingInstallerDownloadSchema = z.object({
  installerUrl: z.string().trim().min(1),
  fileName: z.string().optional(),
  dryRun: z.boolean().optional(),
}).strict();

const anythingDryRunBodySchema = z.object({
  dryRun: z.boolean().optional(),
}).strict();

const anythingLaunchInstallerSchema = z.object({
  fileName: z.string().optional(),
  dryRun: z.boolean().optional(),
}).strict();

const directoryScanBodySchema = z.object({
  directoryPath: z.string().trim().min(1),
  recursive: z.boolean().optional(),
  maxFiles: z.number().int().min(1).max(500).optional(),
}).strict();

const importPathsBodySchema = z.object({
  scanId: z.string().trim().min(1),
  paths: z.array(z.string().trim().min(1)).max(50).optional(),
  candidateIds: z.array(z.string().trim().min(1)).max(50).optional(),
}).strict().refine((body) => Boolean(body.paths?.length || body.candidateIds?.length), {
  message: "Select at least one scanned candidate to import.",
});

const cleanupQueueRetrySchema = z.object({
  ids: z.array(z.string().trim().min(1)).max(100).optional(),
}).strict();

const onboardingStepIdSchema = z.enum(["data", "collection", "embedding", "ocr", "anythingllm", "finish"]);
const onboardingTrackedStepIdSchema = z.enum(["data", "collection", "embedding", "ocr", "anythingllm"]);
const onboardingStepStatusSchema = z.enum(["pending", "complete", "skipped", "failed"]);
const onboardingStepPatchSchema = z.object({
  status: onboardingStepStatusSchema.optional(),
  lastError: z.string().max(500).nullable().optional(),
}).strict();
const onboardingPatchSchema = z.object({
  currentStep: onboardingStepIdSchema.optional(),
  dismissed: z.boolean().optional(),
  steps: z.partialRecord(onboardingTrackedStepIdSchema, onboardingStepPatchSchema).optional(),
  lastResults: z.record(z.string(), z.unknown()).optional(),
}).strict();

function mergeOnboardingPatch(current: OnboardingState, patch: z.infer<typeof onboardingPatchSchema>): OnboardingState {
  const timestamp = nowIso();
  const next = normalizeOnboardingState({
    ...current,
    updatedAt: timestamp,
    ...(patch.currentStep ? { currentStep: patch.currentStep } : {}),
    ...(patch.dismissed !== undefined
      ? {
          dismissed: patch.dismissed,
          dismissedAt: patch.dismissed ? timestamp : undefined,
        }
      : {}),
  });

  for (const stepId of onboardingTrackedSteps) {
    const stepPatch = patch.steps?.[stepId];
    if (!stepPatch) continue;
    next.steps[stepId] = {
      ...next.steps[stepId],
      ...(stepPatch.status ? { status: stepPatch.status } : {}),
      ...(stepPatch.lastError === null ? { lastError: undefined } : stepPatch.lastError ? { lastError: stepPatch.lastError } : {}),
      updatedAt: timestamp,
    };
  }

  const sanitizedResults = sanitizeOnboardingResults(patch.lastResults);
  if (sanitizedResults) {
    next.lastResults = {
      ...(next.lastResults ?? {}),
      ...sanitizedResults,
    };
  }
  return normalizeOnboardingState(next);
}

function configForAnythingEndpoint(base: AppConfig, body: z.infer<typeof anythingTestBodySchema>) {
  const inline = body.anythingllm ?? {};
  return mergeConfig(base, {
    anythingllm: {
      ...base.anythingllm,
      ...inline,
      ...(body.baseUrl !== undefined ? { baseUrl: body.baseUrl } : {}),
      ...(body.apiKey !== undefined ? { apiKey: body.apiKey } : {}),
      ...(body.workspaceName !== undefined ? { workspaceName: body.workspaceName } : {}),
      ...(body.workspaceSlug !== undefined ? { workspaceSlug: body.workspaceSlug } : {}),
      ...(body.desktopExePath !== undefined ? { desktopExePath: body.desktopExePath } : {}),
    },
  });
}

function resolveDirectoryImportSelection(collectionSlug: string, body: z.infer<typeof importPathsBodySchema>) {
  const session = getDirectoryScanSession(collectionSlug, body.scanId);
  const byId = new Map(session.candidates.map((candidate) => [candidate.id, candidate]));
  const byPath = new Map(session.candidates.map((candidate) => [pathKey(candidate.path), candidate]));
  const selected = new Map<string, DirectoryScanCandidate>();

  for (const candidateId of body.candidateIds ?? []) {
    const candidate = byId.get(candidateId);
    if (!candidate) {
      throw Object.assign(new Error(`Selected candidate is not part of the current directory scan: ${candidateId}`), { statusCode: 400 });
    }
    selected.set(pathKey(candidate.path), candidate);
  }

  for (const rawPath of body.paths ?? []) {
    const resolved = assertAbsoluteLocalPath(rawPath);
    const candidate = byPath.get(pathKey(resolved));
    if (!candidate) {
      throw Object.assign(new Error(`Path is not part of the current directory scan: ${path.basename(resolved)}`), { statusCode: 400 });
    }
    selected.set(pathKey(candidate.path), candidate);
  }

  if (!selected.size) {
    throw Object.assign(new Error("Select at least one scanned candidate to import."), { statusCode: 400 });
  }
  return { session, paths: Array.from(selected.values()).map((candidate) => candidate.path) };
}

app.get("/api/health", asyncRoute(async (_request, response) => {
  const db = await getDb();
  const config = await loadConfig();
  response.json({
    ok: true,
    appVersion,
    dataDir,
    lanceDir,
    tableNames: await db.tableNames(),
    config: publicConfig(config),
  });
}));

app.get("/api/ai/tools", asyncRoute(async (_request, response) => {
  response.json({
    mode: "dry-run-policy",
    execution: "no-tools-executed",
    tools: aiToolRegistry.map(publicAiTool),
  });
}));

app.post("/api/ai/tools/dry-run", asyncRoute(async (request, response) => {
  assertTrustedLocalActionRequest(request);
  const body = aiToolDryRunSchema.parse(request.body ?? {});
  const config = await loadConfig();
  const decision = evaluateAiToolDryRun(body, config);
  await appendAiToolAudit(decision, body, config);
  response.json({
    ...decision,
    tools: aiToolRegistry.filter((tool) => decision.matchedToolIds.includes(tool.id)).map(publicAiTool),
  });
}));

app.get("/api/ai/tools/audit", asyncRoute(async (request, response) => {
  assertTrustedLocalActionRequest(request);
  const limit = Math.max(1, Math.min(200, Number(request.query.limit ?? 20) || 20));
  response.json({ events: await readAiToolAudit(limit) });
}));

app.get("/api/onboarding", asyncRoute(async (_request, response) => {
  response.json(await getOnboardingPayload());
}));

app.patch("/api/onboarding", asyncRoute(async (request, response) => {
  const patch = onboardingPatchSchema.parse(request.body ?? {});
  const next = mergeOnboardingPatch(await loadOnboardingState(), patch);
  await saveOnboardingState(next);
  response.json(await getOnboardingPayload(next));
}));

app.post("/api/onboarding/complete", asyncRoute(async (_request, response) => {
  const timestamp = nowIso();
  const current = await loadOnboardingState();
  const steps = { ...current.steps };
  for (const stepId of onboardingTrackedSteps) {
    if (steps[stepId].status === "pending") steps[stepId] = { status: "complete", updatedAt: timestamp };
  }
  const next = normalizeOnboardingState({
    ...current,
    steps,
    completed: true,
    dismissed: true,
    currentStep: "finish",
    updatedAt: timestamp,
    completedAt: timestamp,
    dismissedAt: current.dismissedAt || timestamp,
  });
  await saveOnboardingState(next);
  response.json(await getOnboardingPayload(next));
}));

app.post("/api/onboarding/reset", asyncRoute(async (_request, response) => {
  const next = defaultOnboardingState();
  await saveOnboardingState(next);
  response.json(await getOnboardingPayload(next));
}));

app.get("/api/config", asyncRoute(async (_request, response) => {
  response.json(await loadConfig());
}));

app.put("/api/config", asyncRoute(async (request, response) => {
  const next = normalizeConfig(request.body ?? {});
  await saveConfig(next);
  response.json(next);
}));

app.post("/api/config/copy-from-collection/:slug", asyncRoute(async (request, response) => {
  const { collection } = await getCollection(String(request.params.slug));
  await saveConfig(collection.config);
  const currentDefault = await loadConfig();
  response.json({
    ok: true,
    collection: publicCollection(collection),
    config: currentDefault,
    defaultConfig: currentDefault,
    configStatus: await getCollectionConfigStatus(collection, currentDefault),
  });
}));

app.post("/api/test-embedding", asyncRoute(async (request, response) => {
  const config = mergeConfig(await loadConfig(), request.body ?? {});
  const [vector] = await embedTexts(config, ["Vector Forge Lab embedding test"]);
  response.json({ ok: true, provider: config.embedding.provider, model: config.embedding.model, dimension: vector.length, preview: vector.slice(0, 8) });
}));

app.post("/api/test-ocr", asyncRoute(async (request, response) => {
  const config = mergeConfig(await loadConfig(), request.body ?? {});
  response.json(await testOcr(config.parsers));
}));

app.post("/api/test-anythingllm", asyncRoute(async (request, response) => {
  const config = mergeConfig(await loadConfig(), request.body ?? {});
  const client = new AnythingLLMClient(config.anythingllm);
  response.json(await client.auth());
}));

app.get("/api/anythingllm/environment", asyncRoute(async (request, response) => {
  assertTrustedLocalActionRequest(request);
  response.json(await getAnythingEnvironment());
}));

app.put("/api/anythingllm/exe-path", asyncRoute(async (request, response) => {
  assertTrustedLocalActionRequest(request);
  const body = anythingExePathBodySchema.parse(request.body ?? {});
  const config = await loadConfig();
  const nextPath = body.clear || body.exePath === null ? "" : assertSafeDesktopExePath(body.exePath ?? "");
  if (nextPath) {
    const executable = await inspectAnythingExePath(nextPath);
    if (!executable.launchable) {
      throw Object.assign(new Error(executable.error || "AnythingLLM executable path is not launchable."), { statusCode: 400 });
    }
  }
  const nextConfig = mergeConfig(config, {
    anythingllm: {
      ...config.anythingllm,
      desktopExePath: nextPath,
    },
  });
  await saveConfig(nextConfig);
  response.json({
    ok: true,
    executable: await inspectAnythingExePath(nextConfig.anythingllm.desktopExePath),
    environment: await getAnythingEnvironment(nextConfig),
  });
}));

app.post("/api/anythingllm/test", asyncRoute(async (request, response) => {
  assertTrustedLocalActionRequest(request);
  const body = anythingTestBodySchema.parse(request.body ?? {});
  const config = configForAnythingEndpoint(await loadConfig(), body);
  const executable = await inspectAnythingExePath(config.anythingllm.desktopExePath);
  const api = {
    baseUrl: normalizeBaseUrl(config.anythingllm.baseUrl),
    apiKeyConfigured: Boolean(config.anythingllm.apiKey),
    authenticated: false,
    ok: false,
    error: "",
  };
  if (!config.anythingllm.apiKey) {
    api.error = "AnythingLLM API key is not configured.";
  } else {
    try {
      const auth = await new AnythingLLMClient(config.anythingllm).auth();
      api.authenticated = auth.authenticated === true;
      api.ok = api.authenticated;
      if (!api.ok) api.error = "AnythingLLM authentication failed.";
    } catch (error) {
      api.error = error instanceof Error ? error.message : String(error);
    }
  }
  response.json({
    ok: executable.launchable && api.ok,
    desktop: {
      ready: executable.launchable,
      executable,
    },
    api,
  });
}));

app.get("/api/anythingllm/workspaces", asyncRoute(async (request, response) => {
  assertTrustedLocalActionRequest(request);
  const config = await loadConfig();
  if (!config.anythingllm.apiKey) {
    throw Object.assign(new Error("AnythingLLM API key is not configured."), { statusCode: 400 });
  }
  const result = await new AnythingLLMClient(config.anythingllm).workspaces();
  response.json({
    ok: true,
    baseUrl: normalizeBaseUrl(config.anythingllm.baseUrl),
    apiKeyConfigured: true,
    workspaces: result.workspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
    })),
  });
}));

app.post("/api/anythingllm/workspaces", asyncRoute(async (request, response) => {
  assertTrustedLocalActionRequest(request);
  const body = anythingTestBodySchema.parse(request.body ?? {});
  const config = configForAnythingEndpoint(await loadConfig(), body);
  if (!config.anythingllm.apiKey) {
    throw Object.assign(new Error("AnythingLLM API key is not configured."), { statusCode: 400 });
  }
  const result = await new AnythingLLMClient(config.anythingllm).workspaces();
  response.json({
    ok: true,
    baseUrl: normalizeBaseUrl(config.anythingllm.baseUrl),
    apiKeyConfigured: true,
    workspaces: result.workspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
    })),
  });
}));

app.post("/api/anythingllm/download-installer", asyncRoute(async (request, response) => {
  assertTrustedLocalActionRequest(request);
  const body = anythingInstallerDownloadSchema.parse(request.body ?? {});
  const installerUrl = assertValidInstallerUrl(body.installerUrl);
  const fileName = body.fileName ? sanitizeInstallerFileName(body.fileName) : installerFileNameFromUrl(installerUrl);
  const dryRun = body.dryRun === true;
  const targetPath = dryRun ? installerPathForFileName(fileName) : await uniqueInstallerTargetPath(fileName);
  if (dryRun) {
    response.json({
      ok: true,
      dryRun: true,
      downloaded: false,
      source: { url: installerUrl.href },
      installer: { fileName: path.basename(targetPath), path: targetPath, folder: anythingInstallerDir },
      limits: { maxBytes: maxInstallerBytes, allowedHosts: Array.from(allowedInstallerHosts).sort() },
    });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);
  try {
    const download = await fetch(installerUrl, {
      headers: { "User-Agent": `VectorForgeLab/${appVersion}` },
      signal: controller.signal,
    });
    const finalUrl = assertValidInstallerUrl(download.url || installerUrl.href);
    if (!download.ok) {
      throw Object.assign(new Error(`Installer download failed with HTTP ${download.status}.`), { statusCode: 502 });
    }
    const contentLength = Number(download.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > maxInstallerBytes) {
      throw Object.assign(new Error("Installer download is larger than the allowed maximum."), { statusCode: 413 });
    }
    const buffer = Buffer.from(await download.arrayBuffer());
    if (buffer.byteLength > maxInstallerBytes) {
      throw Object.assign(new Error("Installer download is larger than the allowed maximum."), { statusCode: 413 });
    }
    await mkdir(anythingInstallerDir, { recursive: true });
    await writeFile(targetPath, buffer);
    response.json({
      ok: true,
      dryRun: false,
      downloaded: true,
      source: { url: installerUrl.href, finalUrl: finalUrl.href },
      installer: { fileName: path.basename(targetPath), path: targetPath, folder: anythingInstallerDir, bytes: buffer.byteLength },
    });
  } finally {
    clearTimeout(timeout);
  }
}));

app.post("/api/anythingllm/open-installer-folder", asyncRoute(async (request, response) => {
  assertTrustedLocalActionRequest(request);
  const body = anythingDryRunBodySchema.parse(request.body ?? {});
  const command = dryRunCommandForOpeningFolder(anythingInstallerDir);
  if (body.dryRun === true) {
    response.json({
      ok: true,
      dryRun: true,
      opened: false,
      folder: anythingInstallerDir,
      command,
    });
    return;
  }
  await mkdir(anythingInstallerDir, { recursive: true });
  const pid = await spawnDetached(command.command, command.args);
  response.json({
    ok: true,
    dryRun: false,
    opened: true,
    folder: anythingInstallerDir,
    pid,
  });
}));

app.post("/api/anythingllm/launch-installer", asyncRoute(async (request, response) => {
  assertTrustedLocalActionRequest(request);
  const body = anythingLaunchInstallerSchema.parse(request.body ?? {});
  const targetPath = body.fileName ? installerPathForFileName(body.fileName) : await newestInstallerPath();
  const dryRunTarget = targetPath || installerPathForFileName("AnythingLLM-Desktop-Installer.exe");
  const exists = await fileExists(dryRunTarget);
  const command = commandForInstaller(dryRunTarget);
  if (body.dryRun === true) {
    response.json({
      ok: true,
      dryRun: true,
      launched: false,
      installer: { path: dryRunTarget, fileName: path.basename(dryRunTarget), exists },
      command,
    });
    return;
  }
  if (!targetPath || !exists) {
    throw Object.assign(new Error("No downloaded AnythingLLM installer was found in the managed installer folder."), { statusCode: 404 });
  }
  const pid = await spawnDetached(command.command, command.args);
  response.json({
    ok: true,
    dryRun: false,
    launched: true,
    installer: { path: targetPath, fileName: path.basename(targetPath), exists: true },
    pid,
  });
}));

app.get("/api/anythingllm/cleanup-queue", asyncRoute(async (request, response) => {
  assertTrustedLocalActionRequest(request);
  response.json(await getAnythingCleanupQueuePayload());
}));

app.post("/api/anythingllm/cleanup-queue/retry", asyncRoute(async (request, response) => {
  assertTrustedLocalActionRequest(request);
  const body = cleanupQueueRetrySchema.parse(request.body ?? {});
  const anythingCleanup = await drainAnythingCleanupQueue({ ids: body.ids });
  response.json({ ok: (anythingCleanup.failed ?? 0) === 0, anythingCleanup, queue: await getAnythingCleanupQueuePayload() });
}));

app.get("/api/jobs", asyncRoute(async (request, response) => {
  const collectionSlug = typeof request.query.collectionSlug === "string" ? request.query.collectionSlug : "";
  const list = Array.from(jobs.values())
    .filter((job) => !collectionSlug || job.collectionSlug === collectionSlug)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 100);
  response.json({ jobs: list });
}));

app.get("/api/jobs/:jobId", asyncRoute(async (request, response) => {
  response.json({ job: getJobOrThrow(String(request.params.jobId)) });
}));

app.post("/api/jobs/:jobId/cancel", asyncRoute(async (request, response) => {
  const job = getJobOrThrow(String(request.params.jobId));
  const next = updateJob(job.id, {
    cancelRequested: true,
    ...(job.status === "queued" ? { status: "cancelled" as const, phase: "cancelled" as const, progress: 1, message: "任务已取消" } : {}),
  });
  response.json({ job: next });
}));

app.get("/api/collections", asyncRoute(async (_request, response) => {
  response.json({ collections: await listCollections(), activeCollectionSlug: (await loadManifest()).activeCollectionSlug });
}));

app.post("/api/collections", asyncRoute(async (request, response) => {
  const body = z.object({ name: z.string().min(1), slug: z.string().optional(), description: z.string().optional() }).parse(request.body ?? {});
  const collection = await createCollection(body);
  response.json({ collection: publicCollection(collection), collections: await listCollections() });
}));

app.get("/api/collections/:slug/config", asyncRoute(async (request, response) => {
  const currentDefault = await loadConfig();
  const { collection } = await getCollection(String(request.params.slug));
  response.json({
    collection: publicCollection(collection),
    config: collection.config,
    defaultConfig: currentDefault,
    configStatus: await getCollectionConfigStatus(collection, currentDefault),
  });
}));

app.put("/api/collections/:slug/config", asyncRoute(async (request, response) => {
  const { collection } = await getCollection(String(request.params.slug));
  response.json(await setCollectionConfig(collection.slug, mergeConfig(collection.config, request.body ?? {})));
}));

app.post("/api/collections/:slug/config/apply-default", asyncRoute(async (request, response) => {
  response.json(await setCollectionConfig(String(request.params.slug), await loadConfig()));
}));

app.delete("/api/collections/:slug", asyncRoute(async (request, response) => {
  const body = z.object({ confirmSlug: z.string() }).parse(request.body ?? {});
  response.json(await deleteCollection(String(request.params.slug), body.confirmSlug));
}));

app.post("/api/collections/:slug/scan-directory", asyncRoute(async (request, response) => {
  assertTrustedLocalActionRequest(request);
  const { collection } = await getCollection(String(request.params.slug));
  const body = directoryScanBodySchema.parse(request.body ?? {});
  const result = await scanDirectoryForCandidates({
    directoryPath: body.directoryPath,
    recursive: body.recursive === true,
    maxFiles: body.maxFiles ?? 100,
  });
  const session = rememberDirectoryScanSession(collection.slug, result);
  response.json({ ...result, ...session });
}));

app.post("/api/collections/:slug/import-paths", asyncRoute(async (request, response) => {
  assertTrustedLocalActionRequest(request);
  const { collection } = await getCollection(String(request.params.slug));
  const body = importPathsBodySchema.parse(request.body ?? {});
  const createdJobs: ProcessingJob[] = [];
  const failures: Array<{ path: string; error: string }> = [];
  const maxBytes = collection.config.parsers.maxFileSizeMb * 1024 * 1024;
  const selection = resolveDirectoryImportSelection(collection.slug, body);

  for (const sourcePath of Array.from(new Set(selection.paths))) {
    try {
      const source = await storeLocalSourceFile(collection.slug, sourcePath, selection.session);
      if (source.sizeBytes > maxBytes) {
        await rm(source.storedPath, { force: true }).catch(() => undefined);
        throw Object.assign(new Error(`File exceeds the current knowledge base size limit: ${source.originalName}`), { statusCode: 400 });
      }
      const job = createJob({ kind: "upload", collectionSlug: collection.slug, fileName: source.originalName });
      createdJobs.push(job);
      enqueueProcessingJob(async () => {
        try {
          await processStoredFile({
            collectionSlug: collection.slug,
            storedPath: source.storedPath,
            originalName: source.originalName,
            mime: source.mime,
            jobId: job.id,
            kind: "upload",
          });
        } catch {
          // Job state already records the error.
        }
      });
    } catch (error) {
      failures.push({ path: sourcePath, error: error instanceof Error ? error.message : String(error) });
    }
  }

  response.json({
    jobs: createdJobs,
    failures,
    collections: await listCollections(),
    documents: await loadDocuments(collection.slug),
  });
}));

app.get("/api/collections/:slug/documents", asyncRoute(async (request, response) => {
  const slug = String(request.params.slug);
  await getCollection(slug);
  response.json({ documents: await loadDocuments(slug) });
}));

app.get("/api/collections/:slug/documents/:documentId", asyncRoute(async (request, response) => {
  const { collection } = await getCollection(String(request.params.slug));
  const docs = await loadDocuments(collection.slug);
  const document = docs.find((item) => item.id === request.params.documentId);
  if (!document) throw Object.assign(new Error("Document not found."), { statusCode: 404 });
  response.json({ document, chunks: await getDocumentChunks(collection, String(request.params.documentId)) });
}));

app.get("/api/collections/:slug/documents/:documentId/extracted-text", asyncRoute(async (request, response) => {
  const { collection } = await getCollection(String(request.params.slug));
  const docs = await loadDocuments(collection.slug);
  const document = docs.find((item) => item.id === request.params.documentId);
  if (!document) throw Object.assign(new Error("Document not found."), { statusCode: 404 });
  const text = document.extractedTextPath && isPathInside(extractedDir, document.extractedTextPath) && (await fileExists(document.extractedTextPath))
    ? await readFile(document.extractedTextPath, "utf8")
    : (await getDocumentChunks(collection, document.id)).map((chunk) => chunk.text).join("\n\n");
  const maxChars = 240_000;
  response.json({ document, text: text.slice(0, maxChars), totalChars: text.length, truncated: text.length > maxChars });
}));

app.delete("/api/collections/:slug/documents/:documentId", asyncRoute(async (request, response) => {
  response.json(await deleteDocument(String(request.params.slug), String(request.params.documentId)));
}));

app.post("/api/collections/:slug/documents/:documentId/retry-anythingllm-cleanup", asyncRoute(async (request, response) => {
  response.json(await retryDocumentAnythingCleanup(String(request.params.slug), String(request.params.documentId)));
}));

app.post("/api/collections/:slug/documents/batch-delete", asyncRoute(async (request, response) => {
  const documentIds = parseBatchDocumentIds(request.body ?? {});
  const { collection } = await getCollection(String(request.params.slug));
  const results: Array<{ documentId: string; ok: true; deleted: string } | ReturnType<typeof batchFailure>> = [];
  for (const documentId of documentIds) {
    try {
      const result = await deleteDocument(collection.slug, documentId);
      results.push({ documentId, ok: true, deleted: result.deleted });
    } catch (error) {
      results.push(batchFailure(documentId, error));
    }
  }
  response.json(batchResponse(results));
}));

app.post("/api/collections/:slug/documents/batch-reprocess", asyncRoute(async (request, response) => {
  const documentIds = parseBatchDocumentIds(request.body ?? {});
  const { collection } = await getCollection(String(request.params.slug));
  const docs = await loadDocuments(collection.slug);
  const results: Array<{ documentId: string; ok: true; job: ProcessingJob } | ReturnType<typeof batchFailure>> = [];
  for (const documentId of documentIds) {
    try {
      const document = docs.find((item) => item.id === documentId);
      if (!document) throw documentNotFoundError(documentId);
      const job = await createReprocessJob(collection, document);
      results.push({ documentId, ok: true, job });
    } catch (error) {
      results.push(batchFailure(documentId, error));
    }
  }
  response.json(batchResponse(results));
}));

app.post("/api/collections/:slug/documents/:documentId/reprocess", asyncRoute(async (request, response) => {
  const { collection } = await getCollection(String(request.params.slug));
  const docs = await loadDocuments(collection.slug);
  const document = docs.find((item) => item.id === request.params.documentId);
  if (!document) throw Object.assign(new Error("Document not found."), { statusCode: 404 });
  if (!(await fileExists(document.sourcePath))) {
    throw Object.assign(new Error("原始上传副本不存在，无法重新处理。"), { statusCode: 400 });
  }
  const job = createJob({ kind: "reprocess", collectionSlug: collection.slug, fileName: document.originalName || document.name, documentId: document.id });
  enqueueProcessingJob(async () => {
    try {
      await processStoredFile({
        collectionSlug: collection.slug,
        storedPath: document.sourcePath,
        originalName: document.originalName || document.name,
        mime: document.mime,
        jobId: job.id,
        kind: "reprocess",
        documentId: document.id,
      });
    } catch {
      // Job state already records the error.
    }
  });
  response.json({ job });
}));

app.post("/api/collections/:slug/text", asyncRoute(async (request, response) => {
  const body = z.object({
    name: z.string().min(1),
    text: z.string().min(1),
    metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  }).parse(request.body ?? {});
  response.json(await ingestText(String(request.params.slug), {
    ...body,
    sourcePath: body.name,
    mime: "text/plain",
    parserType: "text",
    parserVersion: appVersion,
    originalName: body.name,
    originalSizeBytes: Buffer.byteLength(body.text, "utf8"),
    extractedTextBytes: Buffer.byteLength(body.text, "utf8"),
  }));
}));

app.post("/api/collections/:slug/upload", upload.array("files"), asyncRoute(async (request, response) => {
  const slug = String(request.params.slug);
  await getCollection(slug);
  const files = (request.files ?? []) as Express.Multer.File[];
  if (!files.length) throw Object.assign(new Error("No files uploaded."), { statusCode: 400 });
  const results = [];
  for (const file of files) {
    const job = createJob({ kind: "upload", collectionSlug: slug, fileName: file.originalname });
    try {
      const storedPath = await storeUploadedFile(slug, file);
      const result = await processStoredFile({
        collectionSlug: slug,
        storedPath,
        originalName: file.originalname,
        mime: file.mimetype,
        jobId: job.id,
        kind: "upload",
      });
      results.push(result);
    } catch (error) {
      await rm(file.path, { force: true }).catch(() => undefined);
      results.push({ file: file.originalname, ok: false, jobId: job.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  response.json({ results, collections: await listCollections(), documents: await loadDocuments(slug) });
}));

app.post("/api/collections/:slug/upload-jobs", upload.array("files"), asyncRoute(async (request, response) => {
  const slug = String(request.params.slug);
  await getCollection(slug);
  const files = (request.files ?? []) as Express.Multer.File[];
  if (!files.length) throw Object.assign(new Error("No files uploaded."), { statusCode: 400 });
  const createdJobs: ProcessingJob[] = [];
  for (const file of files) {
    try {
      const storedPath = await storeUploadedFile(slug, file);
      const job = createJob({ kind: "upload", collectionSlug: slug, fileName: file.originalname });
      createdJobs.push(job);
      enqueueProcessingJob(async () => {
        try {
          await processStoredFile({
            collectionSlug: slug,
            storedPath,
            originalName: file.originalname,
            mime: file.mimetype,
            jobId: job.id,
            kind: "upload",
          });
        } catch {
          // Job state already records the error.
        }
      });
    } catch (error) {
      await rm(file.path, { force: true }).catch(() => undefined);
      const job = createJob({ kind: "upload", collectionSlug: slug, fileName: file.originalname });
      updateJob(job.id, { status: "failed", phase: "failed", error: error instanceof Error ? error.message : String(error), message: "保存上传文件失败" });
      createdJobs.push(getJobOrThrow(job.id));
    }
  }
  response.json({ jobs: createdJobs, collections: await listCollections(), documents: await loadDocuments(slug) });
}));

app.post("/api/collections/:slug/search", asyncRoute(async (request, response) => {
  const body = z.object({ query: z.string().min(1), topK: z.number().int().min(1).max(50).default(8) }).parse(request.body ?? {});
  response.json({ results: await searchCollection(String(request.params.slug), body.query, body.topK) });
}));

app.post("/api/collections/:slug/sync-anythingllm", asyncRoute(async (request, response) => {
  const body = z.object({ maxChunks: z.number().int().min(1).max(5000).default(200) }).parse(request.body ?? {});
  response.json(await syncCollectionToAnythingLLM(String(request.params.slug), body.maxChunks));
}));

app.use(express.static(staticDir));

export async function startServer(port = defaultPort, options: { silent?: boolean } = {}) {
  await ensureDirs();
  return new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const server = app.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      if (!options.silent) console.log(`Vector Forge Lab listening on http://127.0.0.1:${actualPort}`);
      resolve(server);
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  void startServer();
}
