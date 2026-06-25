const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const electronPath = require("electron");

const resultPath = path.join(os.tmpdir(), `vector-forge-ui-smoke-${process.pid}.json`);
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "vector-forge-ui-smoke-data-"));
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "vector-forge-ui-smoke-user-data-"));

const child = spawn(electronPath, ["--disable-gpu", "--disable-gpu-sandbox", "--disable-gpu-compositing", "--disable-gpu-rasterization", "--in-process-gpu", "--no-proxy-server", "--no-sandbox", "."], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    VECTOR_FORGE_UI_SMOKE: "1",
    VECTOR_FORGE_DESKTOP_SMOKE_RESULT: resultPath,
    VECTOR_FORGE_DATA_DIR: dataDir,
    VECTOR_FORGE_USER_DATA_DIR: userDataDir,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let stdout = "";
let stderr = "";

child.stdout.on("data", (chunk) => {
  stdout += chunk.toString();
});

child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

const timeout = setTimeout(() => {
  child.kill();
  console.error("UI smoke timed out.");
  cleanup();
  process.exit(1);
}, 75_000);

function cleanup() {
  try {
    fs.rmSync(resultPath, { force: true });
  } catch {
    // Best effort cleanup.
  }
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // Best effort cleanup.
  }
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  } catch {
    // Best effort cleanup.
  }
}

child.on("exit", (code) => {
  clearTimeout(timeout);
  if (code !== 0) {
    console.error(stderr || stdout || `Electron UI smoke exited with code ${code}`);
    cleanup();
    process.exit(code || 1);
  }
  let rawJson = "";
  if (fs.existsSync(resultPath)) {
    rawJson = fs.readFileSync(resultPath, "utf8");
  } else {
    const jsonStart = stdout.indexOf("{");
    const jsonEnd = stdout.lastIndexOf("}");
    if (jsonStart >= 0 && jsonEnd >= jsonStart) rawJson = stdout.slice(jsonStart, jsonEnd + 1);
  }
  if (!rawJson) {
    console.error(`UI smoke did not emit JSON.\nstdout:\n${stdout}\nstderr:\n${stderr}`);
    cleanup();
    process.exit(1);
  }
  const payload = JSON.parse(rawJson);
  cleanup();
  if (!payload.ok) {
    console.error(`UI smoke failed: ${stdout}`);
    process.exit(1);
  }
  console.log(JSON.stringify(payload, null, 2));
});
