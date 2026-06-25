const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const exePath = path.resolve(process.cwd(), "release", "win-unpacked", "Vector Forge Desktop.exe");
if (!fs.existsSync(exePath)) {
  console.error(`Packaged desktop executable not found: ${exePath}`);
  process.exit(1);
}

const resultPath = path.join(os.tmpdir(), `vector-forge-packaged-smoke-${process.pid}.json`);
const child = spawn(exePath, [], {
  cwd: path.dirname(exePath),
  env: {
    ...process.env,
    VECTOR_FORGE_DESKTOP_SMOKE: "1",
    VECTOR_FORGE_DESKTOP_SMOKE_RESULT: resultPath,
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
  console.error("Packaged desktop smoke timed out.");
  process.exit(1);
}, 60_000);

child.on("exit", (code) => {
  clearTimeout(timeout);
  if (code !== 0) {
    console.error(stderr || stdout || `Packaged desktop exited with code ${code}`);
    process.exit(code || 1);
  }

  let rawJson = "";
  if (fs.existsSync(resultPath)) {
    rawJson = fs.readFileSync(resultPath, "utf8");
    fs.rmSync(resultPath, { force: true });
  } else {
    const jsonStart = stdout.indexOf("{");
    const jsonEnd = stdout.lastIndexOf("}");
    if (jsonStart >= 0 && jsonEnd >= jsonStart) rawJson = stdout.slice(jsonStart, jsonEnd + 1);
  }

  if (!rawJson) {
    console.error(`Packaged desktop smoke did not emit JSON.\nstdout:\n${stdout}\nstderr:\n${stderr}`);
    process.exit(1);
  }

  const payload = JSON.parse(rawJson);
  if (!payload.ok) {
    console.error(`Packaged desktop smoke failed:\n${rawJson}`);
    process.exit(1);
  }
  console.log(JSON.stringify(payload, null, 2));
});
