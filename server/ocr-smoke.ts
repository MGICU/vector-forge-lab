import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";

const rootDir = process.cwd();
const tempDir = await mkdtemp(path.join(os.tmpdir(), "vector-forge-ocr-smoke-"));
const port = 61986;
const tsxCli = path.join(rootDir, "node_modules", "tsx", "dist", "cli.mjs");

type Job = {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  error?: string;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
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
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw new Error("API did not become ready.");
}

async function waitForJob(jobId: string) {
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    const { job } = await fetchJson<{ job: Job }>(`/api/jobs/${jobId}`);
    if (job.status === "succeeded") return job;
    if (job.status === "failed" || job.status === "cancelled") throw new Error(`Job ${jobId} ${job.status}: ${job.error ?? "unknown error"}`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for OCR job: ${jobId}`);
}

function createOcrPng() {
  const canvas = createCanvas(900, 240);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 900, 240);
  ctx.fillStyle = "#111111";
  ctx.font = "bold 64px Arial";
  ctx.fillText("OCR TEST 2048", 70, 130);
  ctx.font = "32px Arial";
  ctx.fillText("VECTOR FORGE OCR SENTINEL", 72, 184);
  return canvas.toBuffer("image/png");
}

if (process.env.VECTOR_FORGE_RUN_OCR_SMOKE !== "1") {
  if (process.env.VECTOR_FORGE_REQUIRE_OCR_SMOKE === "1") {
    throw new Error("Real OCR smoke is required. Set VECTOR_FORGE_RUN_OCR_SMOKE=1 or run npm run smoke:ocr:real.");
  }
  console.log(JSON.stringify({ ok: true, skipped: true, reason: "Set VECTOR_FORGE_RUN_OCR_SMOKE=1 to run real Tesseract OCR smoke." }, null, 2));
  process.exit(0);
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
  await fetchJson("/api/config", {
    method: "PUT",
    body: JSON.stringify({
      embedding: { provider: "local-hash", model: "local-hash-v1", dimension: 384 },
      parsers: {
        ocr: {
          mode: "tesseract",
          language: "eng",
          timeoutMs: 180000,
        },
      },
    }),
  });
  const ocrTest = await fetchJson<{ ok: boolean; message: string }>("/api/test-ocr", {
    method: "POST",
    body: JSON.stringify({
      parsers: {
        ocr: {
          mode: "tesseract",
          language: "eng",
          timeoutMs: 180000,
        },
      },
    }),
  });
  assert(ocrTest.ok, `OCR config test failed: ${ocrTest.message}`);

  const created = await fetchJson<{ collection: { slug: string } }>("/api/collections", {
    method: "POST",
    body: JSON.stringify({ name: "OCR Smoke Collection", slug: "ocr-smoke" }),
  });
  assert(created.collection.slug === "ocr-smoke", "Collection was not created with expected slug.");

  const form = new FormData();
  form.append("files", new Blob([createOcrPng()], { type: "image/png" }), "ocr-smoke.png");
  const uploaded = await fetchJson<{ jobs: Job[] }>("/api/collections/ocr-smoke/upload-jobs", { method: "POST", body: form });
  assert(uploaded.jobs.length === 1, "OCR upload did not create one job.");
  await waitForJob(uploaded.jobs[0]!.id);

  const search = await fetchJson<{ results: Array<{ sourceName: string; text: string; extractor?: string }> }>("/api/collections/ocr-smoke/search", {
    method: "POST",
    body: JSON.stringify({ query: "OCR TEST 2048", topK: 3 }),
  });
  assert(search.results.some((result) => result.sourceName === "ocr-smoke.png" || /OCR\s+TEST\s+2048/i.test(result.text)), "OCR text was not searchable.");

  console.log(JSON.stringify({ ok: true, tempDir, searchResults: search.results.length }, null, 2));
} finally {
  server.kill();
  await new Promise((resolve) => setTimeout(resolve, 300));
  await rm(tempDir, { recursive: true, force: true });
}
