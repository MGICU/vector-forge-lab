import React from "react";
import { createRoot } from "react-dom/client";
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Clock3,
  Clipboard,
  Database,
  Eye,
  FileText,
  FolderPlus,
  ListChecks,
  Loader2,
  Paperclip,
  PlugZap,
  RefreshCw,
  RotateCcw,
  Search,
  SendHorizontal,
  Server,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Upload,
  WandSparkles,
  X,
} from "lucide-react";
import "./styles.css";

type EmbeddingProviderType = "local-hash" | "openai-compatible";
type OcrMode = "auto" | "tesseract" | "paddleocr" | "cloud";
type DuplicateStrategy = "skip" | "version" | "replace";
type ParserType = "text" | "html" | "json" | "csv" | "pdf-text" | "pdf-ocr" | "docx" | "image-ocr" | "unknown";
type DocumentStatus = "pending" | "extracting" | "ocr" | "chunking" | "embedding" | "indexed" | "failed" | "skipped";
type Tone = "neutral" | "good" | "warn" | "bad" | "active";
type SectionId = "overview" | "ai" | "collections" | "search" | "jobs" | "documents" | "parsers" | "mcp" | "anythingllm" | "settings";
type ConfigInspectorPage = "collections" | "jobs" | "parsers" | "mcp" | "anythingllm" | "settings";
type BusyState =
  | "refresh"
  | "create-collection"
  | "upload"
  | "scan-directory"
  | "import-paths"
  | "search"
  | "save-config"
  | "apply-default"
  | "copy-default"
  | "test-embedding"
  | "test-ocr"
  | "test-anything"
  | "anything-env"
  | "anything-exe"
  | "anything-workspaces"
  | "anything-installer-download"
  | "anything-installer-folder"
  | "anything-installer-launch"
  | "sync-anything"
  | "anything-cleanup"
  | "batch-delete"
  | "batch-reprocess"
  | "cancel-job"
  | "document-detail"
  | "document-delete"
  | "document-reprocess"
  | "ai-policy"
  | "data-dir-status"
  | "data-dir-pick"
  | "data-dir-save"
  | "data-dir-reset"
  | "desktop-relaunch"
  | null;

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
  parsers: {
    duplicateStrategy: DuplicateStrategy;
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
      mode: OcrMode;
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
    desktopExePath?: string;
  };
  mcp: {
    allowWrites: boolean;
  };
};

type Collection = {
  id: string;
  name: string;
  slug: string;
  description: string;
  tableName: string;
  dimension: number;
  metric: string;
  embeddingProvider: EmbeddingProviderType;
  embeddingModel: string;
  documentCount: number;
  chunkCount: number;
  updatedAt: string;
};

type DocumentRecord = {
  id: string;
  name: string;
  sourcePath: string;
  mime: string;
  sizeBytes: number;
  chunkCount: number;
  status: DocumentStatus;
  error?: string;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, string | number | boolean>;
  contentHash?: string;
  parserType?: ParserType;
  extractionStatus?: DocumentStatus;
  pageCount?: number;
  ocrEngine?: string;
  ocrLanguage?: string;
  ocrConfidence?: number | null;
  warnings?: string[];
  originalName?: string;
  extractedTextPath?: string;
  anythingLocations?: string[];
  anythingSync?: {
    version: 1;
    updatedAt?: string;
    chunks: Array<{
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
    }>;
  };
};

type DocumentChunk = {
  id: string;
  chunkIndex: number;
  title: string;
  text: string;
  sourceName: string;
  sourcePath: string;
  mime: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  pageNumber?: number;
  sectionTitle?: string;
  extractor?: string;
  confidence?: number;
};

type DocumentDetailPayload = {
  document: DocumentRecord;
  chunks: DocumentChunk[];
};

type DocumentTextPayload = {
  document: DocumentRecord;
  text: string;
  totalChars: number;
  truncated: boolean;
};

type SearchResult = {
  id: string;
  documentId: string;
  chunkIndex: number;
  title: string;
  text: string;
  sourceName: string;
  sourcePath: string;
  preview: string;
  score: number | null;
  pageNumber?: number;
  sectionTitle?: string;
  extractor?: string;
  confidence?: number;
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

type AnythingEnvironment = {
  os: { platform: string; arch: string };
  api: {
    enabled: boolean;
    baseUrl: string;
    apiKeyConfigured: boolean;
    workspaceName: string;
    workspaceSlug: string;
  };
  desktop: {
    configuredExe: { path: string; launchable: boolean; exists: boolean; error?: string };
    detectedExe: { path: string; launchable: boolean; exists: boolean; error?: string } | null;
    candidates: Array<{ path: string; launchable: boolean; exists: boolean; error?: string }>;
  };
  installer: { folder: string; allowedExtensions: string[]; allowedHosts: string[]; maxBytes: number };
};

type AnythingWorkspaceSummary = {
  id: string | number;
  name: string;
  slug: string;
};

type AnythingCleanupSummary = {
  deleted: number;
  skipped: number;
  workspaces: Array<{ workspaceSlug: string; deleted: number }>;
  queued?: number;
  pending?: number;
  failed?: number;
};

type AnythingCleanupQueueEntry = {
  id: string;
  status: "prepared" | "pending" | string;
  source: "document-delete" | "collection-delete" | "reprocess" | string;
  collectionSlug: string;
  collectionId?: string;
  documentId?: string;
  documentName?: string;
  baseUrl: string;
  apiKeyConfigured: boolean;
  workspaceSlug: string;
  locations: string[];
  syncKeys: string[];
  locationCount: number;
  createdAt: string;
  updatedAt: string;
  attempts: number;
  lastAttemptAt: string;
  lastError: string;
};

type AnythingCleanupQueuePayload = {
  version: 1;
  counts: { total: number; prepared: number; pending: number };
  entries: AnythingCleanupQueueEntry[];
};

type AnythingCleanupQueueRetryRequest = {
  ids?: string[];
  label: string;
};

type Health = {
  ok: boolean;
  appVersion: string;
  dataDir: string;
  lanceDir: string;
  tableNames: string[];
  config: AppConfig;
};

type DesktopDataDirectoryStatus = {
  desktop: boolean;
  envOverride: boolean;
  envDataDir: string;
  activeDataDir: string;
  persistedDataDir: string;
  defaultDataDir: string;
  selectedDataDir: string;
  pendingDataDir: string;
  pendingRelaunch: boolean;
  settingsPath: string;
};

type DesktopDataDirectoryPickResult = {
  canceled: boolean;
  path?: string;
  reason?: string;
  status?: DesktopDataDirectoryStatus;
};

type VectorForgeDesktopApi = {
  getLocalActionToken: () => Promise<{ token: string }>;
  getDataDirectoryStatus: () => Promise<DesktopDataDirectoryStatus>;
  chooseDataDirectory: () => Promise<DesktopDataDirectoryPickResult>;
  saveDataDirectory: (dataDir: string) => Promise<DesktopDataDirectoryStatus>;
  resetDataDirectory: () => Promise<DesktopDataDirectoryStatus>;
  relaunch: () => Promise<{ relaunching: true; dryRun?: boolean }>;
};

declare global {
  interface Window {
    vectorForgeDesktop?: VectorForgeDesktopApi;
  }
}

type OnboardingStepId = "data" | "collection" | "embedding" | "ocr" | "anythingllm" | "finish";
type OnboardingStepStatus = "pending" | "complete" | "skipped" | "failed";
type OnboardingState = {
  completed: boolean;
  dismissed: boolean;
  currentStep: OnboardingStepId;
  steps: Record<Exclude<OnboardingStepId, "finish">, { status: OnboardingStepStatus; updatedAt?: string; lastError?: string }>;
  completedAt?: string;
  dismissedAt?: string;
  lastResults?: Record<string, unknown>;
};
type OnboardingReadiness = {
  dataDir: string;
  lanceDir: string;
  lanceDbReady: boolean;
  tableCount: number;
  hasCollection: boolean;
  collectionCount: number;
  activeCollectionSlug: string;
  activeCollectionName: string;
  defaultEmbedding: {
    provider: EmbeddingProviderType;
    model: string;
    dimension: number;
    batchSize: number;
  };
  defaultOcr: {
    mode: OcrMode;
    language: string;
    minConfidence: number;
  };
  anythingllmConfigured: boolean;
  anythingllmEnabled: boolean;
  cloudOcrEnabled: boolean;
};
type OnboardingPayload = {
  onboarding: OnboardingState;
  readiness: OnboardingReadiness;
};
type OnboardingPatch = Partial<{
  currentStep: OnboardingStepId;
  dismissed: boolean;
  steps: Partial<Record<Exclude<OnboardingStepId, "finish">, Partial<{ status: OnboardingStepStatus; lastError: string | null }>>>;
  lastResults: Record<string, unknown>;
}>;

type CollectionConfigStatus = {
  usesDefaultSnapshot?: boolean;
  isCustomized?: boolean;
  embeddingChangedRequiresRebuild?: boolean;
  embeddingMatchesIndex?: boolean;
  canUpdateEmbeddingIndex?: boolean;
  indexedEmbedding?: {
    provider: EmbeddingProviderType;
    model: string;
    dimension: number;
  };
  configEmbedding?: {
    provider: EmbeddingProviderType;
    model: string;
    dimension: number;
  };
};

type CollectionConfigResponse = {
  collection?: Collection;
  config?: AppConfig;
  defaultConfig?: AppConfig;
  configStatus?: CollectionConfigStatus;
};

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

type Toast = { type: "success" | "error" | "info"; text: string };
type BatchDocumentsResponse = Partial<{
  collections: Collection[];
  documents: DocumentRecord[];
  jobs: ProcessingJob[];
  ok: boolean;
  requested: number;
  succeeded: number;
  failed: number;
}>;
type AiMessage = {
  id: string;
  role: "assistant" | "user" | "system";
  text: string;
  detail?: string;
  time: string;
};

type AiToolRisk = "read" | "write" | "destructive" | "external-send" | "local-execution";
type AiToolSummary = {
  id: string;
  label: string;
  category: string;
  risk: AiToolRisk;
  requiresConfirmation: boolean;
  execution: "dry-run-only";
};
type AiToolAuditEvent = {
  id: string;
  createdAt: string;
  promptPreview: string;
  contextSource: "user" | "retrieved" | "mixed";
  contextPreview?: string;
  matchedToolIds: string[];
  highestRisk: AiToolRisk;
  requiresConfirmation: boolean;
  blocked: boolean;
  willExecute: false;
  reason: string;
};
type AiToolDecisionResponse = {
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
  tools?: AiToolSummary[];
};
type PendingAiAction = {
  toolId: string;
  command: string;
  decision: AiToolDecisionResponse;
  fileCount: number;
};
type DesktopActionKind = "open-installer-folder" | "launch-installer";
type OcrTestContext = "config" | "onboarding";
type ProcessingRiskSummary = {
  requiresConfirmation: boolean;
  warnings: string[];
};
type PendingProcessingAction = {
  kind: "upload" | "import-paths" | "reprocess" | "batch-reprocess";
  count: number;
  risk: ProcessingRiskSummary;
  source?: "ai" | "ui";
  files?: File[];
  paths?: string[];
  documentIds?: string[];
};

const supportedFormats = ".txt,.md,.markdown,.json,.html,.htm,.csv,.tsv,.xml,.log,.yaml,.yml,.pdf,.docx,.png,.jpg,.jpeg,.webp,.tif,.tiff,.bmp";
const mcpResourceCatalog = [
  { uri: "vectorforge://health", label: "Health", description: "API 健康、版本、LanceDB 和脱敏配置摘要。" },
  { uri: "vectorforge://collections", label: "Collections", description: "本地知识库列表。" },
  { uri: "vectorforge://collections/{slug}/documents", label: "Collection Documents", description: "指定知识库文档列表，使用实际 slug 替换占位符。" },
  { uri: "vectorforge://embedding-provider/status", label: "Embedding Status", description: "当前 embedding provider 与各知识库索引兼容状态。" },
  { uri: "vectorforge://jobs/recent", label: "Recent Jobs", description: "最近导入、OCR、embedding 和重处理任务。" },
  { uri: "vectorforge://anythingllm/sync-status", label: "AnythingLLM Sync", description: "本地记录的 AnythingLLM 同步状态，不主动访问远端。" },
  { uri: "vectorforge://documents/quality", label: "Document Quality", description: "OCR/解析质量、失败、警告和低置信度概览。" },
];

const parserLabel: Record<string, string> = {
  text: "文本",
  html: "HTML",
  json: "JSON",
  csv: "表格",
  "pdf-text": "PDF 文本",
  "pdf-ocr": "PDF OCR",
  docx: "DOCX",
  "image-ocr": "图片",
  unknown: "未知",
};

const statusLabel: Record<DocumentStatus, { label: string; tone: Tone }> = {
  pending: { label: "等待中", tone: "neutral" },
  extracting: { label: "解析中", tone: "active" },
  ocr: { label: "OCR 中", tone: "active" },
  chunking: { label: "切片中", tone: "active" },
  embedding: { label: "入库中", tone: "active" },
  indexed: { label: "已入库", tone: "good" },
  failed: { label: "失败", tone: "bad" },
  skipped: { label: "已跳过", tone: "warn" },
};

function aiRiskLabel(risk: AiToolRisk) {
  if (risk === "read") return "只读";
  if (risk === "write") return "写入";
  if (risk === "destructive") return "删除/破坏性";
  if (risk === "external-send") return "外部发送";
  return "本地执行";
}

function manualActionHint(toolId?: string) {
  if (toolId === "documents.import") return "请使用导入按钮或文件拖拽区手动确认入库。";
  if (toolId === "collections.create") return "请使用知识库区域的“新建知识库”按钮完成创建。";
  if (toolId === "config.applyDefault") return "请在右侧参数面板点击“应用默认”。";
  if (toolId === "config.copyToDefault") return "请在右侧参数面板保存当前参数后点击“复制为默认”。";
  if (toolId === "config.save") return "请在右侧参数面板点击“保存当前”。";
  if (toolId === "ocr.test") return "请在 OCR / 解析卡片点击“测试 OCR”。";
  if (toolId === "embedding.test") return "请在 Embedding 卡片点击“测试连接”。";
  if (toolId === "anythingllm.test") return "请在 AnythingLLM 卡片点击“测试”。";
  if (toolId === "anythingllm.sync") return "请在 AnythingLLM 卡片点击“同步”并确认当前配置。";
  return "请使用页面上的明确按钮完成该操作。";
}

function isAiConfirmableTool(toolId?: string) {
  return Boolean(
    toolId &&
      [
        "documents.import",
        "config.save",
        "config.applyDefault",
        "config.copyToDefault",
        "ocr.test",
        "embedding.test",
        "anythingllm.test",
        "anythingllm.sync",
      ].includes(toolId),
  );
}

const navItems: Array<{ id: SectionId; label: string; targetId: string; requiresConfig?: boolean }> = [
  { id: "overview", label: "总览", targetId: "section-overview" },
  { id: "ai", label: "AI 控制", targetId: "section-ai", requiresConfig: true },
  { id: "collections", label: "知识库", targetId: "section-collections" },
  { id: "search", label: "本地检索", targetId: "section-search" },
  { id: "jobs", label: "导入任务", targetId: "section-jobs" },
  { id: "documents", label: "文档管理", targetId: "section-documents" },
  { id: "parsers", label: "OCR / 解析", targetId: "section-parsers", requiresConfig: true },
  { id: "mcp", label: "MCP", targetId: "section-mcp", requiresConfig: true },
  { id: "anythingllm", label: "AnythingLLM", targetId: "section-anythingllm", requiresConfig: true },
  { id: "settings", label: "设置", targetId: "section-settings" },
];

const pageCopy: Record<SectionId, { title: string; description: string }> = {
  overview: {
    title: "总览工作台",
    description: "查看当前知识库、文档、chunks、任务和桌面运行状态。",
  },
  ai: {
    title: "AI 控制",
    description: "通过对话式指令做安全预检、检索、附件导入和配置操作确认。",
  },
  collections: {
    title: "知识库管理",
    description: "先选择知识库，再查看 slug、table、embedding 状态和参数副本。",
  },
  search: {
    title: "本地检索",
    description: "在当前知识库内查询 LanceDB 向量结果，复制引用并打开来源文档。",
  },
  jobs: {
    title: "导入任务",
    description: "统一查看上传、解析、OCR、embedding、同步和取消状态。",
  },
  documents: {
    title: "文档管理",
    description: "导入文件或目录、批量处理文档，并查看文档详情和 OCR 警告。",
  },
  parsers: {
    title: "OCR / 解析配置",
    description: "调整当前知识库的解析、PDF、OCR 和重处理参数。",
  },
  mcp: {
    title: "MCP",
    description: "查看本地向量库 MCP resources，并控制当前知识库的写入开关。",
  },
  anythingllm: {
    title: "AnythingLLM",
    description: "配置 AnythingLLM API、workspace、桌面程序路径和可选同步。",
  },
  settings: {
    title: "默认参数与系统设置",
    description: "设置当前知识库 embedding/chunking 参数、默认模板和桌面数据目录。",
  },
};

function App() {
  const [health, setHealth] = React.useState<Health | null>(null);
  const [desktopDataDir, setDesktopDataDir] = React.useState<DesktopDataDirectoryStatus | null>(null);
  const [desktopDataDirDraft, setDesktopDataDirDraft] = React.useState("");
  const [onboardingPayload, setOnboardingPayload] = React.useState<OnboardingPayload | null>(null);
  const [showOnboarding, setShowOnboarding] = React.useState(false);
  const [onboardingBusy, setOnboardingBusy] = React.useState<"" | "patch" | "complete" | "reset">("");
  const [defaultConfig, setDefaultConfig] = React.useState<AppConfig | null>(null);
  const [config, setConfig] = React.useState<AppConfig | null>(null);
  const [configStatus, setConfigStatus] = React.useState<CollectionConfigStatus | null>(null);
  const [savedConfigFingerprint, setSavedConfigFingerprint] = React.useState("");
  const [collections, setCollections] = React.useState<Collection[]>([]);
  const [activeSlug, setActiveSlug] = React.useState("");
  const [documents, setDocuments] = React.useState<DocumentRecord[]>([]);
  const [jobs, setJobs] = React.useState<ProcessingJob[]>([]);
  const [directoryPath, setDirectoryPath] = React.useState("");
  const [directoryRecursive, setDirectoryRecursive] = React.useState(true);
  const [directoryScanId, setDirectoryScanId] = React.useState("");
  const [directoryCandidates, setDirectoryCandidates] = React.useState<DirectoryScanCandidate[]>([]);
  const [anythingEnvironment, setAnythingEnvironment] = React.useState<AnythingEnvironment | null>(null);
  const [anythingWorkspaces, setAnythingWorkspaces] = React.useState<AnythingWorkspaceSummary[]>([]);
  const [anythingCleanupQueue, setAnythingCleanupQueue] = React.useState<AnythingCleanupQueuePayload | null>(null);
  const [anythingDesktopExePath, setAnythingDesktopExePath] = React.useState("");
  const [anythingInstallerUrl, setAnythingInstallerUrl] = React.useState("");
  const [searchQuery, setSearchQuery] = React.useState("医保报销政策的截止日期是什么？");
  const [topK, setTopK] = React.useState(8);
  const [searchResults, setSearchResults] = React.useState<SearchResult[]>([]);
  const [hasSearched, setHasSearched] = React.useState(false);
  const [aiInput, setAiInput] = React.useState("");
  const [aiFiles, setAiFiles] = React.useState<File[]>([]);
  const [aiMessages, setAiMessages] = React.useState<AiMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      text: "把文件拖进来，或者直接说你要做什么。",
      detail: "例如：导入这些文件、搜索 报销截止日期、测试 OCR、保存当前参数、同步 AnythingLLM。",
      time: formatTime(),
    },
  ]);
  const [aiTools, setAiTools] = React.useState<AiToolSummary[]>([]);
  const [aiAuditEvents, setAiAuditEvents] = React.useState<AiToolAuditEvent[]>([]);
  const [aiDecision, setAiDecision] = React.useState<AiToolDecisionResponse | null>(null);
  const [pendingAiAction, setPendingAiAction] = React.useState<PendingAiAction | null>(null);
  const [busy, setBusy] = React.useState<BusyState>(null);
  const [cancellingJobId, setCancellingJobId] = React.useState("");
  const [toast, setToast] = React.useState<Toast | null>(null);
  const [activeSection, setActiveSection] = React.useState<SectionId>("search");
  const [documentDetail, setDocumentDetail] = React.useState<DocumentDetailPayload | null>(null);
  const [documentText, setDocumentText] = React.useState<DocumentTextPayload | null>(null);
  const [pendingDeleteDocument, setPendingDeleteDocument] = React.useState<DocumentRecord | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = React.useState("");
  const [showCreateCollectionDialog, setShowCreateCollectionDialog] = React.useState(false);
  const [createCollectionContext, setCreateCollectionContext] = React.useState<"normal" | "onboarding">("normal");
  const [newCollectionName, setNewCollectionName] = React.useState("");
  const [pendingBatchDeleteIds, setPendingBatchDeleteIds] = React.useState<string[]>([]);
  const [batchDeleteConfirmation, setBatchDeleteConfirmation] = React.useState("");
  const [pendingApplyDefault, setPendingApplyDefault] = React.useState(false);
  const [pendingCopyDefault, setPendingCopyDefault] = React.useState(false);
  const [pendingDesktopRelaunch, setPendingDesktopRelaunch] = React.useState(false);
  const [pendingDesktopAction, setPendingDesktopAction] = React.useState<DesktopActionKind | null>(null);
  const [pendingAnythingSync, setPendingAnythingSync] = React.useState(false);
  const [pendingAnythingCleanupDocument, setPendingAnythingCleanupDocument] = React.useState<DocumentRecord | null>(null);
  const [pendingCleanupQueueRetry, setPendingCleanupQueueRetry] = React.useState<AnythingCleanupQueueRetryRequest | null>(null);
  const [pendingOcrTest, setPendingOcrTest] = React.useState<OcrTestContext | null>(null);
  const [pendingProcessingAction, setPendingProcessingAction] = React.useState<PendingProcessingAction | null>(null);
  const [documentsSelectionResetKey, setDocumentsSelectionResetKey] = React.useState(0);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const aiFileInputRef = React.useRef<HTMLInputElement | null>(null);
  const didBootRef = React.useRef(false);

  const activeCollection = React.useMemo(
    () => collections.find((collection) => collection.slug === activeSlug) ?? collections[0] ?? null,
    [activeSlug, collections],
  );
  const runningJobs = React.useMemo(
    () => jobs.filter((job) => job.status === "queued" || job.status === "running"),
    [jobs],
  );
  const failedDocuments = React.useMemo(
    () => documents.filter((document) => (document.extractionStatus || document.status) === "failed").length,
    [documents],
  );
  const pendingBatchDeleteDocuments = React.useMemo(() => {
    const pendingSet = new Set(pendingBatchDeleteIds);
    return documents.filter((document) => pendingSet.has(document.id));
  }, [documents, pendingBatchDeleteIds]);
  const totalChunks = activeCollection?.chunkCount ?? documents.reduce((sum, document) => sum + document.chunkCount, 0);
  const configDirty = React.useMemo(
    () => Boolean(config && savedConfigFingerprint && configFingerprint(config) !== savedConfigFingerprint),
    [config, savedConfigFingerprint],
  );
  const anythingLLMReady = Boolean(
    activeCollection &&
      config?.anythingllm.enabled &&
      config.anythingllm.baseUrl.trim() &&
      config.anythingllm.apiKey.trim(),
  );
  const canSyncAnythingLLM = anythingLLMReady && !configDirty;
  const desktopDataDirDirty = React.useMemo(() => {
    if (!desktopDataDir) return false;
    return pathLikeNormalize(desktopDataDirDraft) !== pathLikeNormalize(desktopDataDir.selectedDataDir);
  }, [desktopDataDir, desktopDataDirDraft]);
  const anythingSyncDisabledReason = React.useMemo(() => {
    if (!activeCollection) return "请先创建或选择知识库";
    if (!config) return "知识库参数尚未加载";
    if (configDirty) return "请先保存当前知识库参数";
    if (!config.anythingllm.enabled) return "请先启用 AnythingLLM 同步";
    if (!config.anythingllm.baseUrl.trim()) return "请填写 AnythingLLM API 地址";
    if (!config.anythingllm.apiKey.trim()) return "请填写 AnythingLLM API key";
    return "";
  }, [activeCollection, config, configDirty]);

  const processingRisk = React.useMemo<ProcessingRiskSummary>(() => {
    const warnings: string[] = [];
    if (config?.embedding.provider === "openai-compatible") {
      warnings.push(`Embedding 会发送文本 chunks 到外部 API：${config.embedding.baseUrl || "未配置 Base URL"} / ${config.embedding.model}`);
    }
    if (config?.parsers.ocr.mode === "cloud" || config?.parsers.ocr.allowCloudOcr) {
      warnings.push(`Cloud OCR 可能发送图片或扫描页内容到外部 API：${config.parsers.ocr.cloudBaseUrl || "未配置 Base URL"} / ${config.parsers.ocr.cloudModel}`);
    }
    if (config?.parsers.ocr.mode === "paddleocr") {
      warnings.push(`PaddleOCR 会在本机执行配置命令：${config.parsers.ocr.paddleCommand || "未配置命令"} ${config.parsers.ocr.paddleArgs || ""}`.trim());
    }
    return { requiresConfirmation: warnings.length > 0, warnings };
  }, [config]);

  const showToast = React.useCallback((type: Toast["type"], text: string) => {
    setToast({ type, text });
    window.setTimeout(() => setToast(null), 5200);
  }, []);

  const applyConfigPayload = React.useCallback((payload: CollectionConfigResponse) => {
    if (payload.collection) {
      setCollections((current) =>
        current.map((collection) => (collection.slug === payload.collection!.slug ? payload.collection! : collection)),
      );
    }
    if (payload.config) {
      setConfig(payload.config);
      setSavedConfigFingerprint(configFingerprint(payload.config));
    }
    if (payload.defaultConfig) setDefaultConfig(payload.defaultConfig);
    setConfigStatus(payload.configStatus ?? null);
  }, []);

  const loadCollectionBundle = React.useCallback(async (slug: string, quiet = false) => {
    try {
      const [configPayload, docsPayload, jobsPayload] = await Promise.all([
        api<CollectionConfigResponse>(`/api/collections/${encodeURIComponent(slug)}/config`),
        api<{ documents: DocumentRecord[] }>(`/api/collections/${encodeURIComponent(slug)}/documents`),
        api<{ jobs: ProcessingJob[] }>(`/api/jobs?collectionSlug=${encodeURIComponent(slug)}`),
      ]);
      applyConfigPayload(configPayload);
      setDocuments(docsPayload.documents);
      setJobs(jobsPayload.jobs);
      return true;
    } catch (error) {
      setConfig(null);
      setConfigStatus(null);
      setSavedConfigFingerprint("");
      setDocuments([]);
      setJobs([]);
      if (!quiet) showToast("error", errorMessage(error));
      return false;
    }
  }, [applyConfigPayload, showToast]);

  const applyOnboardingPayload = React.useCallback((payload: OnboardingPayload, autoOpen = false) => {
    setOnboardingPayload(payload);
    if (autoOpen && !payload.onboarding.completed && !payload.onboarding.dismissed) setShowOnboarding(true);
  }, []);

  const refreshOnboarding = React.useCallback(async (autoOpen = false) => {
    const payload = await api<OnboardingPayload>("/api/onboarding");
    applyOnboardingPayload(payload, autoOpen);
    return payload;
  }, [applyOnboardingPayload]);

  const refreshDesktopDataDirectory = React.useCallback(async (quiet = true) => {
    if (!window.vectorForgeDesktop) return null;
    setBusy((current) => current ?? "data-dir-status");
    try {
      const status = await window.vectorForgeDesktop.getDataDirectoryStatus();
      setDesktopDataDir(status);
      setDesktopDataDirDraft(status.selectedDataDir || status.activeDataDir || status.defaultDataDir || "");
      return status;
    } catch (error) {
      if (!quiet) showToast("error", errorMessage(error));
      return null;
    } finally {
      setBusy((current) => (current === "data-dir-status" ? null : current));
    }
  }, [showToast]);

  const loadAnythingCleanupQueueState = React.useCallback(async (quiet = true) => {
    try {
      const payload = await api<AnythingCleanupQueuePayload>("/api/anythingllm/cleanup-queue");
      setAnythingCleanupQueue(payload);
      return payload;
    } catch (error) {
      if (!quiet) showToast("error", errorMessage(error));
      return null;
    }
  }, [showToast]);

  const refreshAll = React.useCallback(async (preferredSlug?: string, quiet = false) => {
    if (busy) {
      if (!quiet) showToast("info", "当前已有操作在执行，请稍后再刷新。");
      return false;
    }
    setBusy("refresh");
    try {
      const [nextHealth, nextDefault, listPayload, nextOnboarding] = await Promise.all([
        api<Health>("/api/health"),
        api<AppConfig>("/api/config"),
        api<{ collections: Collection[]; activeCollectionSlug: string }>("/api/collections"),
        api<OnboardingPayload>("/api/onboarding"),
      ]);
      void refreshDesktopDataDirectory(true);
      void loadAnythingCleanupQueueState(true);
      setHealth(nextHealth);
      applyOnboardingPayload(nextOnboarding, true);
      setDefaultConfig(nextDefault);
      setCollections(listPayload.collections);
      const nextSlug = preferredSlug || activeSlug || listPayload.activeCollectionSlug || listPayload.collections[0]?.slug || "";
      setActiveSlug(nextSlug);
      if (nextSlug) {
        await loadCollectionBundle(nextSlug, quiet);
      } else {
        setConfig(null);
        setConfigStatus(null);
        setSavedConfigFingerprint("");
        setDocuments([]);
        setJobs([]);
      }
      return true;
    } catch (error) {
      if (!quiet) showToast("error", errorMessage(error));
      return false;
    } finally {
      setBusy(null);
    }
  }, [activeSlug, applyOnboardingPayload, busy, loadAnythingCleanupQueueState, loadCollectionBundle, refreshDesktopDataDirectory, showToast]);

  const refreshDocumentState = React.useCallback(async (slug: string) => {
    const [listPayload, docsPayload, jobsPayload] = await Promise.all([
      api<{ collections: Collection[]; activeCollectionSlug: string }>("/api/collections"),
      api<{ documents: DocumentRecord[] }>(`/api/collections/${encodeURIComponent(slug)}/documents`),
      api<{ jobs: ProcessingJob[] }>(`/api/jobs?collectionSlug=${encodeURIComponent(slug)}`),
    ]);
    setCollections(listPayload.collections);
    setDocuments(docsPayload.documents);
    setJobs(jobsPayload.jobs);
  }, []);

  async function patchOnboarding(patch: OnboardingPatch, autoOpen = true) {
    if (onboardingBusy) return null;
    setOnboardingBusy("patch");
    try {
      const payload = await api<OnboardingPayload>("/api/onboarding", {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      applyOnboardingPayload(payload, false);
      if (autoOpen) setShowOnboarding(!payload.onboarding.completed);
      return payload;
    } catch (error) {
      showToast("error", errorMessage(error));
      return null;
    } finally {
      setOnboardingBusy("");
    }
  }

  async function completeOnboarding() {
    if (onboardingBusy) return false;
    setOnboardingBusy("complete");
    try {
      const payload = await api<OnboardingPayload>("/api/onboarding/complete", { method: "POST", body: "{}" });
      applyOnboardingPayload(payload, false);
      setShowOnboarding(false);
      showToast("success", "首次运行向导已完成。");
      return true;
    } catch (error) {
      showToast("error", errorMessage(error));
      return false;
    } finally {
      setOnboardingBusy("");
    }
  }

  async function resetOnboarding() {
    if (onboardingBusy) return false;
    setOnboardingBusy("reset");
    try {
      const payload = await api<OnboardingPayload>("/api/onboarding/reset", { method: "POST", body: "{}" });
      applyOnboardingPayload(payload, false);
      setShowOnboarding(true);
      showToast("success", "首次运行向导已重置。");
      return true;
    } catch (error) {
      showToast("error", errorMessage(error));
      return false;
    } finally {
      setOnboardingBusy("");
    }
  }

  React.useEffect(() => {
    if (didBootRef.current) return;
    didBootRef.current = true;
    void refreshAll(undefined, true);
  }, [refreshAll]);

  React.useEffect(() => {
    if (!window.vectorForgeDesktop) return;
    void refreshDesktopDataDirectory(true);
  }, [refreshDesktopDataDirectory]);

  React.useEffect(() => {
    if (activeSlug) {
      setSearchResults([]);
      setHasSearched(false);
      setDocumentDetail(null);
      setDocumentText(null);
      setDirectoryScanId("");
      setDirectoryCandidates([]);
      setAnythingWorkspaces([]);
      void loadCollectionBundle(activeSlug, true);
    }
  }, [activeSlug, loadCollectionBundle]);

  React.useEffect(() => {
    setAnythingWorkspaces([]);
  }, [activeSlug, config?.anythingllm.baseUrl, config?.anythingllm.apiKey]);

  React.useEffect(() => {
    if (!activeSlug || !runningJobs.length) return undefined;
    const timer = window.setInterval(() => {
      void api<{ jobs: ProcessingJob[] }>(`/api/jobs?collectionSlug=${encodeURIComponent(activeSlug)}`)
        .then((payload) => {
          setJobs(payload.jobs);
          if (!payload.jobs.some((job) => job.status === "queued" || job.status === "running")) {
            void refreshDocumentState(activeSlug).catch(() => undefined);
          }
        })
        .catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [activeSlug, refreshDocumentState, runningJobs.length]);

  function patchConfig(updater: (draft: AppConfig) => AppConfig) {
    setConfig((current) => (current ? updater(current) : current));
  }

  function navigateToSection(sectionId: SectionId) {
    const item = navItems.find((navItem) => navItem.id === sectionId);
    if (item?.requiresConfig && !config) {
      showToast("info", "请先选择或新建知识库，再打开这个配置区域。");
      setActiveSection("collections");
      return;
    }
    setActiveSection(sectionId);
    window.requestAnimationFrame(() => {
      document.querySelector(".forge-main")?.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  function openImportPicker() {
    if (busy) {
      showToast("info", "当前有任务运行中，请等待完成后再导入文件。");
      return;
    }
    if (!activeCollection) {
      showToast("error", "Please create or select a knowledge base before importing files.");
      navigateToSection("collections");
      return;
    }
    fileInputRef.current?.click();
  }

  function pushAiMessage(role: AiMessage["role"], text: string, detail?: string) {
    setAiMessages((current) => [
      ...current,
      {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        role,
        text,
        detail,
        time: formatTime(),
      },
    ].slice(-16));
  }

  async function chooseDesktopDataDirectory() {
    if (!window.vectorForgeDesktop || busy) return;
    setBusy("data-dir-pick");
    try {
      const result = await window.vectorForgeDesktop.chooseDataDirectory();
      if (result.status) setDesktopDataDir(result.status);
      if (!result.canceled && result.path) setDesktopDataDirDraft(result.path);
      if (result.reason === "env-override") showToast("info", "当前由 VECTOR_FORGE_DATA_DIR 指定数据目录，桌面设置已锁定。");
    } catch (error) {
      showToast("error", errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function saveDesktopDataDirectory() {
    if (!window.vectorForgeDesktop || busy) return;
    if (!desktopDataDirDraft.trim()) return showToast("error", "请输入要保存的数据目录。");
    setBusy("data-dir-save");
    try {
      const status = await window.vectorForgeDesktop.saveDataDirectory(desktopDataDirDraft.trim());
      setDesktopDataDir(status);
      setDesktopDataDirDraft(status.selectedDataDir || status.activeDataDir || "");
      showToast(status.pendingRelaunch ? "info" : "success", status.pendingRelaunch ? "数据目录已保存，重启应用后生效。" : "数据目录已保存。");
    } catch (error) {
      showToast("error", errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function resetDesktopDataDirectory() {
    if (!window.vectorForgeDesktop || busy) return;
    setBusy("data-dir-reset");
    try {
      const status = await window.vectorForgeDesktop.resetDataDirectory();
      setDesktopDataDir(status);
      setDesktopDataDirDraft(status.selectedDataDir || status.defaultDataDir || "");
      showToast(status.pendingRelaunch ? "info" : "success", status.pendingRelaunch ? "已恢复默认目录，重启应用后生效。" : "已恢复默认目录。");
    } catch (error) {
      showToast("error", errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function relaunchDesktopApp() {
    if (!window.vectorForgeDesktop || busy) return;
    setBusy("desktop-relaunch");
    try {
      const result = await window.vectorForgeDesktop.relaunch();
      if (result.dryRun) {
        setBusy(null);
        showToast("info", "Desktop relaunch dry-run completed.");
      }
    } catch (error) {
      setBusy(null);
      showToast("error", errorMessage(error));
    }
  }

  function requestDesktopRelaunch() {
    if (!window.vectorForgeDesktop || busy) return;
    setPendingDesktopRelaunch(true);
  }

  async function confirmDesktopRelaunch() {
    if (!pendingDesktopRelaunch) return;
    setPendingDesktopRelaunch(false);
    await relaunchDesktopApp();
  }

  function inferAiToolId(rawText: string, hasFiles: boolean) {
    const text = rawText.toLowerCase();
    if (hasFiles && (!text || /(导入|上传|处理|解析|ocr|入库|索引)/i.test(text))) return "documents.import";
    if (/(?:新建|创建|建立)\s*(?:知识库|collection)?\s*[:：]?\s*(.+)$/i.test(rawText)) return "collections.create";
    if (/(搜索|检索|查找|查询|找一下|帮我找|问一下)/i.test(text)) return "local.search";
    if (/(应用默认|恢复默认|使用默认)/i.test(text)) return "config.applyDefault";
    if (/(复制.*默认|设为默认|保存为默认)/i.test(text)) return "config.copyToDefault";
    if (/(保存|提交).*(配置|参数)|保存当前/i.test(text)) return "config.save";
    if (/(测试|检查).*(ocr|解析)/i.test(text)) return "ocr.test";
    if (/(测试|检查).*(embedding|嵌入|模型|向量)/i.test(text)) return "embedding.test";
    if (/(测试|检查|连接).*(anythingllm)/i.test(text)) return "anythingllm.test";
    if (/(同步|anythingllm)/i.test(text)) return "anythingllm.sync";
    return undefined;
  }

  async function dryRunAiPolicy(prompt: string, requestedToolId?: string) {
    setBusy("ai-policy");
    try {
      const decision = await api<AiToolDecisionResponse>("/api/ai/tools/dry-run", {
        method: "POST",
        body: JSON.stringify({
          prompt: prompt || "处理这些文件",
          requestedToolId,
          context: { source: "user" },
        }),
      });
      setAiDecision(decision);
      return decision;
    } catch (error) {
      const message = errorMessage(error);
      showToast("error", message);
      pushAiMessage("system", "AI 安全预检失败，未执行任何动作。", message);
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function loadAiToolRegistry() {
    if (busy) return false;
    setBusy("ai-policy");
    try {
      const payload = await api<{ tools: AiToolSummary[] }>("/api/ai/tools");
      setAiTools(payload.tools);
      showToast("success", `已加载 ${payload.tools.length} 个 AI 策略工具。`);
      return true;
    } catch (error) {
      showToast("error", errorMessage(error));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function loadAiToolAudit() {
    if (busy) return false;
    setBusy("ai-policy");
    try {
      const payload = await api<{ events: AiToolAuditEvent[] }>("/api/ai/tools/audit?limit=20");
      setAiAuditEvents(payload.events);
      showToast("success", payload.events.length ? `已加载 ${payload.events.length} 条 AI 审计记录。` : "暂无 AI 审计记录。");
      return true;
    } catch (error) {
      showToast("error", errorMessage(error));
      return false;
    } finally {
      setBusy(null);
    }
  }

  function shouldAutoRunAiTool(decision: AiToolDecisionResponse, requestedToolId?: string) {
    return (
      requestedToolId === "local.search" &&
      decision.highestRisk === "read" &&
      !decision.requiresConfirmation &&
      !decision.blocked
    );
  }

  function explainAiDecision(decision: AiToolDecisionResponse) {
    const tools = decision.tools?.map((tool) => tool.label).join(" / ") || decision.matchedToolIds.join(" / ");
    return `风险：${aiRiskLabel(decision.highestRisk)}；工具：${tools || "未匹配"}；原因：${decision.reason}`;
  }

  function stopAiForManualConfirmation(decision: AiToolDecisionResponse, requestedToolId?: string) {
    const title = decision.blocked ? "安全预检已阻断这条 AI 指令。" : "安全预检要求手动确认，AI 未自动执行。";
    const manualTarget = manualActionHint(requestedToolId);
    if (!decision.blocked && isAiConfirmableTool(requestedToolId)) {
      setPendingAiAction({
        toolId: requestedToolId!,
        command: decision.promptPreview,
        decision,
        fileCount: aiFiles.length,
      });
    } else {
      setPendingAiAction(null);
    }
    pushAiMessage("assistant", title, `${explainAiDecision(decision)}。${manualTarget}`);
  }

  async function previewAiPolicy(commandOverride?: string, requestedToolIdOverride?: string) {
    if (busy) {
      pushAiMessage("assistant", "当前已有任务在执行。", "等上一个操作结束后再做安全预检。");
      return;
    }
    const rawText = (commandOverride ?? aiInput).trim();
    const hasFiles = aiFiles.length > 0;
    if (!rawText && !hasFiles) {
      pushAiMessage("assistant", "请输入指令或附加文件后再做安全预检。");
      return;
    }
    const requestedToolId = requestedToolIdOverride || inferAiToolId(rawText, hasFiles);
    const decision = await dryRunAiPolicy(rawText || "处理这些文件", requestedToolId);
    if (!decision) return;
    const manualTarget = decision.requiresConfirmation || decision.blocked ? ` ${manualActionHint(requestedToolId)}` : "";
    pushAiMessage(
      "assistant",
      decision.blocked ? "安全预检：已阻断。" : decision.requiresConfirmation ? "安全预检：需要手动确认。" : "安全预检：只读动作可继续。",
      `${explainAiDecision(decision)}。${manualTarget}`.trim(),
    );
  }

  function attachAiFiles(files: FileList | File[] | null) {
    if (!files?.length) return;
    const incoming = Array.from(files);
    setAiFiles((current) => {
      const existing = new Set(current.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
      const next = [...current];
      for (const file of incoming) {
        const key = `${file.name}:${file.size}:${file.lastModified}`;
        if (!existing.has(key)) next.push(file);
      }
      return next.slice(0, 20);
    });
    pushAiMessage("system", `已附加 ${incoming.length} 个文件。`, "输入“导入这些文件”即可加入当前知识库处理队列。");
  }

  async function createCollectionWithName(name: string) {
    if (busy) return false;
    const trimmed = name.trim();
    if (!trimmed) return false;
    setBusy("create-collection");
    try {
      const payload = await api<{ collection: Collection; collections: Collection[] }>("/api/collections", {
        method: "POST",
        body: JSON.stringify({ name: trimmed, description: "从默认参数模板复制创建" }),
      });
      setCollections(payload.collections);
      setActiveSlug(payload.collection.slug);
      await refreshOnboarding(false);
      showToast("success", `已创建知识库：${payload.collection.name}`);
      return true;
    } catch (error) {
      showToast("error", errorMessage(error));
      return false;
    } finally {
      setBusy(null);
    }
  }

  function openCreateCollectionDialog(context: "normal" | "onboarding" = "normal") {
    if (busy) return;
    setCreateCollectionContext(context);
    setNewCollectionName("");
    setShowCreateCollectionDialog(true);
  }

  function createCollection() {
    openCreateCollectionDialog("normal");
  }

  async function completeOnboardingCollectionStep() {
    await patchOnboarding({
      currentStep: "embedding",
      steps: { collection: { status: "complete", lastError: null } },
    });
  }

  async function confirmCreateCollection() {
    const ok = await createCollectionWithName(newCollectionName);
    if (!ok) return false;
    const shouldAdvanceOnboarding = createCollectionContext === "onboarding";
    setShowCreateCollectionDialog(false);
    setNewCollectionName("");
    setCreateCollectionContext("normal");
    if (shouldAdvanceOnboarding) await completeOnboardingCollectionStep();
    return true;
  }

  async function uploadFiles(files: FileList | File[] | null, confirmedRisk = false, source: PendingProcessingAction["source"] = "ui") {
    const fileList = files ? Array.from(files) : [];
    if (!fileList.length) return false;
    if (busy) {
      showToast("info", "当前有任务运行中，请等待完成后再导入文件。");
      return false;
    }
    if (!activeCollection) {
      showToast("error", "Please create or select a knowledge base before importing files.");
      navigateToSection("collections");
      return false;
    }
    if (!confirmedRisk && processingRisk.requiresConfirmation) {
      setPendingProcessingAction({ kind: "upload", count: fileList.length, files: fileList, risk: processingRisk, source });
      return false;
    }
    setBusy("upload");
    try {
      const form = new FormData();
      fileList.forEach((file) => form.append("files", file));
      const payload = await uploadApi<{ jobs: ProcessingJob[]; collections: Collection[]; documents: DocumentRecord[] }>(
        `/api/collections/${encodeURIComponent(activeCollection.slug)}/upload-jobs`,
        form,
      );
      setJobs(payload.jobs);
      setCollections(payload.collections);
      setDocuments(payload.documents);
      showToast("success", `${fileList.length} 个文件已加入处理队列`);
      return true;
    } catch (error) {
      showToast("error", errorMessage(error));
      return false;
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
      setBusy(null);
    }
  }

  async function scanDirectory() {
    if (busy) {
      showToast("info", "当前有任务运行中，请等待完成后再扫描目录。");
      return false;
    }
    if (!activeCollection) {
      showToast("error", "Please create or select a knowledge base before scanning a directory.");
      navigateToSection("collections");
      return false;
    }
    if (!directoryPath.trim()) {
      showToast("error", "请输入要扫描的本地目录绝对路径。");
      return false;
    }
    setDirectoryScanId("");
    setDirectoryCandidates([]);
    setBusy("scan-directory");
    try {
      const payload = await api<{
        scanId: string;
        expiresAt: string;
        directoryPath: string;
        recursive: boolean;
        scanned: number;
        truncated: boolean;
        candidates: DirectoryScanCandidate[];
      }>(`/api/collections/${encodeURIComponent(activeCollection.slug)}/scan-directory`, {
        method: "POST",
        body: JSON.stringify({ directoryPath: directoryPath.trim(), recursive: directoryRecursive, maxFiles: 100 }),
      });
      setDirectoryPath(payload.directoryPath);
      setDirectoryScanId(payload.scanId);
      setDirectoryCandidates(payload.candidates);
      const suffix = payload.truncated ? "，已达到候选上限" : "";
      showToast("success", `已扫描 ${payload.scanned} 个文件，找到 ${payload.candidates.length} 个可导入候选${suffix}。`);
      return true;
    } catch (error) {
      showToast("error", errorMessage(error));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function importScannedPaths(paths: string[], confirmedRisk = false) {
    const uniquePaths = Array.from(new Set(paths)).filter(Boolean);
    if (!uniquePaths.length) {
      showToast("error", "请先选择要导入的扫描候选。");
      return false;
    }
    if (busy) {
      showToast("info", "当前有任务运行中，请等待完成后再导入扫描候选。");
      return false;
    }
    if (!activeCollection) {
      showToast("error", "Please create or select a knowledge base before importing files.");
      navigateToSection("collections");
      return false;
    }
    if (!directoryScanId) {
      showToast("error", "请先重新扫描目录，再导入候选文件。");
      return false;
    }
    if (!confirmedRisk && processingRisk.requiresConfirmation) {
      setPendingProcessingAction({ kind: "import-paths", count: uniquePaths.length, paths: uniquePaths, risk: processingRisk, source: "ui" });
      return false;
    }
    setBusy("import-paths");
    try {
      const payload = await api<{
        jobs: ProcessingJob[];
        failures: Array<{ path: string; error: string }>;
        collections: Collection[];
        documents: DocumentRecord[];
      }>(`/api/collections/${encodeURIComponent(activeCollection.slug)}/import-paths`, {
        method: "POST",
        body: JSON.stringify({ scanId: directoryScanId, paths: uniquePaths }),
      });
      setJobs(payload.jobs);
      setCollections(payload.collections);
      setDocuments(payload.documents);
      const failed = payload.failures.length;
      showToast(failed ? "error" : "success", failed ? `已加入 ${payload.jobs.length} 个任务，${failed} 个文件失败。` : `已将 ${payload.jobs.length} 个本地文件加入处理队列。`);
      return failed === 0;
    } catch (error) {
      const message = errorMessage(error);
      if (/Directory scan has expired|different knowledge base|current directory scan/i.test(message)) {
        setDirectoryScanId("");
        setDirectoryCandidates([]);
        setDocumentsSelectionResetKey((value) => value + 1);
        showToast("error", "扫描结果已过期或不匹配，请重新扫描目录后再导入。");
      } else {
        showToast("error", message);
      }
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function applyBatchDocumentsResponse(slug: string, payload?: BatchDocumentsResponse) {
    let needsRefresh = !payload;
    if (payload?.collections) setCollections(payload.collections);
    else needsRefresh = true;
    if (payload?.documents) setDocuments(payload.documents);
    else needsRefresh = true;
    if (payload?.jobs) setJobs(payload.jobs);
    else needsRefresh = true;
    if (needsRefresh) await refreshDocumentState(slug);
  }

  async function performBatchDeleteDocuments(documentIds: string[]) {
    const ids = Array.from(new Set(documentIds)).filter(Boolean);
    if (!ids.length) return false;
    if (!activeCollection) {
      showToast("error", "请先选择知识库。");
      return false;
    }
    if (busy) return false;
    setBusy("batch-delete");
    try {
      const payload = await api<BatchDocumentsResponse | undefined>(
        `/api/collections/${encodeURIComponent(activeCollection.slug)}/documents/batch-delete`,
        {
          method: "POST",
          body: JSON.stringify({ documentIds: ids }),
        },
      );
      await applyBatchDocumentsResponse(activeCollection.slug, payload);
      void loadAnythingCleanupQueueState(true);
      const succeeded = payload?.succeeded ?? ids.length;
      const failed = payload?.failed ?? 0;
      showToast(failed ? "error" : "success", failed ? `已删除 ${succeeded} 个文档，${failed} 个失败。` : `已删除 ${succeeded} 个文档。`);
      return failed === 0;
    } catch (error) {
      showToast("error", errorMessage(error));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function batchDeleteDocuments(documentIds: string[]) {
    const ids = Array.from(new Set(documentIds)).filter(Boolean);
    if (!ids.length) return false;
    if (!activeCollection) {
      showToast("error", "请先选择知识库。");
      return false;
    }
    if (busy) return false;
    setPendingBatchDeleteIds(ids);
    setBatchDeleteConfirmation("");
    return false;
  }

  async function confirmBatchDeleteDocuments() {
    const ids = Array.from(new Set(pendingBatchDeleteIds)).filter(Boolean);
    if (!ids.length) return false;
    if (!activeCollection || busy) return false;
    if (batchDeleteConfirmation !== activeCollection.slug) {
      showToast("info", "知识库 slug 确认不匹配，未删除文档。");
      return false;
    }
    const ok = await performBatchDeleteDocuments(ids);
    if (ok) {
      setPendingBatchDeleteIds([]);
      setBatchDeleteConfirmation("");
    }
    return ok;
  }

  async function batchReprocessDocuments(documentIds: string[], confirmedRisk = false) {
    const ids = Array.from(new Set(documentIds)).filter(Boolean);
    if (!ids.length) return false;
    if (!activeCollection) {
      showToast("error", "请先选择知识库。");
      return false;
    }
    if (busy) return false;
    if (!confirmedRisk && processingRisk.requiresConfirmation) {
      setPendingProcessingAction({ kind: "batch-reprocess", count: ids.length, documentIds: ids, risk: processingRisk, source: "ui" });
      return false;
    }
    setBusy("batch-reprocess");
    try {
      const payload = await api<BatchDocumentsResponse | undefined>(
        `/api/collections/${encodeURIComponent(activeCollection.slug)}/documents/batch-reprocess`,
        {
          method: "POST",
          body: JSON.stringify({ documentIds: ids }),
        },
      );
      await applyBatchDocumentsResponse(activeCollection.slug, payload);
      void loadAnythingCleanupQueueState(true);
      const succeeded = payload?.succeeded ?? ids.length;
      const failed = payload?.failed ?? 0;
      showToast(failed ? "error" : "success", failed ? `已加入 ${succeeded} 个重处理任务，${failed} 个失败。` : `已将 ${succeeded} 个文档加入重处理队列。`);
      return failed === 0;
    } catch (error) {
      showToast("error", errorMessage(error));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function cancelJob(jobId: string) {
    if (!jobId || cancellingJobId) return false;
    setCancellingJobId(jobId);
    try {
      const payload = await api<{ job: ProcessingJob }>(`/api/jobs/${encodeURIComponent(jobId)}/cancel`, {
        method: "POST",
        body: "{}",
      });
      setJobs((current) => current.map((job) => (job.id === payload.job.id ? payload.job : job)));
      showToast("success", "已请求取消任务。");
      return true;
    } catch (error) {
      showToast("error", errorMessage(error));
      return false;
    } finally {
      setCancellingJobId("");
    }
  }

  async function openDocumentDetail(documentId: string) {
    if (!activeCollection || !documentId) return false;
    if (busy) {
      showToast("info", "当前已有操作在执行，请稍后再打开文档详情。");
      return false;
    }
    setBusy("document-detail");
    try {
      const detailPayload = await api<DocumentDetailPayload>(`/api/collections/${encodeURIComponent(activeCollection.slug)}/documents/${encodeURIComponent(documentId)}`);
      setDocumentDetail(detailPayload);
      try {
        const textPayload = await api<DocumentTextPayload>(`/api/collections/${encodeURIComponent(activeCollection.slug)}/documents/${encodeURIComponent(documentId)}/extracted-text`);
        setDocumentText(textPayload);
      } catch (error) {
        setDocumentText(null);
        showToast("info", `全文预览加载失败，已使用 chunks 预览：${errorMessage(error)}`);
      }
      setActiveSection("documents");
      return true;
    } catch (error) {
      showToast("error", errorMessage(error));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function reprocessDocument(documentId: string, confirmedRisk = false) {
    if (!activeCollection || !documentId || busy) return false;
    if (!confirmedRisk && processingRisk.requiresConfirmation) {
      setPendingProcessingAction({ kind: "reprocess", count: 1, documentIds: [documentId], risk: processingRisk, source: "ui" });
      return false;
    }
    setBusy("document-reprocess");
    try {
      const payload = await api<{ job: ProcessingJob }>(
        `/api/collections/${encodeURIComponent(activeCollection.slug)}/documents/${encodeURIComponent(documentId)}/reprocess`,
        {
          method: "POST",
          body: "{}",
        },
      );
      setJobs((current) => [payload.job, ...current.filter((job) => job.id !== payload.job.id)]);
      showToast("success", "已加入重新处理队列。");
      await refreshDocumentState(activeCollection.slug);
      void loadAnythingCleanupQueueState(true);
      return true;
    } catch (error) {
      showToast("error", errorMessage(error));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function confirmPendingProcessingAction() {
    const action = pendingProcessingAction;
    if (!action || busy) return false;
    setPendingProcessingAction(null);
    if (action.kind === "upload") {
      const ok = await uploadFiles(action.files ?? [], true, action.source ?? "ui");
      if (ok && action.source === "ai") {
        setAiFiles([]);
        pushAiMessage("assistant", `已将 ${action.count} 个附件加入导入队列。`);
      }
      return ok;
    }
    if (action.kind === "import-paths") {
      const ok = await importScannedPaths(action.paths ?? [], true);
      if (ok) setDocumentsSelectionResetKey((value) => value + 1);
      return ok;
    }
    if (action.kind === "reprocess") return reprocessDocument(action.documentIds?.[0] || "", true);
    if (action.kind === "batch-reprocess") {
      const ok = await batchReprocessDocuments(action.documentIds ?? [], true);
      if (ok) setDocumentsSelectionResetKey((value) => value + 1);
      return ok;
    }
    return false;
  }

  function requestDeleteDocument(document: DocumentRecord) {
    setPendingDeleteDocument(document);
    setDeleteConfirmation("");
  }

  async function confirmDeleteDocument() {
    const document = pendingDeleteDocument;
    if (!document) return false;
    if (!activeCollection || busy) return false;
    if (deleteConfirmation !== document.name) {
      showToast("info", "文件名确认不匹配，未删除文档。");
      return false;
    }
    setBusy("document-delete");
    try {
      await api<{ deleted: string }>(
        `/api/collections/${encodeURIComponent(activeCollection.slug)}/documents/${encodeURIComponent(document.id)}`,
        { method: "DELETE" },
      );
      setDocumentDetail((current) => (current?.document.id === document.id ? null : current));
      setDocumentText((current) => (current?.document.id === document.id ? null : current));
      setPendingDeleteDocument(null);
      setDeleteConfirmation("");
      await refreshDocumentState(activeCollection.slug);
      void loadAnythingCleanupQueueState(true);
      showToast("success", "文档已删除。");
      return true;
    } catch (error) {
      showToast("error", errorMessage(error));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function copyTextToClipboard(text: string) {
    if (!text) return false;
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.setAttribute("readonly", "true");
    textArea.style.position = "fixed";
    textArea.style.left = "-9999px";
    document.body.appendChild(textArea);
    textArea.select();
    try {
      if (document.execCommand("copy")) return true;
    } catch {
      // Fall through to the async clipboard API when the legacy path is unavailable.
    } finally {
      document.body.removeChild(textArea);
    }
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  async function copyDocumentId(documentId: string) {
    if (!documentId) return;
    const ok = await copyTextToClipboard(documentId);
    showToast(ok ? "success" : "error", ok ? "文档 ID 已复制。" : "复制失败，请手动复制文档 ID。");
  }

  async function copyMcpResourceUri(uri: string) {
    const resolved = activeCollection ? uri.replace("{slug}", activeCollection.slug) : uri;
    const ok = await copyTextToClipboard(resolved);
    showToast(ok ? "success" : "error", ok ? "MCP resource URI 已复制。" : "复制失败，请手动复制 URI。");
  }

  async function runSearchForQuery(query: string, options: { revealResults?: boolean } = {}) {
    if (busy) return null;
    if (!activeCollection) return showToast("error", "请先选择知识库。");
    if (!query.trim()) return showToast("error", "请输入检索问题。");
    setBusy("search");
    try {
      const payload = await api<{ results: SearchResult[] }>(`/api/collections/${encodeURIComponent(activeCollection.slug)}/search`, {
        method: "POST",
        body: JSON.stringify({ query: query.trim(), topK }),
      });
      setSearchResults(payload.results);
      setHasSearched(true);
      if (options.revealResults) setActiveSection("search");
      if (!payload.results.length) showToast("info", "没有检索到结果。");
      return payload.results.length;
    } catch (error) {
      showToast("error", errorMessage(error));
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function runSearch() {
    await runSearchForQuery(searchQuery);
  }

  async function saveConfig() {
    if (!activeCollection || !config || busy) return false;
    setBusy("save-config");
    try {
      const payload = await api<CollectionConfigResponse>(`/api/collections/${encodeURIComponent(activeCollection.slug)}/config`, {
        method: "PUT",
        body: JSON.stringify(config),
      });
      applyConfigPayload(payload);
      showToast("success", "当前知识库参数已保存。");
      return true;
    } catch (error) {
      showToast("error", errorMessage(error));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function applyDefaultToCollection() {
    if (!activeCollection || busy) return false;
    setBusy("apply-default");
    try {
      const payload = await api<CollectionConfigResponse>(`/api/collections/${encodeURIComponent(activeCollection.slug)}/config/apply-default`, {
        method: "POST",
        body: "{}",
      });
      applyConfigPayload(payload);
      showToast("success", "已把默认模板复制到当前知识库。");
      return true;
    } catch (error) {
      showToast("error", errorMessage(error));
      return false;
    } finally {
      setBusy(null);
    }
  }

  function requestApplyDefaultToCollection() {
    if (!activeCollection || busy) return;
    setPendingApplyDefault(true);
  }

  async function confirmApplyDefaultToCollection() {
    if (!pendingApplyDefault) return false;
    setPendingApplyDefault(false);
    return applyDefaultToCollection();
  }

  async function copyCurrentToDefault() {
    if (!activeCollection || busy) return false;
    if (configDirty) {
      showToast("error", "请先保存当前知识库参数，再复制为默认模板。");
      return false;
    }
    setBusy("copy-default");
    try {
      const payload = await api<CollectionConfigResponse>(`/api/config/copy-from-collection/${encodeURIComponent(activeCollection.slug)}`, {
        method: "POST",
        body: "{}",
      });
      applyConfigPayload(payload);
      showToast("success", "已把当前知识库参数保存为默认模板。");
      return true;
    } catch (error) {
      showToast("error", errorMessage(error));
      return false;
    } finally {
      setBusy(null);
    }
  }

  function requestCopyCurrentToDefault() {
    if (!activeCollection || busy) return;
    if (configDirty) {
      showToast("error", "Save the current knowledge-base parameters before copying them as the default template.");
      return;
    }
      /*
      showToast("error", "璇峰厛淇濆瓨褰撳墠鐭ヨ瘑搴撳弬鏁帮紝鍐嶅鍒朵负榛樿妯℃澘銆?);
      return;
    }
      */
    setPendingCopyDefault(true);
  }

  async function confirmCopyCurrentToDefault() {
    if (!pendingCopyDefault) return false;
    setPendingCopyDefault(false);
    return copyCurrentToDefault();
  }

  async function testEmbedding() {
    if (!config || busy) return null;
    setBusy("test-embedding");
    try {
      const result = await api<{ provider: string; model: string; dimension: number }>("/api/test-embedding", {
        method: "POST",
        body: JSON.stringify(config),
      });
      showToast("success", `Embedding 可用：${result.provider} / ${result.model} / ${result.dimension} 维`);
    } catch (error) {
      showToast("error", errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  function ocrTestNeedsConfirmation(value: AppConfig | null) {
    if (!value) return false;
    return value.parsers.ocr.mode === "paddleocr" || value.parsers.ocr.mode === "cloud" || value.parsers.ocr.allowCloudOcr;
  }

  function requestTestOcr() {
    if (!config || busy) return;
    if (ocrTestNeedsConfirmation(config)) {
      setPendingOcrTest("config");
      return;
    }
    void performTestOcr();
  }

  async function confirmOcrTest() {
    const context = pendingOcrTest;
    if (!context || busy) return;
    setPendingOcrTest(null);
    if (context === "onboarding") {
      await performOnboardingOcrTest();
      return;
    }
    await performTestOcr();
  }

  async function performTestOcr() {
    if (!config || busy) return null;
    setBusy("test-ocr");
    try {
      const result = await api<{ ok: boolean; engine: string; message: string }>("/api/test-ocr", {
        method: "POST",
        body: JSON.stringify(config),
      });
      showToast(result.ok ? "success" : "error", `${result.engine}: ${result.message}`);
    } catch (error) {
      showToast("error", errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function testAnythingLLM() {
    if (!config || busy) return null;
    setBusy("test-anything");
    try {
      const result = await api<{ authenticated: boolean }>("/api/test-anythingllm", {
        method: "POST",
        body: JSON.stringify(config),
      });
      showToast(result.authenticated ? "success" : "error", result.authenticated ? "AnythingLLM 连接成功。" : "AnythingLLM 鉴权失败。");
    } catch (error) {
      showToast("error", errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function refreshAnythingEnvironment() {
    if (busy) return;
    setBusy("anything-env");
    try {
      const payload = await api<AnythingEnvironment>("/api/anythingllm/environment");
      setAnythingEnvironment(payload);
      setAnythingDesktopExePath(payload.desktop.configuredExe.path || payload.desktop.detectedExe?.path || "");
      showToast("success", payload.desktop.detectedExe?.launchable || payload.desktop.configuredExe.launchable ? "已检测到 AnythingLLM 桌面程序。" : "已刷新 AnythingLLM 环境，未检测到可启动程序。");
    } catch (error) {
      showToast("error", errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function saveAnythingExePath(clear = false) {
    if (busy) return;
    if (!clear && !anythingDesktopExePath.trim()) {
      showToast("error", "请输入 AnythingLLM.exe 的绝对路径，或点击清空。");
      return;
    }
    setBusy("anything-exe");
    try {
      const payload = await api<{ environment: AnythingEnvironment }>("/api/anythingllm/exe-path", {
        method: "PUT",
        body: JSON.stringify(clear ? { clear: true } : { exePath: anythingDesktopExePath.trim() }),
      });
      setAnythingEnvironment(payload.environment);
      setAnythingDesktopExePath(payload.environment.desktop.configuredExe.path || "");
      setDefaultConfig(await api<AppConfig>("/api/config"));
      showToast("success", clear ? "已清空 AnythingLLM 桌面路径。" : "AnythingLLM 桌面路径已保存。");
    } catch (error) {
      showToast("error", errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function testAnythingDesktop() {
    if (!config || busy) return;
    setBusy("test-anything");
    try {
      const result = await api<{
        ok: boolean;
        desktop: { ready: boolean; executable?: { path: string; error?: string } };
        api: { authenticated: boolean; error?: string };
      }>("/api/anythingllm/test", {
        method: "POST",
        body: JSON.stringify({
          anythingllm: {
            ...config.anythingllm,
            desktopExePath: anythingDesktopExePath,
          },
        }),
      });
      showToast(result.ok ? "success" : "error", result.ok ? "AnythingLLM 桌面程序和 API 都可用。" : `桌面：${result.desktop.ready ? "可用" : "不可用"}；API：${result.api.authenticated ? "可用" : result.api.error || "不可用"}`);
    } catch (error) {
      showToast("error", errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function loadAnythingWorkspaces() {
    if (busy) return;
    if (!config) {
      showToast("error", "请先选择知识库并加载 AnythingLLM 参数。");
      return;
    }
    if (!config.anythingllm.baseUrl.trim()) {
      setAnythingWorkspaces([]);
      showToast("error", "请先填写 AnythingLLM API 地址。");
      return;
    }
    if (!config.anythingllm.apiKey.trim()) {
      setAnythingWorkspaces([]);
      showToast("error", "请先填写 AnythingLLM API key。");
      return;
    }
    setBusy("anything-workspaces");
    try {
      const payload = await api<{ workspaces: AnythingWorkspaceSummary[] }>("/api/anythingllm/workspaces", {
        method: "POST",
        body: JSON.stringify({
          anythingllm: {
            ...config.anythingllm,
            desktopExePath: anythingDesktopExePath,
          },
        }),
      });
      setAnythingWorkspaces(payload.workspaces);
      showToast(
        "success",
        `${configDirty ? "已用当前草稿参数读取" : "已读取"} ${payload.workspaces.length} 个 AnythingLLM workspace。`,
      );
    } catch (error) {
      showToast("error", errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function downloadAnythingInstaller(dryRun: boolean) {
    if (busy) return;
    if (!anythingInstallerUrl.trim()) {
      showToast("error", "请输入官方 GitHub release 安装包直链。");
      return;
    }
    setBusy("anything-installer-download");
    try {
      const payload = await api<{ downloaded: boolean; dryRun: boolean; installer: { fileName: string; folder: string; bytes?: number } }>("/api/anythingllm/download-installer", {
        method: "POST",
        body: JSON.stringify({ installerUrl: anythingInstallerUrl.trim(), dryRun }),
      });
      showToast("success", payload.dryRun ? `链接格式通过：${payload.installer.fileName}` : `已下载：${payload.installer.fileName}`);
    } catch (error) {
      showToast("error", errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  function requestOpenAnythingInstallerFolder() {
    if (busy) return;
    setPendingDesktopAction("open-installer-folder");
  }

  function requestLaunchAnythingInstaller() {
    if (busy) return;
    setPendingDesktopAction("launch-installer");
  }

  async function confirmDesktopAction() {
    const action = pendingDesktopAction;
    if (!action || busy) return;
    setPendingDesktopAction(null);
    if (action === "open-installer-folder") {
      await performOpenAnythingInstallerFolder();
      return;
    }
    await performLaunchAnythingInstaller();
  }

  async function performOpenAnythingInstallerFolder() {
    if (busy) return;
    setBusy("anything-installer-folder");
    try {
      await api<{ opened: boolean; folder: string }>("/api/anythingllm/open-installer-folder", {
        method: "POST",
        body: JSON.stringify({}),
      });
      showToast("success", "已打开 AnythingLLM 安装器目录。");
    } catch (error) {
      showToast("error", errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function performLaunchAnythingInstaller() {
    if (busy) return;
    setBusy("anything-installer-launch");
    try {
      const check = await api<{ installer: { exists: boolean; fileName: string } }>("/api/anythingllm/launch-installer", {
        method: "POST",
        body: JSON.stringify({ dryRun: true }),
      });
      if (!check.installer.exists) {
        showToast("error", "托管目录里还没有可启动安装器，请先下载安装器。");
        return;
      }
      const payload = await api<{ launched: boolean; installer: { fileName: string } }>("/api/anythingllm/launch-installer", {
        method: "POST",
        body: JSON.stringify({}),
      });
      showToast(payload.launched ? "success" : "error", payload.launched ? `已启动安装器：${payload.installer.fileName}` : "没有启动安装器。");
    } catch (error) {
      showToast("error", errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  function requestSyncAnythingLLM() {
    if (busy) return;
    setPendingAnythingSync(true);
  }

  async function confirmSyncAnythingLLM() {
    if (!pendingAnythingSync || busy) return;
    setPendingAnythingSync(false);
    await syncAnythingLLM();
  }

  async function syncAnythingLLM() {
    if (busy) return;
    if (!activeCollection) {
      showToast("error", "Please select a knowledge base before syncing.");
      return;
    }
    if (configDirty) {
      showToast("error", "Please save the current knowledge base parameters before syncing to AnythingLLM.");
      navigateToSection("anythingllm");
      return;
    }
    if (!anythingLLMReady) {
      showToast("error", "Please enable AnythingLLM and fill in the API URL and key first.");
      navigateToSection("anythingllm");
      return;
    }
    setBusy("sync-anything");
    try {
      const result = await api<{ uploaded: number; skipped?: number; embedded: number; remaining?: number }>(`/api/collections/${encodeURIComponent(activeCollection.slug)}/sync-anythingllm`, {
        method: "POST",
        body: JSON.stringify({ maxChunks: 200 }),
      });
      await refreshDocumentState(activeCollection.slug);
      const remainingNote = result.remaining ? `，剩余 ${result.remaining} 个待继续同步` : "";
      showToast("success", `已同步 ${result.uploaded} 个新 chunks，跳过 ${result.skipped ?? 0} 个已同步记录，embedded ${result.embedded}${remainingNote}。`);
    } catch (error) {
      showToast("error", errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function refreshAnythingCleanupQueue() {
    if (busy) {
      showToast("info", "当前已有操作在执行，请稍后再刷新清理队列。");
      return false;
    }
    setBusy("anything-cleanup");
    try {
      const payload = await loadAnythingCleanupQueueState(false);
      if (!payload) return false;
      const suffix = payload.counts.pending ? `，${payload.counts.pending} 个待处理` : "";
      showToast("success", payload.counts.total ? `已刷新 AnythingLLM 清理队列${suffix}。` : "AnythingLLM 清理队列为空。");
      return true;
    } finally {
      setBusy(null);
    }
  }

  function requestCleanupQueueRetry(ids?: string[]) {
    if (busy) return;
    const queue = anythingCleanupQueue;
    if (!queue) {
      showToast("info", "请先刷新 AnythingLLM 清理队列。");
      return;
    }
    const idSet = ids?.length ? new Set(ids) : null;
    const candidates = queue.entries.filter((entry) => (!idSet || idSet.has(entry.id)) && entry.status === "pending");
    if (!candidates.length) {
      showToast("info", "没有可重试的 pending 清理记录。");
      return;
    }
    setPendingCleanupQueueRetry({
      ids: idSet ? candidates.map((entry) => entry.id) : undefined,
      label: idSet ? candidates.map((entry) => entry.documentName || entry.collectionSlug).join("、") : "全部 pending 清理记录",
    });
  }

  async function confirmCleanupQueueRetry() {
    const request = pendingCleanupQueueRetry;
    if (!request || busy) return false;
    setPendingCleanupQueueRetry(null);
    setBusy("anything-cleanup");
    try {
      const result = await api<{ ok: boolean; anythingCleanup: AnythingCleanupSummary; queue: AnythingCleanupQueuePayload }>(
        "/api/anythingllm/cleanup-queue/retry",
        {
          method: "POST",
          body: JSON.stringify(request.ids?.length ? { ids: request.ids } : {}),
        },
      );
      setAnythingCleanupQueue(result.queue);
      if (activeCollection) await refreshDocumentState(activeCollection.slug).catch(() => undefined);
      const failed = result.anythingCleanup.failed ?? 0;
      const pending = result.queue.counts.pending;
      if (result.ok) {
        showToast("success", `清理队列已重试，删除 ${result.anythingCleanup.deleted} 个远端 embedding location。`);
      } else {
        showToast("error", `清理队列仍有 ${pending} 个待处理记录，失败 ${failed} 个，跳过 ${result.anythingCleanup.skipped} 个 location。`);
      }
      return result.ok;
    } catch (error) {
      showToast("error", errorMessage(error));
      await loadAnythingCleanupQueueState(true);
      return false;
    } finally {
      setBusy(null);
    }
  }

  function requestAnythingCleanup(document: DocumentRecord) {
    if (busy) return;
    setPendingAnythingCleanupDocument(document);
  }

  async function confirmAnythingCleanup() {
    const document = pendingAnythingCleanupDocument;
    if (!document || busy) return;
    setPendingAnythingCleanupDocument(null);
    await retryAnythingCleanup(document.id);
  }

  async function retryAnythingCleanup(documentId: string) {
    if (!activeCollection || !documentId || busy) return false;
    setBusy("anything-cleanup");
    try {
      const result = await api<{
        ok: boolean;
        pending: number;
        anythingCleanup: { deleted: number; skipped: number };
        document: DocumentRecord;
      }>(`/api/collections/${encodeURIComponent(activeCollection.slug)}/documents/${encodeURIComponent(documentId)}/retry-anythingllm-cleanup`, {
        method: "POST",
        body: "{}",
      });
      await refreshDocumentState(activeCollection.slug);
      const detailPayload = await api<DocumentDetailPayload>(`/api/collections/${encodeURIComponent(activeCollection.slug)}/documents/${encodeURIComponent(documentId)}`);
      setDocumentDetail(detailPayload);
      try {
        const textPayload = await api<DocumentTextPayload>(`/api/collections/${encodeURIComponent(activeCollection.slug)}/documents/${encodeURIComponent(documentId)}/extracted-text`);
        setDocumentText(textPayload);
      } catch {
        setDocumentText(null);
      }
      void loadAnythingCleanupQueueState(true);
      if (result.ok) {
        showToast("success", `AnythingLLM 清理已重试，删除 ${result.anythingCleanup.deleted} 个远端 embedding 记录。`);
      } else {
        showToast("error", `AnythingLLM 清理仍有 ${result.pending} 个记录待处理，跳过 ${result.anythingCleanup.skipped} 个。`);
      }
      return result.ok;
    } catch (error) {
      showToast("error", errorMessage(error));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function copyCitation() {
    const first = searchResults[0];
    if (!first) return showToast("info", "没有可复制的引用。");
    const ok = await copyTextToClipboard(`${first.sourceName} #${first.chunkIndex + 1}: ${first.preview || summarize(first.text, 160)}`);
    showToast(ok ? "success" : "error", ok ? "引用片段已复制。" : "复制失败，请手动复制引用片段。");
  }

  async function runAiCommand(commandOverride?: string, requestedToolIdOverride?: string) {
    if (busy) {
      pushAiMessage("assistant", "当前已有任务在执行。", "等上一个操作结束后，我再处理下一条指令。");
      return;
    }

    const rawText = (commandOverride ?? aiInput).trim();
    const files = aiFiles;
    if (!rawText && !files.length) {
      pushAiMessage("assistant", "先告诉我要做什么，或者附加文件。", "我能处理：导入文件、检索问题、保存/应用配置、测试 OCR/embedding、同步 AnythingLLM。");
      return;
    }

    pushAiMessage("user", rawText || "处理这些文件", files.length ? files.map((file) => file.name).join(" / ") : undefined);
    setAiInput("");
    setPendingAiAction(null);

    const text = rawText.toLowerCase();
    const hasFiles = files.length > 0;
    const requestedToolId = requestedToolIdOverride || inferAiToolId(rawText, hasFiles);
    const decision = await dryRunAiPolicy(rawText || "处理这些文件", requestedToolId);
    if (!decision) return;
    if (!shouldAutoRunAiTool(decision, requestedToolId)) {
      stopAiForManualConfirmation(decision, requestedToolId);
      return;
    }

    if (/(搜索|检索|查找|查询|找一下|帮我找|问一下)/i.test(text)) {
      const query = rawText
        .replace(/^(搜索|检索|查找|查询|找一下|帮我找|问一下)\s*[:：]?\s*/i, "")
        .trim() || rawText;
      pushAiMessage("assistant", `正在本地检索：${query}`, activeCollection ? `知识库：${activeCollection.name}` : "请先选择知识库。");
      const count = await runSearchForQuery(query, { revealResults: true });
      if (typeof count === "number") pushAiMessage("assistant", count ? `检索完成，返回 ${count} 条结果。` : "检索完成，但没有命中结果。");
      return;
    }

    pushAiMessage("assistant", "安全预检已通过，但这条指令没有可自动执行的只读动作。", "目前 AI 控制台只会自动执行本地检索；写入、同步、测试和本地执行类动作请使用页面上的明确按钮。");
  }

  async function confirmPendingAiAction() {
    const action = pendingAiAction;
    if (!action || busy) return false;
    setPendingAiAction(null);
    pushAiMessage("user", `确认执行：${action.command || action.toolId}`);

    if (action.toolId === "documents.import") {
      if (!aiFiles.length) {
        pushAiMessage("assistant", "没有可导入的附件。", "请先拖入文件或点击“附件”选择文件。");
        return false;
      }
      const ok = await uploadFiles(aiFiles, false, "ai");
      if (ok) {
        setAiFiles([]);
        pushAiMessage("assistant", `已将 ${action.fileCount || aiFiles.length} 个附件加入导入队列。`);
      }
      return ok;
    }

    if (action.toolId === "config.save") return saveConfig();
    if (action.toolId === "config.applyDefault") {
      requestApplyDefaultToCollection();
      pushAiMessage("assistant", "已打开应用默认参数确认。", "确认前不会覆盖当前知识库参数。");
      return true;
    }
    if (action.toolId === "config.copyToDefault") {
      requestCopyCurrentToDefault();
      pushAiMessage("assistant", "Opened the copy-default confirmation.", "The global default template will not change until you confirm.");
      /*
      pushAiMessage("assistant", "宸叉墦寮€澶嶅埗涓洪粯璁ょ‘璁ゃ€?, "纭鍓嶄笉浼氭敼鍙樺叏灞€榛樿妯℃澘銆?);
      */
      return true;
    }
    if (action.toolId === "ocr.test") {
      requestTestOcr();
      pushAiMessage("assistant", ocrTestNeedsConfirmation(config) ? "已打开 OCR 风险确认。" : "已开始 OCR 测试。");
      return true;
    }
    if (action.toolId === "embedding.test") {
      await testEmbedding();
      return true;
    }
    if (action.toolId === "anythingllm.test") return testAnythingLLM();
    if (action.toolId === "anythingllm.sync") {
      requestSyncAnythingLLM();
      pushAiMessage("assistant", "已打开 AnythingLLM 同步确认。");
      return true;
    }

    pushAiMessage("assistant", "这条 AI 动作没有可执行入口。", manualActionHint(action.toolId));
    return false;
  }

  async function confirmOnboardingData() {
    await patchOnboarding({
      currentStep: "collection",
      steps: { data: { status: "complete", lastError: null } },
    });
  }

  async function confirmOnboardingCollection() {
    if (!activeCollection) {
      openCreateCollectionDialog("onboarding");
      showToast("info", "请先创建知识库；创建成功后向导会继续到 embedding 测试。");
      return;
    }
    await completeOnboardingCollectionStep();
  }

  async function confirmOnboardingEmbedding() {
    if (!config || busy) return;
    setBusy("test-embedding");
    try {
      const result = await api<{ provider: string; model: string; dimension: number }>("/api/test-embedding", {
        method: "POST",
        body: JSON.stringify(config),
      });
      showToast("success", `Embedding 可用：${result.provider} / ${result.model} / ${result.dimension} 维`);
      await patchOnboarding({
        currentStep: "ocr",
        steps: { embedding: { status: "complete", lastError: null } },
        lastResults: { embedding: result },
      });
    } catch (error) {
      const message = errorMessage(error);
      showToast("error", message);
      await patchOnboarding({
        currentStep: "embedding",
        steps: { embedding: { status: "failed", lastError: message } },
      });
    } finally {
      setBusy(null);
    }
  }

  function requestOnboardingOcrTest() {
    if (!config || busy) return;
    if (ocrTestNeedsConfirmation(config)) {
      setPendingOcrTest("onboarding");
      return;
    }
    void performOnboardingOcrTest();
  }

  async function performOnboardingOcrTest() {
    if (!config || busy) return;
    setBusy("test-ocr");
    try {
      const result = await api<{ ok: boolean; engine: string; message: string }>("/api/test-ocr", {
        method: "POST",
        body: JSON.stringify(config),
      });
      showToast(result.ok ? "success" : "error", `${result.engine}: ${result.message}`);
      await patchOnboarding({
        currentStep: "anythingllm",
        steps: { ocr: { status: result.ok ? "complete" : "failed", lastError: result.ok ? null : result.message } },
        lastResults: { ocr: result },
      });
    } catch (error) {
      const message = errorMessage(error);
      showToast("error", message);
      await patchOnboarding({
        currentStep: "ocr",
        steps: { ocr: { status: "failed", lastError: message } },
      });
    } finally {
      setBusy(null);
    }
  }

  async function skipOnboardingOcr() {
    await patchOnboarding({
      currentStep: "anythingllm",
      steps: { ocr: { status: "skipped", lastError: null } },
    });
  }

  async function skipOnboardingAnything() {
    await patchOnboarding({
      currentStep: "finish",
      steps: { anythingllm: { status: "skipped", lastError: null } },
    });
  }

  async function confirmOnboardingAnything() {
    if (!config || busy) return;
    if (!config.anythingllm.enabled) {
      await skipOnboardingAnything();
      return;
    }
    if (!config.anythingllm.baseUrl.trim() || !config.anythingllm.apiKey.trim()) {
      const missing = !config.anythingllm.baseUrl.trim() ? "AnythingLLM API 地址" : "AnythingLLM API key";
      const message = `已启用 AnythingLLM，但缺少 ${missing}。请先在参数面板补齐，或关闭 AnythingLLM 后再跳过。`;
      showToast("error", message);
      await patchOnboarding({
        currentStep: "anythingllm",
        steps: { anythingllm: { status: "failed", lastError: message } },
      });
      return;
    }
    setBusy("test-anything");
    try {
      const result = await api<{ authenticated: boolean }>("/api/test-anythingllm", {
        method: "POST",
        body: JSON.stringify(config),
      });
      showToast(result.authenticated ? "success" : "error", result.authenticated ? "AnythingLLM 连接成功。" : "AnythingLLM 鉴权失败。");
      await patchOnboarding({
        currentStep: "finish",
        steps: { anythingllm: { status: result.authenticated ? "complete" : "failed", lastError: result.authenticated ? null : "Authentication failed." } },
        lastResults: { anythingllm: result },
      });
    } catch (error) {
      const message = errorMessage(error);
      showToast("error", message);
      await patchOnboarding({
        currentStep: "anythingllm",
        steps: { anythingllm: { status: "failed", lastError: message } },
      });
    } finally {
      setBusy(null);
    }
  }

  async function dismissOnboarding() {
    await patchOnboarding({ dismissed: true }, false);
    setShowOnboarding(false);
  }

  const page = pageCopy[activeSection];
  const configPage: ConfigInspectorPage | null =
    activeSection === "collections" ||
    activeSection === "jobs" ||
    activeSection === "parsers" ||
    activeSection === "mcp" ||
    activeSection === "anythingllm" ||
    activeSection === "settings"
      ? activeSection
      : null;

  return (
    <main className="forge-shell">
      <Sidebar
        health={health}
        onboardingPayload={onboardingPayload}
        config={config}
        defaultConfig={defaultConfig}
        activeCollection={activeCollection}
        collections={collections}
        activeSlug={activeSlug}
        activeSection={activeSection}
        busy={busy}
        runningJobs={runningJobs.length}
        failedDocuments={failedDocuments}
        onRefresh={() => void refreshAll(activeSlug)}
        onImport={openImportPicker}
        onNavigate={navigateToSection}
        onOpenOnboarding={() => {
          setShowOnboarding(true);
          void refreshOnboarding(false);
        }}
        onResetOnboarding={() => void resetOnboarding()}
        onboardingBusy={onboardingBusy}
      />

      <section className="forge-main">
        <TopBar
          title={page.title}
          description={page.description}
          health={health}
          activeCollection={activeCollection}
          busy={busy}
          canImport={Boolean(activeCollection)}
          canSyncAnythingLLM={canSyncAnythingLLM}
          anythingSyncDisabledReason={anythingSyncDisabledReason}
          onImport={openImportPicker}
          onSync={requestSyncAnythingLLM}
        />

        {activeSection === "overview" && (
          <MetricGrid
            collections={collections.length}
            documents={documents.length}
            chunks={totalChunks}
            runningJobs={runningJobs.length}
            failedDocuments={failedDocuments}
          />
        )}

        <div className={`workbench-grid ${configPage ? "config-page" : "single-page"}`}>
          <section className="primary-column">
            {activeSection === "overview" && (
              <section className="panel overview-panel" id="section-overview">
                <div className="panel-heading">
                  <div>
                    <h2>当前工作状态</h2>
                    <p>知识库、检索、导入任务和桌面交付状态分开展示；从左侧进入对应页面处理。</p>
                  </div>
                  <Database size={18} />
                </div>
                <div className="overview-status-grid">
                  <DetailItem label="当前知识库" value={activeCollection ? `${activeCollection.name} / ${activeCollection.slug}` : "未选择"} />
                  <DetailItem label="Embedding" value={config ? `${config.embedding.provider} / ${config.embedding.model} / ${config.embedding.dimension}` : "未加载"} />
                  <DetailItem label="OCR" value={config ? `${config.parsers.ocr.mode} / ${config.parsers.ocr.language}` : "未加载"} />
                  <DetailItem label="任务" value={`${runningJobs.length} running / ${failedDocuments} failed`} />
                </div>
              </section>
            )}
            {activeSection === "ai" && (
            <AiControlPanel
              activeCollection={activeCollection}
              configReady={Boolean(activeCollection && config)}
              canSyncAnythingLLM={canSyncAnythingLLM}
              messages={aiMessages}
              tools={aiTools}
              auditEvents={aiAuditEvents}
              lastDecision={aiDecision}
              pendingAction={pendingAiAction}
              input={aiInput}
              files={aiFiles}
              busy={busy}
              onInput={setAiInput}
              onAttach={attachAiFiles}
              onRemoveFile={(index) => setAiFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}
              onPickFiles={() => aiFileInputRef.current?.click()}
              onRun={() => void runAiCommand()}
              onSafetyCheck={() => void previewAiPolicy()}
              onLoadTools={() => void loadAiToolRegistry()}
              onLoadAudit={() => void loadAiToolAudit()}
              onQuickCommand={(command, toolId) => void runAiCommand(command, toolId)}
              onConfirmPendingAction={() => void confirmPendingAiAction()}
              onCancelPendingAction={() => setPendingAiAction(null)}
            />
            )}
            {activeSection === "search" && (
            <SearchPanel
              query={searchQuery}
              topK={topK}
              results={searchResults}
              hasSearched={hasSearched}
              busy={busy}
              canSearch={Boolean(activeCollection && searchQuery.trim())}
              onQuery={setSearchQuery}
              onTopK={setTopK}
              onSearch={() => void runSearch()}
              onCopyCitation={() => void copyCitation()}
              onOpenDocument={(documentId) => {
                setActiveSection("documents");
                void openDocumentDetail(documentId);
              }}
            />
            )}
            {activeSection === "documents" && (
              <>
            <DocumentsPanel
              documents={documents}
              busy={busy}
              canImport={Boolean(activeCollection)}
              directoryPath={directoryPath}
              directoryRecursive={directoryRecursive}
              directoryCandidates={directoryCandidates}
              selectionResetKey={documentsSelectionResetKey}
              onImport={openImportPicker}
              onDirectoryPath={(value) => {
                setDirectoryPath(value);
                setDirectoryScanId("");
                setDirectoryCandidates([]);
              }}
              onDirectoryRecursive={(value) => {
                setDirectoryRecursive(value);
                setDirectoryScanId("");
                setDirectoryCandidates([]);
              }}
              onScanDirectory={() => void scanDirectory()}
              onImportPaths={(paths) => importScannedPaths(paths)}
              onBatchDelete={batchDeleteDocuments}
              onBatchReprocess={batchReprocessDocuments}
              onOpenDocument={(documentId) => void openDocumentDetail(documentId)}
              onDeleteDocument={requestDeleteDocument}
              onReprocessDocument={(documentId) => void reprocessDocument(documentId)}
            />
            <DocumentDetailPanel
              detail={documentDetail}
              text={documentText}
              busy={busy}
              onClose={() => {
                setDocumentDetail(null);
                setDocumentText(null);
              }}
              onCopyId={(documentId) => void copyDocumentId(documentId)}
              onDelete={requestDeleteDocument}
              onReprocess={(documentId) => void reprocessDocument(documentId)}
              onRetryAnythingCleanup={requestAnythingCleanup}
            />
              </>
            )}
          </section>

          {configPage && (
          <ConfigInspector
            page={configPage}
            config={config}
            defaultConfig={defaultConfig}
            status={configStatus}
            collections={collections}
            activeSlug={activeSlug}
            activeCollection={activeCollection}
            jobs={jobs}
            busy={busy}
            configDirty={configDirty}
            canSyncAnythingLLM={canSyncAnythingLLM}
            anythingSyncDisabledReason={anythingSyncDisabledReason}
            anythingEnvironment={anythingEnvironment}
            anythingWorkspaces={anythingWorkspaces}
            anythingCleanupQueue={anythingCleanupQueue}
            desktopDataDir={desktopDataDir}
            desktopDataDirDraft={desktopDataDirDraft}
            desktopDataDirDirty={desktopDataDirDirty}
            anythingDesktopExePath={anythingDesktopExePath}
            anythingInstallerUrl={anythingInstallerUrl}
            onActiveSlug={(slug) => {
              setActiveSlug(slug);
              void loadCollectionBundle(slug, false);
            }}
            onCreateCollection={createCollection}
            onPatch={patchConfig}
            onSave={() => void saveConfig()}
            onApplyDefault={requestApplyDefaultToCollection}
            onCopyDefault={requestCopyCurrentToDefault}
            onCopyMcpResource={(uri) => void copyMcpResourceUri(uri)}
            onTestEmbedding={() => void testEmbedding()}
            onTestOcr={requestTestOcr}
            onTestAnything={() => void testAnythingLLM()}
            onDesktopDataDirDraft={setDesktopDataDirDraft}
            onChooseDesktopDataDir={() => void chooseDesktopDataDirectory()}
            onSaveDesktopDataDir={() => void saveDesktopDataDirectory()}
            onResetDesktopDataDir={() => void resetDesktopDataDirectory()}
            onRelaunchDesktop={requestDesktopRelaunch}
            onRefreshAnythingEnvironment={() => void refreshAnythingEnvironment()}
            onAnythingDesktopExePath={setAnythingDesktopExePath}
            onSaveAnythingExePath={() => void saveAnythingExePath(false)}
            onClearAnythingExePath={() => void saveAnythingExePath(true)}
            onTestAnythingDesktop={() => void testAnythingDesktop()}
            onLoadAnythingWorkspaces={() => void loadAnythingWorkspaces()}
            onAnythingInstallerUrl={setAnythingInstallerUrl}
            onValidateAnythingInstaller={() => void downloadAnythingInstaller(true)}
            onDownloadAnythingInstaller={() => void downloadAnythingInstaller(false)}
            onOpenAnythingInstallerFolder={requestOpenAnythingInstallerFolder}
            onLaunchAnythingInstaller={requestLaunchAnythingInstaller}
            onSync={requestSyncAnythingLLM}
            onRefreshAnythingCleanupQueue={() => void refreshAnythingCleanupQueue()}
            onRetryAnythingCleanupQueue={(ids) => requestCleanupQueueRetry(ids)}
            onCancelJob={(jobId) => void cancelJob(jobId)}
            cancellingJobId={cancellingJobId}
          />
          )}
        </div>
      </section>

      <input ref={fileInputRef} className="hidden-file-input" type="file" multiple accept={supportedFormats} onChange={(event) => void uploadFiles(event.target.files)} />
      <input
        ref={aiFileInputRef}
        className="hidden-file-input"
        type="file"
        multiple
        accept={supportedFormats}
        onChange={(event) => {
          attachAiFiles(event.target.files);
          event.currentTarget.value = "";
        }}
      />
      <OnboardingWizard
        payload={onboardingPayload}
        open={showOnboarding}
        busy={busy}
        onboardingBusy={onboardingBusy}
        activeCollection={activeCollection}
        config={config}
        desktopDataDir={desktopDataDir}
        desktopDataDirDraft={desktopDataDirDraft}
        desktopDataDirDirty={desktopDataDirDirty}
        onDesktopDataDirDraft={setDesktopDataDirDraft}
        onChooseDesktopDataDir={() => void chooseDesktopDataDirectory()}
        onSaveDesktopDataDir={() => void saveDesktopDataDirectory()}
        onResetDesktopDataDir={() => void resetDesktopDataDirectory()}
        onRelaunchDesktop={requestDesktopRelaunch}
        onClose={() => void dismissOnboarding()}
        onConfirmData={() => void confirmOnboardingData()}
        onConfirmCollection={() => void confirmOnboardingCollection()}
        onConfirmEmbedding={() => void confirmOnboardingEmbedding()}
        onConfirmOcr={requestOnboardingOcrTest}
        onSkipOcr={() => void skipOnboardingOcr()}
        onConfirmAnything={() => void confirmOnboardingAnything()}
        onSkipAnything={() => void skipOnboardingAnything()}
        onComplete={() => void completeOnboarding()}
        onReset={() => void resetOnboarding()}
      />
      <CreateCollectionDialog
        open={showCreateCollectionDialog}
        context={createCollectionContext}
        name={newCollectionName}
        defaultConfig={defaultConfig}
        busy={busy}
        onName={setNewCollectionName}
        onCancel={() => {
          setShowCreateCollectionDialog(false);
          setNewCollectionName("");
          setCreateCollectionContext("normal");
        }}
        onConfirm={() => void confirmCreateCollection()}
      />
      <BatchDeleteDocumentsDialog
        collection={activeCollection}
        documents={pendingBatchDeleteDocuments}
        totalCount={pendingBatchDeleteIds.length}
        confirmation={batchDeleteConfirmation}
        busy={busy}
        onConfirmation={setBatchDeleteConfirmation}
        onCancel={() => {
          setPendingBatchDeleteIds([]);
          setBatchDeleteConfirmation("");
        }}
        onConfirm={() => void confirmBatchDeleteDocuments()}
      />
      <ApplyDefaultConfirmDialog
        open={pendingApplyDefault}
        collection={activeCollection}
        config={config}
        defaultConfig={defaultConfig}
        configDirty={configDirty}
        busy={busy}
        onCancel={() => setPendingApplyDefault(false)}
        onConfirm={() => void confirmApplyDefaultToCollection()}
      />
      <CopyDefaultConfirmDialog
        open={pendingCopyDefault}
        collection={activeCollection}
        config={config}
        busy={busy}
        onCancel={() => setPendingCopyDefault(false)}
        onConfirm={() => void confirmCopyCurrentToDefault()}
      />
      <DesktopRelaunchConfirmDialog
        open={pendingDesktopRelaunch}
        status={desktopDataDir}
        busy={busy}
        onCancel={() => setPendingDesktopRelaunch(false)}
        onConfirm={() => void confirmDesktopRelaunch()}
      />
      <DeleteDocumentDialog
        document={pendingDeleteDocument}
        confirmation={deleteConfirmation}
        busy={busy}
        onConfirmation={setDeleteConfirmation}
        onCancel={() => {
          setPendingDeleteDocument(null);
          setDeleteConfirmation("");
        }}
        onConfirm={() => void confirmDeleteDocument()}
      />
      <DesktopActionConfirmDialog
        action={pendingDesktopAction}
        busy={busy}
        onCancel={() => setPendingDesktopAction(null)}
        onConfirm={() => void confirmDesktopAction()}
      />
      <AnythingSyncConfirmDialog
        open={pendingAnythingSync}
        collection={activeCollection}
        config={config}
        busy={busy}
        onCancel={() => setPendingAnythingSync(false)}
        onConfirm={() => void confirmSyncAnythingLLM()}
      />
      <AnythingCleanupConfirmDialog
        document={pendingAnythingCleanupDocument}
        busy={busy}
        onCancel={() => setPendingAnythingCleanupDocument(null)}
        onConfirm={() => void confirmAnythingCleanup()}
      />
      <AnythingCleanupQueueConfirmDialog
        request={pendingCleanupQueueRetry}
        queue={anythingCleanupQueue}
        busy={busy}
        onCancel={() => setPendingCleanupQueueRetry(null)}
        onConfirm={() => void confirmCleanupQueueRetry()}
      />
      <OcrTestConfirmDialog
        context={pendingOcrTest}
        config={config}
        busy={busy}
        onCancel={() => setPendingOcrTest(null)}
        onConfirm={() => void confirmOcrTest()}
      />
      <ProcessingRiskConfirmDialog
        action={pendingProcessingAction}
        collection={activeCollection}
        busy={busy}
        onCancel={() => setPendingProcessingAction(null)}
        onConfirm={() => void confirmPendingProcessingAction()}
      />
      {toast && <ToastView toast={toast} />}
    </main>
  );
}

function Sidebar(props: {
  health: Health | null;
  onboardingPayload: OnboardingPayload | null;
  config: AppConfig | null;
  defaultConfig: AppConfig | null;
  activeCollection: Collection | null;
  collections: Collection[];
  activeSlug: string;
  activeSection: SectionId;
  busy: BusyState;
  runningJobs: number;
  failedDocuments: number;
  onRefresh: () => void;
  onImport: () => void;
  onNavigate: (sectionId: SectionId, targetId: string) => void;
  onOpenOnboarding: () => void;
  onResetOnboarding: () => void;
  onboardingBusy: "" | "patch" | "complete" | "reset";
}) {
  const onboarding = props.onboardingPayload?.onboarding;
  const readiness = props.onboardingPayload?.readiness;
  const stepDone = (step: Exclude<OnboardingStepId, "finish">) => onboarding?.steps[step]?.status === "complete" || onboarding?.steps[step]?.status === "skipped";
  return (
    <aside className="forge-sidebar">
      <div className="brand-row">
        <div className="brand-mark">KF</div>
        <div className="brand-copy">
          <strong>Knowledge Forge</strong>
          <span>本地向量库工作台</span>
        </div>
        <button className="mobile-import" onClick={props.onImport} disabled={!props.activeCollection || Boolean(props.busy)} title={props.busy ? "当前有任务运行中" : props.activeCollection ? "导入文件" : "请先新建或选择知识库"}>导入</button>
      </div>

      <nav className="side-nav" aria-label="主导航">
        {navItems.map((item) => {
          const disabled = Boolean(item.requiresConfig && !props.config);
          return (
            <button
              key={item.id}
              type="button"
              data-testid={`nav-${item.id}`}
              className={props.activeSection === item.id ? "active" : ""}
              onClick={() => props.onNavigate(item.id, item.targetId)}
              disabled={disabled}
              title={disabled ? "请先选择或新建知识库" : item.label}
            >
              <span className="nav-icon" />
              {item.label}
            </button>
          );
        })}
      </nav>

      <section className="sidebar-status">
        <div className="sidebar-title">
          <span>系统状态</span>
          <button className="icon-button" onClick={props.onRefresh} disabled={Boolean(props.busy)} title={props.busy ? "当前已有操作在执行" : "刷新"}>
            {props.busy === "refresh" ? <Loader2 className="spin" size={14} /> : <RefreshCw size={14} />}
          </button>
        </div>
        <div className="pill-row">
          <Pill tone={props.health?.ok ? "good" : "bad"}>{props.health?.ok ? "LanceDB 就绪" : "API 未连接"}</Pill>
          <Pill tone="warn">{props.config?.embedding.provider ?? props.defaultConfig?.embedding.provider ?? "local-hash"}</Pill>
        </div>
        <p title={props.health?.lanceDir}>数据目录：{compactPath(props.health?.lanceDir)}</p>
        <p>MCP：{props.config?.mcp.allowWrites ? "允许写入" : "只读模式"}</p>
        <p>OCR：{props.config?.parsers.ocr.mode ?? props.defaultConfig?.parsers.ocr.mode ?? "auto"}</p>
      </section>

      <section className="first-run">
        <div className="first-run-head">
          <h2>首次运行向导</h2>
          <Pill tone={onboarding?.completed ? "good" : "warn"}>{onboarding?.completed ? "已完成" : "进行中"}</Pill>
        </div>
        <GuideItem done={stepDone("data") || Boolean(readiness?.lanceDbReady)} label="确认数据目录" />
        <GuideItem done={stepDone("collection") || Boolean(readiness?.hasCollection)} label="先选择知识库" />
        <GuideItem done={stepDone("embedding")} label="测试 embedding" />
        <GuideItem done={stepDone("ocr")} label="测试 OCR/解析" />
        <GuideItem done={stepDone("anythingllm")} label="可选 AnythingLLM" />
        <div className="first-run-actions">
          <button type="button" onClick={props.onOpenOnboarding} disabled={Boolean(props.busy) || Boolean(props.onboardingBusy)}>
            {props.onboardingBusy ? <Loader2 className="spin" size={13} /> : <WandSparkles size={13} />}
            {onboarding?.completed ? "重新查看" : "继续设置"}
          </button>
          <button type="button" onClick={props.onResetOnboarding} disabled={Boolean(props.busy) || Boolean(props.onboardingBusy)} title="重新运行首次设置">
            <RotateCcw size={13} />
          </button>
        </div>
      </section>
    </aside>
  );
}

function TopBar(props: {
  title: string;
  description: string;
  health: Health | null;
  activeCollection: Collection | null;
  busy: BusyState;
  canImport: boolean;
  canSyncAnythingLLM: boolean;
  anythingSyncDisabledReason: string;
  onImport: () => void;
  onSync: () => void;
}) {
  return (
    <header className="topbar" id="section-overview">
      <div>
        <h1>{props.title}</h1>
        <p>{props.description}</p>
      </div>
      <div className="top-actions">
        <Pill tone="active">桌面入口</Pill>
        <Pill tone="neutral">{props.health?.ok ? "API 127.0.0.1" : "API 未连接"}</Pill>
        <Pill tone="neutral">{props.activeCollection?.name ?? "未选择知识库"}</Pill>
        <button className="button primary" onClick={props.onImport} disabled={!props.canImport || Boolean(props.busy)} title={props.busy ? "当前有任务运行中" : props.canImport ? "Import files" : "Create or select a knowledge base first"}>
          {props.busy === "upload" ? <Loader2 className="spin" size={15} /> : <Upload size={15} />} 导入文件
        </button>
        <button
          className="button secondary"
          onClick={props.onSync}
          disabled={!props.canSyncAnythingLLM || Boolean(props.busy)}
          title={props.busy ? "当前有任务运行中" : props.canSyncAnythingLLM ? "同步已保存配置到 AnythingLLM" : props.anythingSyncDisabledReason}
        >
          <PlugZap size={15} /> 同步
        </button>
      </div>
    </header>
  );
}

function MetricGrid(props: { collections: number; documents: number; chunks: number; runningJobs: number; failedDocuments: number }) {
  return (
    <section className="metric-grid">
      <MetricCard color="blue" label="知识库" value={String(props.collections)} caption="创建时复制默认参数" />
      <MetricCard color="green" label="文档" value={String(props.documents)} caption="PDF / DOCX / 图片" />
      <MetricCard color="violet" label="Chunks" value={formatCount(props.chunks)} caption="LanceDB 已索引" />
      <MetricCard color="orange" label="任务" value={String(props.runningJobs)} caption={props.failedDocuments ? `${props.failedDocuments} 个失败需处理` : "OCR 队列运行中"} />
    </section>
  );
}

function AiControlPanel(props: {
  activeCollection: Collection | null;
  configReady: boolean;
  canSyncAnythingLLM: boolean;
  messages: AiMessage[];
  tools: AiToolSummary[];
  auditEvents: AiToolAuditEvent[];
  lastDecision: AiToolDecisionResponse | null;
  pendingAction: PendingAiAction | null;
  input: string;
  files: File[];
  busy: BusyState;
  onInput: (value: string) => void;
  onAttach: (files: FileList | File[]) => void;
  onRemoveFile: (index: number) => void;
  onPickFiles: () => void;
  onRun: () => void;
  onSafetyCheck: () => void;
  onLoadTools: () => void;
  onLoadAudit: () => void;
  onQuickCommand: (command: string, toolId: string) => void;
  onConfirmPendingAction: () => void;
  onCancelPendingAction: () => void;
}) {
  const [isDragging, setIsDragging] = React.useState(false);
  const [showPolicyPanel, setShowPolicyPanel] = React.useState(false);
  const messageListRef = React.useRef<HTMLDivElement | null>(null);
  const isBusy = Boolean(props.busy);
  const hasFiles = props.files.length > 0;
  const latestAudit = props.auditEvents.slice(-5).reverse();

  React.useEffect(() => {
    messageListRef.current?.scrollTo({ top: messageListRef.current.scrollHeight, behavior: "smooth" });
  }, [props.messages.length]);

  function handleDragLeave(event: React.DragEvent<HTMLElement>) {
    const nextTarget = event.relatedTarget;
    if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
      setIsDragging(false);
    }
  }

  function handleDrop(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    setIsDragging(false);
    if (isBusy || !event.dataTransfer.files.length) return;
    props.onAttach(event.dataTransfer.files);
  }

  const quickCommands = [
    {
      label: "导入附件",
      command: "导入这些文件",
      toolId: "documents.import",
      icon: <Upload size={13} />,
      disabled: !hasFiles || !props.activeCollection,
      title: !hasFiles ? "请先点击“附件”或拖入文件" : "请先选择知识库",
    },
    { label: "测试 OCR", command: "测试 OCR", toolId: "ocr.test", icon: <WandSparkles size={13} />, disabled: !props.configReady, title: "请先选择知识库" },
    { label: "测 embedding", command: "测试 embedding", toolId: "embedding.test", icon: <Bot size={13} />, disabled: !props.configReady, title: "请先选择知识库" },
    { label: "保存参数", command: "保存当前参数", toolId: "config.save", icon: <Settings size={13} />, disabled: !props.configReady, title: "请先选择知识库" },
    { label: "应用默认", command: "应用默认", toolId: "config.applyDefault", icon: <RotateCcw size={13} />, disabled: !props.configReady, title: "请先选择知识库" },
    { label: "同步", command: "同步 AnythingLLM", toolId: "anythingllm.sync", icon: <PlugZap size={13} />, disabled: !props.canSyncAnythingLLM, title: "请先保存配置并启用 AnythingLLM" },
  ];

  return (
    <section
      className={`panel ai-control-panel${isDragging ? " dragging" : ""}`}
      onDragEnter={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="ai-heading">
        <div className="ai-title">
          <span className="ai-orb"><Bot size={18} /></span>
          <div>
            <h2>AI 控制台</h2>
            <p className="ai-context">
              当前知识库：{props.activeCollection ? `${props.activeCollection.name} / ${props.activeCollection.slug}` : "未选择"}
            </p>
          </div>
        </div>
        <div className="ai-heading-actions">
          <button
            className="mini-action"
            type="button"
            onClick={() => setShowPolicyPanel((value) => !value)}
            aria-expanded={showPolicyPanel}
            data-testid="ai-policy-toggle"
            title="查看 AI 策略工具和最近审计"
          >
            <ListChecks size={13} />
            策略/审计
          </button>
          <button
            className="mini-action"
            type="button"
            onClick={props.onSafetyCheck}
            disabled={isBusy || (!props.input.trim() && !hasFiles)}
            title="只做安全预检，不执行动作"
          >
            {props.busy === "ai-policy" ? <Loader2 className="spin" size={13} /> : <ShieldCheck size={13} />}
            安全预检
          </button>
          <Pill tone={props.activeCollection ? "active" : "warn"}>{props.activeCollection ? "本地指令路由" : "先选知识库"}</Pill>
        </div>
      </div>

      {showPolicyPanel && (
        <div className="ai-policy-panel" data-testid="ai-policy-panel">
          <div className="ai-policy-panel-head">
            <div>
              <strong>策略工具与审计</strong>
              <span>{props.tools.length ? `${props.tools.length} 个工具` : "尚未加载工具"} · {props.auditEvents.length ? `${props.auditEvents.length} 条审计` : "暂无审计"}</span>
            </div>
            <div className="button-row">
              <button className="mini-action" type="button" onClick={props.onLoadTools} disabled={isBusy} data-testid="ai-tools-refresh">
                {props.busy === "ai-policy" ? <Loader2 className="spin" size={13} /> : <RefreshCw size={13} />}
                刷新策略
              </button>
              <button className="mini-action" type="button" onClick={props.onLoadAudit} disabled={isBusy} data-testid="ai-audit-refresh">
                {props.busy === "ai-policy" ? <Loader2 className="spin" size={13} /> : <Clock3 size={13} />}
                刷新审计
              </button>
            </div>
          </div>
          <div className="ai-tool-grid">
            {props.tools.slice(0, 8).map((tool) => (
              <div className="ai-tool-card" key={tool.id} data-testid="ai-tool-card">
                <span>{tool.category}</span>
                <strong>{tool.label}</strong>
                <small>{tool.id} · {aiRiskLabel(tool.risk)}{tool.requiresConfirmation ? " · 需确认" : ""}</small>
              </div>
            ))}
            {!props.tools.length && <p className="empty-mini">点击“刷新策略”读取后端注册的可用工具。</p>}
          </div>
          <div className="ai-audit-list" data-testid="ai-audit-list">
            {latestAudit.map((event) => (
              <article className={event.blocked ? "blocked" : event.requiresConfirmation ? "confirm" : "ok"} key={event.id}>
                <div>
                  <strong>{event.matchedToolIds.join(" / ") || "未匹配"}</strong>
                  <time>{formatDate(event.createdAt)}</time>
                </div>
                <p>{event.promptPreview || "空指令"} · {aiRiskLabel(event.highestRisk)} · {event.reason}</p>
              </article>
            ))}
            {!latestAudit.length && <p className="empty-mini">执行或安全预检后，点击“刷新审计”查看最近 dry-run 记录。</p>}
          </div>
        </div>
      )}

      {props.lastDecision && (
        <div
          className={`ai-policy-strip ${props.lastDecision.blocked ? "blocked" : props.lastDecision.requiresConfirmation ? "confirm" : "ok"}`}
          data-ai-policy-risk={props.lastDecision.highestRisk}
          data-ai-policy-blocked={String(props.lastDecision.blocked)}
          data-ai-policy-confirm={String(props.lastDecision.requiresConfirmation)}
        >
          <ShieldCheck size={14} />
          <strong>{props.lastDecision.blocked ? "已阻断" : props.lastDecision.requiresConfirmation ? "需手动确认" : "只读可执行"}</strong>
          <span>
            {aiRiskLabel(props.lastDecision.highestRisk)} · {(props.lastDecision.tools?.map((tool) => tool.label).join(" / ") || props.lastDecision.matchedToolIds.join(" / ")) || "未匹配"}
            {props.lastDecision.blocked || props.lastDecision.requiresConfirmation ? ` · ${manualActionHint(props.lastDecision.matchedToolIds[0])}` : ""}
          </span>
        </div>
      )}

      {props.pendingAction && (
        <div className="ai-pending-action" data-testid="ai-pending-action">
          <div>
            <strong>等待确认：{props.pendingAction.decision.tools?.[0]?.label || props.pendingAction.toolId}</strong>
            <span>
              {aiRiskLabel(props.pendingAction.decision.highestRisk)} · {props.pendingAction.command}
              {props.pendingAction.fileCount ? ` · ${props.pendingAction.fileCount} 个附件` : ""}
            </span>
          </div>
          <div className="button-row">
            <button className="mini-action" type="button" onClick={props.onCancelPendingAction} disabled={isBusy}>
              取消
            </button>
            <button className="mini-action invert" type="button" onClick={props.onConfirmPendingAction} disabled={isBusy}>
              {isBusy ? <Loader2 className="spin" size={13} /> : <CheckCircle2 size={13} />}
              确认执行
            </button>
          </div>
        </div>
      )}

      <div className="ai-message-list" ref={messageListRef} aria-live="polite">
        {props.messages.map((message) => (
          <article className={`ai-message ${message.role}`} key={message.id}>
            <div className="ai-message-meta">
              <span>{message.role === "user" ? "你" : message.role === "system" ? "系统" : "控制器"}</span>
              <time>{message.time}</time>
            </div>
            <p>{message.text}</p>
            {message.detail && <small>{message.detail}</small>}
          </article>
        ))}
      </div>

      {hasFiles && (
        <div className="ai-file-row" aria-label="已附加文件">
          {props.files.map((file, index) => (
            <span className="ai-file-chip" key={`${file.name}-${file.size}-${file.lastModified}`}>
              <FileText size={13} />
              <span title={file.name}>{file.name}</span>
              <small>{formatFileSize(file.size)}</small>
              <button type="button" onClick={() => props.onRemoveFile(index)} disabled={isBusy} title="移除文件">
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="ai-command-row" aria-label="快捷指令">
        {quickCommands.map((command) => (
          <button
            className="ai-command"
            type="button"
            key={command.command}
            data-smoke-command={command.toolId}
            onClick={() => props.onQuickCommand(command.command, command.toolId)}
            disabled={isBusy || command.disabled}
            title={command.disabled ? command.title : command.command}
          >
            {command.icon}
            {command.label}
          </button>
        ))}
      </div>

      <div className="ai-input-row">
        <textarea
          className="ai-prompt-input"
          value={props.input}
          onChange={(event) => props.onInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              props.onRun();
            }
          }}
          placeholder="输入：导入这些文件 / 搜索 报销截止日期 / 测试 OCR / 保存当前参数"
          rows={2}
          disabled={isBusy}
        />
        <div className="ai-input-actions">
          <button className="button secondary" type="button" onClick={props.onPickFiles} disabled={isBusy}>
            <Paperclip size={15} /> 附件
          </button>
          <button className="button primary" type="button" onClick={props.onRun} disabled={isBusy || (!props.input.trim() && !hasFiles)}>
            {isBusy ? <Loader2 className="spin" size={15} /> : <SendHorizontal size={15} />} 执行
          </button>
        </div>
      </div>
    </section>
  );
}

function SearchPanel(props: {
  query: string;
  topK: number;
  results: SearchResult[];
  hasSearched: boolean;
  busy: BusyState;
  canSearch: boolean;
  onQuery: (value: string) => void;
  onTopK: (value: number) => void;
  onSearch: () => void;
  onCopyCitation: () => void;
  onOpenDocument: (documentId: string) => void;
}) {
  const visibleResults = props.results.length ? props.results : [];
  return (
    <section className="panel search-panel" id="section-search">
      <div className="panel-heading">
        <div>
          <h2>本地检索</h2>
          <p>直接检索本地 LanceDB，不依赖 AnythingLLM。</p>
        </div>
      </div>
      <div className="search-row">
        <input value={props.query} onChange={(event) => props.onQuery(event.target.value)} onKeyDown={(event) => event.key === "Enter" && props.canSearch && !props.busy && props.onSearch()} placeholder="输入问题：例如“医保报销政策的截止日期是什么？”" disabled={Boolean(props.busy)} />
        <input className="topk" type="number" min={1} max={50} value={props.topK} onChange={(event) => props.onTopK(Math.min(50, Math.max(1, Number(event.target.value) || 8)))} title="Top K" disabled={Boolean(props.busy)} />
        <button className="button primary" onClick={props.onSearch} disabled={!props.canSearch || Boolean(props.busy)} title={props.busy ? "当前有任务运行中" : props.canSearch ? "检索当前知识库" : "请先选择知识库并输入问题"}>
          {props.busy === "search" ? <Loader2 className="spin" size={15} /> : <Search size={15} />} 检索
        </button>
        <button className="button secondary" onClick={props.onCopyCitation} disabled={!props.results.length || Boolean(props.busy)} title={props.busy ? "当前检索中" : props.results.length ? "复制第一条命中的引用片段" : "暂无可复制引用"}><Clipboard size={15} /> 复制引用</button>
      </div>

      <div className="result-list">
        {visibleResults.map((result, index) => (
          <article className={index === 0 ? "result-row highlighted" : "result-row"} key={result.id}>
            <div>
              <strong>{result.sourceName || result.title}</strong>
              <span>
                {result.pageNumber ? `第 ${result.pageNumber} 页 · ` : ""}
                {result.extractor || "chunk"} · chunk {result.chunkIndex + 1}
              </span>
            </div>
            <p>{result.preview || summarize(result.text, 130)}</p>
            <b>{formatScore(result.score)}</b>
            <button className="mini-action" type="button" onClick={() => props.onOpenDocument(result.documentId)} disabled={Boolean(props.busy)}>
              <Eye size={14} /> 打开
            </button>
          </article>
        ))}
        {!visibleResults.length && (
          <EmptyResult hasSearched={props.hasSearched} />
        )}
      </div>
    </section>
  );
}

function DocumentsPanel({
  documents,
  busy,
  canImport,
  directoryPath,
  directoryRecursive,
  directoryCandidates,
  selectionResetKey,
  onImport,
  onDirectoryPath,
  onDirectoryRecursive,
  onScanDirectory,
  onImportPaths,
  onBatchDelete,
  onBatchReprocess,
  onOpenDocument,
  onDeleteDocument,
  onReprocessDocument,
}: {
  documents: DocumentRecord[];
  busy: BusyState;
  canImport: boolean;
  directoryPath: string;
  directoryRecursive: boolean;
  directoryCandidates: DirectoryScanCandidate[];
  selectionResetKey: number;
  onImport: () => void;
  onDirectoryPath: (value: string) => void;
  onDirectoryRecursive: (value: boolean) => void;
  onScanDirectory: () => void;
  onImportPaths: (paths: string[]) => Promise<boolean>;
  onBatchDelete: (documentIds: string[]) => Promise<boolean>;
  onBatchReprocess: (documentIds: string[]) => Promise<boolean>;
  onOpenDocument: (documentId: string) => void;
  onDeleteDocument: (document: DocumentRecord) => void;
  onReprocessDocument: (documentId: string) => void;
}) {
  const [showAllDocuments, setShowAllDocuments] = React.useState(false);
  const [showAllDirectoryCandidates, setShowAllDirectoryCandidates] = React.useState(false);
  const visibleDocuments = React.useMemo(
    () => (showAllDocuments ? documents : documents.slice(0, 8)),
    [documents, showAllDocuments],
  );
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const [selectedSourcePaths, setSelectedSourcePaths] = React.useState<string[]>([]);
  const selectedSet = React.useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedSourceSet = React.useMemo(() => new Set(selectedSourcePaths), [selectedSourcePaths]);
  const visibleDirectoryCandidates = React.useMemo(
    () => (showAllDirectoryCandidates ? directoryCandidates : directoryCandidates.slice(0, 12)),
    [directoryCandidates, showAllDirectoryCandidates],
  );
  const visibleSourcePathSet = React.useMemo(() => new Set(visibleDirectoryCandidates.map((candidate) => candidate.path)), [visibleDirectoryCandidates]);
  const selectedVisibleSourceCount = React.useMemo(
    () => selectedSourcePaths.filter((sourcePath) => visibleSourcePathSet.has(sourcePath)).length,
    [selectedSourcePaths, visibleSourcePathSet],
  );
  const allVisibleSourcesSelected = visibleDirectoryCandidates.length > 0 && selectedVisibleSourceCount === visibleDirectoryCandidates.length;
  const hiddenDirectoryCandidateCount = Math.max(0, directoryCandidates.length - visibleDirectoryCandidates.length);
  const selectAllRef = React.useRef<HTMLInputElement | null>(null);
  const selectedCount = selectedIds.length;
  const allVisibleSelected = visibleDocuments.length > 0 && selectedCount === visibleDocuments.length;
  const hasPartialSelection = selectedCount > 0 && !allVisibleSelected;
  const batchDisabled = selectedCount === 0 || Boolean(busy);

  React.useEffect(() => {
    const visibleIds = new Set(visibleDocuments.map((document) => document.id));
    setSelectedIds((current) => current.filter((id) => visibleIds.has(id)));
  }, [visibleDocuments]);

  React.useEffect(() => {
    if (documents.length <= 8) setShowAllDocuments(false);
  }, [documents.length]);

  React.useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = hasPartialSelection;
  }, [hasPartialSelection]);

  React.useEffect(() => {
    const available = new Set(directoryCandidates.map((candidate) => candidate.path));
    setSelectedSourcePaths((current) => current.filter((item) => available.has(item)));
  }, [directoryCandidates]);

  React.useEffect(() => {
    if (directoryCandidates.length <= 12) setShowAllDirectoryCandidates(false);
  }, [directoryCandidates.length]);

  React.useEffect(() => {
    setSelectedIds([]);
    setSelectedSourcePaths([]);
  }, [selectionResetKey]);

  function toggleDocument(documentId: string) {
    if (busy) return;
    setSelectedIds((current) =>
      current.includes(documentId) ? current.filter((id) => id !== documentId) : [...current, documentId],
    );
  }

  function toggleAllVisible() {
    if (busy) return;
    setSelectedIds(allVisibleSelected ? [] : visibleDocuments.map((document) => document.id));
  }

  async function runBatchDelete() {
    const ok = await onBatchDelete(selectedIds);
    if (ok) setSelectedIds([]);
  }

  async function runBatchReprocess() {
    const ok = await onBatchReprocess(selectedIds);
    if (ok) setSelectedIds([]);
  }

  function toggleSourcePath(sourcePath: string) {
    if (busy) return;
    setSelectedSourcePaths((current) =>
      current.includes(sourcePath) ? current.filter((item) => item !== sourcePath) : [...current, sourcePath],
    );
  }

  function toggleAllSourcePaths() {
    if (busy) return;
    setSelectedSourcePaths((current) => {
      const currentSet = new Set(current);
      if (allVisibleSourcesSelected) {
        return current.filter((item) => !visibleSourcePathSet.has(item));
      }
      for (const candidate of visibleDirectoryCandidates) currentSet.add(candidate.path);
      return Array.from(currentSet);
    });
  }

  async function runImportPaths() {
    const ok = await onImportPaths(selectedSourcePaths);
    if (ok) setSelectedSourcePaths([]);
  }

  async function runImportAllPaths() {
    const ok = await onImportPaths(directoryCandidates.map((candidate) => candidate.path));
    if (ok) setSelectedSourcePaths([]);
  }
  return (
    <section className="panel docs-panel" id="section-documents">
      <div className="panel-heading table-heading">
        <div>
          <h2>文档管理</h2>
          <p>查看解析状态、OCR 置信度和 chunk 数。</p>
        </div>
      </div>
      <div className="directory-source">
        <div className="directory-source-head">
          <div>
            <strong>目录数据源</strong>
            <span>扫描本机目录后选择文件入库，原目录文件不会被删除或移动。</span>
          </div>
          <label className="check-field compact-check">
            <input type="checkbox" checked={directoryRecursive} onChange={(event) => onDirectoryRecursive(event.target.checked)} disabled={Boolean(busy)} />
            <span>递归</span>
          </label>
        </div>
        <div className="directory-source-row">
          <input value={directoryPath} onChange={(event) => onDirectoryPath(event.target.value)} placeholder="例如 C:\\Users\\you\\Documents\\知识库资料" disabled={Boolean(busy)} />
          <button className="button secondary" type="button" onClick={onScanDirectory} disabled={!canImport || Boolean(busy)} title={busy ? "当前有任务运行中" : canImport ? "扫描目录" : "请先新建或选择知识库"}>
            {busy === "scan-directory" ? <Loader2 className="spin" size={15} /> : <FolderPlus size={15} />}
            扫描目录
          </button>
        </div>
        {directoryCandidates.length > 0 && (
          <div className="directory-candidates">
            <div className="directory-candidates-head">
              <label className="check-field compact-check">
                <input
                  type="checkbox"
                  checked={allVisibleSourcesSelected}
                  onChange={toggleAllSourcePaths}
                  disabled={Boolean(busy)}
                />
                <span>候选 {selectedSourcePaths.length} / {directoryCandidates.length}</span>
              </label>
              {hiddenDirectoryCandidateCount > 0 && (
                <span className="candidate-limit-note">仅显示前 {visibleDirectoryCandidates.length} 个，另有 {hiddenDirectoryCandidateCount} 个未展示</span>
              )}
              {directoryCandidates.length > 12 && (
                <button className="mini-action" type="button" onClick={() => setShowAllDirectoryCandidates((value) => !value)} disabled={Boolean(busy)}>
                  {showAllDirectoryCandidates ? "收起候选" : "显示全部候选"}
                </button>
              )}
              <button className="mini-action" type="button" onClick={() => void runImportAllPaths()} disabled={!directoryCandidates.length || Boolean(busy)}>
                {busy === "import-paths" ? <Loader2 className="spin" size={13} /> : <Upload size={13} />}
                导入全部候选
              </button>
              <button className="mini-action" type="button" onClick={() => void runImportPaths()} disabled={!selectedSourcePaths.length || Boolean(busy)}>
                {busy === "import-paths" ? <Loader2 className="spin" size={13} /> : <Upload size={13} />}
                导入选中
              </button>
            </div>
            <div className="directory-candidate-list">
              {visibleDirectoryCandidates.map((candidate) => (
                <label className="directory-candidate" key={candidate.path} title={candidate.path}>
                  <input
                    type="checkbox"
                    checked={selectedSourceSet.has(candidate.path)}
                    onChange={() => toggleSourcePath(candidate.path)}
                    disabled={Boolean(busy)}
                  />
                  <span>{candidate.name}</span>
                  <small>{candidate.extension} · {formatFileSize(candidate.sizeBytes)}</small>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="doc-toolbar">
        <span className="doc-selection-summary">
          {visibleDocuments.length
            ? selectedCount
              ? `已选 ${selectedCount} / 已展示 ${visibleDocuments.length}`
              : `已展示 ${visibleDocuments.length} / 共 ${documents.length} 条`
            : "暂无可选文档"}
        </span>
        <div className="button-row">
          {documents.length > 8 && (
            <button className="button secondary" onClick={() => setShowAllDocuments((value) => !value)} disabled={Boolean(busy)}>
              {showAllDocuments ? "收起文档" : `显示全部 ${documents.length} 条`}
            </button>
          )}
          <button className="button secondary" onClick={() => void runBatchReprocess()} disabled={batchDisabled}>
            {busy === "batch-reprocess" ? <Loader2 className="spin" size={15} /> : <RotateCcw size={15} />}
            批量重处理
          </button>
          <button className="button secondary danger" onClick={() => void runBatchDelete()} disabled={batchDisabled}>
            {busy === "batch-delete" ? <Loader2 className="spin" size={15} /> : <Trash2 size={15} />}
            批量删除
          </button>
        </div>
      </div>
      <div className="doc-table">
        <div className="doc-head">
          <label className="doc-select">
            <input
              ref={selectAllRef}
              type="checkbox"
              aria-label="选择当前展示文档"
              checked={allVisibleSelected}
              disabled={!visibleDocuments.length || Boolean(busy)}
              onChange={toggleAllVisible}
            />
          </label>
          <span>文件</span>
          <span>状态</span>
          <span>解析</span>
          <span>OCR</span>
          <span>Chunks</span>
          <span>更新时间</span>
          <span>操作</span>
        </div>
        {visibleDocuments.map((document) => {
          const status = document.extractionStatus || document.status;
          const isFailed = status === "failed";
          return (
            <div className={status === "failed" || status === "skipped" ? "doc-row attention" : "doc-row"} key={document.id}>
              <label className="doc-select">
                <input
                  type="checkbox"
                  aria-label={`选择文档 ${document.name}`}
                  checked={selectedSet.has(document.id)}
                  disabled={Boolean(busy)}
                  onChange={() => toggleDocument(document.id)}
                />
              </label>
              <strong title={document.sourcePath}>{document.name}</strong>
              <span className={`status-text ${statusLabel[status]?.tone ?? "neutral"}`}>{statusLabel[status]?.label ?? status}</span>
              <span>{parserLabel[document.parserType || "unknown"] ?? document.parserType ?? "-"}</span>
              <span>{typeof document.ocrConfidence === "number" ? `${Math.round(document.ocrConfidence)}%` : document.ocrEngine ? "运行中" : "-"}</span>
              <span>{document.chunkCount || "-"}</span>
              <span>{formatDate(document.updatedAt)}</span>
              <span className="doc-row-actions">
                <button className="mini-action" type="button" onClick={() => onOpenDocument(document.id)} disabled={Boolean(busy)}>
                  <Eye size={13} /> 详情
                </button>
                <button className="mini-action" type="button" onClick={() => onReprocessDocument(document.id)} disabled={Boolean(busy)}>
                  <RotateCcw size={13} /> {isFailed ? "重试" : "重处理"}
                </button>
                <button className="mini-action danger" type="button" onClick={() => onDeleteDocument(document)} disabled={Boolean(busy)}>
                  <Trash2 size={13} /> 删除
                </button>
              </span>
            </div>
          );
        })}
        {!visibleDocuments.length && (
          <div className="empty-table">
            <FileText size={18} />
            <span>暂无文档。先导入文件后，这里会显示解析、OCR 和入库状态。</span>
            <button className="button primary" onClick={onImport} disabled={!canImport || Boolean(busy)} title={busy ? "当前有任务运行中" : canImport ? "导入文件" : "请先新建或选择知识库"}><Upload size={15} /> 导入文件</button>
          </div>
        )}
      </div>
    </section>
  );
}

function DocumentDetailPanel({
  detail,
  text,
  busy,
  onClose,
  onCopyId,
  onDelete,
  onReprocess,
  onRetryAnythingCleanup,
}: {
  detail: DocumentDetailPayload | null;
  text: DocumentTextPayload | null;
  busy: BusyState;
  onClose: () => void;
  onCopyId: (documentId: string) => void;
  onDelete: (document: DocumentRecord) => void;
  onReprocess: (documentId: string) => void;
  onRetryAnythingCleanup: (document: DocumentRecord) => void;
}) {
  if (!detail) return null;
  const document = detail.document;
  const status = document.extractionStatus || document.status;
  const warnings = document.warnings ?? [];
  const cleanupPendingCount = document.anythingSync?.chunks.filter((chunk) => chunk.cleanupPending).length ?? 0;
  const preview = text?.text ? summarize(text.text, 900) : detail.chunks.map((chunk) => chunk.text).join("\n\n").slice(0, 900);

  return (
    <section className="panel document-detail-panel" aria-live="polite">
      <div className="panel-heading">
        <div>
          <h2>{document.name}</h2>
          <p>{document.id}</p>
        </div>
        <button className="icon-button" type="button" onClick={onClose} title="关闭详情">
          <X size={15} />
        </button>
      </div>

      <div className="detail-actions">
        <Pill tone={statusLabel[status]?.tone ?? "neutral"}>{statusLabel[status]?.label ?? status}</Pill>
        <button className="mini-action" type="button" onClick={() => onCopyId(document.id)}>
          <Clipboard size={14} /> 复制 ID
        </button>
        <button className="mini-action" type="button" onClick={() => onReprocess(document.id)} disabled={Boolean(busy)}>
          {busy === "document-reprocess" ? <Loader2 className="spin" size={14} /> : <RotateCcw size={14} />}
          {status === "failed" ? "重试" : "重新处理"}
        </button>
        {cleanupPendingCount > 0 && (
          <button className="mini-action" type="button" onClick={() => onRetryAnythingCleanup(document)} disabled={Boolean(busy)} title="确认后重试删除已记录的 AnythingLLM embedding locations">
            {busy === "anything-cleanup" ? <Loader2 className="spin" size={14} /> : <PlugZap size={14} />}
            清理 AnythingLLM ({cleanupPendingCount})
          </button>
        )}
        <button className="mini-action danger" type="button" onClick={() => onDelete(document)} disabled={Boolean(busy)}>
          {busy === "document-delete" ? <Loader2 className="spin" size={14} /> : <Trash2 size={14} />}
          删除文档
        </button>
      </div>

      <div className="detail-grid">
        <DetailItem label="类型" value={parserLabel[document.parserType || "unknown"] ?? document.parserType ?? "-"} />
        <DetailItem label="大小" value={formatFileSize(document.sizeBytes)} />
        <DetailItem label="页数" value={document.pageCount ? String(document.pageCount) : "-"} />
        <DetailItem label="Chunks" value={String(document.chunkCount || detail.chunks.length)} />
        <DetailItem label="OCR" value={document.ocrEngine ? `${document.ocrEngine} / ${document.ocrLanguage || "-"}` : "-"} />
        <DetailItem label="置信度" value={typeof document.ocrConfidence === "number" ? `${Math.round(document.ocrConfidence)}%` : "-"} />
      </div>

      {document.error && (
        <div className="detail-alert bad">
          <AlertCircle size={15} />
          <span>{document.error}</span>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="detail-alert warn">
          <AlertCircle size={15} />
          <span>{warnings.slice(0, 4).join(" / ")}</span>
        </div>
      )}

      <div className="detail-section">
        <div className="detail-section-title">
          <strong>提取文本预览</strong>
          {text?.truncated && <span>已截断，总字符 {formatCount(text.totalChars)}</span>}
        </div>
        <pre>{preview || "暂无可预览文本。"}</pre>
      </div>

      <div className="detail-section">
        <div className="detail-section-title">
          <strong>Chunks</strong>
          <span>{detail.chunks.length} 条</span>
        </div>
        <div className="chunk-list">
          {detail.chunks.slice(0, 8).map((chunk) => (
            <article className="chunk-row" key={chunk.id}>
              <div>
                <strong>#{chunk.chunkIndex + 1} {chunk.pageNumber ? `第 ${chunk.pageNumber} 页` : ""}</strong>
                <span>{chunk.extractor || document.parserType || "chunk"}</span>
              </div>
              <p>{summarize(chunk.text, 180)}</p>
            </article>
          ))}
          {!detail.chunks.length && <span className="muted">该文档还没有入库 chunks。</span>}
        </div>
      </div>
    </section>
  );
}

function OnboardingWizard({
  payload,
  open,
  busy,
  onboardingBusy,
  activeCollection,
  config,
  desktopDataDir,
  desktopDataDirDraft,
  desktopDataDirDirty,
  onDesktopDataDirDraft,
  onChooseDesktopDataDir,
  onSaveDesktopDataDir,
  onResetDesktopDataDir,
  onRelaunchDesktop,
  onClose,
  onConfirmData,
  onConfirmCollection,
  onConfirmEmbedding,
  onConfirmOcr,
  onSkipOcr,
  onConfirmAnything,
  onSkipAnything,
  onComplete,
  onReset,
}: {
  payload: OnboardingPayload | null;
  open: boolean;
  busy: BusyState;
  onboardingBusy: "" | "patch" | "complete" | "reset";
  activeCollection: Collection | null;
  config: AppConfig | null;
  desktopDataDir: DesktopDataDirectoryStatus | null;
  desktopDataDirDraft: string;
  desktopDataDirDirty: boolean;
  onDesktopDataDirDraft: (value: string) => void;
  onChooseDesktopDataDir: () => void;
  onSaveDesktopDataDir: () => void;
  onResetDesktopDataDir: () => void;
  onRelaunchDesktop: () => void;
  onClose: () => void;
  onConfirmData: () => void;
  onConfirmCollection: () => void;
  onConfirmEmbedding: () => void;
  onConfirmOcr: () => void;
  onSkipOcr: () => void;
  onConfirmAnything: () => void;
  onSkipAnything: () => void;
  onComplete: () => void;
  onReset: () => void;
}) {
  if (!open || !payload) return null;
  const { onboarding, readiness } = payload;
  const isBusy = Boolean(busy) || Boolean(onboardingBusy);
  const stepStatus = (step: Exclude<OnboardingStepId, "finish">) => onboarding.steps[step]?.status ?? "pending";
  const stepDone = (step: Exclude<OnboardingStepId, "finish">) => {
    const status = stepStatus(step);
    return status === "complete" || status === "skipped";
  };
  const stepTone = (step: Exclude<OnboardingStepId, "finish">): Tone => {
    const status = stepStatus(step);
    if (status === "complete") return "good";
    if (status === "skipped") return "neutral";
    if (status === "failed") return "bad";
    if (onboarding.currentStep === step) return "active";
    return "warn";
  };
  const canComplete = stepDone("data") && stepDone("collection") && stepDone("embedding") && stepDone("ocr") && stepDone("anythingllm");
  const anythingConfigIssue =
    config?.anythingllm.enabled && !config.anythingllm.baseUrl.trim()
      ? "已启用 AnythingLLM，但还缺少 API 地址。"
      : config?.anythingllm.enabled && !config.anythingllm.apiKey.trim()
        ? "已启用 AnythingLLM，但还缺少 API key。"
        : "";
  const canSkipAnything = !config?.anythingllm.enabled || Boolean(anythingConfigIssue);

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="onboarding-dialog" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
        <div className="panel-heading">
          <div>
            <h2 id="onboarding-title">首次运行向导</h2>
            <p>先确认本地数据目录，再选择知识库和参数；默认参数只会复制到未来新建的知识库。</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} disabled={onboardingBusy === "patch"} title="稍后继续">
            <X size={15} />
          </button>
        </div>

        <div className="onboarding-summary">
          <DetailItem label="数据目录" value={compactPath(readiness.dataDir)} />
          <DetailItem label="LanceDB" value={`${readiness.lanceDbReady ? "ready" : "pending"} / ${readiness.tableCount} tables`} />
          <DetailItem label="默认 embedding" value={`${readiness.defaultEmbedding.provider} / ${readiness.defaultEmbedding.model} / ${readiness.defaultEmbedding.dimension}`} />
          <DetailItem label="当前知识库" value={activeCollection ? `${activeCollection.name} / ${activeCollection.slug}` : readiness.activeCollectionSlug || "未选择"} />
        </div>

        <div className="onboarding-steps">
          <article className="onboarding-step">
            <div>
              <Pill tone={stepTone("data")}>{stepStatus("data")}</Pill>
              <h3>1. 确认本地数据目录</h3>
              <p title={readiness.lanceDir}>API 只绑定本机，LanceDB 数据在 {compactPath(readiness.lanceDir)}。</p>
            </div>
            <DataDirectoryControl
              status={desktopDataDir}
              draft={desktopDataDirDraft}
              dirty={desktopDataDirDirty}
              busy={busy}
              compact
              onDraft={onDesktopDataDirDraft}
              onChoose={onChooseDesktopDataDir}
              onSave={onSaveDesktopDataDir}
              onReset={onResetDesktopDataDir}
              onRelaunch={onRelaunchDesktop}
            />
            <button className="button primary" type="button" onClick={onConfirmData} disabled={isBusy || Boolean(desktopDataDir?.pendingRelaunch)}>
              {onboardingBusy === "patch" && onboarding.currentStep === "data" ? <Loader2 className="spin" size={15} /> : <CheckCircle2 size={15} />}
              确认目录
            </button>
          </article>

          <article className="onboarding-step">
            <div>
              <Pill tone={stepTone("collection")}>{stepStatus("collection")}</Pill>
              <h3>2. 选择知识库</h3>
              <p>{readiness.hasCollection ? `已有 ${readiness.collectionCount} 个知识库，当前为 ${readiness.activeCollectionName || readiness.activeCollectionSlug}` : "还没有知识库，新建时会复制默认参数模板。"}</p>
            </div>
            <button className="button primary" type="button" onClick={onConfirmCollection} disabled={isBusy}>
              {busy === "create-collection" ? <Loader2 className="spin" size={15} /> : <Database size={15} />}
              {activeCollection ? "确认当前知识库" : "新建知识库"}
            </button>
          </article>

          <article className="onboarding-step">
            <div>
              <Pill tone={stepTone("embedding")}>{stepStatus("embedding")}</Pill>
              <h3>3. 测试 embedding</h3>
              <p>{config ? `${config.embedding.provider} / ${config.embedding.model} / ${config.embedding.dimension} 维 / batch ${config.embedding.batchSize}` : "请先选择知识库，加载该知识库自己的参数副本。"}</p>
            </div>
            <button className="button primary" type="button" onClick={onConfirmEmbedding} disabled={isBusy || !config}>
              {busy === "test-embedding" ? <Loader2 className="spin" size={15} /> : <Bot size={15} />}
              测试 embedding
            </button>
          </article>

          <article className="onboarding-step">
            <div>
              <Pill tone={stepTone("ocr")}>{stepStatus("ocr")}</Pill>
              <h3>4. 测试 OCR / 解析</h3>
              <p>{config ? `${config.parsers.ocr.mode} / ${config.parsers.ocr.language} / min ${config.parsers.ocr.minConfidence}%` : "请先选择知识库。"}</p>
            </div>
            <div className="button-row">
              <button className="button secondary" type="button" onClick={onSkipOcr} disabled={isBusy}>
                跳过 OCR
              </button>
              <button className="button primary" type="button" onClick={onConfirmOcr} disabled={isBusy || !config}>
                {busy === "test-ocr" ? <Loader2 className="spin" size={15} /> : <WandSparkles size={15} />}
                测试 OCR
              </button>
            </div>
          </article>

          <article className="onboarding-step">
            <div>
              <Pill tone={stepTone("anythingllm")}>{stepStatus("anythingllm")}</Pill>
              <h3>5. 可选 AnythingLLM</h3>
              <p>{anythingConfigIssue || (readiness.anythingllmConfigured ? "已启用并配置 API key，可以测试连接。" : "AnythingLLM 是可选下游；未启用时可以跳过。")}</p>
            </div>
            <div className="button-row">
              <button
                className="button secondary"
                type="button"
                onClick={onSkipAnything}
                disabled={isBusy || !canSkipAnything}
                title={!canSkipAnything ? "已启用并配置 AnythingLLM，请测试连接或先在参数面板关闭它" : "跳过可选 AnythingLLM"}
              >
                跳过
              </button>
              <button className="button primary" type="button" onClick={onConfirmAnything} disabled={isBusy || !config}>
                {busy === "test-anything" ? <Loader2 className="spin" size={15} /> : <PlugZap size={15} />}
                测试或确认
              </button>
            </div>
          </article>
        </div>

        <div className="onboarding-footer">
          <button className="button secondary" type="button" onClick={onReset} disabled={isBusy}>
            {onboardingBusy === "reset" ? <Loader2 className="spin" size={15} /> : <RotateCcw size={15} />}
            重置向导
          </button>
          <button className="button secondary" type="button" onClick={onClose} disabled={onboardingBusy === "patch"}>
            稍后继续
          </button>
          <button className="button primary" type="button" onClick={onComplete} disabled={isBusy || !canComplete}>
            {onboardingBusy === "complete" ? <Loader2 className="spin" size={15} /> : <CheckCircle2 size={15} />}
            完成向导
          </button>
        </div>
      </section>
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-item">
      <span>{label}</span>
      <strong title={value}>{value}</strong>
    </div>
  );
}

function CreateCollectionDialog({
  open,
  context,
  name,
  defaultConfig,
  busy,
  onName,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  context: "normal" | "onboarding";
  name: string;
  defaultConfig: AppConfig | null;
  busy: BusyState;
  onName: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;
  const trimmedName = name.trim();
  const isCreating = busy === "create-collection";
  const defaultSummary = defaultConfig
    ? `${defaultConfig.embedding.provider} / ${defaultConfig.embedding.model} / ${defaultConfig.embedding.dimension} 维 · chunk ${defaultConfig.chunking.targetChars}/${defaultConfig.chunking.overlapChars} · OCR ${defaultConfig.parsers.ocr.mode}/${defaultConfig.parsers.ocr.language}`
    : "默认参数模板尚未加载，创建时会使用服务端系统默认值。";
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-dialog create-collection-dialog" role="dialog" aria-modal="true" aria-labelledby="create-collection-title">
        <div className="panel-heading">
          <div>
            <h2 id="create-collection-title">新建知识库</h2>
            <p>{context === "onboarding" ? "首次运行会先创建知识库，再继续测试 embedding。" : "新知识库会复制一份当前默认参数，之后可独立修改。"}</p>
          </div>
          <FolderPlus size={18} />
        </div>
        <label className="field">
          <span>知识库名称</span>
          <input
            autoFocus
            value={name}
            onChange={(event) => onName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !isCreating) onCancel();
              if (event.key === "Enter" && trimmedName && !busy) onConfirm();
            }}
            placeholder="例如：合同资料库"
            disabled={Boolean(busy)}
          />
        </label>
        <div className="config-copy-preview">
          <Database size={15} />
          <span title={defaultSummary}>创建时复制默认参数：{defaultSummary}</span>
        </div>
        <div className="dialog-actions">
          <button className="button secondary" type="button" onClick={onCancel} disabled={isCreating}>
            取消
          </button>
          <button className="button primary" type="button" onClick={onConfirm} disabled={!trimmedName || Boolean(busy)}>
            {isCreating ? <Loader2 className="spin" size={15} /> : <FolderPlus size={15} />}
            创建知识库
          </button>
        </div>
      </section>
    </div>
  );
}

function BatchDeleteDocumentsDialog({
  collection,
  documents,
  totalCount,
  confirmation,
  busy,
  onConfirmation,
  onCancel,
  onConfirm,
}: {
  collection: Collection | null;
  documents: DocumentRecord[];
  totalCount: number;
  confirmation: string;
  busy: BusyState;
  onConfirmation: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!collection || totalCount <= 0) return null;
  const matches = confirmation === collection.slug;
  const isDeleting = busy === "batch-delete";
  const listedDocuments = documents.slice(0, 5);
  const hiddenCount = Math.max(0, totalCount - listedDocuments.length);
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-dialog batch-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="batch-delete-title">
        <div className="panel-heading">
          <div>
            <h2 id="batch-delete-title">批量删除文档</h2>
            <p>将从当前知识库移除应用管理的文档记录、提取文本缓存和 LanceDB rows。</p>
          </div>
          <Trash2 size={18} />
        </div>
        <div className="delete-target">
          <Database size={16} />
          <span title={collection.slug}>{collection.name} / {collection.slug}</span>
        </div>
        <div className="delete-target-list" aria-label="即将删除的文档">
          {listedDocuments.map((document) => (
            <span key={document.id} title={document.sourcePath}>
              <FileText size={13} /> {document.name}
            </span>
          ))}
          {hiddenCount > 0 && <span>另有 {hiddenCount} 个文档未显示</span>}
        </div>
        <label className="field">
          <span>输入当前知识库 slug 确认：{collection.slug}</span>
          <input
            autoFocus
            value={confirmation}
            onChange={(event) => onConfirmation(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !isDeleting) onCancel();
              if (event.key === "Enter" && matches && !busy) onConfirm();
            }}
            placeholder={collection.slug}
            disabled={Boolean(busy)}
          />
        </label>
        <div className="dialog-actions">
          <button className="button secondary" type="button" onClick={onCancel} disabled={isDeleting}>
            取消
          </button>
          <button className="button secondary danger" type="button" onClick={onConfirm} disabled={!matches || Boolean(busy)}>
            {isDeleting ? <Loader2 className="spin" size={15} /> : <Trash2 size={15} />}
            确认删除 {totalCount} 个文档
          </button>
        </div>
      </section>
    </div>
  );
}

function ApplyDefaultConfirmDialog({
  open,
  collection,
  config,
  defaultConfig,
  configDirty,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  collection: Collection | null;
  config: AppConfig | null;
  defaultConfig: AppConfig | null;
  configDirty: boolean;
  busy: BusyState;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open || !collection) return null;
  const isBusy = busy === "apply-default";
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-dialog apply-default-dialog" role="dialog" aria-modal="true" aria-labelledby="apply-default-title">
        <div className="panel-heading">
          <div>
            <h2 id="apply-default-title">应用默认参数到当前知识库</h2>
            <p>这会把默认模板复制到当前知识库，覆盖它自己的参数副本；已有索引不会自动重建。</p>
          </div>
          <RotateCcw size={18} />
        </div>
        <div className="detail-grid">
          <DetailItem label="知识库" value={`${collection.name} / ${collection.slug}`} />
          <DetailItem label="当前 embedding" value={config ? `${config.embedding.provider} / ${config.embedding.model} / ${config.embedding.dimension}` : "未加载"} />
          <DetailItem label="默认 embedding" value={defaultConfig ? `${defaultConfig.embedding.provider} / ${defaultConfig.embedding.model} / ${defaultConfig.embedding.dimension}` : "未加载"} />
          <DetailItem label="当前 OCR" value={config ? `${config.parsers.ocr.mode} / ${config.parsers.ocr.language}` : "未加载"} />
          <DetailItem label="默认 OCR" value={defaultConfig ? `${defaultConfig.parsers.ocr.mode} / ${defaultConfig.parsers.ocr.language}` : "未加载"} />
          <DetailItem label="AnythingLLM" value={defaultConfig?.anythingllm.enabled ? defaultConfig.anythingllm.workspaceSlug || defaultConfig.anythingllm.workspaceName || "已启用" : "默认关闭"} />
        </div>
        <div className="detail-alert warn">
          {configDirty ? "当前面板有未保存草稿；继续会用默认模板覆盖当前知识库参数。" : "如果 embedding provider、模型或维度变化，旧向量索引需要手动重建。"}
        </div>
        <div className="dialog-actions">
          <button className="button secondary" type="button" onClick={onCancel} disabled={isBusy}>
            取消
          </button>
          <button className="button primary" type="button" onClick={onConfirm} disabled={Boolean(busy)}>
            {isBusy ? <Loader2 className="spin" size={15} /> : <RotateCcw size={15} />}
            确认应用默认
          </button>
        </div>
      </section>
    </div>
  );
}

function CopyDefaultConfirmDialog({
  open,
  collection,
  config,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  collection: Collection | null;
  config: AppConfig | null;
  busy: BusyState;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open || !collection) return null;
  const isBusy = busy === "copy-default";
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-dialog copy-default-dialog" role="dialog" aria-modal="true" aria-labelledby="copy-default-title" data-testid="copy-default-dialog">
        <div className="panel-heading">
          <div>
            <h2 id="copy-default-title">Copy current parameters as default</h2>
            <p>This writes the global default template used by future knowledge bases. Existing knowledge bases keep their own saved copies.</p>
          </div>
          <Clipboard size={18} />
        </div>
        <div className="detail-grid">
          <DetailItem label="Knowledge base" value={`${collection.name} / ${collection.slug}`} />
          <DetailItem label="Embedding" value={config ? `${config.embedding.provider} / ${config.embedding.model} / ${config.embedding.dimension}` : "Not loaded"} />
          <DetailItem label="Chunking" value={config ? `${config.chunking.targetChars} / ${config.chunking.overlapChars}` : "Not loaded"} />
          <DetailItem label="OCR" value={config ? `${config.parsers.ocr.mode} / ${config.parsers.ocr.language}` : "Not loaded"} />
          <DetailItem label="AnythingLLM" value={config?.anythingllm.enabled ? config.anythingllm.workspaceSlug || config.anythingllm.workspaceName || "Enabled" : "Disabled"} />
        </div>
        <div className="detail-alert warn">
          Save current knowledge-base parameters first. Only saved values are copied into the default template.
        </div>
        <div className="dialog-actions">
          <button className="button secondary" type="button" onClick={onCancel} disabled={isBusy}>
            Cancel
          </button>
          <button className="button primary" type="button" onClick={onConfirm} disabled={Boolean(busy)} data-testid="copy-default-confirm">
            {isBusy ? <Loader2 className="spin" size={15} /> : <Clipboard size={15} />}
            Confirm copy
          </button>
        </div>
      </section>
    </div>
  );
}

function DesktopRelaunchConfirmDialog({
  open,
  status,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  status: DesktopDataDirectoryStatus | null;
  busy: BusyState;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;
  const isBusy = busy === "desktop-relaunch";
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-dialog desktop-relaunch-dialog" role="dialog" aria-modal="true" aria-labelledby="desktop-relaunch-title" data-testid="desktop-relaunch-dialog">
        <div className="panel-heading">
          <div>
            <h2 id="desktop-relaunch-title">Restart Vector Forge Desktop</h2>
            <p>The app will close and relaunch so the pending data directory can take effect.</p>
          </div>
          <RefreshCw size={18} />
        </div>
        <div className="detail-grid">
          <DetailItem label="Current data directory" value={compactPath(status?.activeDataDir)} />
          <DetailItem label="Next launch directory" value={compactPath(status?.selectedDataDir || status?.pendingDataDir || status?.activeDataDir)} />
          <DetailItem label="Pending relaunch" value={status?.pendingRelaunch ? "Yes" : "No"} />
        </div>
        <div className="detail-alert warn">
          Finish any running imports or OCR jobs before restarting.
        </div>
        <div className="dialog-actions">
          <button className="button secondary" type="button" onClick={onCancel} disabled={isBusy}>
            Cancel
          </button>
          <button className="button primary" type="button" onClick={onConfirm} disabled={Boolean(busy)} data-testid="desktop-relaunch-confirm">
            {isBusy ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} />}
            Confirm restart
          </button>
        </div>
      </section>
    </div>
  );
}

function DeleteDocumentDialog({
  document,
  confirmation,
  busy,
  onConfirmation,
  onCancel,
  onConfirm,
}: {
  document: DocumentRecord | null;
  confirmation: string;
  busy: BusyState;
  onConfirmation: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!document) return null;
  const matches = confirmation === document.name;
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-document-title">
        <div className="panel-heading">
          <div>
            <h2 id="delete-document-title">删除文档</h2>
            <p>删除会移除应用管理的文档记录、提取文本缓存和 LanceDB rows。</p>
          </div>
          <Trash2 size={18} />
        </div>
        <div className="delete-target">
          <FileText size={16} />
          <span title={document.name}>{document.name}</span>
        </div>
        <label className="field">
          <span>输入完整文件名确认</span>
          <input
            autoFocus
            value={confirmation}
            onChange={(event) => onConfirmation(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onCancel();
              if (event.key === "Enter" && matches && !busy) onConfirm();
            }}
            placeholder={document.name}
            disabled={Boolean(busy)}
          />
        </label>
        <div className="dialog-actions">
          <button className="button secondary" type="button" onClick={onCancel} disabled={busy === "document-delete"}>
            取消
          </button>
          <button className="button secondary danger" type="button" onClick={onConfirm} disabled={!matches || Boolean(busy)}>
            {busy === "document-delete" ? <Loader2 className="spin" size={15} /> : <Trash2 size={15} />}
            确认删除
          </button>
        </div>
      </section>
    </div>
  );
}

function DesktopActionConfirmDialog({
  action,
  busy,
  onCancel,
  onConfirm,
}: {
  action: DesktopActionKind | null;
  busy: BusyState;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!action) return null;
  const isLaunch = action === "launch-installer";
  const title = isLaunch ? "启动 AnythingLLM 安装器" : "打开安装器目录";
  const body = isLaunch
    ? "这会调用本机系统启动托管目录里最近下载的 AnythingLLM 安装器。请确认安装包来自官方 GitHub release。"
    : "这会调用本机系统打开 Vector Forge 管理的 AnythingLLM 安装器目录。";
  const confirmLabel = isLaunch ? "确认启动" : "确认打开";
  const isBusy = busy === "anything-installer-launch" || busy === "anything-installer-folder";
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-dialog desktop-action-dialog" role="dialog" aria-modal="true" aria-labelledby="desktop-action-title">
        <div className="panel-heading">
          <div>
            <h2 id="desktop-action-title">{title}</h2>
            <p>{body}</p>
          </div>
          <Server size={18} />
        </div>
        <div className="detail-alert warn">
          本地执行类动作只通过 127.0.0.1 受信接口触发，不会开放到局域网或公网。
        </div>
        <div className="dialog-actions">
          <button className="button secondary" type="button" onClick={onCancel} disabled={isBusy}>
            取消
          </button>
          <button className="button primary" type="button" onClick={onConfirm} disabled={Boolean(busy)}>
            {isBusy ? <Loader2 className="spin" size={15} /> : isLaunch ? <PlugZap size={15} /> : <FolderPlus size={15} />}
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

function AnythingSyncConfirmDialog({
  open,
  collection,
  config,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  collection: Collection | null;
  config: AppConfig | null;
  busy: BusyState;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;
  const isBusy = busy === "sync-anything";
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-dialog anything-sync-dialog" role="dialog" aria-modal="true" aria-labelledby="anything-sync-title">
        <div className="panel-heading">
          <div>
            <h2 id="anything-sync-title">同步到 AnythingLLM</h2>
            <p>这会把当前知识库的 chunks 发送到配置的 AnythingLLM workspace，并记录幂等同步 manifest。</p>
          </div>
          <PlugZap size={18} />
        </div>
        <div className="detail-grid">
          <DetailItem label="知识库" value={collection ? `${collection.name} / ${collection.slug}` : "未选择"} />
          <DetailItem label="API" value={config?.anythingllm.baseUrl || "未配置"} />
          <DetailItem label="Workspace" value={config?.anythingllm.workspaceSlug || config?.anythingllm.workspaceName || "未配置"} />
          <DetailItem label="上限" value="每次最多 200 chunks" />
        </div>
        <div className="detail-alert warn">
          同步属于外部发送动作；请确认 API 地址、workspace 和当前知识库参数已保存。
        </div>
        <div className="dialog-actions">
          <button className="button secondary" type="button" onClick={onCancel} disabled={isBusy}>
            取消
          </button>
          <button className="button primary" type="button" onClick={onConfirm} disabled={Boolean(busy)}>
            {isBusy ? <Loader2 className="spin" size={15} /> : <PlugZap size={15} />}
            确认同步
          </button>
        </div>
      </section>
    </div>
  );
}

function AnythingCleanupConfirmDialog({
  document,
  busy,
  onCancel,
  onConfirm,
}: {
  document: DocumentRecord | null;
  busy: BusyState;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!document) return null;
  const pending = document.anythingSync?.chunks.filter((chunk) => chunk.cleanupPending).length ?? 0;
  const isBusy = busy === "anything-cleanup";
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-dialog anything-cleanup-dialog" role="dialog" aria-modal="true" aria-labelledby="anything-cleanup-title">
        <div className="panel-heading">
          <div>
            <h2 id="anything-cleanup-title">清理 AnythingLLM 远端记录</h2>
            <p>这会重试删除 manifest 中标记为待清理的 AnythingLLM embedding locations。</p>
          </div>
          <Trash2 size={18} />
        </div>
        <div className="delete-target">
          <FileText size={16} />
          <span title={document.name}>{document.name}</span>
        </div>
        <div className="detail-alert warn">
          待清理记录：{pending}。该动作会调用 AnythingLLM API 删除远端 embedding 记录。
        </div>
        <div className="dialog-actions">
          <button className="button secondary" type="button" onClick={onCancel} disabled={isBusy}>
            取消
          </button>
          <button className="button secondary danger" type="button" onClick={onConfirm} disabled={Boolean(busy)}>
            {isBusy ? <Loader2 className="spin" size={15} /> : <Trash2 size={15} />}
            确认清理
          </button>
        </div>
      </section>
    </div>
  );
}

function AnythingCleanupQueueConfirmDialog({
  request,
  queue,
  busy,
  onCancel,
  onConfirm,
}: {
  request: AnythingCleanupQueueRetryRequest | null;
  queue: AnythingCleanupQueuePayload | null;
  busy: BusyState;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!request || !queue) return null;
  const idSet = request.ids?.length ? new Set(request.ids) : null;
  const entries = queue.entries.filter((entry) => (!idSet || idSet.has(entry.id)) && entry.status === "pending");
  const locationCount = entries.reduce((sum, entry) => sum + entry.locationCount, 0);
  const missingKeyCount = entries.filter((entry) => !entry.apiKeyConfigured).length;
  const isBusy = busy === "anything-cleanup";
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-dialog anything-cleanup-queue-dialog" role="dialog" aria-modal="true" aria-labelledby="anything-cleanup-queue-title">
        <div className="panel-heading">
          <div>
            <h2 id="anything-cleanup-queue-title">重试 AnythingLLM 清理队列</h2>
            <p>这会按持久化队列调用 AnythingLLM API 删除远端 embedding locations。</p>
          </div>
          <Trash2 size={18} />
        </div>
        <div className="detail-grid">
          <DetailItem label="范围" value={request.label} />
          <DetailItem label="记录" value={`${entries.length} 条 pending`} />
          <DetailItem label="Locations" value={String(locationCount)} />
          <DetailItem label="缺少 key" value={String(missingKeyCount)} />
        </div>
        <div className="detail-alert warn">
          该动作会删除记录里的 AnythingLLM 远端 embedding。缺少匹配 API key 的记录会保留在队列中，等待恢复对应 API 地址和 key 后再重试。
        </div>
        <div className="dialog-actions">
          <button className="button secondary" type="button" onClick={onCancel} disabled={isBusy}>
            取消
          </button>
          <button className="button secondary danger" type="button" onClick={onConfirm} disabled={Boolean(busy) || !entries.length}>
            {isBusy ? <Loader2 className="spin" size={15} /> : <Trash2 size={15} />}
            确认重试
          </button>
        </div>
      </section>
    </div>
  );
}

function OcrTestConfirmDialog({
  context,
  config,
  busy,
  onCancel,
  onConfirm,
}: {
  context: OcrTestContext | null;
  config: AppConfig | null;
  busy: BusyState;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!context || !config) return null;
  const isBusy = busy === "test-ocr";
  const mode = config.parsers.ocr.mode;
  const riskText =
    mode === "cloud" || config.parsers.ocr.allowCloudOcr
      ? "当前配置允许 cloud OCR，测试可能向外部 API 发送图片内容。"
      : mode === "paddleocr"
        ? "当前配置使用 PaddleOCR，本机会调用你配置的 OCR 命令。"
        : "当前 OCR 测试会检查本机 OCR 运行环境。";
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-dialog ocr-test-dialog" role="dialog" aria-modal="true" aria-labelledby="ocr-test-title">
        <div className="panel-heading">
          <div>
            <h2 id="ocr-test-title">确认 OCR 测试</h2>
            <p>{riskText}</p>
          </div>
          <WandSparkles size={18} />
        </div>
        <div className="detail-grid">
          <DetailItem label="来源" value={context === "onboarding" ? "首次运行向导" : "OCR / 解析配置"} />
          <DetailItem label="模式" value={mode} />
          <DetailItem label="语言" value={config.parsers.ocr.language} />
          <DetailItem label="超时" value={`${config.parsers.ocr.timeoutMs} ms`} />
        </div>
        <div className="dialog-actions">
          <button className="button secondary" type="button" onClick={onCancel} disabled={isBusy}>
            取消
          </button>
          <button className="button primary" type="button" onClick={onConfirm} disabled={Boolean(busy)}>
            {isBusy ? <Loader2 className="spin" size={15} /> : <WandSparkles size={15} />}
            确认测试
          </button>
        </div>
      </section>
    </div>
  );
}

function ProcessingRiskConfirmDialog({
  action,
  collection,
  busy,
  onCancel,
  onConfirm,
}: {
  action: PendingProcessingAction | null;
  collection: Collection | null;
  busy: BusyState;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!action) return null;
  const isBusy =
    busy === "upload" ||
    busy === "import-paths" ||
    busy === "document-reprocess" ||
    busy === "batch-reprocess";
  const actionLabel =
    action.kind === "upload"
      ? "导入附件"
      : action.kind === "import-paths"
        ? "导入扫描候选"
        : action.kind === "reprocess"
          ? "重新处理文档"
          : "批量重新处理";
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-dialog processing-risk-dialog" role="dialog" aria-modal="true" aria-labelledby="processing-risk-title">
        <div className="panel-heading">
          <div>
            <h2 id="processing-risk-title">确认{actionLabel}</h2>
            <p>当前知识库参数会在处理时触发外部发送或本地执行，请确认后继续。</p>
          </div>
          <ShieldCheck size={18} />
        </div>
        <div className="detail-grid">
          <DetailItem label="知识库" value={collection ? `${collection.name} / ${collection.slug}` : "未选择"} />
          <DetailItem label="数量" value={`${action.count} 项`} />
          <DetailItem label="动作" value={actionLabel} />
        </div>
        <div className="risk-list">
          {action.risk.warnings.map((warning) => (
            <div className="detail-alert warn" key={warning}>
              {warning}
            </div>
          ))}
        </div>
        <div className="dialog-actions">
          <button className="button secondary" type="button" onClick={onCancel} disabled={isBusy}>
            取消
          </button>
          <button className="button primary" type="button" onClick={onConfirm} disabled={Boolean(busy)}>
            {isBusy ? <Loader2 className="spin" size={15} /> : <CheckCircle2 size={15} />}
            确认继续
          </button>
        </div>
      </section>
    </div>
  );
}

function DataDirectoryControl({
  status,
  draft,
  dirty,
  busy,
  compact = false,
  onDraft,
  onChoose,
  onSave,
  onReset,
  onRelaunch,
}: {
  status: DesktopDataDirectoryStatus | null;
  draft: string;
  dirty: boolean;
  busy: BusyState;
  compact?: boolean;
  onDraft: (value: string) => void;
  onChoose: () => void;
  onSave: () => void;
  onReset: () => void;
  onRelaunch: () => void;
}) {
  if (!status && !window.vectorForgeDesktop) return null;
  const envLocked = Boolean(status?.envOverride);
  const pending = Boolean(status?.pendingRelaunch);
  const isBusy = Boolean(busy);
  const canSave = Boolean(draft.trim()) && dirty && !envLocked && !isBusy;
  const canReset = Boolean((status?.persistedDataDir || status?.pendingDataDir) && !envLocked && !isBusy);
  return (
    <div className={`desktop-data-dir-panel${compact ? " compact" : ""}`} data-testid="data-dir-card">
      <div className="desktop-data-dir-status">
        <DetailItem label="当前运行" value={compactPath(status?.activeDataDir)} />
        <DetailItem label="下次启动" value={compactPath(status?.selectedDataDir || status?.activeDataDir)} />
      </div>
      <label className="field">
        <span>数据目录</span>
        <input
          data-testid="data-dir-input"
          value={draft}
          onChange={(event) => onDraft(event.target.value)}
          disabled={isBusy || envLocked}
          placeholder={status?.defaultDataDir || "选择一个本地数据目录"}
        />
      </label>
      {envLocked && (
        <p className="inline-warning" data-testid="data-dir-env-lock">
          当前由 VECTOR_FORGE_DATA_DIR 指定数据目录，桌面设置不可修改。
        </p>
      )}
      {pending && (
        <p className="inline-warning" data-testid="data-dir-restart-required">
          已保存新目录，当前进程仍使用旧目录；重启应用后生效。
        </p>
      )}
      <div className="button-row">
        <button className="mini-action" type="button" onClick={onChoose} disabled={isBusy || envLocked} data-testid="data-dir-choose">
          <FolderPlus size={13} /> 选择目录
        </button>
        <button className="mini-action" type="button" onClick={onSave} disabled={!canSave} data-testid="data-dir-save">
          {busy === "data-dir-save" ? <Loader2 className="spin" size={13} /> : <Settings size={13} />}
          保存目录
        </button>
        <button className="mini-action" type="button" onClick={onReset} disabled={!canReset} data-testid="data-dir-reset">
          恢复默认
        </button>
        {pending && (
          <button className="mini-action invert" type="button" onClick={onRelaunch} disabled={isBusy} data-testid="data-dir-relaunch">
            {busy === "desktop-relaunch" ? <Loader2 className="spin" size={13} /> : <RefreshCw size={13} />}
            重启应用
          </button>
        )}
      </div>
    </div>
  );
}

function cleanupSourceLabel(source: string) {
  if (source === "document-delete") return "文档删除";
  if (source === "collection-delete") return "知识库删除";
  if (source === "reprocess") return "重新处理";
  return source || "未知来源";
}

function cleanupEntryTitle(entry: AnythingCleanupQueueEntry) {
  return entry.documentName || entry.documentId || entry.collectionSlug || entry.id;
}

function AnythingCleanupQueuePanel({
  queue,
  busy,
  onRefresh,
  onRetry,
}: {
  queue: AnythingCleanupQueuePayload | null;
  busy: BusyState;
  onRefresh: () => void;
  onRetry: (ids?: string[]) => void;
}) {
  const pendingEntries = queue?.entries.filter((entry) => entry.status === "pending") ?? [];
  const visibleEntries = queue?.entries.slice(0, 5) ?? [];
  const canRetryAll = pendingEntries.length > 0 && !busy;
  return (
    <div className="anything-cleanup-queue" data-testid="anything-cleanup-queue">
      <div className="anything-cleanup-queue-head">
        <div>
          <strong>远端清理队列</strong>
          <p>跟踪删除、重处理或知识库删除后仍需清理的 AnythingLLM embedding locations。</p>
        </div>
        <div className="button-row">
          <button className="mini-action" type="button" onClick={onRefresh} disabled={Boolean(busy)} data-testid="cleanup-queue-refresh">
            {busy === "anything-cleanup" ? <Loader2 className="spin" size={13} /> : <RefreshCw size={13} />}
            刷新队列
          </button>
          <button className="mini-action danger" type="button" onClick={() => onRetry()} disabled={!canRetryAll} data-testid="cleanup-queue-retry-all" title={canRetryAll ? "确认后重试全部 pending 清理记录" : "没有 pending 清理记录"}>
            <Trash2 size={13} />
            重试全部
          </button>
        </div>
      </div>
      {queue ? (
        <>
          <div className="cleanup-queue-counts">
            <DetailItem label="总数" value={String(queue.counts.total)} />
            <DetailItem label="待处理" value={String(queue.counts.pending)} />
            <DetailItem label="待激活" value={String(queue.counts.prepared)} />
          </div>
          {!queue.entries.length ? (
            <p className="muted">当前没有待清理的 AnythingLLM 远端记录。</p>
          ) : (
            <div className="cleanup-queue-list">
              {visibleEntries.map((entry) => (
                <div className="cleanup-queue-entry" key={entry.id} data-cleanup-entry-id={entry.id}>
                  <div className="cleanup-entry-main">
                    <div className="cleanup-entry-title">
                      <span title={cleanupEntryTitle(entry)}>{cleanupEntryTitle(entry)}</span>
                      <Pill tone={entry.status === "pending" ? "warn" : "neutral"}>{entry.status}</Pill>
                      {!entry.apiKeyConfigured && <Pill tone="bad">缺少 API key</Pill>}
                    </div>
                    <p title={entry.baseUrl}>
                      {cleanupSourceLabel(entry.source)} · {entry.collectionSlug} · {entry.workspaceSlug} · {entry.locationCount} locations
                    </p>
                    {entry.lastError && <p className="cleanup-entry-error" title={entry.lastError}>{entry.lastError}</p>}
                  </div>
                  <div className="cleanup-entry-side">
                    <span>{entry.attempts} 次</span>
                    <span>{formatDate(entry.updatedAt)}</span>
                    <button
                      className="mini-action danger"
                      type="button"
                      onClick={() => onRetry([entry.id])}
                      disabled={Boolean(busy) || entry.status !== "pending"}
                      title={entry.status === "pending" ? "确认后重试这一条清理记录" : "prepared 记录会在本地删除提交后自动转为 pending"}
                    >
                      重试
                    </button>
                  </div>
                </div>
              ))}
              {queue.entries.length > visibleEntries.length && (
                <p className="muted">还有 {queue.entries.length - visibleEntries.length} 条记录；点击“重试全部”会处理全部 pending 记录。</p>
              )}
            </div>
          )}
        </>
      ) : (
        <p className="muted">尚未刷新清理队列。点击“刷新队列”会读取本地持久化队列，不会自动删除远端内容。</p>
      )}
    </div>
  );
}

function ConfigInspector(props: {
  page: ConfigInspectorPage;
  config: AppConfig | null;
  defaultConfig: AppConfig | null;
  status: CollectionConfigStatus | null;
  collections: Collection[];
  activeSlug: string;
  activeCollection: Collection | null;
  jobs: ProcessingJob[];
  busy: BusyState;
  configDirty: boolean;
  canSyncAnythingLLM: boolean;
  anythingSyncDisabledReason: string;
  anythingEnvironment: AnythingEnvironment | null;
  anythingWorkspaces: AnythingWorkspaceSummary[];
  anythingCleanupQueue: AnythingCleanupQueuePayload | null;
  desktopDataDir: DesktopDataDirectoryStatus | null;
  desktopDataDirDraft: string;
  desktopDataDirDirty: boolean;
  anythingDesktopExePath: string;
  anythingInstallerUrl: string;
  onActiveSlug: (slug: string) => void;
  onCreateCollection: () => void;
  onPatch: (updater: (draft: AppConfig) => AppConfig) => void;
  onSave: () => void;
  onApplyDefault: () => void;
  onCopyDefault: () => void;
  onCopyMcpResource: (uri: string) => void;
  onTestEmbedding: () => void;
  onTestOcr: () => void;
  onTestAnything: () => void;
  onDesktopDataDirDraft: (value: string) => void;
  onChooseDesktopDataDir: () => void;
  onSaveDesktopDataDir: () => void;
  onResetDesktopDataDir: () => void;
  onRelaunchDesktop: () => void;
  onRefreshAnythingEnvironment: () => void;
  onAnythingDesktopExePath: (value: string) => void;
  onSaveAnythingExePath: () => void;
  onClearAnythingExePath: () => void;
  onTestAnythingDesktop: () => void;
  onLoadAnythingWorkspaces: () => void;
  onAnythingInstallerUrl: (value: string) => void;
  onValidateAnythingInstaller: () => void;
  onDownloadAnythingInstaller: () => void;
  onOpenAnythingInstallerFolder: () => void;
  onLaunchAnythingInstaller: () => void;
  onSync: () => void;
  onRefreshAnythingCleanupQueue: () => void;
  onRetryAnythingCleanupQueue: (ids?: string[]) => void;
  onCancelJob: (jobId: string) => void;
  cancellingJobId: string;
}) {
  const config = props.config;
  const controlsDisabled = Boolean(props.busy);
  const showCollectionPicker = props.page !== "jobs";
  const showCollectionSummary = props.page === "collections";
  const showDesktopDataDir = props.page === "settings";
  const showEmbedding = props.page === "settings";
  const showParsers = props.page === "parsers";
  const showMcp = props.page === "mcp";
  const showAnythingLLM = props.page === "anythingllm";
  const showDefaultSummary = props.page === "settings";
  const showActions = props.page === "settings" || props.page === "parsers" || props.page === "mcp" || props.page === "anythingllm";
  const showTaskMini = props.page === "jobs";
  const canTestAnythingDraft = Boolean(config?.anythingllm.baseUrl.trim() && config?.anythingllm.apiKey.trim());
  const canLoadAnythingWorkspaces = canTestAnythingDraft;
  const anythingDraftTestTitle = !config
    ? "请先选择知识库"
    : !config.anythingllm.baseUrl.trim()
      ? "请先填写 AnythingLLM API 地址"
      : !config.anythingllm.apiKey.trim()
        ? "请先填写 AnythingLLM API key"
        : "测试当前草稿里的 AnythingLLM 连接";
  const anythingWorkspaceTitle = !config
    ? "请先选择知识库"
    : !config.anythingllm.baseUrl.trim()
      ? "请先填写 AnythingLLM API 地址"
      : !config.anythingllm.apiKey.trim()
        ? "请先填写 AnythingLLM API key"
        : "读取当前草稿 API 下的 Workspace";
  return (
    <aside className="inspector-panel">
      <div className="panel-heading">
        <div>
          <h2>配置检查器</h2>
          <p>先选择知识库，再编辑它自己的参数副本。</p>
        </div>
        <Settings size={18} />
      </div>

      <div className="inspector-pills">
        <Pill tone={props.status?.usesDefaultSnapshot ? "active" : "neutral"}>
          {props.status?.usesDefaultSnapshot ? "使用默认副本" : "已自定义"}
        </Pill>
        {props.status?.embeddingChangedRequiresRebuild && <Pill tone="warn">需要重建 embedding</Pill>}
        {props.configDirty && <Pill tone="warn">参数未保存</Pill>}
      </div>

      {props.configDirty && (
        <p className="inline-warning">当前面板里有未保存参数；测试按钮会使用草稿，但导入、重处理、同步和 MCP 会使用已保存配置。</p>
      )}

      {showCollectionPicker && (
        <label className="field compact-field" id="section-collections">
          <span>当前知识库</span>
          <div className="collection-picker-row">
            <select value={props.activeSlug} onChange={(event) => props.onActiveSlug(event.target.value)} disabled={!props.collections.length || Boolean(props.busy)}>
              {!props.collections.length && <option value="">暂无知识库</option>}
              {props.collections.map((collection) => (
                <option key={collection.slug} value={collection.slug}>{collection.name} / {collection.slug}</option>
              ))}
            </select>
            <button className="mini-action square" onClick={props.onCreateCollection} disabled={Boolean(props.busy)} title="新建知识库">
              <FolderPlus size={15} />
            </button>
          </div>
        </label>
      )}

      {showDesktopDataDir && (
        <div className="desktop-data-dir-section" id="section-settings" data-testid="settings-data-dir-card">
          <div className="config-card-head">
            <div>
              <h3>桌面数据目录</h3>
              <p>保存后重启应用生效，不会在运行中热切换 LanceDB 或 manifest。</p>
            </div>
            <Database size={16} />
          </div>
          <DataDirectoryControl
            status={props.desktopDataDir}
            draft={props.desktopDataDirDraft}
            dirty={props.desktopDataDirDirty}
            busy={props.busy}
            onDraft={props.onDesktopDataDirDraft}
            onChoose={props.onChooseDesktopDataDir}
            onSave={props.onSaveDesktopDataDir}
            onReset={props.onResetDesktopDataDir}
            onRelaunch={props.onRelaunchDesktop}
          />
        </div>
      )}

      {config && !showTaskMini ? (
        <fieldset className="config-control-fieldset" disabled={controlsDisabled}>
          {showCollectionSummary && (
            <section className="collection-config-summary" data-testid="collection-config-summary">
              <div className="config-card-head">
                <div>
                  <h3>配置摘要</h3>
                  <p>当前知识库使用创建时复制的参数副本，修改后只影响这个知识库。</p>
                </div>
                <Database size={16} />
              </div>
              <div className="overview-status-grid">
                <DetailItem label="Slug" value={props.activeCollection?.slug ?? "未选择"} />
                <DetailItem label="Table" value={props.activeCollection?.tableName ?? "未创建"} />
                <DetailItem label="Embedding" value={`${config.embedding.provider} / ${config.embedding.model}`} />
                <DetailItem label="维度" value={String(config.embedding.dimension)} />
                <DetailItem label="Chunk" value={`${config.chunking.targetChars} / ${config.chunking.overlapChars}`} />
                <DetailItem label="OCR" value={`${config.parsers.ocr.mode} / ${config.parsers.ocr.language}`} />
              </div>
              <div className="button-row">
                <button className="mini-action" type="button" onClick={props.onCreateCollection} disabled={Boolean(props.busy)}>
                  <FolderPlus size={14} /> 新建知识库
                </button>
                <button className="mini-action" type="button" onClick={props.onApplyDefault} disabled={Boolean(props.busy)}>
                  <RotateCcw size={14} /> 应用默认到当前
                </button>
              </div>
            </section>
          )}

          {showEmbedding && (
          <ConfigCard color="blue" title="Embedding" meta={`${config.embedding.model} · ${config.embedding.dimension} 维`} icon={<Bot size={16} />} id="section-embedding">
            <div className="two-col">
              <label className="field">
                <span>Provider</span>
                <select value={config.embedding.provider} onChange={(event) => props.onPatch((draft) => ({ ...draft, embedding: { ...draft.embedding, provider: event.target.value as EmbeddingProviderType } }))}>
                  <option value="local-hash">local-hash</option>
                  <option value="openai-compatible">OpenAI-compatible</option>
                </select>
              </label>
              <NumberField label="维度" value={config.embedding.dimension} min={32} max={4096} onChange={(value) => props.onPatch((draft) => ({ ...draft, embedding: { ...draft.embedding, dimension: value } }))} />
            </div>
            <label className="field">
              <span>模型</span>
              <input value={config.embedding.model} onChange={(event) => props.onPatch((draft) => ({ ...draft, embedding: { ...draft.embedding, model: event.target.value } }))} />
            </label>
            <label className="field">
              <span>Base URL</span>
              <input value={config.embedding.baseUrl} onChange={(event) => props.onPatch((draft) => ({ ...draft, embedding: { ...draft.embedding, baseUrl: event.target.value } }))} placeholder="https://api.openai.com/v1/embeddings" />
            </label>
            <div className="two-col">
              <label className="field">
                <span>API key</span>
                <input type="password" value={config.embedding.apiKey} onChange={(event) => props.onPatch((draft) => ({ ...draft, embedding: { ...draft.embedding, apiKey: event.target.value } }))} placeholder="OpenAI-compatible key" />
              </label>
              <NumberField label="Batch size" value={config.embedding.batchSize} min={1} max={256} onChange={(value) => props.onPatch((draft) => ({ ...draft, embedding: { ...draft.embedding, batchSize: value } }))} />
            </div>
            <div className="two-col">
              <NumberField label="切片长度" value={config.chunking.targetChars} min={300} max={8000} onChange={(value) => props.onPatch((draft) => ({ ...draft, chunking: { ...draft.chunking, targetChars: value } }))} />
              <NumberField label="重叠" value={config.chunking.overlapChars} min={0} max={2000} onChange={(value) => props.onPatch((draft) => ({ ...draft, chunking: { ...draft.chunking, overlapChars: value } }))} />
            </div>
            {props.status?.embeddingChangedRequiresRebuild && (
              <p className="inline-warning">Embedding provider、模型或维度已变化；旧索引不会自动改变，需要重建 embedding。</p>
            )}
            <button className="mini-action" onClick={props.onTestEmbedding} disabled={Boolean(props.busy)}><WandSparkles size={14} /> 测试 embedding</button>
          </ConfigCard>
          )}

          {showParsers && (
          <ConfigCard color="orange" title="OCR / 解析" meta={`${config.parsers.ocr.mode} · ${config.parsers.ocr.language}`} icon={<SlidersHorizontal size={16} />} id="section-parsers">
            <div className="two-col">
              <label className="field">
                <span>重复文件策略</span>
                <select value={config.parsers.duplicateStrategy} onChange={(event) => props.onPatch((draft) => ({ ...draft, parsers: { ...draft.parsers, duplicateStrategy: event.target.value as DuplicateStrategy } }))}>
                  <option value="skip">跳过</option>
                  <option value="version">作为新版本</option>
                  <option value="replace">替换旧文档</option>
                </select>
              </label>
              <NumberField label="最大文件 MB" value={config.parsers.maxFileSizeMb} min={1} max={2048} onChange={(value) => props.onPatch((draft) => ({ ...draft, parsers: { ...draft.parsers, maxFileSizeMb: value } }))} />
            </div>
            <div className="two-col">
              <NumberField label="PDF 最大页数" value={config.parsers.pdf.maxPages} min={1} max={5000} onChange={(value) => props.onPatch((draft) => ({ ...draft, parsers: { ...draft.parsers, pdf: { ...draft.parsers.pdf, maxPages: value } } }))} />
              <NumberField label="OCR 触发阈值" value={config.parsers.pdf.ocrTextThreshold} min={0} max={5000} onChange={(value) => props.onPatch((draft) => ({ ...draft, parsers: { ...draft.parsers, pdf: { ...draft.parsers.pdf, ocrTextThreshold: value } } }))} />
            </div>
            <div className="two-col">
              <NumberField label="PDF 渲染倍数" value={config.parsers.pdf.renderScale} min={1} max={4} step={0.1} onChange={(value) => props.onPatch((draft) => ({ ...draft, parsers: { ...draft.parsers, pdf: { ...draft.parsers.pdf, renderScale: value } } }))} />
              <NumberField label="OCR 超时 ms" value={config.parsers.ocr.timeoutMs} min={1000} max={600000} step={1000} onChange={(value) => props.onPatch((draft) => ({ ...draft, parsers: { ...draft.parsers, ocr: { ...draft.parsers.ocr, timeoutMs: value } } }))} />
            </div>
            <label className="check-field">
              <input type="checkbox" checked={config.parsers.pdf.textFirst} onChange={(event) => props.onPatch((draft) => ({ ...draft, parsers: { ...draft.parsers, pdf: { ...draft.parsers.pdf, textFirst: event.target.checked } } }))} />
              <span>PDF 优先抽取文本层，文本过少时再 OCR</span>
            </label>
            <label className="check-field">
              <input type="checkbox" checked={config.parsers.pdf.keepPageNumbers} onChange={(event) => props.onPatch((draft) => ({ ...draft, parsers: { ...draft.parsers, pdf: { ...draft.parsers.pdf, keepPageNumbers: event.target.checked } } }))} />
              <span>保留页码 metadata，检索结果显示来源页</span>
            </label>
            <div className="two-col">
              <label className="field">
                <span>模式</span>
                <select value={config.parsers.ocr.mode} onChange={(event) => props.onPatch((draft) => ({ ...draft, parsers: { ...draft.parsers, ocr: { ...draft.parsers.ocr, mode: event.target.value as OcrMode } } }))}>
                  <option value="auto">auto</option>
                  <option value="tesseract">tesseract</option>
                  <option value="paddleocr">paddleocr</option>
                  <option value="cloud">cloud</option>
                </select>
              </label>
              <NumberField label="最低置信度" value={config.parsers.ocr.minConfidence} min={0} max={100} onChange={(value) => props.onPatch((draft) => ({ ...draft, parsers: { ...draft.parsers, ocr: { ...draft.parsers.ocr, minConfidence: value } } }))} />
            </div>
            <label className="field">
              <span>语言</span>
              <input value={config.parsers.ocr.language} onChange={(event) => props.onPatch((draft) => ({ ...draft, parsers: { ...draft.parsers, ocr: { ...draft.parsers.ocr, language: event.target.value } } }))} />
            </label>
            <label className="field">
              <span>Tesseract 语言包路径</span>
              <input value={config.parsers.ocr.tesseractLangPath} onChange={(event) => props.onPatch((draft) => ({ ...draft, parsers: { ...draft.parsers, ocr: { ...draft.parsers.ocr, tesseractLangPath: event.target.value } } }))} placeholder="留空使用默认缓存" />
            </label>
            <div className="two-col">
              <label className="field">
                <span>PaddleOCR 命令</span>
                <input value={config.parsers.ocr.paddleCommand} onChange={(event) => props.onPatch((draft) => ({ ...draft, parsers: { ...draft.parsers, ocr: { ...draft.parsers.ocr, paddleCommand: event.target.value } } }))} placeholder="paddleocr" />
              </label>
              <label className="field">
                <span>Paddle 参数模板</span>
                <input value={config.parsers.ocr.paddleArgs} onChange={(event) => props.onPatch((draft) => ({ ...draft, parsers: { ...draft.parsers, ocr: { ...draft.parsers.ocr, paddleArgs: event.target.value } } }))} placeholder="{input} {output}" />
              </label>
            </div>
            <label className="check-field">
              <input type="checkbox" checked={config.parsers.ocr.allowCloudOcr} onChange={(event) => props.onPatch((draft) => ({ ...draft, parsers: { ...draft.parsers, ocr: { ...draft.parsers.ocr, allowCloudOcr: event.target.checked } } }))} />
              <span>允许 cloud OCR，图片会发送到外部 API</span>
            </label>
            <label className="field">
              <span>Cloud OCR Base URL</span>
              <input value={config.parsers.ocr.cloudBaseUrl} onChange={(event) => props.onPatch((draft) => ({ ...draft, parsers: { ...draft.parsers, ocr: { ...draft.parsers.ocr, cloudBaseUrl: event.target.value } } }))} placeholder="OpenAI-compatible vision endpoint" />
            </label>
            <div className="two-col">
              <label className="field">
                <span>Cloud OCR API key</span>
                <input type="password" value={config.parsers.ocr.cloudApiKey} onChange={(event) => props.onPatch((draft) => ({ ...draft, parsers: { ...draft.parsers, ocr: { ...draft.parsers.ocr, cloudApiKey: event.target.value } } }))} />
              </label>
              <label className="field">
                <span>Cloud OCR 模型</span>
                <input value={config.parsers.ocr.cloudModel} onChange={(event) => props.onPatch((draft) => ({ ...draft, parsers: { ...draft.parsers, ocr: { ...draft.parsers.ocr, cloudModel: event.target.value } } }))} />
              </label>
            </div>
            <p className="inline-warning">解析、OCR 或切片参数只影响之后导入和重新处理；旧文档需要手动重新处理。</p>
            <button className="mini-action" onClick={props.onTestOcr} disabled={Boolean(props.busy)}><WandSparkles size={14} /> 测试 OCR</button>
          </ConfigCard>
          )}

          {showMcp && (
          <ConfigCard color="green" title="MCP" meta={config.mcp.allowWrites ? "允许写入" : "只读模式"} icon={<ShieldCheck size={16} />} id="section-mcp">
            <label className="check-field">
              <input type="checkbox" checked={config.mcp.allowWrites} onChange={(event) => props.onPatch((draft) => ({ ...draft, mcp: { ...draft.mcp, allowWrites: event.target.checked } }))} />
              <span>在当前知识库参数中允许 MCP 写入</span>
            </label>
            <p className="muted">MCP 服务读取默认模板；如需真正启用写入，请保存当前参数后复制为默认并重启 MCP。</p>
            <div className="mcp-resource-list" data-testid="mcp-resource-list">
              <div className="mcp-resource-head">
                <strong>只读 Resources</strong>
                <span>{mcpResourceCatalog.length} 个可被 AI 客户端读取的本地上下文入口</span>
              </div>
              {mcpResourceCatalog.map((resource) => {
                const resolvedUri = props.activeCollection ? resource.uri.replace("{slug}", props.activeCollection.slug) : resource.uri;
                return (
                  <div className="mcp-resource-row" key={resource.uri}>
                    <div>
                      <strong>{resource.label}</strong>
                      <code>{resolvedUri}</code>
                      <small>{resource.description}</small>
                    </div>
                    <button
                      className="mini-action square"
                      type="button"
                      onClick={() => props.onCopyMcpResource(resource.uri)}
                      disabled={Boolean(props.busy)}
                      title={`复制 ${resolvedUri}`}
                    >
                      <Clipboard size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
          </ConfigCard>
          )}

          {showAnythingLLM && (
          <ConfigCard color="violet" title="AnythingLLM" meta={config.anythingllm.enabled ? config.anythingllm.workspaceSlug || "已启用" : "可选下游"} icon={<PlugZap size={16} />} id="section-anythingllm">
            <label className="check-field">
              <input type="checkbox" checked={config.anythingllm.enabled} onChange={(event) => props.onPatch((draft) => ({ ...draft, anythingllm: { ...draft.anythingllm, enabled: event.target.checked } }))} />
              <span>启用 AnythingLLM 同步</span>
            </label>
            <label className="field">
              <span>API Base URL</span>
              <input value={config.anythingllm.baseUrl} onChange={(event) => props.onPatch((draft) => ({ ...draft, anythingllm: { ...draft.anythingllm, baseUrl: event.target.value } }))} placeholder="http://127.0.0.1:3001/api" />
            </label>
            <label className="field">
              <span>API key</span>
              <input type="password" value={config.anythingllm.apiKey} onChange={(event) => props.onPatch((draft) => ({ ...draft, anythingllm: { ...draft.anythingllm, apiKey: event.target.value } }))} placeholder="AnythingLLM API key" />
            </label>
            <div className="two-col">
              <label className="field">
                <span>Workspace</span>
                <input value={config.anythingllm.workspaceName} onChange={(event) => props.onPatch((draft) => ({ ...draft, anythingllm: { ...draft.anythingllm, workspaceName: event.target.value } }))} />
              </label>
              <label className="field">
                <span>Slug</span>
                <input value={config.anythingllm.workspaceSlug} onChange={(event) => props.onPatch((draft) => ({ ...draft, anythingllm: { ...draft.anythingllm, workspaceSlug: event.target.value } }))} />
              </label>
            </div>
            {props.configDirty && (
              <p className="inline-warning">同步使用后端已保存的 AnythingLLM 配置；请先保存当前知识库参数。</p>
            )}
            <div className="button-row">
              <button className="mini-action" onClick={props.onTestAnything} disabled={!canTestAnythingDraft || Boolean(props.busy)} title={anythingDraftTestTitle}><Server size={14} /> 测试</button>
              <button
                className="mini-action"
                onClick={props.onSync}
                disabled={!props.canSyncAnythingLLM || Boolean(props.busy)}
                title={props.busy ? "当前有任务运行中" : props.canSyncAnythingLLM ? "同步到 AnythingLLM" : props.anythingSyncDisabledReason}
              >
                <PlugZap size={14} /> 同步
              </button>
            </div>
            <AnythingCleanupQueuePanel
              queue={props.anythingCleanupQueue}
              busy={props.busy}
              onRefresh={props.onRefreshAnythingCleanupQueue}
              onRetry={props.onRetryAnythingCleanupQueue}
            />
            <div className="anything-desktop-box">
              <div className="anything-desktop-head">
                <strong>桌面管理</strong>
                <button className="mini-action" type="button" onClick={props.onRefreshAnythingEnvironment} disabled={Boolean(props.busy)}>
                  {props.busy === "anything-env" ? <Loader2 className="spin" size={13} /> : <RefreshCw size={13} />}
                  刷新环境
                </button>
              </div>
              <p className="muted">
                {props.anythingEnvironment
                  ? `系统 ${props.anythingEnvironment.os.platform}/${props.anythingEnvironment.os.arch} · ${props.anythingEnvironment.desktop.detectedExe?.launchable || props.anythingEnvironment.desktop.configuredExe.launchable ? "已检测到可启动程序" : "未检测到可启动程序"}`
                  : "用于配置官方 AnythingLLM.exe 路径、读取 workspace 和管理安装器。"}
              </p>
              <label className="field">
                <span>AnythingLLM.exe 路径</span>
                <input value={props.anythingDesktopExePath} onChange={(event) => props.onAnythingDesktopExePath(event.target.value)} placeholder="C:\\Users\\you\\AppData\\Local\\Programs\\AnythingLLM\\AnythingLLM.exe" disabled={Boolean(props.busy)} />
              </label>
              <div className="button-row">
                <button className="mini-action" type="button" onClick={props.onSaveAnythingExePath} disabled={Boolean(props.busy) || !props.anythingDesktopExePath.trim()}>
                  {props.busy === "anything-exe" ? <Loader2 className="spin" size={13} /> : <Settings size={13} />}
                  保存路径
                </button>
                <button className="mini-action" type="button" onClick={props.onClearAnythingExePath} disabled={Boolean(props.busy)}>清空</button>
                <button className="mini-action" type="button" onClick={props.onTestAnythingDesktop} disabled={Boolean(props.busy)}><Server size={13} /> 桌面测试</button>
              </div>
              <div className="button-row">
                <button className="mini-action" type="button" onClick={props.onLoadAnythingWorkspaces} disabled={!canLoadAnythingWorkspaces || Boolean(props.busy)} title={anythingWorkspaceTitle}>
                  {props.busy === "anything-workspaces" ? <Loader2 className="spin" size={13} /> : <Database size={13} />}
                  读取 Workspace
                </button>
                {props.anythingWorkspaces.slice(0, 3).map((workspace) => (
                  <button
                    className="workspace-chip"
                    type="button"
                    key={workspace.slug || String(workspace.id)}
                    onClick={() => props.onPatch((draft) => ({
                      ...draft,
                      anythingllm: {
                        ...draft.anythingllm,
                        workspaceName: workspace.name || draft.anythingllm.workspaceName,
                        workspaceSlug: workspace.slug || draft.anythingllm.workspaceSlug,
                      },
                    }))}
                    disabled={Boolean(props.busy)}
                    title="应用到当前知识库参数草稿"
                  >
                    {workspace.name || workspace.slug}
                  </button>
                ))}
              </div>
              <label className="field">
                <span>安装包直链</span>
                <input value={props.anythingInstallerUrl} onChange={(event) => props.onAnythingInstallerUrl(event.target.value)} placeholder="https://github.com/Mintplex-Labs/anything-llm/releases/download/.../AnythingLLM.exe" />
              </label>
              <div className="button-row">
                <button className="mini-action" type="button" onClick={props.onValidateAnythingInstaller} disabled={!props.anythingInstallerUrl.trim() || Boolean(props.busy)} title="只检查官方地址、文件名和扩展名格式">检查格式</button>
                <button className="mini-action" type="button" onClick={props.onDownloadAnythingInstaller} disabled={!props.anythingInstallerUrl.trim() || Boolean(props.busy)}>
                  {props.busy === "anything-installer-download" ? <Loader2 className="spin" size={13} /> : <Upload size={13} />}
                  下载
                </button>
                <button className="mini-action" type="button" onClick={props.onOpenAnythingInstallerFolder} disabled={Boolean(props.busy)} title="先确认，再打开本机安装器目录">打开目录</button>
                <button className="mini-action" type="button" onClick={props.onLaunchAnythingInstaller} disabled={Boolean(props.busy)} title="先确认，再启动托管目录里最近下载的安装器">启动已下载安装器</button>
              </div>
            </div>
          </ConfigCard>
          )}

          {showDefaultSummary && (
            <div className="default-summary">
              <span>默认模板</span>
              <p>{props.defaultConfig ? `${props.defaultConfig.embedding.provider} · ${props.defaultConfig.embedding.model} · OCR ${props.defaultConfig.parsers.ocr.mode}` : "未加载"}</p>
            </div>
          )}

          {showActions && (
            <div className="inspector-actions">
              <button className="button secondary" onClick={props.onApplyDefault} disabled={Boolean(props.busy)}><RotateCcw size={15} /> 应用默认</button>
              <button className="button secondary" onClick={props.onCopyDefault} disabled={Boolean(props.busy) || props.configDirty} title={props.configDirty ? "请先保存当前知识库参数，再复制为默认模板" : "复制已保存的当前知识库参数为默认模板"}><Clipboard size={15} /> 复制为默认</button>
              <button className="button primary" onClick={props.onSave} disabled={Boolean(props.busy)}>
                {props.busy === "save-config" ? <Loader2 className="spin" size={15} /> : <Settings size={15} />} 保存当前
              </button>
            </div>
          )}
        </fieldset>
      ) : !showTaskMini ? (
        <div className="empty-inspector">
          <Database size={22} />
          <strong>请选择或新建知识库</strong>
          <span>参数会从默认模板复制，之后独立保存。</span>
          <button className="button primary" onClick={props.onCreateCollection} disabled={Boolean(props.busy)}><FolderPlus size={15} /> 新建知识库</button>
        </div>
      ) : null}

      {showTaskMini && <TaskMini jobs={props.jobs} cancellingJobId={props.cancellingJobId} onCancelJob={props.onCancelJob} />}
    </aside>
  );
}

function ConfigCard({ color, title, meta, icon, children, id }: { color: string; title: string; meta: string; icon: React.ReactNode; children: React.ReactNode; id?: string }) {
  return (
    <section className="config-card" id={id}>
      <div className={`config-accent ${color}`} />
      <div className="config-card-head">
        <div>
          <h3>{title}</h3>
          <p>{meta}</p>
        </div>
        {icon}
      </div>
      <div className="config-card-body">{children}</div>
    </section>
  );
}

function TaskMini({ jobs, cancellingJobId, onCancelJob }: { jobs: ProcessingJob[]; cancellingJobId: string; onCancelJob: (jobId: string) => void }) {
  const active = jobs.find((job) => job.status === "running" || job.status === "queued") ?? jobs[0];
  const progress = active ? Math.max(0, Math.min(1, active.progress)) : 0;
  const canCancel = Boolean(active && (active.status === "queued" || active.status === "running"));
  return (
    <section className="task-mini" id="section-jobs">
      <div className="task-mini-head">
        <h2>统一任务中心</h2>
        {canCancel && (
          <button className="mini-action invert" type="button" onClick={() => onCancelJob(active!.id)} disabled={cancellingJobId === active!.id}>
            {cancellingJobId === active!.id ? <Loader2 className="spin" size={13} /> : <X size={13} />}
            取消
          </button>
        )}
      </div>
      {active ? (
        <>
          <p>{active.fileName} · {phaseLabel(active.phase)}</p>
          <div className="progress-track"><span style={{ width: `${Math.round(progress * 100)}%` }} /></div>
          <small>{active.error || active.message || "等待处理"}</small>
          <div className="recent-job-list">
            {jobs.slice(0, 4).map((job) => (
              <span key={job.id}>{phaseLabel(job.phase)} · {job.fileName}</span>
            ))}
          </div>
        </>
      ) : (
        <>
          <p>当前没有运行任务</p>
          <div className="progress-track"><span style={{ width: "0%" }} /></div>
          <small>上传、OCR、embedding 和同步会在这里显示。</small>
        </>
      )}
    </section>
  );
}

function MetricCard({ color, label, value, caption }: { color: string; label: string; value: string; caption: string }) {
  return (
    <article className="metric-card">
      <span className={`metric-accent ${color}`} />
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{caption}</small>
      </div>
    </article>
  );
}

function EmptyResult({ hasSearched }: { hasSearched: boolean }) {
  return (
    <div className="empty-result">
      <Search size={20} />
      <strong>{hasSearched ? "没有命中结果" : "还没有检索结果"}</strong>
      <span>{hasSearched ? "换一个问题或检查当前知识库的 embedding 配置。" : "输入问题后会返回来源、页码、chunk 和分数。"}</span>
    </div>
  );
}

function GuideItem({ done, label }: { done: boolean; label: string }) {
  return (
    <div className="guide-item">
      <span className={done ? "done" : ""}>{done ? <CheckCircle2 size={12} /> : null}</span>
      <p>{label}</p>
    </div>
  );
}

function NumberField({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Math.min(max, Math.max(min, Number(event.target.value) || min)))} />
    </label>
  );
}

function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

function ToastView({ toast }: { toast: Toast }) {
  const Icon = toast.type === "success" ? CheckCircle2 : toast.type === "error" ? AlertCircle : Server;
  return <div className={`toast ${toast.type}`}><Icon size={16} />{toast.text}</div>;
}

function needsLocalActionToken(url: string) {
  return /^\/api\/(?:ai\/tools|anythingllm|test-(?:embedding|ocr|anythingllm)|config(?:\/|$)|onboarding(?:\/|$)|jobs\/[^/]+\/cancel|collections(?:\/|$))/.test(url);
}

async function localActionHeaders(url: string): Promise<Record<string, string>> {
  if (!needsLocalActionToken(url) || !window.vectorForgeDesktop?.getLocalActionToken) return {};
  const { token } = await window.vectorForgeDesktop.getLocalActionToken();
  return token ? { "X-Vector-Forge-Local-Action-Token": token } : {};
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  const trustedHeaders = await localActionHeaders(url);
  for (const [key, value] of Object.entries(trustedHeaders)) headers.set(key, value);
  const response = await fetch(url, { ...init, headers });
  const text = await response.text();
  if (!response.ok) {
    let message = text || response.statusText;
    try {
      const parsed = JSON.parse(text) as { error?: string };
      message = parsed.error || message;
    } catch {
      // Keep raw text.
    }
    throw new Error(message);
  }
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

async function uploadApi<T>(url: string, body: FormData): Promise<T> {
  const trustedHeaders = await localActionHeaders(url);
  const response = await fetch(url, { method: "POST", body, headers: trustedHeaders });
  if (!response.ok) {
    const text = await response.text();
    let message = text || response.statusText;
    try {
      const parsed = JSON.parse(text) as { error?: string };
      message = parsed.error || message;
    } catch {
      // Keep raw text.
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

function phaseLabel(phase: ProcessingJob["phase"]) {
  if (phase === "ocr") return "OCR 中";
  if (phase === "extracting") return "解析中";
  if (phase === "chunking") return "切片中";
  if (phase === "embedding") return "入库中";
  if (phase === "indexed") return "已入库";
  if (phase === "failed") return "失败";
  if (phase === "cancelled") return "已取消";
  return "排队中";
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function formatTime() {
  return new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function formatFileSize(value: number) {
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}

function formatCount(value: number) {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

function formatScore(score: number | null) {
  if (typeof score !== "number") return "score -";
  return `score ${score.toFixed(2)}`;
}

function summarize(text: string, length: number) {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > length ? `${compact.slice(0, length)}...` : compact;
}

function compactPath(value?: string) {
  if (!value) return "data/lancedb";
  const normalized = value.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/data/");
  return index >= 0 ? normalized.slice(index + 1) : normalized;
}

function pathLikeNormalize(value?: string) {
  return (value || "").trim().replace(/\\/g, "/").replace(/\/+$/g, "").toLowerCase();
}

function configFingerprint(value: AppConfig) {
  return JSON.stringify(value);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

const rootElement = document.getElementById("root")!;
const rootHolder = globalThis as typeof globalThis & { __vectorForgeRoot?: ReturnType<typeof createRoot> };
const root = rootHolder.__vectorForgeRoot ?? createRoot(rootElement);
rootHolder.__vectorForgeRoot = root;

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
