import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { lookup as mimeLookup } from "mime-types";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import Tesseract from "tesseract.js";

export type DuplicateStrategy = "skip" | "version" | "replace";
export type OcrMode = "auto" | "tesseract" | "paddleocr" | "cloud";
export type ParserType =
  | "text"
  | "html"
  | "json"
  | "csv"
  | "pdf-text"
  | "pdf-ocr"
  | "docx"
  | "image-ocr"
  | "unknown";

export type ExtractionPage = {
  pageNumber?: number;
  sectionTitle?: string;
  text: string;
  extractor: ParserType | string;
  confidence?: number | null;
};

export type ParserConfig = {
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

export type ExtractionProgress = {
  phase: "extracting" | "ocr" | "done";
  progress: number;
  current?: number;
  total?: number;
  message?: string;
};

export type ExtractionResult = {
  text: string;
  pages: ExtractionPage[];
  mime: string;
  contentHash: string;
  parserType: ParserType;
  parserVersion: string;
  pageCount?: number;
  ocrEngine?: string;
  ocrLanguage?: string;
  ocrConfidence?: number | null;
  warnings: string[];
  originalSizeBytes: number;
  extractedTextBytes: number;
};

type ExtractInput = {
  filePath: string;
  originalName: string;
  mime?: string;
  config: ParserConfig;
  onProgress?: (progress: ExtractionProgress) => void;
  shouldCancel?: () => boolean;
};

type OcrImageInput = {
  image: Buffer | string;
  config: ParserConfig;
  sourceName: string;
};

const parserVersion = "document-processing-v0.2.0";
let cachedTesseractWorker: Tesseract.Worker | null = null;
let cachedTesseractLanguage = "";
let cachedTesseractLangPath = "";

export const defaultParserConfig: ParserConfig = {
  duplicateStrategy: "skip",
  maxFileSizeMb: 100,
  pdf: {
    maxPages: 50,
    textFirst: true,
    ocrTextThreshold: 40,
    renderScale: 1.5,
    keepPageNumbers: true,
  },
  docx: {
    includeHeadings: true,
    includeTables: true,
  },
  ocr: {
    mode: "auto",
    language: "eng+chi_sim",
    minConfidence: 45,
    timeoutMs: 120_000,
    tesseractLangPath: "",
    paddleCommand: "",
    paddleArgs: "",
    allowCloudOcr: false,
    cloudBaseUrl: "https://api.openai.com/v1",
    cloudApiKey: "",
    cloudModel: "gpt-4.1-mini",
  },
};

export function normalizeParserConfig(input: Partial<ParserConfig> = {}): ParserConfig {
  const ocrMode = input.ocr?.mode;
  const duplicateStrategy = input.duplicateStrategy;
  return {
    duplicateStrategy: duplicateStrategy === "version" || duplicateStrategy === "replace" ? duplicateStrategy : "skip",
    maxFileSizeMb: clampNumber(input.maxFileSizeMb, defaultParserConfig.maxFileSizeMb, 1, 2048),
    pdf: {
      ...defaultParserConfig.pdf,
      ...(input.pdf ?? {}),
      maxPages: clampNumber(input.pdf?.maxPages, defaultParserConfig.pdf.maxPages, 1, 500),
      textFirst: input.pdf?.textFirst !== false,
      ocrTextThreshold: clampNumber(input.pdf?.ocrTextThreshold, defaultParserConfig.pdf.ocrTextThreshold, 0, 50_000),
      renderScale: clampNumber(input.pdf?.renderScale, defaultParserConfig.pdf.renderScale, 0.5, 3),
      keepPageNumbers: input.pdf?.keepPageNumbers !== false,
    },
    docx: {
      ...defaultParserConfig.docx,
      ...(input.docx ?? {}),
      includeHeadings: input.docx?.includeHeadings !== false,
      includeTables: input.docx?.includeTables !== false,
    },
    ocr: {
      ...defaultParserConfig.ocr,
      ...(input.ocr ?? {}),
      mode: ocrMode === "tesseract" || ocrMode === "paddleocr" || ocrMode === "cloud" ? ocrMode : "auto",
      language: sanitizeLanguage(input.ocr?.language || defaultParserConfig.ocr.language),
      minConfidence: clampNumber(input.ocr?.minConfidence, defaultParserConfig.ocr.minConfidence, 0, 100),
      timeoutMs: clampNumber(input.ocr?.timeoutMs, defaultParserConfig.ocr.timeoutMs, 10_000, 600_000),
      allowCloudOcr: input.ocr?.allowCloudOcr === true,
      cloudBaseUrl: normalizeBaseUrl(input.ocr?.cloudBaseUrl || defaultParserConfig.ocr.cloudBaseUrl),
    },
  };
}

export function hashBuffer(buffer: Buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export async function extractDocument(input: ExtractInput): Promise<ExtractionResult> {
  const config = normalizeParserConfig(input.config);
  input.onProgress?.({ phase: "extracting", progress: 0.05, message: "读取文件" });
  const buffer = await readFile(input.filePath);
  const maxBytes = config.maxFileSizeMb * 1024 * 1024;
  if (buffer.byteLength > maxBytes) {
    throw new Error(`文件超过大小上限：${formatBytes(buffer.byteLength)} > ${config.maxFileSizeMb} MB`);
  }
  const mime = detectMime(input.originalName, input.mime);
  const extension = path.extname(input.originalName).toLowerCase();
  const base = {
    mime,
    contentHash: hashBuffer(buffer),
    warnings: [] as string[],
    originalSizeBytes: buffer.byteLength,
  };
  assertNotCancelled(input.shouldCancel);

  if (extension === ".pdf" || mime === "application/pdf") {
    return { ...base, ...(await extractPdf(buffer, input.originalName, config, input.onProgress, input.shouldCancel)) };
  }
  if (extension === ".docx" || mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    return { ...base, ...(await extractDocx(buffer, config, input.onProgress)) };
  }
  if (isImage(extension, mime)) {
    return { ...base, ...(await extractImageOcr(buffer, input.originalName, config, input.onProgress, input.shouldCancel)) };
  }
  if (isSupportedText(extension, mime)) {
    return { ...base, ...extractTextLike(buffer, input.originalName, mime) };
  }
  throw new Error(`暂不支持的文件类型：${input.originalName} (${mime})`);
}

export async function testOcr(config: ParserConfig) {
  const normalized = normalizeParserConfig(config);
  const mode = normalized.ocr.mode;
  if (mode === "paddleocr") {
    return {
      ok: Boolean(normalized.ocr.paddleCommand.trim()),
      mode,
      engine: "paddleocr",
      message: normalized.ocr.paddleCommand.trim() ? "PaddleOCR 命令已配置，实际识别会在解析图片时执行。" : "未配置 PaddleOCR 命令路径。",
    };
  }
  if (mode === "cloud") {
    const ok = normalized.ocr.allowCloudOcr && Boolean(normalized.ocr.cloudBaseUrl && normalized.ocr.cloudApiKey && normalized.ocr.cloudModel);
    return {
      ok,
      mode,
      engine: "cloud",
      message: ok ? "云端 OCR 已配置。解析图片时会把图片内容发送到外部 API。" : "云端 OCR 需要开启隐私授权并填写 API 地址、Key 和模型。",
    };
  }
  try {
    const worker = await getTesseractWorker(normalized);
    return {
      ok: Boolean(worker),
      mode,
      engine: "tesseract.js",
      language: normalized.ocr.language,
      message: "Tesseract.js worker 可用。",
    };
  } catch (error) {
    return {
      ok: false,
      mode,
      engine: "tesseract.js",
      language: normalized.ocr.language,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function extractTextLike(buffer: Buffer, originalName: string, mime: string): Omit<ExtractionResult, "mime" | "contentHash" | "originalSizeBytes"> {
  const rawText = buffer.toString("utf8");
  const extension = path.extname(originalName).toLowerCase();
  let text = rawText;
  let parserType: ParserType = "text";
  if (String(mime).includes("html") || extension === ".html" || extension === ".htm") {
    text = rawText.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
    parserType = "html";
  } else if (String(mime).includes("json") || extension === ".json") {
    try {
      text = JSON.stringify(JSON.parse(rawText), null, 2);
    } catch {
      text = rawText;
    }
    parserType = "json";
  } else if (extension === ".csv" || extension === ".tsv" || String(mime).includes("csv")) {
    parserType = "csv";
  }
  const clean = normalizeExtractedText(text);
  return {
    text: clean,
    pages: [{ text: clean, extractor: parserType }],
    parserType,
    parserVersion,
    warnings: [],
    extractedTextBytes: Buffer.byteLength(clean, "utf8"),
  };
}

async function extractDocx(
  buffer: Buffer,
  _config: ParserConfig,
  onProgress?: (progress: ExtractionProgress) => void,
): Promise<Omit<ExtractionResult, "mime" | "contentHash" | "originalSizeBytes">> {
  onProgress?.({ phase: "extracting", progress: 0.2, message: "解析 DOCX" });
  const result = await mammoth.extractRawText({ buffer });
  const text = normalizeExtractedText(result.value);
  const warnings = result.messages.map((message) => message.message).filter(Boolean);
  return {
    text,
    pages: [{ text, extractor: "docx" }],
    parserType: "docx",
    parserVersion,
    pageCount: undefined,
    extractedTextBytes: Buffer.byteLength(text, "utf8"),
    warnings,
  };
}

async function extractPdf(
  buffer: Buffer,
  sourceName: string,
  config: ParserConfig,
  onProgress?: (progress: ExtractionProgress) => void,
  shouldCancel?: () => boolean,
): Promise<Omit<ExtractionResult, "mime" | "contentHash" | "originalSizeBytes">> {
  const warnings: string[] = [];
  const parser = new PDFParse({ data: buffer });
  try {
    onProgress?.({ phase: "extracting", progress: 0.15, message: "读取 PDF 文本层" });
    const info = await parser.getInfo({ parsePageInfo: false }).catch(() => null);
    const totalPages = info?.total || 0;
    const pageLimit = Math.max(1, Math.min(config.pdf.maxPages, totalPages || config.pdf.maxPages));
    const textResult = config.pdf.textFirst
      ? await parser.getText({ first: 1, last: pageLimit }).catch((error: unknown) => {
          warnings.push(`PDF 文本层抽取失败：${error instanceof Error ? error.message : String(error)}`);
          return null;
        })
      : null;
    const textPages = (textResult?.pages ?? []).map<ExtractionPage>((page) => ({
      pageNumber: config.pdf.keepPageNumbers ? page.num : undefined,
      text: normalizeExtractedText(page.text),
      extractor: "pdf-text",
    }));
    const text = normalizeExtractedText(textPages.map((page) => page.text).join("\n\n"));
    if (text.length >= config.pdf.ocrTextThreshold || !needsPdfOcr(config)) {
      onProgress?.({ phase: "done", progress: 1, message: "PDF 文本层解析完成" });
      return {
        text,
        pages: textPages.length ? textPages : [{ text, extractor: "pdf-text" }],
        parserType: "pdf-text",
        parserVersion,
        pageCount: totalPages || textResult?.total,
        extractedTextBytes: Buffer.byteLength(text, "utf8"),
        warnings,
      };
    }

    warnings.push("PDF 文本层内容较少，已触发 OCR。");
    assertNotCancelled(shouldCancel);
    onProgress?.({ phase: "ocr", progress: 0.25, current: 0, total: pageLimit, message: "渲染扫描 PDF 页面" });
    const screenshot = await parser.getScreenshot({
      first: 1,
      last: pageLimit,
      scale: config.pdf.renderScale,
      imageBuffer: true,
      imageDataUrl: false,
    });
    const pages: ExtractionPage[] = [];
    const confidences: number[] = [];
    for (let index = 0; index < screenshot.pages.length; index += 1) {
      assertNotCancelled(shouldCancel);
      const page = screenshot.pages[index];
      onProgress?.({ phase: "ocr", progress: 0.25 + (index / Math.max(1, screenshot.pages.length)) * 0.65, current: index + 1, total: screenshot.pages.length, message: `OCR 第 ${page.pageNumber} 页` });
      const recognized = await recognizeImage(Buffer.from(page.data), {
        image: Buffer.from(page.data),
        config,
        sourceName: `${sourceName}#page-${page.pageNumber}`,
      });
      pages.push({
        pageNumber: config.pdf.keepPageNumbers ? page.pageNumber : undefined,
        text: normalizeExtractedText(recognized.text),
        extractor: "pdf-ocr",
        confidence: recognized.confidence,
      });
      if (typeof recognized.confidence === "number") confidences.push(recognized.confidence);
    }
    const ocrText = normalizeExtractedText(pages.map((page) => page.text).join("\n\n"));
    return {
      text: ocrText,
      pages,
      parserType: "pdf-ocr",
      parserVersion,
      pageCount: totalPages || screenshot.total,
      ocrEngine: chooseOcrEngineName(config),
      ocrLanguage: config.ocr.language,
      ocrConfidence: average(confidences),
      extractedTextBytes: Buffer.byteLength(ocrText, "utf8"),
      warnings,
    };
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

async function extractImageOcr(
  buffer: Buffer,
  sourceName: string,
  config: ParserConfig,
  onProgress?: (progress: ExtractionProgress) => void,
  shouldCancel?: () => boolean,
): Promise<Omit<ExtractionResult, "mime" | "contentHash" | "originalSizeBytes">> {
  assertNotCancelled(shouldCancel);
  onProgress?.({ phase: "ocr", progress: 0.15, current: 1, total: 1, message: "图片 OCR" });
  const recognized = await recognizeImage(buffer, { image: buffer, config, sourceName });
  const text = normalizeExtractedText(recognized.text);
  return {
    text,
    pages: [{ text, extractor: "image-ocr", confidence: recognized.confidence }],
    parserType: "image-ocr",
    parserVersion,
    pageCount: 1,
    ocrEngine: recognized.engine,
    ocrLanguage: config.ocr.language,
    ocrConfidence: recognized.confidence,
    extractedTextBytes: Buffer.byteLength(text, "utf8"),
    warnings: recognized.warnings,
  };
}

async function recognizeImage(_buffer: Buffer, input: OcrImageInput): Promise<{ text: string; confidence: number | null; engine: string; warnings: string[] }> {
  const mode = input.config.ocr.mode;
  if (mode === "paddleocr" || (mode === "auto" && input.config.ocr.paddleCommand.trim())) {
    try {
      return { ...(await recognizeWithPaddle(input)), engine: "paddleocr", warnings: [] };
    } catch (error) {
      if (mode === "paddleocr") throw error;
    }
  }
  if (mode === "cloud") {
    return { ...(await recognizeWithCloud(input)), engine: "cloud", warnings: [] };
  }
  try {
    return { ...(await recognizeWithTesseract(input)), engine: "tesseract.js", warnings: [] };
  } catch (error) {
    if (mode === "auto" && input.config.ocr.allowCloudOcr && input.config.ocr.cloudApiKey.trim()) {
      const cloud = await recognizeWithCloud(input);
      return {
        ...cloud,
        engine: "cloud",
        warnings: [`Tesseract.js 失败后回退云端 OCR：${error instanceof Error ? error.message : String(error)}`],
      };
    }
    throw error;
  }
}

async function recognizeWithTesseract(input: OcrImageInput) {
  const worker = await getTesseractWorker(input.config);
  const result = await withTimeout(worker.recognize(input.image), input.config.ocr.timeoutMs, "Tesseract.js OCR 超时");
  return {
    text: result.data.text || "",
    confidence: typeof result.data.confidence === "number" ? result.data.confidence : null,
  };
}

async function getTesseractWorker(config: ParserConfig) {
  const language = config.ocr.language || "eng";
  const langPath = config.ocr.tesseractLangPath || "";
  if (cachedTesseractWorker && cachedTesseractLanguage === language && cachedTesseractLangPath === langPath) return cachedTesseractWorker;
  if (cachedTesseractWorker) await cachedTesseractWorker.terminate().catch(() => undefined);
  cachedTesseractWorker = await Tesseract.createWorker(language, 1, {
    ...(langPath ? { langPath } : {}),
  });
  cachedTesseractLanguage = language;
  cachedTesseractLangPath = langPath;
  return cachedTesseractWorker;
}

async function recognizeWithPaddle(input: OcrImageInput) {
  const command = input.config.ocr.paddleCommand.trim();
  if (!command) throw new Error("未配置 PaddleOCR 命令路径。");
  if (typeof input.image !== "string") throw new Error("PaddleOCR 需要文件路径输入。");
  const imagePath = input.image;
  const argsTemplate = input.config.ocr.paddleArgs.trim();
  const args = argsTemplate
    ? splitArgs(argsTemplate).map((part) => part.replace(/\{input\}/g, imagePath))
    : [imagePath];
  if (argsTemplate && !argsTemplate.includes("{input}")) args.push(imagePath);
  const output = await execFileCapture(command, args, input.config.ocr.timeoutMs);
  return { text: output.trim(), confidence: null };
}

async function recognizeWithCloud(input: OcrImageInput) {
  const { allowCloudOcr, cloudApiKey, cloudBaseUrl, cloudModel } = input.config.ocr;
  if (!allowCloudOcr) throw new Error("云端 OCR 未开启隐私授权。");
  if (!cloudApiKey.trim() || !cloudModel.trim()) throw new Error("云端 OCR 需要 API Key 和模型名。");
  const imageBuffer = typeof input.image === "string" ? await readFile(input.image) : input.image;
  const dataUrl = `data:image/png;base64,${imageBuffer.toString("base64")}`;
  const response = await fetch(`${normalizeBaseUrl(cloudBaseUrl)}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cloudApiKey}`,
    },
    body: JSON.stringify({
      model: cloudModel,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Extract all visible text from this image. Return only the extracted text, preserving line breaks where useful." },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`云端 OCR 返回 ${response.status}: ${text || response.statusText}`);
  const parsed = JSON.parse(text) as { choices?: Array<{ message?: { content?: string } }> };
  return { text: parsed.choices?.[0]?.message?.content ?? "", confidence: null };
}

function detectMime(originalName: string, provided?: string) {
  const guessed = mimeLookup(originalName);
  return String(guessed || provided || "application/octet-stream");
}

function isSupportedText(extension: string, mime: string) {
  return (
    mime.startsWith("text/") ||
    [".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".html", ".htm", ".xml", ".log", ".yaml", ".yml"].includes(extension)
  );
}

function isImage(extension: string, mime: string) {
  return mime.startsWith("image/") || [".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".bmp"].includes(extension);
}

function normalizeExtractedText(text: string) {
  return text.split(String.fromCharCode(0)).join("").replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
}

function needsPdfOcr(config: ParserConfig) {
  return config.ocr.mode === "auto" || config.ocr.mode === "tesseract" || config.ocr.mode === "paddleocr" || config.ocr.mode === "cloud";
}

function chooseOcrEngineName(config: ParserConfig) {
  if (config.ocr.mode === "paddleocr" || (config.ocr.mode === "auto" && config.ocr.paddleCommand.trim())) return "paddleocr";
  if (config.ocr.mode === "cloud") return "cloud";
  return "tesseract.js";
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function sanitizeLanguage(language: string) {
  return language.replace(/[^\w+-]/g, "").slice(0, 80) || defaultParserConfig.ocr.language;
}

function normalizeBaseUrl(input: string) {
  return input.replace(/\/+$/, "");
}

function average(values: number[]) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function assertNotCancelled(shouldCancel?: () => boolean) {
  if (shouldCancel?.()) throw Object.assign(new Error("任务已取消。"), { statusCode: 499 });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function execFileCapture(command: string, args: string[], timeoutMs: number) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    const stdout: string[] = [];
    const stderr: string[] = [];
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("PaddleOCR 执行超时。"));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => stdout.push(String(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(String(chunk)));
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve(stdout.join(""));
      else reject(new Error(stderr.join("").trim() || `PaddleOCR 退出码 ${code}`));
    });
  });
}

function splitArgs(input: string) {
  const matches = input.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  return matches.map((item) => item.replace(/^"|"$/g, ""));
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
