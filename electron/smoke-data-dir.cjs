const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const electronPath = require("electron");

async function runElectronSmokeCase(name, smokeEnv, envOverrides, cleanupPaths) {
  const resultPath = path.join(os.tmpdir(), `vector-forge-data-dir-smoke-${name}-${process.pid}.json`);
  const child = spawn(electronPath, ["."], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...smokeEnv,
      VECTOR_FORGE_DESKTOP_SMOKE_RESULT: resultPath,
      ...envOverrides,
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

  function cleanup() {
    try {
      fs.rmSync(resultPath, { force: true });
    } catch {
      // Best effort cleanup.
    }
    for (const targetPath of cleanupPaths) {
      try {
        fs.rmSync(targetPath, { recursive: true, force: true });
      } catch {
        // Best effort cleanup.
      }
    }
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      cleanup();
      reject(new Error(`${name} data directory smoke timed out.`));
    }, 75_000);

    child.on("exit", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        cleanup();
        reject(new Error(stderr || stdout || `${name} Electron data directory smoke exited with code ${code}`));
        return;
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
        cleanup();
        reject(new Error(`${name} data directory smoke did not emit JSON.\nstdout:\n${stdout}\nstderr:\n${stderr}`));
        return;
      }
      const payload = JSON.parse(rawJson);
      cleanup();
      if (!payload.ok) {
        reject(new Error(`${name} data directory smoke failed: ${stdout}`));
        return;
      }
      resolve(payload);
    });
  });
}

async function runDataDirSmokeCase(name, envOverrides, cleanupPaths) {
  return runElectronSmokeCase(name, { VECTOR_FORGE_DATA_DIR_SMOKE: "1" }, envOverrides, cleanupPaths);
}

async function runDesktopSmokeCase(name, envOverrides, cleanupPaths) {
  return runElectronSmokeCase(name, { VECTOR_FORGE_DESKTOP_SMOKE: "1" }, envOverrides, cleanupPaths);
}

function desktopSettingsPath(userDataDir) {
  return path.join(userDataDir, "desktop-settings.json");
}

function writeDesktopSettings(userDataDir, dataDir) {
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(
    desktopSettingsPath(userDataDir),
    `${JSON.stringify({ dataDir, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8",
  );
}

function assertSamePath(actual, expected, message) {
  if (path.resolve(actual) !== path.resolve(expected)) {
    throw new Error(`${message}: ${JSON.stringify({ actual, expected })}`);
  }
}

(async () => {
  const editableUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "vector-forge-data-dir-user-data-editable-"));
  const envLockUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "vector-forge-data-dir-user-data-env-lock-"));
  const forcedDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "vector-forge-data-dir-env-override-"));

  try {
    const editable = await runDataDirSmokeCase(
      "editable",
      {
        VECTOR_FORGE_DATA_DIR: "",
        VECTOR_FORGE_USER_DATA_DIR: editableUserDataDir,
      },
      [],
    );
    if (!editable.pendingDataDir) {
      throw new Error(`Editable data directory smoke did not report a saved custom directory: ${JSON.stringify(editable)}`);
    }

    writeDesktopSettings(editableUserDataDir, editable.pendingDataDir);
    const customRelaunch = await runDesktopSmokeCase(
      "editable-relaunch-custom",
      {
        VECTOR_FORGE_DATA_DIR: "",
        VECTOR_FORGE_USER_DATA_DIR: editableUserDataDir,
      },
      [],
    );
    assertSamePath(customRelaunch.dataDir, editable.pendingDataDir, "Second launch did not activate the saved custom data directory");

    writeDesktopSettings(editableUserDataDir, "");
    const defaultRelaunch = await runDesktopSmokeCase(
      "editable-relaunch-default",
      {
        VECTOR_FORGE_DATA_DIR: "",
        VECTOR_FORGE_USER_DATA_DIR: editableUserDataDir,
      },
      [],
    );
    assertSamePath(defaultRelaunch.dataDir, path.join(editableUserDataDir, "data"), "Third launch did not return to the default data directory after reset");

    const envLock = await runDataDirSmokeCase(
      "env-lock",
      {
        VECTOR_FORGE_DATA_DIR: forcedDataDir,
        VECTOR_FORGE_USER_DATA_DIR: envLockUserDataDir,
      },
      [envLockUserDataDir, forcedDataDir],
    );
    console.log(JSON.stringify({ ok: true, runs: [editable, customRelaunch, defaultRelaunch, envLock] }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    try {
      fs.rmSync(editableUserDataDir, { recursive: true, force: true });
    } catch {
      // Best effort cleanup.
    }
  }
})();
