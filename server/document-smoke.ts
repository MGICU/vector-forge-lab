import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import PDFDocument from "pdfkit";

const rootDir = process.cwd();
const tempDir = await mkdtemp(path.join(os.tmpdir(), "vector-forge-documents-smoke-"));
const port = 61985;
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

async function waitForJobs(jobIds: string[]) {
  const deadline = Date.now() + 180_000;
  const finished = new Map<string, Job>();
  while (Date.now() < deadline) {
    for (const jobId of jobIds) {
      if (finished.has(jobId)) continue;
      const { job } = await fetchJson<{ job: Job }>(`/api/jobs/${jobId}`);
      if (job.status === "succeeded") finished.set(jobId, job);
      if (job.status === "failed" || job.status === "cancelled") throw new Error(`Job ${jobId} ${job.status}: ${job.error ?? "unknown error"}`);
    }
    if (finished.size === jobIds.length) return Array.from(finished.values());
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for jobs: ${jobIds.join(", ")}`);
}

function xmlEscape(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function createDocx(text: string) {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.folder("_rels")?.file(
    ".rels",
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.folder("word")?.file(
    "document.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>${xmlEscape(text)}</w:t></w:r></w:p>
  </w:body>
</w:document>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

function createPdf(text: string) {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 72 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.fontSize(18).text(text, { lineGap: 6 });
    doc.end();
  });
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
  const created = await fetchJson<{ collection: { slug: string } }>("/api/collections", {
    method: "POST",
    body: JSON.stringify({ name: "Document Smoke Collection", slug: "documents-smoke" }),
  });
  assert(created.collection.slug === "documents-smoke", "Collection was not created with expected slug.");

  const samples = [
    { name: "format.txt", type: "text/plain", body: Buffer.from("VECTOR_FORGE_FORMAT_TXT_SENTINEL plain text document", "utf8"), query: "VECTOR_FORGE_FORMAT_TXT_SENTINEL" },
    { name: "format.md", type: "text/markdown", body: Buffer.from("# Markdown\n\nVECTOR_FORGE_FORMAT_MD_SENTINEL markdown document", "utf8"), query: "VECTOR_FORGE_FORMAT_MD_SENTINEL" },
    { name: "format.html", type: "text/html", body: Buffer.from("<style>.x{}</style><script>ignore()</script><main>VECTOR_FORGE_FORMAT_HTML_SENTINEL html document</main>", "utf8"), query: "VECTOR_FORGE_FORMAT_HTML_SENTINEL" },
    { name: "format.json", type: "application/json", body: Buffer.from(JSON.stringify({ nested: { sentinel: "VECTOR_FORGE_FORMAT_JSON_SENTINEL" } }), "utf8"), query: "VECTOR_FORGE_FORMAT_JSON_SENTINEL" },
    { name: "format.csv", type: "text/csv", body: Buffer.from("kind,value\ncsv,VECTOR_FORGE_FORMAT_CSV_SENTINEL\n", "utf8"), query: "VECTOR_FORGE_FORMAT_CSV_SENTINEL" },
    { name: "format.pdf", type: "application/pdf", body: await createPdf("VECTOR FORGE FORMAT PDF SENTINEL copyable text PDF"), query: "VECTOR FORGE FORMAT PDF SENTINEL" },
    { name: "format.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", body: await createDocx("VECTOR_FORGE_FORMAT_DOCX_SENTINEL docx document"), query: "VECTOR_FORGE_FORMAT_DOCX_SENTINEL" },
  ];

  const form = new FormData();
  for (const sample of samples) {
    form.append("files", new Blob([sample.body], { type: sample.type }), sample.name);
  }
  const uploaded = await fetchJson<{ jobs: Job[] }>("/api/collections/documents-smoke/upload-jobs", { method: "POST", body: form });
  assert(uploaded.jobs.length === samples.length, "Upload jobs count mismatch.");
  await waitForJobs(uploaded.jobs.map((job) => job.id));

  const docs = await fetchJson<{ documents: Array<{ name: string; parserType?: string; chunkCount: number }> }>("/api/collections/documents-smoke/documents");
  assert(docs.documents.length === samples.length, `Expected ${samples.length} documents, got ${docs.documents.length}.`);
  const pdfDoc = docs.documents.find((doc) => doc.name === "format.pdf");
  assert(pdfDoc?.parserType === "pdf-text", `Expected copyable PDF to use pdf-text, got ${pdfDoc?.parserType ?? "missing"}.`);
  for (const sample of samples) {
    const search = await fetchJson<{ results: Array<{ sourceName: string; text: string; parserType?: string }> }>("/api/collections/documents-smoke/search", {
      method: "POST",
      body: JSON.stringify({ query: sample.query, topK: 50 }),
    });
    assert(search.results.some((result) => result.sourceName === sample.name || result.text.includes(sample.query)), `Search did not find ${sample.name}.`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        tempDir,
        collection: created.collection.slug,
        uploaded: samples.length,
        documents: docs.documents.map((doc) => ({ name: doc.name, parserType: doc.parserType, chunks: doc.chunkCount })),
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
