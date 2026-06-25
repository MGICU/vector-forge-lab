const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const nodeCrypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

function isSmokeMode() {
  return process.env.VECTOR_FORGE_UI_SMOKE === "1" || process.env.VECTOR_FORGE_DESKTOP_SMOKE === "1" || process.env.VECTOR_FORGE_DATA_DIR_SMOKE === "1";
}

if (isSmokeMode()) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-gpu-sandbox");
  app.commandLine.appendSwitch("disable-gpu-compositing");
  app.commandLine.appendSwitch("disable-gpu-rasterization");
  app.commandLine.appendSwitch("in-process-gpu");
  app.commandLine.appendSwitch("no-proxy-server");
  app.commandLine.appendSwitch("no-sandbox");
}

if (process.env.VECTOR_FORGE_USER_DATA_DIR) {
  app.setPath("userData", path.resolve(process.env.VECTOR_FORGE_USER_DATA_DIR));
}

let apiServer = null;
let mainWindow = null;
let appUrl = "";
let activeDataDir = "";
let dataDirSmokeRelaunchRequests = 0;
const initialEnvDataDir = process.env.VECTOR_FORGE_DATA_DIR ? path.resolve(process.env.VECTOR_FORGE_DATA_DIR) : "";
const localActionToken = nodeCrypto.randomBytes(32).toString("hex");
const allowedExternalHosts = new Set([
  "github.com",
  "www.github.com",
  "anythingllm.com",
  "docs.anythingllm.com",
]);

function isAllowedExternalUrl(targetUrl) {
  try {
    const parsed = new URL(targetUrl);
    return (parsed.protocol === "https:" || parsed.protocol === "http:") && allowedExternalHosts.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function isAppUrl(targetUrl) {
  try {
    return Boolean(appUrl) && new URL(targetUrl).origin === new URL(appUrl).origin;
  } catch {
    return false;
  }
}

function resolveAppRoot() {
  return app.getAppPath();
}

function resolveServerEntry(appRoot) {
  return path.join(appRoot, "dist-server", "server", "index.js");
}

function resolveStaticDir(appRoot) {
  return path.join(appRoot, "dist");
}

function desktopSettingsPath() {
  return path.join(app.getPath("userData"), "desktop-settings.json");
}

function defaultDataDir() {
  return path.join(app.getPath("userData"), "data");
}

function smokeDataDirPickerDir() {
  const configured = normalizeDataDir(process.env.VECTOR_FORGE_DATA_DIR_PICKER_RESULT || "");
  return configured || path.join(app.getPath("userData"), "picked-data-root");
}

function normalizeDataDir(input) {
  if (typeof input !== "string") return "";
  const trimmed = input.trim();
  return trimmed ? path.resolve(trimmed) : "";
}

function validateDataDir(input) {
  if (typeof input !== "string" || !input.trim()) throw new Error("Please provide an absolute data directory path.");
  const trimmed = input.trim();
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) throw new Error("Data directory must be a local filesystem path, not a URL.");
  if (!path.isAbsolute(trimmed)) throw new Error("Data directory must be an absolute path.");
  return path.resolve(trimmed);
}

function loadDesktopSettings() {
  try {
    const settingsPath = desktopSettingsPath();
    if (!fs.existsSync(settingsPath)) return {};
    const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveDesktopSettings(settings) {
  const settingsPath = desktopSettingsPath();
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  const tempPath = `${settingsPath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, settingsPath);
}

function resolveConfiguredDataDir() {
  const persistedDataDir = normalizeDataDir(loadDesktopSettings().dataDir);
  return initialEnvDataDir || persistedDataDir || defaultDataDir();
}

function desktopDataDirStatus() {
  const persistedDataDir = normalizeDataDir(loadDesktopSettings().dataDir);
  const selectedDataDir = initialEnvDataDir || persistedDataDir || defaultDataDir();
  const currentActive = activeDataDir || selectedDataDir;
  const pendingRelaunch = !initialEnvDataDir && path.resolve(selectedDataDir) !== path.resolve(currentActive);
  return {
    desktop: true,
    envOverride: Boolean(initialEnvDataDir),
    envDataDir: initialEnvDataDir,
    activeDataDir: currentActive,
    persistedDataDir,
    defaultDataDir: defaultDataDir(),
    selectedDataDir,
    pendingDataDir: pendingRelaunch ? selectedDataDir : "",
    pendingRelaunch,
    settingsPath: desktopSettingsPath(),
  };
}

function ensureBuiltArtifacts(appRoot) {
  const serverEntry = resolveServerEntry(appRoot);
  const staticDir = resolveStaticDir(appRoot);
  if (!fs.existsSync(serverEntry)) {
    throw new Error(`Missing server bundle: ${serverEntry}. Run npm run build before starting the desktop app.`);
  }
  if (!fs.existsSync(path.join(staticDir, "index.html"))) {
    throw new Error(`Missing UI bundle: ${staticDir}. Run npm run build before starting the desktop app.`);
  }
  return { serverEntry, staticDir };
}

async function startLocalApi() {
  const appRoot = resolveAppRoot();
  const { serverEntry, staticDir } = ensureBuiltArtifacts(appRoot);
  const dataDir = resolveConfiguredDataDir();
  activeDataDir = dataDir;

  process.env.VECTOR_FORGE_ROOT_DIR = appRoot;
  process.env.VECTOR_FORGE_STATIC_DIR = staticDir;
  process.env.VECTOR_FORGE_DATA_DIR = dataDir;
  process.env.VECTOR_FORGE_DESKTOP = "1";
  process.env.VECTOR_FORGE_LOCAL_ACTION_TOKEN = localActionToken;

  const serverModule = await import(pathToFileURL(serverEntry).href);
  apiServer = await serverModule.startServer(0, { silent: true });
  const address = apiServer.address();
  if (!address || typeof address === "string") throw new Error("Unable to determine local API port.");
  const healthUrl = `http://127.0.0.1:${address.port}`;
  appUrl = healthUrl;
  await waitForLocalApi(healthUrl);
  return appUrl;
}

async function waitForLocalApi(url) {
  const deadline = Date.now() + 10_000;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/api/health`, { cache: "no-store" });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Local API did not become healthy before desktop load: ${lastError}`);
}

async function createMainWindow(url, options = {}) {
  mainWindow = new BrowserWindow({
    width: 1260,
    height: 860,
    minWidth: 920,
    minHeight: 640,
    show: options.show ?? true,
    backgroundColor: "#f3f6fa",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
      sandbox: !isSmokeMode(),
    },
  });

  if (isSmokeMode()) {
    await mainWindow.webContents.session.setProxy({ mode: "direct" });
  }

  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (isAllowedExternalUrl(targetUrl)) {
      void shell.openExternal(targetUrl);
    }
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
    if (isAppUrl(targetUrl)) return;
    event.preventDefault();
    if (isAllowedExternalUrl(targetUrl)) {
      void shell.openExternal(targetUrl);
    }
  });

  let lastLoadError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await mainWindow.loadURL(url);
      lastLoadError = null;
      break;
    } catch (error) {
      lastLoadError = error;
      if (attempt === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  if (lastLoadError) throw lastLoadError;
  if (options.show ?? true) mainWindow.show();
  return mainWindow;
}

function closeApiServer() {
  if (!apiServer) return;
  apiServer.close();
  apiServer = null;
}

function writeSmokeResult(payload) {
  const resultPath = process.env.VECTOR_FORGE_DESKTOP_SMOKE_RESULT;
  if (!resultPath) return;
  fs.writeFileSync(resultPath, `${JSON.stringify(payload, null, 2)}\n`);
}

function smokeJsonHeaders() {
  return {
    "Content-Type": "application/json",
    "X-Vector-Forge-Local-Action-Token": localActionToken,
  };
}

function assertTrustedRenderer(event) {
  const frameUrl = event.senderFrame?.url || "";
  const expectedOrigin = appUrl ? new URL(appUrl).origin : "";
  let actualOrigin = "";
  try {
    actualOrigin = new URL(frameUrl).origin;
  } catch {
    // Keep empty origin.
  }
  if (!expectedOrigin || actualOrigin !== expectedOrigin) {
    throw new Error("Rejected desktop IPC from untrusted renderer origin.");
  }
}

function registerIpcHandlers() {
  ipcMain.handle("vector-forge:get-local-action-token", (event) => {
    assertTrustedRenderer(event);
    return { token: localActionToken };
  });
  ipcMain.handle("vector-forge:get-data-dir-status", (event) => {
    assertTrustedRenderer(event);
    return desktopDataDirStatus();
  });
  ipcMain.handle("vector-forge:choose-data-dir", async (event) => {
    assertTrustedRenderer(event);
    if (initialEnvDataDir) return { canceled: true, reason: "env-override", status: desktopDataDirStatus() };
    if (process.env.VECTOR_FORGE_DATA_DIR_SMOKE === "1") {
      const pickedPath = smokeDataDirPickerDir();
      fs.mkdirSync(pickedPath, { recursive: true });
      return { canceled: false, path: pickedPath, status: desktopDataDirStatus(), smoke: true };
    }
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "选择 Vector Forge 数据目录",
      properties: ["openDirectory", "createDirectory"],
    });
    return {
      canceled: result.canceled,
      path: result.filePaths[0] || "",
      status: desktopDataDirStatus(),
    };
  });
  ipcMain.handle("vector-forge:save-data-dir", async (event, input) => {
    assertTrustedRenderer(event);
    if (initialEnvDataDir) throw new Error("VECTOR_FORGE_DATA_DIR is set. Desktop data directory changes are disabled.");
    const dataDir = validateDataDir(input);
    fs.mkdirSync(dataDir, { recursive: true });
    saveDesktopSettings({ dataDir, updatedAt: new Date().toISOString() });
    return desktopDataDirStatus();
  });
  ipcMain.handle("vector-forge:reset-data-dir", async (event) => {
    assertTrustedRenderer(event);
    if (initialEnvDataDir) throw new Error("VECTOR_FORGE_DATA_DIR is set. Desktop data directory changes are disabled.");
    saveDesktopSettings({ dataDir: "", updatedAt: new Date().toISOString() });
    return desktopDataDirStatus();
  });
  ipcMain.handle("vector-forge:relaunch", async (event) => {
    assertTrustedRenderer(event);
    if (process.env.VECTOR_FORGE_DATA_DIR_SMOKE === "1") {
      dataDirSmokeRelaunchRequests += 1;
      return { relaunching: true, dryRun: true };
    }
    app.relaunch();
    app.exit(0);
    return { relaunching: true };
  });
}

async function runSmoke(url) {
  const window = await createMainWindow(url, { show: false });
  const healthResponse = await fetch(`${url}/api/health`);
  if (!healthResponse.ok) throw new Error(`Health check failed: ${healthResponse.status}`);
  const health = await healthResponse.json();
  const title = await window.webContents.executeJavaScript("document.title");
  const bodyHasApp = await window.webContents.executeJavaScript("document.body.innerText.includes('Knowledge Forge')");
  if (!bodyHasApp) throw new Error("Desktop window did not render the Knowledge Forge UI.");
  const payload = { ok: true, url, title, appVersion: health.appVersion, dataDir: health.dataDir };
  writeSmokeResult(payload);
  console.log(JSON.stringify(payload, null, 2));
  app.quit();
}

async function runDataDirSmoke(url) {
  const window = await createMainWindow(url, { show: false });
  await waitForWindowCondition(window, "document.body.innerText.includes('Knowledge Forge')", "app render");
  await waitForWindowCondition(window, "Boolean(window.vectorForgeDesktop)", "desktop preload API");
  await navigateSmokePage(window, "settings", "#section-settings");
  await waitForWindowCondition(window, "Boolean(document.querySelector('[data-testid=\"data-dir-input\"]'))", "desktop data directory input");
  if (initialEnvDataDir) {
    await waitForWindowCondition(window, "Boolean(document.querySelector('[data-testid=\"data-dir-env-lock\"]'))", "desktop data directory env lock", 45_000);
    const lockState = await window.webContents.executeJavaScript(`(async () => {
      const status = await window.vectorForgeDesktop.getDataDirectoryStatus();
      const saveError = await window.vectorForgeDesktop.saveDataDirectory(status.defaultDataDir + '-other').then(
        () => '',
        (error) => String(error?.message || error)
      );
      const resetError = await window.vectorForgeDesktop.resetDataDirectory().then(
        () => '',
        (error) => String(error?.message || error)
      );
      const choose = await window.vectorForgeDesktop.chooseDataDirectory();
      return {
        status,
        inputDisabled: Boolean(document.querySelector('[data-testid="data-dir-input"]')?.disabled),
        chooseDisabled: Boolean(document.querySelector('[data-testid="data-dir-choose"]')?.disabled),
        saveDisabled: Boolean(document.querySelector('[data-testid="data-dir-save"]')?.disabled),
        resetDisabled: Boolean(document.querySelector('[data-testid="data-dir-reset"]')?.disabled),
        hasLockWarning: Boolean(document.querySelector('[data-testid="data-dir-env-lock"]')),
        saveError,
        resetError,
        choose
      };
    })()`);
    if (!lockState.status.envOverride) throw new Error(`Env override status was not set: ${JSON.stringify(lockState)}`);
    if (path.resolve(lockState.status.envDataDir) !== path.resolve(initialEnvDataDir)) throw new Error(`Env data dir mismatch: ${JSON.stringify(lockState)}`);
    if (path.resolve(lockState.status.activeDataDir) !== path.resolve(initialEnvDataDir)) throw new Error(`Active data dir did not use env override: ${JSON.stringify(lockState)}`);
    if (path.resolve(lockState.status.selectedDataDir) !== path.resolve(initialEnvDataDir)) throw new Error(`Selected data dir did not use env override: ${JSON.stringify(lockState)}`);
    if (!lockState.inputDisabled || !lockState.chooseDisabled || !lockState.saveDisabled || !lockState.resetDisabled || !lockState.hasLockWarning) {
      throw new Error(`Env override UI controls were not locked: ${JSON.stringify(lockState)}`);
    }
    if (lockState.choose?.reason !== "env-override") throw new Error(`Choose directory did not return env override reason: ${JSON.stringify(lockState.choose)}`);
    if (!lockState.saveError.includes("VECTOR_FORGE_DATA_DIR is set") || !lockState.resetError.includes("VECTOR_FORGE_DATA_DIR is set")) {
      throw new Error(`Env override IPC guards did not reject save/reset: ${JSON.stringify(lockState)}`);
    }
    const payload = { ok: true, mode: "env-lock", url, userData: app.getPath("userData"), envDataDir: initialEnvDataDir, lockState };
    writeSmokeResult(payload);
    console.log(JSON.stringify(payload, null, 2));
    app.quit();
    return;
  }
  await waitForWindowCondition(window, "Boolean(document.querySelector('[data-testid=\"data-dir-input\"]:not(:disabled)'))", "editable desktop data directory input");
  await waitForWindowCondition(
    window,
    "window.vectorForgeDesktop.getDataDirectoryStatus().then((status) => Boolean(status.selectedDataDir || status.activeDataDir || status.defaultDataDir))",
    "desktop data directory status initialized",
    45_000
  );
  const pickedDir = smokeDataDirPickerDir();
  const pickResult = await window.webContents.executeJavaScript(`(async () => {
    const input = document.querySelector('[data-testid="data-dir-input"]:not(:disabled)');
    const chooseButton = document.querySelector('[data-testid="data-dir-choose"]:not(:disabled)');
    if (!input) throw new Error('Missing editable data directory input before picker smoke.');
    if (!chooseButton) throw new Error('Missing enabled choose-directory button.');
    chooseButton.click();
    for (let i = 0; i < 40; i += 1) {
      const saveButton = document.querySelector('[data-testid="data-dir-save"]');
      if (input.value === ${JSON.stringify(pickedDir)} && saveButton && !saveButton.disabled) {
        return {
          pickedValue: input.value,
          saveEnabled: true
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('Choose-directory button did not write the picked path into the input. Last value: ' + input.value);
  })()`);
  if (path.resolve(pickResult.pickedValue) !== path.resolve(pickedDir) || !pickResult.saveEnabled) {
    throw new Error(`Choose-directory button did not update editable data-dir draft: ${JSON.stringify(pickResult)}`);
  }
  const customDir = path.join(app.getPath("userData"), "custom-data-root");
  const result = await window.webContents.executeJavaScript(`(async () => {
    const initial = await window.vectorForgeDesktop.getDataDirectoryStatus();
    const inputs = Array.from(document.querySelectorAll('[data-testid="data-dir-input"]:not(:disabled)'));
    if (!inputs.length) throw new Error('Missing editable desktop data directory input');
    for (const input of inputs) {
      const setter = Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value')?.set;
      if (!setter) throw new Error('Missing native value setter');
      const tracker = input._valueTracker;
      if (tracker) tracker.setValue('');
      setter.call(input, ${JSON.stringify(customDir)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    let saveButton = Array.from(document.querySelectorAll('[data-testid="data-dir-save"]')).find((button) => !button.disabled);
    for (let i = 0; i < 40 && !saveButton; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      saveButton = Array.from(document.querySelectorAll('[data-testid="data-dir-save"]')).find((button) => !button.disabled);
    }
    if (!saveButton) {
      const states = Array.from(document.querySelectorAll('[data-testid="data-dir-save"]')).map((button) => ({ disabled: button.disabled, text: button.innerText }));
      throw new Error('Save data directory button unavailable: ' + JSON.stringify(states));
    }
    saveButton.click();
    for (let i = 0; i < 40; i += 1) {
      const status = await window.vectorForgeDesktop.getDataDirectoryStatus();
      if (status.pendingRelaunch && status.pendingDataDir === ${JSON.stringify(customDir)}) {
        return { initial, saved: status, panelText: document.querySelector('.desktop-data-dir-panel')?.innerText || '' };
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error('Data directory save did not become pending relaunch.');
  })()`);
  const settingsPath = desktopSettingsPath();
  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  if (result.initial.envOverride) throw new Error("Data directory smoke should not run with env override.");
  if (path.resolve(result.initial.activeDataDir) !== path.resolve(defaultDataDir())) throw new Error(`Unexpected initial data dir: ${JSON.stringify(result.initial)}`);
  if (path.resolve(result.saved.pendingDataDir) !== path.resolve(customDir)) throw new Error(`Saved data dir did not become pending: ${JSON.stringify(result.saved)}`);
  if (path.resolve(settings.dataDir) !== path.resolve(customDir)) throw new Error(`Desktop settings file did not persist data dir: ${JSON.stringify(settings)}`);
  const relaunchRequestsBefore = dataDirSmokeRelaunchRequests;
  const relaunchConfirm = await window.webContents.executeJavaScript(`(async () => {
    const relaunchButton = Array.from(document.querySelectorAll('[data-testid="data-dir-relaunch"]')).find((button) => !button.disabled);
    if (!relaunchButton) {
      const states = Array.from(document.querySelectorAll('[data-testid="data-dir-relaunch"]')).map((button) => ({ disabled: button.disabled, text: button.innerText }));
      throw new Error('Relaunch button unavailable: ' + JSON.stringify(states));
    }
    relaunchButton.click();
    for (let i = 0; i < 40 && !document.querySelector('[data-testid="desktop-relaunch-dialog"]'); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!document.querySelector('[data-testid="desktop-relaunch-dialog"]')) throw new Error('Relaunch confirmation dialog did not open.');
    const cancelButton = Array.from(document.querySelectorAll('[data-testid="desktop-relaunch-dialog"] button')).find((button) => button.innerText.includes('Cancel'));
    if (!cancelButton) throw new Error('Relaunch confirmation cancel button missing.');
    cancelButton.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (document.querySelector('[data-testid="desktop-relaunch-dialog"]')) throw new Error('Relaunch confirmation did not close after cancel.');
    relaunchButton.click();
    for (let i = 0; i < 40 && !document.querySelector('[data-testid="desktop-relaunch-dialog"]'); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const confirmButton = document.querySelector('[data-testid="desktop-relaunch-confirm"]');
    if (!confirmButton || confirmButton.disabled) throw new Error('Relaunch confirmation button unavailable.');
    confirmButton.click();
    for (let i = 0; i < 40 && document.querySelector('[data-testid="desktop-relaunch-dialog"]'); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return {
      dialogStillOpen: Boolean(document.querySelector('[data-testid="desktop-relaunch-dialog"]'))
    };
  })()`);
  const relaunchCalls = dataDirSmokeRelaunchRequests - relaunchRequestsBefore;
  if (relaunchCalls !== 1 || relaunchConfirm.dialogStillOpen) throw new Error(`Relaunch confirmation guard failed: ${JSON.stringify({ ...relaunchConfirm, calls: relaunchCalls })}`);
  const resetResult = await window.webContents.executeJavaScript(`(async () => {
    const resetButton = Array.from(document.querySelectorAll('[data-testid="data-dir-reset"]')).find((button) => !button.disabled);
    if (!resetButton) {
      const states = Array.from(document.querySelectorAll('[data-testid="data-dir-reset"]')).map((button) => ({ disabled: button.disabled, text: button.innerText }));
      throw new Error('Reset data directory button unavailable: ' + JSON.stringify(states));
    }
    resetButton.click();
    for (let i = 0; i < 40; i += 1) {
      const status = await window.vectorForgeDesktop.getDataDirectoryStatus();
      if (!status.pendingRelaunch && !status.persistedDataDir && status.selectedDataDir === status.defaultDataDir && status.activeDataDir === status.defaultDataDir) {
        return {
          status,
          restartWarningVisible: Boolean(document.querySelector('[data-testid="data-dir-restart-required"]')),
          resetDisabled: Boolean(document.querySelector('[data-testid="data-dir-reset"]')?.disabled)
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error('Data directory reset did not return to default.');
  })()`);
  const resetSettings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  if (resetSettings.dataDir !== "") throw new Error(`Desktop settings file did not clear data dir after reset: ${JSON.stringify(resetSettings)}`);
  if (resetResult.restartWarningVisible || !resetResult.resetDisabled) throw new Error(`Data directory reset UI state is incorrect: ${JSON.stringify(resetResult)}`);
  const payload = {
    ok: true,
    mode: "editable",
    url,
    userData: app.getPath("userData"),
    activeDataDir: result.initial.activeDataDir,
    pickedDataDir: pickedDir,
    pendingDataDir: result.saved.pendingDataDir,
    relaunchCalls,
    resetDataDir: resetResult.status.selectedDataDir,
    settingsPath,
  };
  writeSmokeResult(payload);
  console.log(JSON.stringify(payload, null, 2));
  app.quit();
}

async function waitForWindowCondition(window, script, label, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastValue;
  while (Date.now() < deadline) {
    try {
      lastValue = await window.webContents.executeJavaScript(script);
    } catch (error) {
      throw new Error(`Script failed while waiting for ${label}: ${error instanceof Error ? error.message : String(error)}. Script: ${script.slice(0, 240)}`, { cause: error });
    }
    if (lastValue) return lastValue;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${label}. Last value: ${JSON.stringify(lastValue)}`);
}

async function clickWindowButton(window, text, scopeSelector = "") {
  const rawResult = await window.webContents.executeJavaScript(`(() => {
    const scope = ${JSON.stringify(scopeSelector)} ? document.querySelector(${JSON.stringify(scopeSelector)}) : document;
    if (!scope) return JSON.stringify({ ok: false, error: 'missing scope', count: 0 });
    const buttons = Array.from(scope.querySelectorAll('button')).filter((button) => button.innerText.trim() === ${JSON.stringify(text)});
    if (buttons.length !== 1) return JSON.stringify({ ok: false, error: 'button count mismatch', count: buttons.length, texts: Array.from(scope.querySelectorAll('button')).map((button) => button.innerText.trim()).slice(0, 30) });
    if (buttons[0].disabled) return JSON.stringify({ ok: false, error: 'button disabled', count: 1 });
    buttons[0].click();
    return JSON.stringify({ ok: true, count: 1 });
  })()`);
  const result = JSON.parse(rawResult);
  if (!result.ok) throw new Error(`Unable to click "${text}": ${JSON.stringify(result)}`);
}

async function navigateSmokePage(window, pageId, expectedSelector = "") {
  const navSelector = `[data-testid="nav-${pageId}"]`;
  const rawResult = await window.webContents.executeJavaScript(`(() => {
    const button = document.querySelector(${JSON.stringify(navSelector)});
    if (!button) return JSON.stringify({ ok: false, error: 'missing nav button' });
    if (button.disabled) return JSON.stringify({ ok: false, error: 'nav button disabled' });
    button.click();
    return JSON.stringify({ ok: true });
  })()`);
  const result = JSON.parse(rawResult);
  if (!result.ok) throw new Error(`Unable to navigate smoke page "${pageId}": ${JSON.stringify(result)}`);
  await waitForWindowCondition(window, `document.querySelector(${JSON.stringify(navSelector)})?.classList.contains('active')`, `${pageId} nav active`);
  if (expectedSelector) {
    await waitForWindowCondition(window, `Boolean(document.querySelector(${JSON.stringify(expectedSelector)}))`, `${pageId} page content`);
  }
}

async function fillWindowInput(window, scopeSelector, selector, value) {
  const rawResult = await window.webContents.executeJavaScript(`(() => {
    const scope = ${JSON.stringify(scopeSelector)} ? document.querySelector(${JSON.stringify(scopeSelector)}) : document;
    if (!scope) return JSON.stringify({ ok: false, error: 'missing scope' });
    const input = scope.querySelector(${JSON.stringify(selector)});
    if (!input) return JSON.stringify({ ok: false, error: 'missing input' });
    if (input.disabled) return JSON.stringify({ ok: false, error: 'input disabled' });
    const setter = Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value')?.set;
    if (!setter) return JSON.stringify({ ok: false, error: 'missing native setter' });
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return JSON.stringify({ ok: true });
  })()`);
  const result = JSON.parse(rawResult);
  if (!result.ok) throw new Error(`Unable to fill input "${selector}": ${JSON.stringify(result)}`);
}

async function installPostProbe(window, name, patternSources) {
  try {
    await window.webContents.executeJavaScript(`(() => {
      const probeName = ${JSON.stringify(name)};
      window[probeName] = [];
      window.__vectorForgeProbeOriginalFetch = window.__vectorForgeProbeOriginalFetch || window.fetch.bind(window);
      const originalFetch = window.__vectorForgeProbeOriginalFetch;
      const patterns = ${JSON.stringify(patternSources)}.map((source) => new RegExp(source));
      window.fetch = async (input, init = {}) => {
        const targetUrl = typeof input === 'string' ? input : input.url;
        const method = String(init.method || 'GET').toUpperCase();
        const body = typeof init.body === 'string' ? init.body : '';
        if (method !== 'GET' && patterns.some((pattern) => pattern.test(targetUrl))) {
          window[probeName].push({ method, url: targetUrl, body });
        }
        return originalFetch(input, init);
      };
      return true;
    })()`);
  } catch (error) {
    throw new Error(`Unable to install POST probe ${name}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

async function readPostProbe(window, name) {
  try {
    return await window.webContents.executeJavaScript(`window[${JSON.stringify(name)}] || []`);
  } catch (error) {
    throw new Error(`Unable to read POST probe ${name}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

async function restorePostProbe(window) {
  try {
    await window.webContents.executeJavaScript(`(() => {
      if (window.__vectorForgeProbeOriginalFetch) {
        window.fetch = window.__vectorForgeProbeOriginalFetch;
        delete window.__vectorForgeProbeOriginalFetch;
      }
      return true;
    })()`);
  } catch (error) {
    throw new Error(`Unable to restore POST probe: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

function uiSmokeCheckpoint(label) {
  if (process.env.VECTOR_FORGE_UI_SMOKE_DEBUG === "1") console.error(`[ui-smoke] ${label}`);
}

async function runUiSmoke(url) {
  const window = await createMainWindow(url, { show: process.env.VECTOR_FORGE_UI_SMOKE_SHOW === "1" });
  await waitForWindowCondition(window, "document.body.innerText.includes('Knowledge Forge')", "app render");
  await waitForWindowCondition(
    window,
    "Boolean(document.querySelector('.onboarding-dialog')) || Boolean(document.querySelector('.first-run .first-run-actions button:not(:disabled)'))",
    "onboarding dialog or sidebar entry",
    45_000
  );
  await window.webContents.executeJavaScript(`(() => {
    if (document.querySelector('.onboarding-dialog')) return true;
    const button = document.querySelector('.first-run .first-run-actions button:not(:disabled)');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  await waitForWindowCondition(window, "Boolean(document.querySelector('.onboarding-dialog'))", "onboarding dialog", 15_000);

  const initial = await window.webContents.executeJavaScript(`(() => ({
    title: document.title,
    hasOnboarding: Boolean(document.querySelector('.onboarding-dialog')),
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    buttonCount: document.querySelectorAll('button').length
  }))()`);
  if (!initial.hasOnboarding) throw new Error("Onboarding dialog did not open on first run.");
  if (initial.horizontalOverflow) throw new Error("Initial desktop layout has horizontal overflow.");

  await window.webContents.executeJavaScript(`(() => {
    window.__nativeDialogCalls = [];
    for (const name of ['prompt', 'confirm', 'alert']) {
      window[name] = (...args) => {
        window.__nativeDialogCalls.push({ name, args: args.map((item) => String(item)) });
        throw new Error('Native dialog call is not allowed in UI smoke: ' + name);
      };
    }
    return true;
  })()`);

  await clickWindowButton(window, "确认目录", ".onboarding-dialog");
  await waitForWindowCondition(window, "document.querySelector('.onboarding-dialog')?.innerText.includes('complete')", "data step complete");
  await clickWindowButton(window, "新建知识库", ".onboarding-dialog");
  await waitForWindowCondition(window, "Boolean(document.querySelector('.create-collection-dialog'))", "create collection dialog");
  await fillWindowInput(window, ".create-collection-dialog", "input", "UI Smoke Collection");
  await clickWindowButton(window, "创建知识库", ".create-collection-dialog");
  await waitForWindowCondition(window, "document.body.innerText.includes('UI Smoke Collection') && !document.querySelector('.create-collection-dialog')", "collection created");
  await waitForWindowCondition(window, "Array.from(document.querySelectorAll('.onboarding-step'))[1]?.querySelector('.pill')?.innerText.trim() === 'complete'", "collection step complete");
  await clickWindowButton(window, "测试 embedding", ".onboarding-dialog");
  await waitForWindowCondition(window, "Array.from(document.querySelectorAll('.onboarding-step'))[2]?.querySelector('.pill')?.innerText.trim() === 'complete'", "embedding step complete");
  await clickWindowButton(window, "跳过 OCR", ".onboarding-dialog");
  await waitForWindowCondition(window, "Array.from(document.querySelectorAll('.onboarding-step'))[3]?.querySelector('.pill')?.innerText.trim() === 'skipped'", "ocr step skipped");
  await clickWindowButton(window, "跳过", ".onboarding-dialog");
  await waitForWindowCondition(window, "!Array.from(document.querySelectorAll('button')).find((button) => button.innerText.trim() === '完成向导')?.disabled", "finish enabled");
  await clickWindowButton(window, "完成向导", ".onboarding-dialog");
  await waitForWindowCondition(window, "!document.querySelector('.onboarding-dialog')", "onboarding closed");

  const collections = await (await fetch(`${url}/api/collections`)).json();
  const collection = collections.collections.find((item) => item.name === "UI Smoke Collection") || collections.collections[0];
  if (!collection) throw new Error("UI smoke collection was not created.");
  const noteResponse = await fetch(`${url}/api/collections/${encodeURIComponent(collection.slug)}/text`, {
    method: "POST",
    headers: smokeJsonHeaders(),
    body: JSON.stringify({
      name: "ui-smoke-note.txt",
      text: "UI_SMOKE_SENTINEL local vector search result. Buttons should open this document detail.",
    }),
  });
  if (!noteResponse.ok) throw new Error(`Unable to create UI smoke note: ${noteResponse.status}`);
  const deleteResponse = await fetch(`${url}/api/collections/${encodeURIComponent(collection.slug)}/text`, {
    method: "POST",
    headers: smokeJsonHeaders(),
    body: JSON.stringify({
      name: "ui-smoke-delete.txt",
      text: "UI_SMOKE_DELETE_SENTINEL document exists only to verify the batch delete dialog.",
    }),
  });
  if (!deleteResponse.ok) throw new Error(`Unable to create UI smoke delete document: ${deleteResponse.status}`);
  const singleDeleteResponse = await fetch(`${url}/api/collections/${encodeURIComponent(collection.slug)}/text`, {
    method: "POST",
    headers: smokeJsonHeaders(),
    body: JSON.stringify({
      name: "ui-smoke-single-delete.txt",
      text: "UI_SMOKE_SINGLE_DELETE_SENTINEL document exists only to verify the single-document delete dialog.",
    }),
  });
  if (!singleDeleteResponse.ok) throw new Error(`Unable to create UI smoke single-delete document: ${singleDeleteResponse.status}`);
  for (let index = 1; index <= 8; index += 1) {
    const extraResponse = await fetch(`${url}/api/collections/${encodeURIComponent(collection.slug)}/text`, {
      method: "POST",
      headers: smokeJsonHeaders(),
      body: JSON.stringify({
        name: `ui-smoke-extra-${String(index).padStart(2, "0")}.txt`,
        text: `UI_SMOKE_EXTRA_${index} document pads the list so the show-all documents button is exercised.`,
      }),
    });
    if (!extraResponse.ok) throw new Error(`Unable to create extra UI smoke document ${index}: ${extraResponse.status}`);
  }
  const configResponse = await fetch(`${url}/api/collections/${encodeURIComponent(collection.slug)}/config`);
  if (!configResponse.ok) throw new Error(`Unable to load UI smoke collection config: ${configResponse.status}`);
  const configPayload = await configResponse.json();
  const configuredForAiGuard = {
    ...configPayload.config,
    parsers: {
      ...configPayload.config.parsers,
      ocr: {
        ...configPayload.config.parsers.ocr,
        mode: "cloud",
        allowCloudOcr: true,
        cloudBaseUrl: "http://127.0.0.1:1/v1/chat/completions",
        cloudApiKey: "ui-smoke-cloud-ocr-key",
        cloudModel: "ui-smoke-vision",
      },
    },
    anythingllm: {
      ...configPayload.config.anythingllm,
      enabled: true,
      baseUrl: "http://127.0.0.1:1/api",
      apiKey: "ui-smoke-anything-key",
      workspaceName: "UI Smoke Workspace",
      workspaceSlug: "ui-smoke-workspace",
    },
  };
  const saveConfigResponse = await fetch(`${url}/api/collections/${encodeURIComponent(collection.slug)}/config`, {
    method: "PUT",
    headers: smokeJsonHeaders(),
    body: JSON.stringify(configuredForAiGuard),
  });
  if (!saveConfigResponse.ok) throw new Error(`Unable to configure UI smoke AnythingLLM config: ${saveConfigResponse.status}`);
  const documentsPath = path.join(process.env.VECTOR_FORGE_DATA_DIR, `${collection.slug}.documents.json`);
  const smokeDocuments = JSON.parse(fs.readFileSync(documentsPath, "utf8"));
  const noteDocument = smokeDocuments.find((item) => item.name === "ui-smoke-note.txt");
  if (!noteDocument) throw new Error("Unable to find UI smoke note document for cleanup manifest setup.");
  noteDocument.anythingSync = {
    version: 1,
    updatedAt: new Date().toISOString(),
    chunks: [
      {
        syncKey: "ui-smoke-cleanup",
        location: "custom-documents/ui-smoke-note.txt",
        chunkId: "ui-smoke-cleanup-chunk",
        chunkIndex: 0,
        textHash: "ui-smoke-cleanup-hash",
        baseUrl: "http://127.0.0.1:1/api",
        workspaceSlug: "ui-smoke-workspace",
        uploadedAt: new Date().toISOString(),
        cleanupPending: true,
      },
    ],
  };
  fs.writeFileSync(documentsPath, `${JSON.stringify(smokeDocuments, null, 2)}\n`, "utf8");
  const cleanupQueuePath = path.join(process.env.VECTOR_FORGE_DATA_DIR, "anythingllm-cleanup-queue.json");
  fs.writeFileSync(cleanupQueuePath, `${JSON.stringify({
    version: 1,
    entries: [
      {
        id: "ui-smoke-global-cleanup",
        status: "pending",
        source: "document-delete",
        collectionSlug: collection.slug,
        collectionId: collection.id,
        documentId: "ui-smoke-deleted-document",
        documentName: "ui-smoke-orphan.pdf",
        baseUrl: "http://127.0.0.1:1/api",
        workspaceSlug: "ui-smoke-workspace",
        locations: ["custom-documents/ui-smoke-orphan.pdf"],
        syncKeys: ["ui-smoke-orphan-cleanup"],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        attempts: 0,
        lastError: "UI smoke pending cleanup with missing matching API key.",
        activationGuard: { kind: "document-deleted", documentId: "ui-smoke-deleted-document" },
      },
    ],
  }, null, 2)}\n`, "utf8");
  await window.webContents.reload();
  await waitForWindowCondition(window, "document.body.innerText.includes('UI Smoke Collection')", "ui collection after reload");
  const waitForDocumentNames = async (names, label, timeoutMs = 45_000) => {
    const deadline = Date.now() + timeoutMs;
    let lastNames = [];
    while (Date.now() < deadline) {
      const response = await fetch(`${url}/api/collections/${encodeURIComponent(collection.slug)}/documents`);
      if (!response.ok) throw new Error(`Unable to load documents while waiting for ${label}: ${response.status}`);
      const payload = await response.json();
      const documents = payload.documents || [];
      lastNames = documents.map((item) => item.name);
      if (names.every((name) => lastNames.includes(name))) return documents;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`Timed out waiting for ${label}. Last documents: ${lastNames.join(", ")}`);
  };
  const ensureAllDocumentsVisible = async (label) => {
    const state = await window.webContents.executeJavaScript(`(() => {
      const summary = document.querySelector('.doc-selection-summary')?.innerText || '';
      const total = Number((summary.match(/共\\s*(\\d+)/) || [])[1] || document.querySelectorAll('.doc-row').length);
      const visible = document.querySelectorAll('.doc-row').length;
      return {
        total,
        visible,
        hasShowAll: Array.from(document.querySelectorAll('.docs-panel button')).some((button) => button.innerText.includes('显示全部'))
      };
    })()`);
    if (state.total > state.visible) {
      if (!state.hasShowAll) throw new Error(`Missing show-all documents button for ${label}: ${JSON.stringify(state)}`);
      await waitForWindowCondition(window, "Array.from(document.querySelectorAll('.docs-panel button')).some((button) => button.innerText.includes('显示全部') && !button.disabled)", `${label} show-all button enabled`);
      const showAllClick = await window.webContents.executeJavaScript(`(() => {
        const button = Array.from(document.querySelectorAll('.docs-panel button')).find((item) => item.innerText.includes('显示全部') && !item.disabled);
        if (!button) return { ok: false, error: 'missing enabled show-all button' };
        const text = button.innerText;
        button.click();
        return { ok: true, text };
      })()`);
      if (!showAllClick.ok) throw new Error(`Unable to click show-all documents button for ${label}: ${JSON.stringify(showAllClick)}`);
      await waitForWindowCondition(window, `document.querySelectorAll('.doc-row').length > ${state.visible}`, `${label} more documents visible`);
      return await window.webContents.executeJavaScript("document.querySelectorAll('.doc-row').length");
    }
    return state.visible;
  };
  await window.webContents.executeJavaScript(`(() => {
    window.__nativeDialogCalls = [];
    for (const name of ['prompt', 'confirm', 'alert']) {
      window[name] = (...args) => {
        window.__nativeDialogCalls.push({ name, args: args.map((item) => String(item)) });
        throw new Error('Native dialog call is not allowed in UI smoke after reload: ' + name);
      };
    }
    return true;
  })()`);
  await navigateSmokePage(window, "documents", ".docs-panel");
  const docListState = await window.webContents.executeJavaScript(`(() => {
    const summary = document.querySelector('.doc-selection-summary')?.innerText || '';
    return {
      summary,
      total: Number((summary.match(/共\\s*(\\d+)/) || [])[1] || 0),
      visible: document.querySelectorAll('.doc-row').length,
      hasShowAll: Array.from(document.querySelectorAll('.docs-panel button')).some((button) => button.innerText.includes('显示全部'))
    };
  })()`);
  if (docListState.total <= 8 || docListState.visible !== 8 || !docListState.hasShowAll) {
    throw new Error(`Document show-all precondition failed: ${JSON.stringify(docListState)}`);
  }
  uiSmokeCheckpoint("document show-all precondition ok");
  await clickWindowButton(window, `显示全部 ${docListState.total} 条`, ".docs-panel");
  await waitForWindowCondition(window, `document.querySelectorAll('.doc-row').length === ${docListState.total}`, "show all documents button reveals all rows");
  uiSmokeCheckpoint("document show-all clicked");
  await navigateSmokePage(window, "mcp", "#section-mcp");
  const mcpResourceUiState = await window.webContents.executeJavaScript(`(() => {
    const list = document.querySelector('[data-testid="mcp-resource-list"]');
    if (!list) return { ok: false, error: 'missing MCP resource list' };
    const rows = Array.from(list.querySelectorAll('.mcp-resource-row'));
    const firstButton = rows[0]?.querySelector('button');
    if (!firstButton || firstButton.disabled) return { ok: false, error: 'first MCP copy button unavailable', rows: rows.length };
    firstButton.click();
    return {
      ok: true,
      rows: rows.length,
      text: list.innerText,
      toast: document.querySelector('.toast')?.innerText || ''
    };
  })()`);
  if (
    !mcpResourceUiState.ok
    || mcpResourceUiState.rows !== 7
    || !mcpResourceUiState.text.includes("vectorforge://embedding-provider/status")
    || !mcpResourceUiState.text.includes("vectorforge://anythingllm/sync-status")
  ) {
    throw new Error(`MCP resource UI coverage failed: ${JSON.stringify(mcpResourceUiState)}`);
  }
  uiSmokeCheckpoint("MCP resource list and copy button ok");
  await navigateSmokePage(window, "documents", ".docs-panel");

  const processingRiskCoverage = { upload: 0, importPaths: 0, importSelected: 0, reprocess: 0, batchReprocess: 0 };
  const aiPolicyCoverage = { toolCards: 0, auditRows: 0, auditHasSecret: false };
  const aiSearchCoverage = { dryRunCalls: 0, searchCalls: 0 };
  const aiSafetyPrecheckCoverage = { dryRunCalls: 0, blockedDirectCalls: 0, requiresConfirmation: false };
  const visibleImportButtonCoverage = { clickTriggeredInput: false };
  const documentDeleteCoverage = { calls: 0, disabledUntilNameMatch: false, removed: false };
  const batchDeleteCoverage = { removed: false };
  const searchDetailCoverage = { hasSearchResult: false, hasDocumentDetail: false };
  const taskCancelCoverage = { calls: 0, updated: false };
  const configControlCoverage = { saveCalls: 0, payloadMatches: false, persisted: false };
  const citationCopyCoverage = { calls: 0, copiedTextMatches: false };
  const cleanupQueueSingleRetryCoverage = { dialog: false, callsBeforeConfirm: 0, submitCalls: 0, payloadMatches: false };
  const onboardingResetCoverage = { sidebarCalls: 0, dialogCalls: 0, reopened: false, finishDisabled: false, closed: false };
  const workspaceChipCoverage = { clicked: false, persisted: false, clearedAfterDraftChange: false };
  const ocrTestCoverage = { callsBeforeConfirm: 0, callsAfterConfirm: 0, payloadMatches: false };
  const embeddingTestCoverage = { configButtonCalls: 0, configPayloadMatches: false, aiQuickCalls: 0, aiPayloadMatches: false };
  const anythingButtonCoverage = {
    connectionTestCalls: 0,
    desktopTestCalls: 0,
    environmentRefreshCalls: 0,
    environmentRefreshUpdatedInput: false,
    exePathSaveCalls: 0,
    exePathClearCalls: 0,
    exePathPersisted: false,
    exePathCleared: false,
    desktopSideEffectCallsBeforeConfirm: 0,
    installerDownloadCalls: 0,
    installerLaunchCallsAfterConfirm: 0,
  };
  await installPostProbe(window, "__riskUploadCalls", ["\\/api\\/collections\\/[^/]+\\/upload-jobs$"]);
  uiSmokeCheckpoint("upload probe installed");
  const visibleImportButtonRaw = await window.webContents.executeJavaScript(`(async () => {
    try {
      const input = document.querySelector('input.hidden-file-input[type="file"]');
      if (!input) return JSON.stringify({ ok: false, error: 'Missing hidden upload input' });
      let clickCount = 0;
      const originalClick = input.click.bind(input);
      input.click = () => {
        clickCount += 1;
      };
      const button = document.querySelector('.top-actions .button.primary');
      if (!button) return JSON.stringify({ ok: false, error: 'Missing visible import button' });
      if (button.disabled) return JSON.stringify({ ok: false, error: 'Visible import button disabled' });
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      input.click = originalClick;
      return JSON.stringify({ ok: true, clickCount });
    } catch (error) {
      return JSON.stringify({ ok: false, error: String(error?.message || error) });
    }
  })()`);
  const visibleImportButtonState = JSON.parse(visibleImportButtonRaw);
  visibleImportButtonCoverage.clickTriggeredInput = visibleImportButtonState.ok && visibleImportButtonState.clickCount === 1;
  if (!visibleImportButtonCoverage.clickTriggeredInput) {
    throw new Error(`Visible import button did not trigger the hidden file input: ${JSON.stringify(visibleImportButtonState)}`);
  }
  uiSmokeCheckpoint("visible import button triggered hidden file input");
  const uploadInjectionRaw = await window.webContents.executeJavaScript(`(() => {
    try {
      const input = document.querySelector('input.hidden-file-input[type="file"]');
      if (!input) return JSON.stringify({ ok: false, error: 'Missing hidden upload input' });
      if (typeof DataTransfer !== 'function') return JSON.stringify({ ok: false, error: 'DataTransfer is not available in renderer' });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(new File(['UI_SMOKE_UPLOAD_RISK source-backed document'], 'ui-risk-upload.txt', { type: 'text/plain' }));
      input.files = dataTransfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return JSON.stringify({ ok: true, fileCount: input.files?.length || 0 });
    } catch (error) {
      return JSON.stringify({ ok: false, error: String(error?.message || error) });
    }
  })()`);
  const uploadInjection = JSON.parse(uploadInjectionRaw);
  if (!uploadInjection.ok) throw new Error(`Unable to inject upload file for UI smoke: ${JSON.stringify(uploadInjection)}`);
  uiSmokeCheckpoint("upload file injected");
  await waitForWindowCondition(window, "Boolean(document.querySelector('.processing-risk-dialog'))", "upload processing risk confirmation");
  let riskCalls = await readPostProbe(window, "__riskUploadCalls");
  if (riskCalls.length !== 0) throw new Error(`Upload bypassed processing-risk confirmation: ${JSON.stringify(riskCalls)}`);
  await clickWindowButton(window, "确认继续", ".processing-risk-dialog");
  await waitForWindowCondition(window, "(window.__riskUploadCalls || []).length === 1", "upload post-confirm request");
  processingRiskCoverage.upload = (await readPostProbe(window, "__riskUploadCalls")).length;
  await restorePostProbe(window);
  uiSmokeCheckpoint("upload risk confirmed");
  let sourceBackedDocuments = await waitForDocumentNames(["ui-risk-upload.txt"], "risk upload document");
  uiSmokeCheckpoint("upload document indexed");

  const directorySmokeDir = fs.mkdtempSync(path.join(os.tmpdir(), "vector-forge-ui-dir-source-"));
  for (let index = 1; index <= 13; index += 1) {
    fs.writeFileSync(
      path.join(directorySmokeDir, `ui-risk-dir-${String(index).padStart(2, "0")}.txt`),
      `UI_SMOKE_DIRECTORY_RISK_${index} source-backed document for import-all and reprocess coverage.\n`,
      "utf8",
    );
  }
  await fillWindowInput(window, ".directory-source-row", "input", directorySmokeDir);
  uiSmokeCheckpoint("directory path filled");
  await clickWindowButton(window, "扫描目录", ".directory-source");
  await waitForWindowCondition(window, "document.querySelectorAll('.directory-candidate').length === 12", "directory candidates initially limited to 12");
  uiSmokeCheckpoint("directory scan completed");
  const candidateLimitState = await window.webContents.executeJavaScript(`(() => ({
    visible: document.querySelectorAll('.directory-candidate').length,
    hasLimitNote: document.querySelector('.candidate-limit-note')?.innerText.includes('另有 1 个未展示') || false,
    hasShowAll: Array.from(document.querySelectorAll('.directory-candidates button')).some((button) => button.innerText.includes('显示全部候选'))
  }))()`);
  if (!candidateLimitState.hasLimitNote || !candidateLimitState.hasShowAll) {
    throw new Error(`Directory candidate limit state is incomplete: ${JSON.stringify(candidateLimitState)}`);
  }
  await clickWindowButton(window, "显示全部候选", ".directory-candidates");
  await waitForWindowCondition(window, "document.querySelectorAll('.directory-candidate').length === 13", "show all directory candidates");
  uiSmokeCheckpoint("directory show-all clicked");
  await installPostProbe(window, "__riskImportCalls", ["\\/api\\/collections\\/[^/]+\\/import-paths$"]);
  await clickWindowButton(window, "导入全部候选", ".directory-candidates");
  await waitForWindowCondition(window, "Boolean(document.querySelector('.processing-risk-dialog'))", "directory import processing risk confirmation");
  riskCalls = await readPostProbe(window, "__riskImportCalls");
  if (riskCalls.length !== 0) throw new Error(`Directory import bypassed processing-risk confirmation: ${JSON.stringify(riskCalls)}`);
  await clickWindowButton(window, "确认继续", ".processing-risk-dialog");
  await waitForWindowCondition(window, "(window.__riskImportCalls || []).length === 1", "directory import post-confirm request");
  const importCalls = await readPostProbe(window, "__riskImportCalls");
  processingRiskCoverage.importPaths = importCalls.length;
  await restorePostProbe(window);
  const importBody = JSON.parse(importCalls[0].body || "{}");
  if (!Array.isArray(importBody.paths) || importBody.paths.length !== 13) {
    throw new Error(`Import-all did not submit all directory candidates: ${JSON.stringify(importCalls)}`);
  }
  uiSmokeCheckpoint("directory import risk confirmed");
  sourceBackedDocuments = await waitForDocumentNames(["ui-risk-upload.txt", "ui-risk-dir-01.txt", "ui-risk-dir-02.txt"], "directory import documents");
  uiSmokeCheckpoint("directory import documents indexed");
  const selectedImportRaw = await window.webContents.executeJavaScript(`(() => {
    try {
      const checkboxes = Array.from(document.querySelectorAll('.directory-candidate input[type="checkbox"]'));
      if (checkboxes.length < 2) return JSON.stringify({ ok: false, error: 'expected at least two directory candidates', count: checkboxes.length });
      for (const checkbox of checkboxes.slice(0, 2)) {
        if (checkbox.disabled) return JSON.stringify({ ok: false, error: 'candidate checkbox disabled' });
        if (!checkbox.checked) checkbox.click();
      }
      return JSON.stringify({ ok: true, selected: document.querySelectorAll('.directory-candidate input[type="checkbox"]:checked').length });
    } catch (error) {
      return JSON.stringify({ ok: false, error: String(error?.message || error) });
    }
  })()`);
  const selectedImportState = JSON.parse(selectedImportRaw);
  if (!selectedImportState.ok || selectedImportState.selected < 2) {
    throw new Error(`Unable to select directory candidates for selected-import smoke: ${JSON.stringify(selectedImportState)}`);
  }
  await installPostProbe(window, "__riskImportSelectedCalls", ["\\/api\\/collections\\/[^/]+\\/import-paths$"]);
  await window.webContents.executeJavaScript(`(() => {
    const head = document.querySelector('.directory-candidates-head');
    if (!head) throw new Error('Missing directory candidate actions');
    const buttons = Array.from(head.querySelectorAll('button'));
    const selectedImportButton = buttons[buttons.length - 1];
    if (!selectedImportButton) throw new Error('Missing selected-import button');
    if (selectedImportButton.disabled) throw new Error('Selected-import button disabled');
    selectedImportButton.click();
    return true;
  })()`);
  await waitForWindowCondition(window, "Boolean(document.querySelector('.processing-risk-dialog'))", "directory selected-import processing risk confirmation");
  riskCalls = await readPostProbe(window, "__riskImportSelectedCalls");
  if (riskCalls.length !== 0) throw new Error(`Directory selected import bypassed processing-risk confirmation: ${JSON.stringify(riskCalls)}`);
  await window.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('.processing-risk-dialog .button.primary');
    if (!button || button.disabled) throw new Error('Selected-import confirmation button unavailable');
    button.click();
    return true;
  })()`);
  await waitForWindowCondition(window, "(window.__riskImportSelectedCalls || []).length === 1", "directory selected-import post-confirm request");
  const selectedImportCalls = await readPostProbe(window, "__riskImportSelectedCalls");
  processingRiskCoverage.importSelected = selectedImportCalls.length;
  await restorePostProbe(window);
  const selectedImportBody = JSON.parse(selectedImportCalls[0].body || "{}");
  if (!Array.isArray(selectedImportBody.paths) || selectedImportBody.paths.length !== 2) {
    throw new Error(`Selected import did not submit exactly two directory candidates: ${JSON.stringify(selectedImportCalls)}`);
  }
  uiSmokeCheckpoint("directory selected import risk confirmed");
  const uploadDocument = sourceBackedDocuments.find((item) => item.name === "ui-risk-upload.txt");
  const batchReprocessDocuments = ["ui-risk-dir-01.txt", "ui-risk-dir-02.txt"].map((name) => sourceBackedDocuments.find((item) => item.name === name));
  if (!uploadDocument || batchReprocessDocuments.some((item) => !item)) {
    throw new Error(`Missing source-backed documents for reprocess coverage: ${sourceBackedDocuments.map((item) => item.name).join(", ")}`);
  }
  await navigateSmokePage(window, "documents", ".docs-panel");
  await waitForWindowCondition(window, "document.querySelectorAll('.doc-row').length > 0", "document rows after reload", 45_000);
  await ensureAllDocumentsVisible("risk imported documents");
  await waitForWindowCondition(window, "Array.from(document.querySelectorAll('.doc-row')).some((row) => row.innerText.includes('ui-risk-upload.txt'))", "risk upload row after imports", 15_000);
  uiSmokeCheckpoint("continued after risk imports");
  await window.webContents.executeJavaScript(`(() => {
    const row = Array.from(document.querySelectorAll('.doc-row')).find((item) => item.innerText.includes('ui-risk-upload.txt'));
    if (!row) throw new Error('Missing ui-risk-upload row');
    const detailButton = Array.from(row.querySelectorAll('button')).find((button) => button.innerText.includes('详情'));
    if (!detailButton || detailButton.disabled) throw new Error('ui-risk-upload detail button unavailable');
    detailButton.click();
    return true;
  })()`);
  await waitForWindowCondition(window, "document.querySelector('.document-detail-panel')?.innerText.includes('ui-risk-upload.txt')", "source-backed document detail opened");
  uiSmokeCheckpoint("source-backed detail opened");
  await installPostProbe(window, "__riskReprocessCalls", ["\\/api\\/collections\\/[^/]+\\/documents\\/[^/]+\\/reprocess$"]);
  await clickWindowButton(window, "重新处理", ".document-detail-panel");
  await waitForWindowCondition(window, "Boolean(document.querySelector('.processing-risk-dialog'))", "single reprocess processing risk confirmation");
  riskCalls = await readPostProbe(window, "__riskReprocessCalls");
  if (riskCalls.length !== 0) throw new Error(`Single reprocess bypassed processing-risk confirmation: ${JSON.stringify(riskCalls)}`);
  await clickWindowButton(window, "确认继续", ".processing-risk-dialog");
  await waitForWindowCondition(window, "(window.__riskReprocessCalls || []).length === 1", "single reprocess post-confirm request");
  const reprocessCalls = await readPostProbe(window, "__riskReprocessCalls");
  processingRiskCoverage.reprocess = reprocessCalls.length;
  await restorePostProbe(window);
  if (!reprocessCalls[0].url.includes(encodeURIComponent(uploadDocument.id))) {
    throw new Error(`Single reprocess targeted the wrong document: ${JSON.stringify(reprocessCalls)}`);
  }
  await waitForWindowCondition(
    window,
    "!document.querySelector('.processing-risk-dialog') && Array.from(document.querySelectorAll('.doc-row input[type=\"checkbox\"]')).some((checkbox) => !checkbox.disabled)",
    "single reprocess UI returns to selectable state",
  );
  uiSmokeCheckpoint("single reprocess risk confirmed");
  await ensureAllDocumentsVisible("batch reprocess documents");
  const batchSelectRaw = await window.webContents.executeJavaScript(`(() => {
    try {
      const targets = new Set(['ui-risk-dir-01.txt', 'ui-risk-dir-02.txt']);
      let matched = 0;
      for (const row of Array.from(document.querySelectorAll('.doc-row'))) {
        if (!Array.from(targets).some((name) => row.innerText.includes(name))) continue;
        matched += 1;
        const checkbox = row.querySelector('input[type="checkbox"]');
        if (!checkbox) return JSON.stringify({ ok: false, error: 'missing checkbox', rowText: row.innerText });
        if (checkbox.disabled) return JSON.stringify({ ok: false, error: 'checkbox disabled', rowText: row.innerText });
        if (!checkbox.checked) checkbox.click();
      }
      const selected = document.querySelectorAll('.doc-row input[type="checkbox"]:checked').length;
      return JSON.stringify({ ok: matched === 2 && selected === 2, matched, selected });
    } catch (error) {
      return JSON.stringify({ ok: false, error: String(error?.message || error) });
    }
  })()`);
  const batchSelect = JSON.parse(batchSelectRaw);
  if (!batchSelect.ok) throw new Error(`Unable to select batch reprocess documents: ${JSON.stringify(batchSelect)}`);
  uiSmokeCheckpoint("batch reprocess docs selected");
  await installPostProbe(window, "__riskBatchReprocessCalls", ["\\/api\\/collections\\/[^/]+\\/documents\\/batch-reprocess$"]);
  await clickWindowButton(window, "批量重处理", ".docs-panel");
  await waitForWindowCondition(window, "Boolean(document.querySelector('.processing-risk-dialog'))", "batch reprocess processing risk confirmation");
  riskCalls = await readPostProbe(window, "__riskBatchReprocessCalls");
  if (riskCalls.length !== 0) throw new Error(`Batch reprocess bypassed processing-risk confirmation: ${JSON.stringify(riskCalls)}`);
  await clickWindowButton(window, "确认继续", ".processing-risk-dialog");
  await waitForWindowCondition(window, "(window.__riskBatchReprocessCalls || []).length === 1", "batch reprocess post-confirm request");
  const batchReprocessCalls = await readPostProbe(window, "__riskBatchReprocessCalls");
  processingRiskCoverage.batchReprocess = batchReprocessCalls.length;
  await restorePostProbe(window);
  const batchReprocessBody = JSON.parse(batchReprocessCalls[0].body || "{}");
  if (!Array.isArray(batchReprocessBody.documentIds) || batchReprocessBody.documentIds.length !== 2) {
    throw new Error(`Batch reprocess did not submit two document ids: ${JSON.stringify(batchReprocessCalls)}`);
  }
  await waitForWindowCondition(window, "document.querySelectorAll('.doc-row input[type=\"checkbox\"]:checked').length === 0", "batch reprocess clears selected documents");
  fs.rmSync(directorySmokeDir, { recursive: true, force: true });
  await ensureAllDocumentsVisible("post-risk smoke");
  uiSmokeCheckpoint("batch reprocess risk confirmed");

  await navigateSmokePage(window, "anythingllm", "#section-anythingllm");
  await waitForWindowCondition(window, "Boolean(document.querySelector('#section-anythingllm'))", "AnythingLLM config panel");
  await window.webContents.executeJavaScript(`(() => {
    window.__anythingButtonCalls = [];
    window.__anythingButtonOriginalFetch = window.__anythingButtonOriginalFetch || window.fetch.bind(window);
    const originalFetch = window.__anythingButtonOriginalFetch;
    window.fetch = async (input, init = {}) => {
      const targetUrl = typeof input === 'string' ? input : input.url;
      const method = String(init.method || 'GET').toUpperCase();
      const body = typeof init.body === 'string' ? init.body : '';
      if (method === 'POST' && /\\/api\\/test-anythingllm$/.test(targetUrl)) {
        window.__anythingButtonCalls.push({ kind: 'test-anythingllm', method, url: targetUrl, body });
        return new Response(JSON.stringify({ authenticated: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (method === 'POST' && /\\/api\\/anythingllm\\/test$/.test(targetUrl)) {
        window.__anythingButtonCalls.push({ kind: 'desktop-test', method, url: targetUrl, body });
        return new Response(JSON.stringify({
          ok: true,
          desktop: { ready: true, executable: { path: 'C:\\\\Smoke\\\\AnythingLLM.exe' } },
          api: { authenticated: true }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return originalFetch(input, init);
    };
    return true;
  })()`);
  await clickWindowButton(window, "测试", "#section-anythingllm");
  await waitForWindowCondition(window, "(window.__anythingButtonCalls || []).filter((call) => call.kind === 'test-anythingllm').length === 1", "AnythingLLM connection test button call");
  await waitForWindowCondition(window, "!Array.from(document.querySelectorAll('#section-anythingllm button')).find((button) => button.innerText.trim() === '桌面测试')?.disabled", "AnythingLLM desktop test button enabled after connection test");
  await clickWindowButton(window, "桌面测试", "#section-anythingllm");
  await waitForWindowCondition(window, "(window.__anythingButtonCalls || []).filter((call) => call.kind === 'desktop-test').length === 1", "AnythingLLM desktop test button call");
  await waitForWindowCondition(window, "!Array.from(document.querySelectorAll('#section-anythingllm button')).find((button) => button.innerText.trim() === '读取 Workspace')?.disabled", "AnythingLLM workspace button enabled after desktop test");
  const anythingButtonCalls = await window.webContents.executeJavaScript(`(() => {
    const calls = window.__anythingButtonCalls || [];
    if (window.__anythingButtonOriginalFetch) {
      window.fetch = window.__anythingButtonOriginalFetch;
      delete window.__anythingButtonOriginalFetch;
    }
    return calls;
  })()`);
  anythingButtonCoverage.connectionTestCalls = anythingButtonCalls.filter((call) => call.kind === "test-anythingllm").length;
  anythingButtonCoverage.desktopTestCalls = anythingButtonCalls.filter((call) => call.kind === "desktop-test").length;
  uiSmokeCheckpoint("AnythingLLM test buttons clicked");

  const fakeAnythingExeDir = fs.mkdtempSync(path.join(os.tmpdir(), "vector-forge-ui-anything-exe-"));
  const fakeAnythingExePath = path.join(fakeAnythingExeDir, "AnythingLLM.exe");
  fs.writeFileSync(fakeAnythingExePath, "MZ fake AnythingLLM executable for UI smoke");
  await installPostProbe(window, "__anythingExePathCalls", ["\\/api\\/anythingllm\\/exe-path$"]);
  const exePathFillRaw = await window.webContents.executeJavaScript(`(() => {
    const setNativeValue = (element, value) => {
      const setter = Object.getOwnPropertyDescriptor(element.constructor.prototype, 'value')?.set;
      if (!setter) throw new Error('missing native setter');
      setter.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const field = Array.from(document.querySelectorAll('#section-anythingllm label.field')).find((label) => label.innerText.includes('AnythingLLM.exe'));
    const input = field?.querySelector('input');
    if (!input) return JSON.stringify({ ok: false, error: 'missing AnythingLLM exe path input' });
    if (input.disabled) return JSON.stringify({ ok: false, error: 'AnythingLLM exe path input disabled' });
    setNativeValue(input, ${JSON.stringify(fakeAnythingExePath)});
    return JSON.stringify({ ok: true, value: input.value });
  })()`);
  const exePathFill = JSON.parse(exePathFillRaw);
  if (!exePathFill.ok) throw new Error(`Unable to fill AnythingLLM exe path: ${JSON.stringify(exePathFill)}`);
  await clickWindowButton(window, "保存路径", "#section-anythingllm");
  await waitForWindowCondition(window, "(window.__anythingExePathCalls || []).length === 1", "AnythingLLM exe-path save request");
  await waitForWindowCondition(
    window,
    `(() => {
      const field = Array.from(document.querySelectorAll('#section-anythingllm label.field')).find((label) => label.innerText.includes('AnythingLLM.exe'));
      return field?.querySelector('input')?.value === ${JSON.stringify(fakeAnythingExePath)};
    })()`,
    "AnythingLLM exe-path persisted in UI",
  );
  let exePathCalls = await readPostProbe(window, "__anythingExePathCalls");
  const exePathSaveBody = JSON.parse(exePathCalls[0]?.body || "{}");
  if (exePathSaveBody.exePath !== fakeAnythingExePath) {
    throw new Error(`AnythingLLM exe-path save submitted the wrong payload: ${JSON.stringify(exePathCalls)}`);
  }
  anythingButtonCoverage.exePathSaveCalls = exePathCalls.length;
  anythingButtonCoverage.exePathPersisted = true;
  await waitForWindowCondition(
    window,
    "!Array.from(document.querySelectorAll('#section-anythingllm button')).find((button) => button.innerText.trim() === '清空')?.disabled",
    "AnythingLLM exe-path clear button enabled after save",
  );
  await clickWindowButton(window, "清空", "#section-anythingllm");
  await waitForWindowCondition(window, "(window.__anythingExePathCalls || []).length === 2", "AnythingLLM exe-path clear request");
  await waitForWindowCondition(
    window,
    `(() => {
      const field = Array.from(document.querySelectorAll('#section-anythingllm label.field')).find((label) => label.innerText.includes('AnythingLLM.exe'));
      return (field?.querySelector('input')?.value || '') === '';
    })()`,
    "AnythingLLM exe-path cleared in UI",
  );
  exePathCalls = await readPostProbe(window, "__anythingExePathCalls");
  const exePathClearBody = JSON.parse(exePathCalls[1]?.body || "{}");
  if (exePathClearBody.clear !== true) {
    throw new Error(`AnythingLLM exe-path clear submitted the wrong payload: ${JSON.stringify(exePathCalls)}`);
  }
  anythingButtonCoverage.exePathClearCalls = exePathCalls.length - anythingButtonCoverage.exePathSaveCalls;
  anythingButtonCoverage.exePathCleared = true;
  await restorePostProbe(window);
  fs.rmSync(fakeAnythingExeDir, { recursive: true, force: true });
  uiSmokeCheckpoint("AnythingLLM exe-path save and clear buttons clicked");

  const fakeAnythingRefreshPath = "C:\\Smoke\\Refresh\\AnythingLLM.exe";
  await window.webContents.executeJavaScript(`(() => {
    window.__anythingEnvironmentRefreshCalls = [];
    window.__anythingEnvironmentOriginalFetch = window.__anythingEnvironmentOriginalFetch || window.fetch.bind(window);
    const originalFetch = window.__anythingEnvironmentOriginalFetch;
    window.fetch = async (input, init = {}) => {
      const targetUrl = typeof input === 'string' ? input : input.url;
      const method = String(init.method || 'GET').toUpperCase();
      if (method === 'GET' && /\\/api\\/anythingllm\\/environment(?:\\?|$)/.test(targetUrl)) {
        window.__anythingEnvironmentRefreshCalls.push({ method, url: targetUrl });
        return new Response(JSON.stringify({
          os: { platform: 'win32', arch: 'x64' },
          api: { enabled: true, baseUrl: 'http://127.0.0.1:3001/api', hasApiKey: true },
          desktop: {
            installRoot: '',
            configuredExe: { path: '', exists: false, launchable: false },
            detectedExe: { path: ${JSON.stringify(fakeAnythingRefreshPath)}, exists: true, launchable: true },
            latestRelease: null,
            installer: { folder: 'C:\\\\Smoke', exists: false, fileName: '' }
          }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return originalFetch(input, init);
    };
    const button = document.querySelector('#section-anythingllm .anything-desktop-head button');
    if (!button || button.disabled) throw new Error('AnythingLLM environment refresh button unavailable');
    button.click();
    return true;
  })()`);
  await waitForWindowCondition(window, "(window.__anythingEnvironmentRefreshCalls || []).length === 1", "AnythingLLM environment refresh request");
  const anythingEnvironmentState = await window.webContents.executeJavaScript(`(() => {
    const field = Array.from(document.querySelectorAll('#section-anythingllm label.field')).find((label) => label.innerText.includes('AnythingLLM.exe'));
    const input = field?.querySelector('input');
    const result = {
      calls: window.__anythingEnvironmentRefreshCalls || [],
      inputValue: input?.value || '',
      summary: document.querySelector('#section-anythingllm .anything-desktop-box')?.innerText || ''
    };
    if (window.__anythingEnvironmentOriginalFetch) {
      window.fetch = window.__anythingEnvironmentOriginalFetch;
      delete window.__anythingEnvironmentOriginalFetch;
    }
    return result;
  })()`);
  anythingButtonCoverage.environmentRefreshCalls = anythingEnvironmentState.calls.length;
  anythingButtonCoverage.environmentRefreshUpdatedInput = anythingEnvironmentState.inputValue === fakeAnythingRefreshPath;
  if (anythingButtonCoverage.environmentRefreshCalls !== 1 || !anythingButtonCoverage.environmentRefreshUpdatedInput) {
    throw new Error(`AnythingLLM environment refresh coverage failed: ${JSON.stringify(anythingEnvironmentState)}`);
  }
  uiSmokeCheckpoint("AnythingLLM environment refresh button clicked");

  await installPostProbe(window, "__configControlSaveCalls", ["\\/api\\/collections\\/[^/]+\\/config$"]);
  await navigateSmokePage(window, "settings", "#section-embedding");
  const configControlRaw = await window.webContents.executeJavaScript(`(() => {
    const setNativeValue = (element, value) => {
      const setter = Object.getOwnPropertyDescriptor(element.constructor.prototype, 'value')?.set;
      if (!setter) throw new Error('missing native value setter');
      setter.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const setSelectValue = (select, value) => {
      const setter = Object.getOwnPropertyDescriptor(select.constructor.prototype, 'value')?.set;
      if (!setter) throw new Error('missing native select setter');
      setter.call(select, value);
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const fieldInput = (scopeSelector, labelText) => {
      const scope = document.querySelector(scopeSelector);
      const label = Array.from(scope?.querySelectorAll('label.field') || []).find((item) => item.innerText.includes(labelText));
      return label?.querySelector('input, select, textarea') || null;
    };
    const checkbox = (scopeSelector, labelText) => {
      const scope = document.querySelector(scopeSelector);
      const label = Array.from(scope?.querySelectorAll('label.check-field') || []).find((item) => item.innerText.includes(labelText));
      return label?.querySelector('input[type="checkbox"]') || null;
    };
    const provider = fieldInput('#section-embedding', 'Provider');
    const dimension = fieldInput('#section-embedding', '维度');
    const model = fieldInput('#section-embedding', '模型');
    const baseUrl = fieldInput('#section-embedding', 'Base URL');
    const apiKey = fieldInput('#section-embedding', 'API key');
    const batchSize = fieldInput('#section-embedding', 'Batch size');
    const chunkTarget = fieldInput('#section-embedding', '切片长度');
    const overlap = fieldInput('#section-embedding', '重叠');
    const missing = { provider, dimension, model, baseUrl, apiKey, batchSize, chunkTarget, overlap };
    const missingKeys = Object.entries(missing).filter(([, value]) => !value).map(([key]) => key);
    if (missingKeys.length) return JSON.stringify({ ok: false, error: 'missing settings controls', missingKeys });
    setSelectValue(provider, 'local-hash');
    setNativeValue(dimension, '384');
    setNativeValue(model, 'ui-smoke-local-hash-model');
    setNativeValue(baseUrl, 'http://127.0.0.1:1/v1/embeddings');
    setNativeValue(apiKey, 'ui-smoke-embedding-key');
    setNativeValue(batchSize, '48');
    setNativeValue(chunkTarget, '1111');
    setNativeValue(overlap, '222');
    return JSON.stringify({
      ok: true,
      provider: provider.value,
      dimension: dimension.value,
      model: model.value,
      batchSize: batchSize.value,
      chunkTarget: chunkTarget.value,
      overlap: overlap.value,
      dirtyVisible: document.querySelector('.inspector-panel')?.innerText.includes('未保存') || false
    });
  })()`);
  const configControlState = JSON.parse(configControlRaw);
  if (!configControlState.ok) throw new Error(`Unable to edit settings controls: ${JSON.stringify(configControlState)}`);

  await navigateSmokePage(window, "parsers", "#section-parsers");
  const parserConfigRaw = await window.webContents.executeJavaScript(`(() => {
    const setNativeValue = (element, value) => {
      const setter = Object.getOwnPropertyDescriptor(element.constructor.prototype, 'value')?.set;
      if (!setter) throw new Error('missing native value setter');
      setter.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const setSelectValue = (select, value) => {
      const setter = Object.getOwnPropertyDescriptor(select.constructor.prototype, 'value')?.set;
      if (!setter) throw new Error('missing native select setter');
      setter.call(select, value);
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const nthFieldInput = (scopeSelector, index) => {
      const scope = document.querySelector(scopeSelector);
      const label = Array.from(scope?.querySelectorAll('label.field') || [])[index];
      return label?.querySelector('input, select, textarea') || null;
    };
    const nthCheckbox = (scopeSelector, index) => {
      const scope = document.querySelector(scopeSelector);
      const label = Array.from(scope?.querySelectorAll('label.check-field') || [])[index];
      return label?.querySelector('input[type="checkbox"]') || null;
    };
    const setCheckboxValue = (input, checked) => {
      if (Boolean(input.checked) !== Boolean(checked)) input.click();
    };
    const fieldInput = (scopeSelector, labelText) => {
      const scope = document.querySelector(scopeSelector);
      const label = Array.from(scope?.querySelectorAll('label.field') || []).find((item) => item.innerText.includes(labelText));
      return label?.querySelector('input, select, textarea') || null;
    };
    const checkbox = (scopeSelector, labelText) => {
      const scope = document.querySelector(scopeSelector);
      const label = Array.from(scope?.querySelectorAll('label.check-field') || []).find((item) => item.innerText.includes(labelText));
      return label?.querySelector('input[type="checkbox"]') || null;
    };
    const duplicateStrategy = nthFieldInput('#section-parsers', 0);
    const maxFileSizeMb = nthFieldInput('#section-parsers', 1);
    const pdfMaxPages = nthFieldInput('#section-parsers', 2);
    const pdfOcrThreshold = nthFieldInput('#section-parsers', 3);
    const pdfRenderScale = nthFieldInput('#section-parsers', 4);
    const ocrTimeoutMs = nthFieldInput('#section-parsers', 5);
    const pdfTextFirst = nthCheckbox('#section-parsers', 0);
    const pdfKeepPageNumbers = nthCheckbox('#section-parsers', 1);
    const tesseractLangPath = nthFieldInput('#section-parsers', 9);
    const paddleCommand = nthFieldInput('#section-parsers', 10);
    const paddleArgs = nthFieldInput('#section-parsers', 11);
    const ocrMode = fieldInput('#section-parsers', '模式');
    const language = fieldInput('#section-parsers', '语言');
    const minConfidence = fieldInput('#section-parsers', '最低置信度');
    const allowCloud = checkbox('#section-parsers', '允许 cloud OCR');
    const cloudBaseUrl = fieldInput('#section-parsers', 'Cloud OCR Base URL');
    const cloudApiKey = nthFieldInput('#section-parsers', 13);
    const cloudModel = fieldInput('#section-parsers', 'Cloud OCR 模型');
    const controls = {
      duplicateStrategy, maxFileSizeMb, pdfMaxPages, pdfOcrThreshold, pdfRenderScale,
      ocrTimeoutMs, pdfTextFirst, pdfKeepPageNumbers, tesseractLangPath, paddleCommand,
      paddleArgs, ocrMode, language, minConfidence, allowCloud, cloudBaseUrl, cloudApiKey, cloudModel
    };
    const missingKeys = Object.entries(controls).filter(([, value]) => !value).map(([key]) => key);
    if (missingKeys.length) return JSON.stringify({ ok: false, error: 'missing parser controls', missingKeys });
    setSelectValue(duplicateStrategy, 'replace');
    setNativeValue(maxFileSizeMb, '321');
    setNativeValue(pdfMaxPages, '123');
    setNativeValue(pdfOcrThreshold, '456');
    setNativeValue(pdfRenderScale, '2.5');
    setNativeValue(ocrTimeoutMs, '120000');
    setCheckboxValue(pdfTextFirst, false);
    setCheckboxValue(pdfKeepPageNumbers, true);
    setNativeValue(tesseractLangPath, 'C:\\\\Smoke\\\\tessdata');
    setNativeValue(paddleCommand, 'paddleocr-smoke');
    setNativeValue(paddleArgs, '--input {input} --output {output}');
    setSelectValue(ocrMode, 'cloud');
    setNativeValue(language, 'eng+chi_sim+ui');
    setNativeValue(minConfidence, '67');
    setCheckboxValue(allowCloud, true);
    setNativeValue(cloudBaseUrl, 'http://127.0.0.1:1/v1/chat/completions');
    setNativeValue(cloudApiKey, 'ui-smoke-cloud-ocr-key');
    setNativeValue(cloudModel, 'ui-smoke-vision-model');
    return JSON.stringify({
      ok: true,
      duplicateStrategy: duplicateStrategy.value,
      maxFileSizeMb: maxFileSizeMb.value,
      pdfMaxPages: pdfMaxPages.value,
      pdfTextFirst: pdfTextFirst.checked,
      pdfKeepPageNumbers: pdfKeepPageNumbers.checked,
      ocrMode: ocrMode.value,
      allowCloud: allowCloud.checked
    });
  })()`);
  const parserConfigState = JSON.parse(parserConfigRaw);
  if (!parserConfigState.ok) throw new Error(`Unable to edit parser controls: ${JSON.stringify(parserConfigState)}`);

  await navigateSmokePage(window, "anythingllm", "#section-anythingllm");
  const anythingConfigRaw = await window.webContents.executeJavaScript(`(() => {
    const setNativeValue = (element, value) => {
      const setter = Object.getOwnPropertyDescriptor(element.constructor.prototype, 'value')?.set;
      if (!setter) throw new Error('missing native value setter');
      setter.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const setCheckboxValue = (input, checked) => {
      if (Boolean(input.checked) !== Boolean(checked)) input.click();
    };
    const nthFieldInput = (scopeSelector, index) => {
      const scope = document.querySelector(scopeSelector);
      const label = Array.from(scope?.querySelectorAll('label.field') || [])[index];
      return label?.querySelector('input, select, textarea') || null;
    };
    const nthCheckbox = (scopeSelector, index) => {
      const scope = document.querySelector(scopeSelector);
      const label = Array.from(scope?.querySelectorAll('label.check-field') || [])[index];
      return label?.querySelector('input[type="checkbox"]') || null;
    };
    const anythingEnabled = nthCheckbox('#section-anythingllm', 0);
    const anythingBaseUrl = nthFieldInput('#section-anythingllm', 0);
    const anythingApiKey = nthFieldInput('#section-anythingllm', 1);
    const anythingWorkspace = nthFieldInput('#section-anythingllm', 2);
    const anythingSlug = nthFieldInput('#section-anythingllm', 3);
    const controls = { anythingEnabled, anythingBaseUrl, anythingApiKey, anythingWorkspace, anythingSlug };
    const missingKeys = Object.entries(controls).filter(([, value]) => !value).map(([key]) => key);
    if (missingKeys.length) return JSON.stringify({ ok: false, error: 'missing anythingllm controls', missingKeys });
    setCheckboxValue(anythingEnabled, true);
    setNativeValue(anythingBaseUrl, 'http://127.0.0.1:1/api');
    setNativeValue(anythingApiKey, 'ui-smoke-anything-key');
    setNativeValue(anythingWorkspace, 'UI Smoke Workspace');
    setNativeValue(anythingSlug, 'ui-smoke-workspace');
    return JSON.stringify({
      ok: true,
      anythingEnabled: anythingEnabled.checked,
      anythingSlug: anythingSlug.value
    });
  })()`);
  const anythingConfigState = JSON.parse(anythingConfigRaw);
  if (!anythingConfigState.ok) throw new Error(`Unable to edit AnythingLLM controls: ${JSON.stringify(anythingConfigState)}`);

  await navigateSmokePage(window, "mcp", "#section-mcp");
  const mcpConfigRaw = await window.webContents.executeJavaScript(`(() => {
    const label = Array.from(document.querySelectorAll('#section-mcp label.check-field')).find((item) => item.innerText.includes('允许 MCP 写入'));
    const mcpWrites = label?.querySelector('input[type="checkbox"]');
    if (!mcpWrites) return JSON.stringify({ ok: false, error: 'missing MCP writes checkbox' });
    if (!mcpWrites.checked) mcpWrites.click();
    return JSON.stringify({ ok: true, mcpWrites: mcpWrites.checked });
  })()`);
  const mcpConfigState = JSON.parse(mcpConfigRaw);
  if (!mcpConfigState.ok || !mcpConfigState.mcpWrites) throw new Error(`Unable to edit MCP controls: ${JSON.stringify(mcpConfigState)}`);

  await navigateSmokePage(window, "settings", "#section-embedding");
  await clickWindowButton(window, "保存当前", ".inspector-actions");
  await waitForWindowCondition(window, "(window.__configControlSaveCalls || []).length === 1", "config control save request");
  const configControlCalls = await readPostProbe(window, "__configControlSaveCalls");
  const configControlBody = JSON.parse(configControlCalls[0]?.body || "{}");
  configControlCoverage.saveCalls = configControlCalls.length;
  configControlCoverage.payloadMatches = (
    configControlBody.embedding?.provider === "local-hash"
    && configControlBody.embedding?.model === "ui-smoke-local-hash-model"
    && configControlBody.embedding?.dimension === 384
    && configControlBody.embedding?.batchSize === 48
    && configControlBody.chunking?.targetChars === 1111
    && configControlBody.chunking?.overlapChars === 222
    && configControlBody.parsers?.duplicateStrategy === "replace"
    && configControlBody.parsers?.maxFileSizeMb === 321
    && configControlBody.parsers?.pdf?.maxPages === 123
    && configControlBody.parsers?.pdf?.ocrTextThreshold === 456
    && configControlBody.parsers?.pdf?.renderScale === 2.5
    && configControlBody.parsers?.pdf?.textFirst === false
    && configControlBody.parsers?.pdf?.keepPageNumbers === true
    && configControlBody.parsers?.ocr?.mode === "cloud"
    && configControlBody.parsers?.ocr?.timeoutMs === 120000
    && configControlBody.parsers?.ocr?.allowCloudOcr === true
    && configControlBody.parsers?.ocr?.tesseractLangPath === "C:\\Smoke\\tessdata"
    && configControlBody.parsers?.ocr?.paddleCommand === "paddleocr-smoke"
    && configControlBody.parsers?.ocr?.paddleArgs === "--input {input} --output {output}"
    && configControlBody.parsers?.ocr?.cloudApiKey === "ui-smoke-cloud-ocr-key"
    && configControlBody.parsers?.ocr?.cloudModel === "ui-smoke-vision-model"
    && configControlBody.anythingllm?.enabled === true
    && configControlBody.anythingllm?.baseUrl === "http://127.0.0.1:1/api"
    && configControlBody.anythingllm?.apiKey === "ui-smoke-anything-key"
    && configControlBody.anythingllm?.workspaceName === "UI Smoke Workspace"
    && configControlBody.anythingllm?.workspaceSlug === "ui-smoke-workspace"
    && configControlBody.mcp?.allowWrites === true
  );
  if (!configControlCoverage.payloadMatches) {
    throw new Error(`Config save button submitted the wrong payload: ${JSON.stringify(configControlCalls)}`);
  }
  await waitForWindowCondition(
    window,
    "!document.querySelector('.inspector-actions .button.primary')?.disabled",
    "config save button enabled after save",
  );
  let persistedConfigPayload = null;
  const configPersistDeadline = Date.now() + 15_000;
  while (Date.now() < configPersistDeadline && !configControlCoverage.persisted) {
    const persistedConfigResponse = await fetch(`${url}/api/collections/${encodeURIComponent(collection.slug)}/config`);
    if (!persistedConfigResponse.ok) throw new Error(`Unable to verify persisted config after UI save: ${persistedConfigResponse.status}`);
    persistedConfigPayload = await persistedConfigResponse.json();
    configControlCoverage.persisted = (
      persistedConfigPayload.config?.embedding?.provider === "local-hash"
      && persistedConfigPayload.config?.embedding?.model === "ui-smoke-local-hash-model"
      && persistedConfigPayload.config?.embedding?.dimension === 384
      && persistedConfigPayload.config?.chunking?.targetChars === 1111
      && persistedConfigPayload.config?.parsers?.duplicateStrategy === "replace"
      && persistedConfigPayload.config?.parsers?.maxFileSizeMb === 321
      && persistedConfigPayload.config?.parsers?.pdf?.maxPages === 123
      && persistedConfigPayload.config?.parsers?.pdf?.ocrTextThreshold === 456
      && persistedConfigPayload.config?.parsers?.pdf?.renderScale === 2.5
      && persistedConfigPayload.config?.parsers?.pdf?.textFirst === false
      && persistedConfigPayload.config?.parsers?.pdf?.keepPageNumbers === true
      && persistedConfigPayload.config?.parsers?.ocr?.mode === "cloud"
      && persistedConfigPayload.config?.parsers?.ocr?.timeoutMs === 120000
      && persistedConfigPayload.config?.parsers?.ocr?.tesseractLangPath === "C:\\Smoke\\tessdata"
      && persistedConfigPayload.config?.parsers?.ocr?.paddleCommand === "paddleocr-smoke"
      && persistedConfigPayload.config?.parsers?.ocr?.paddleArgs === "--input {input} --output {output}"
      && persistedConfigPayload.config?.parsers?.ocr?.cloudApiKey === "ui-smoke-cloud-ocr-key"
      && persistedConfigPayload.config?.anythingllm?.enabled === true
      && persistedConfigPayload.config?.anythingllm?.baseUrl === "http://127.0.0.1:1/api"
      && persistedConfigPayload.config?.anythingllm?.apiKey === "ui-smoke-anything-key"
      && persistedConfigPayload.config?.anythingllm?.workspaceName === "UI Smoke Workspace"
      && persistedConfigPayload.config?.anythingllm?.workspaceSlug === "ui-smoke-workspace"
      && persistedConfigPayload.config?.mcp?.allowWrites === true
    );
    if (!configControlCoverage.persisted) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!configControlCoverage.persisted) {
    throw new Error(`Config save button did not persist edited controls: ${JSON.stringify(persistedConfigPayload?.config)}`);
  }
  await restorePostProbe(window);
  uiSmokeCheckpoint("config controls edited and saved");

  await window.webContents.executeJavaScript(`(() => {
    window.__embeddingTestCalls = [];
    window.__embeddingTestOriginalFetch = window.__embeddingTestOriginalFetch || window.fetch.bind(window);
    const originalFetch = window.__embeddingTestOriginalFetch;
    window.fetch = async (input, init = {}) => {
      const targetUrl = typeof input === 'string' ? input : input.url;
      const method = String(init.method || 'GET').toUpperCase();
      const body = typeof init.body === 'string' ? init.body : '';
      if (method === 'POST' && /\\/api\\/test-embedding$/.test(targetUrl)) {
        window.__embeddingTestCalls.push({ method, url: targetUrl, body });
        return new Response(JSON.stringify({ provider: 'local-hash', model: 'ui-smoke-local-hash-model', dimension: 384 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return originalFetch(input, init);
    };
    return true;
  })()`);
  await clickWindowButton(window, "测试 embedding", "#section-embedding");
  await waitForWindowCondition(window, "(window.__embeddingTestCalls || []).length === 1", "config embedding test request");
  const configEmbeddingTestState = await window.webContents.executeJavaScript(`(() => {
    const result = { calls: window.__embeddingTestCalls || [], toast: document.querySelector('.toast')?.innerText || '' };
    if (window.__embeddingTestOriginalFetch) {
      window.fetch = window.__embeddingTestOriginalFetch;
      delete window.__embeddingTestOriginalFetch;
    }
    return result;
  })()`);
  const configEmbeddingBody = JSON.parse(configEmbeddingTestState.calls[0]?.body || "{}");
  embeddingTestCoverage.configButtonCalls = configEmbeddingTestState.calls.length;
  embeddingTestCoverage.configPayloadMatches = (
    configEmbeddingBody.embedding?.provider === "local-hash"
    && configEmbeddingBody.embedding?.model === "ui-smoke-local-hash-model"
    && configEmbeddingBody.embedding?.dimension === 384
    && configEmbeddingBody.embedding?.batchSize === 48
  );
  if (embeddingTestCoverage.configButtonCalls !== 1 || !embeddingTestCoverage.configPayloadMatches) {
    throw new Error(`Config embedding test button submitted the wrong payload: ${JSON.stringify(configEmbeddingTestState)}`);
  }
  uiSmokeCheckpoint("config embedding test button clicked");

  await window.webContents.executeJavaScript(`(() => {
    window.__workspaceStaleOriginalFetch = window.__workspaceStaleOriginalFetch || window.fetch.bind(window);
    const originalFetch = window.__workspaceStaleOriginalFetch;
    window.fetch = async (input, init = {}) => {
      const targetUrl = typeof input === 'string' ? input : input.url;
      const method = String(init.method || 'GET').toUpperCase();
      if (method === 'POST' && /\\/api\\/anythingllm\\/workspaces$/.test(targetUrl)) {
        return new Response(JSON.stringify({
          workspaces: [
            { id: 1, name: 'Smoke Workspace A', slug: 'smoke-a' },
            { id: 2, name: 'Smoke Workspace B', slug: 'smoke-b' }
          ]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return originalFetch(input, init);
    };
    return true;
  })()`);
  await navigateSmokePage(window, "anythingllm", "#section-anythingllm");
  await clickWindowButton(window, "读取 Workspace", "#section-anythingllm");
  await waitForWindowCondition(window, "document.querySelectorAll('#section-anythingllm .workspace-chip').length === 2", "AnythingLLM workspace chips loaded");
  await clickWindowButton(window, "Smoke Workspace A", "#section-anythingllm");
  const workspaceChipApply = await window.webContents.executeJavaScript(`(() => {
    const workspaceLabel = Array.from(document.querySelectorAll('#section-anythingllm label.field')).find((label) => label.innerText.includes('Workspace'));
    const slugLabel = Array.from(document.querySelectorAll('#section-anythingllm label.field')).find((label) => label.innerText.includes('Slug'));
    return {
      workspaceName: workspaceLabel?.querySelector('input')?.value || '',
      workspaceSlug: slugLabel?.querySelector('input')?.value || ''
    };
  })()`);
  if (workspaceChipApply.workspaceName !== "Smoke Workspace A" || workspaceChipApply.workspaceSlug !== "smoke-a") {
    throw new Error(`Workspace chip did not apply to the draft config: ${JSON.stringify(workspaceChipApply)}`);
  }
  workspaceChipCoverage.clicked = true;
  await clickWindowButton(window, "保存当前", ".inspector-actions");
  await waitForWindowCondition(
    window,
    `(async () => {
      const response = await fetch('/api/collections/${encodeURIComponent(collection.slug)}/config');
      if (!response.ok) return false;
      const payload = await response.json();
      return payload.config?.anythingllm?.workspaceName === 'Smoke Workspace A' && payload.config?.anythingllm?.workspaceSlug === 'smoke-a';
    })()`,
    "workspace chip config persisted"
  );
  workspaceChipCoverage.persisted = true;
  await installPostProbe(window, "__copyDefaultCalls", ["\\/api\\/config\\/copy-from-collection\\/[^/]+$"]);
  await window.webContents.executeJavaScript(`(() => {
    const copyButton = document.querySelector('.inspector-actions button:nth-child(2)');
    if (!copyButton) throw new Error('Copy-default button missing');
    if (copyButton.disabled) throw new Error('Copy-default button disabled');
    copyButton.click();
  })()`);
  await waitForWindowCondition(window, "Boolean(document.querySelector('[data-testid=\"copy-default-dialog\"]'))", "copy-default confirmation dialog");
  let copyDefaultGuard = await window.webContents.executeJavaScript(`(() => ({
    calls: window.__copyDefaultCalls || [],
    dialog: document.querySelector('[data-testid="copy-default-dialog"]')?.innerText || ''
  }))()`);
  if (copyDefaultGuard.calls.length !== 0 || !copyDefaultGuard.dialog.includes("Copy current parameters as default")) {
    throw new Error(`Copy-default action did not stop at confirmation: ${JSON.stringify(copyDefaultGuard)}`);
  }
  await clickWindowButton(window, "Cancel", "[data-testid=\"copy-default-dialog\"]");
  await waitForWindowCondition(window, "!document.querySelector('[data-testid=\"copy-default-dialog\"]')", "copy-default confirmation cancelled");
  copyDefaultGuard = await window.webContents.executeJavaScript(`(() => ({ calls: window.__copyDefaultCalls || [] }))()`);
  if (copyDefaultGuard.calls.length !== 0) throw new Error(`Copy-default called API before confirmation: ${JSON.stringify(copyDefaultGuard)}`);
  await window.webContents.executeJavaScript(`(() => {
    const copyButton = document.querySelector('.inspector-actions button:nth-child(2)');
    if (!copyButton) throw new Error('Copy-default button missing on second pass');
    if (copyButton.disabled) throw new Error('Copy-default button disabled on second pass');
    copyButton.click();
  })()`);
  await waitForWindowCondition(window, "Boolean(document.querySelector('[data-testid=\"copy-default-dialog\"]'))", "copy-default confirmation dialog second pass");
  await clickWindowButton(window, "Confirm copy", "[data-testid=\"copy-default-dialog\"]");
  await waitForWindowCondition(window, "(window.__copyDefaultCalls || []).length === 1 && !document.querySelector('[data-testid=\"copy-default-dialog\"]')", "copy-default post-confirm request");
  await restorePostProbe(window);
  const workspaceEditRaw = await window.webContents.executeJavaScript(`(() => {
    const setNativeValue = (element, value) => {
      const setter = Object.getOwnPropertyDescriptor(element.constructor.prototype, 'value')?.set;
      if (!setter) throw new Error('missing native setter');
      setter.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const field = Array.from(document.querySelectorAll('#section-anythingllm label.field')).find((label) => label.innerText.includes('API Base URL'));
    const input = field?.querySelector('input');
    if (!input) return JSON.stringify({ ok: false, error: 'missing AnythingLLM base URL input' });
    setNativeValue(input, 'http://127.0.0.1:2/api');
    return JSON.stringify({ ok: true });
  })()`);
  const workspaceEdit = JSON.parse(workspaceEditRaw);
  if (!workspaceEdit.ok) throw new Error(`Unable to edit AnythingLLM base URL for workspace stale smoke: ${JSON.stringify(workspaceEdit)}`);
  await waitForWindowCondition(window, "document.querySelectorAll('#section-anythingllm .workspace-chip').length === 0", "AnythingLLM workspace chips cleared after draft base URL change");
  workspaceChipCoverage.clearedAfterDraftChange = true;
  const workspaceRestoreRaw = await window.webContents.executeJavaScript(`(() => {
    const setNativeValue = (element, value) => {
      const setter = Object.getOwnPropertyDescriptor(element.constructor.prototype, 'value')?.set;
      if (!setter) throw new Error('missing native setter');
      setter.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const field = Array.from(document.querySelectorAll('#section-anythingllm label.field')).find((label) => label.innerText.includes('API Base URL'));
    const input = field?.querySelector('input');
    if (!input) return JSON.stringify({ ok: false, error: 'missing AnythingLLM base URL input' });
    setNativeValue(input, 'http://127.0.0.1:1/api');
    if (window.__workspaceStaleOriginalFetch) {
      window.fetch = window.__workspaceStaleOriginalFetch;
      delete window.__workspaceStaleOriginalFetch;
    }
    return JSON.stringify({ ok: true });
  })()`);
  const workspaceRestore = JSON.parse(workspaceRestoreRaw);
  if (!workspaceRestore.ok) throw new Error(`Unable to restore AnythingLLM base URL after workspace stale smoke: ${JSON.stringify(workspaceRestore)}`);
  await waitForWindowCondition(window, "!document.querySelector('#section-anythingllm .workspace-chip') && !Array.from(document.querySelectorAll('#section-anythingllm button')).find((button) => button.innerText.trim() === '同步')?.disabled", "AnythingLLM workspace stale smoke restored saved draft");
  await window.webContents.executeJavaScript(`(() => {
    window.__desktopActionCalls = [];
    window.__desktopActionOriginalFetch = window.__desktopActionOriginalFetch || window.fetch.bind(window);
    const originalFetch = window.__desktopActionOriginalFetch;
    window.fetch = async (input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      const method = String(init.method || 'GET').toUpperCase();
      const body = typeof init.body === 'string' ? init.body : '';
      if (method === 'POST' && /\\/api\\/anythingllm\\/download-installer$/.test(url)) {
        window.__desktopActionCalls.push({ kind: 'download-installer', method, url, body });
        const parsed = body ? JSON.parse(body) : {};
        return new Response(JSON.stringify({
          downloaded: !parsed.dryRun,
          dryRun: Boolean(parsed.dryRun),
          installer: { fileName: 'AnythingLLM-Smoke.exe', folder: 'C:\\\\Smoke', bytes: parsed.dryRun ? undefined : 12345 }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (method === 'POST' && /\\/api\\/anythingllm\\/open-installer-folder$/.test(url)) {
        window.__desktopActionCalls.push({ kind: 'open-installer-folder', method, url, body });
        return new Response(JSON.stringify({ opened: true, folder: 'C:\\\\Smoke' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (method === 'POST' && /\\/api\\/anythingllm\\/launch-installer$/.test(url)) {
        window.__desktopActionCalls.push({ kind: 'launch-installer', method, url, body });
        const parsed = body ? JSON.parse(body) : {};
        if (parsed.dryRun) {
          return new Response(JSON.stringify({ installer: { exists: true, fileName: 'AnythingLLM-Smoke.exe' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({ launched: true, installer: { fileName: 'AnythingLLM-Smoke.exe' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return originalFetch(input, init);
    };
    return true;
  })()`);
  const installerUrlRaw = await window.webContents.executeJavaScript(`(() => {
    const setNativeValue = (element, value) => {
      const setter = Object.getOwnPropertyDescriptor(element.constructor.prototype, 'value')?.set;
      if (!setter) throw new Error('missing native setter');
      setter.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const field = Array.from(document.querySelectorAll('#section-anythingllm label.field')).find((label) => label.innerText.includes('安装包直链'));
    const input = field?.querySelector('input');
    if (!input) return JSON.stringify({ ok: false, error: 'missing installer URL input' });
    setNativeValue(input, 'https://github.com/Mintplex-Labs/anything-llm/releases/download/v0.0.0/AnythingLLM-Smoke.exe');
    return JSON.stringify({ ok: true });
  })()`);
  const installerUrlResult = JSON.parse(installerUrlRaw);
  if (!installerUrlResult.ok) throw new Error(`Unable to fill installer URL: ${JSON.stringify(installerUrlResult)}`);
  await clickWindowButton(window, "检查格式", "#section-anythingllm");
  await waitForWindowCondition(window, "(window.__desktopActionCalls || []).filter((call) => call.kind === 'download-installer' && JSON.parse(call.body || '{}').dryRun === true).length === 1", "installer format check call");
  await waitForWindowCondition(
    window,
    "Array.from(document.querySelectorAll('#section-anythingllm button')).some((button) => button.innerText.trim() === '下载' && !button.disabled)",
    "installer download button re-enabled",
  );
  await clickWindowButton(window, "下载", "#section-anythingllm");
  await waitForWindowCondition(window, "(window.__desktopActionCalls || []).filter((call) => call.kind === 'download-installer' && JSON.parse(call.body || '{}').dryRun === false).length === 1", "installer download call");
  await clickWindowButton(window, "打开目录", "#section-anythingllm");
  await waitForWindowCondition(window, "Boolean(document.querySelector('.desktop-action-dialog'))", "open folder confirmation");
  let desktopActionState = await window.webContents.executeJavaScript(`(() => ({ calls: window.__desktopActionCalls || [], dialog: document.querySelector('.desktop-action-dialog')?.innerText || '' }))()`);
  if (desktopActionState.calls.some((call) => call.kind === 'open-installer-folder') || !desktopActionState.dialog.includes("打开安装器目录")) throw new Error(`Open folder button bypassed confirmation: ${JSON.stringify(desktopActionState)}`);
  anythingButtonCoverage.desktopSideEffectCallsBeforeConfirm += desktopActionState.calls.filter((call) => call.kind === 'open-installer-folder').length;
  await clickWindowButton(window, "取消", ".desktop-action-dialog");
  await waitForWindowCondition(window, "!document.querySelector('.desktop-action-dialog')", "open folder confirmation cancelled");
  await clickWindowButton(window, "启动已下载安装器", "#section-anythingllm");
  await waitForWindowCondition(window, "Boolean(document.querySelector('.desktop-action-dialog'))", "launch installer confirmation");
  desktopActionState = await window.webContents.executeJavaScript(`(() => ({ calls: window.__desktopActionCalls || [], dialog: document.querySelector('.desktop-action-dialog')?.innerText || '' }))()`);
  if (desktopActionState.calls.some((call) => call.kind === 'launch-installer') || !desktopActionState.dialog.includes("启动 AnythingLLM 安装器")) throw new Error(`Launch installer button bypassed confirmation: ${JSON.stringify(desktopActionState)}`);
  anythingButtonCoverage.desktopSideEffectCallsBeforeConfirm += desktopActionState.calls.filter((call) => call.kind === 'launch-installer').length;
  await clickWindowButton(window, "取消", ".desktop-action-dialog");
  await waitForWindowCondition(window, "!document.querySelector('.desktop-action-dialog')", "launch installer confirmation cancelled");
  await clickWindowButton(window, "启动已下载安装器", "#section-anythingllm");
  await waitForWindowCondition(window, "Boolean(document.querySelector('.desktop-action-dialog'))", "launch installer confirmation second pass");
  await clickWindowButton(window, "确认启动", ".desktop-action-dialog");
  await waitForWindowCondition(window, "(window.__desktopActionCalls || []).filter((call) => call.kind === 'launch-installer').length === 2 && !document.querySelector('.desktop-action-dialog')", "launch installer post-confirm calls");
  const desktopActionCalls = await window.webContents.executeJavaScript(`(() => {
    const calls = window.__desktopActionCalls || [];
    if (window.__desktopActionOriginalFetch) window.fetch = window.__desktopActionOriginalFetch;
    return calls;
  })()`);
  anythingButtonCoverage.installerDownloadCalls = desktopActionCalls.filter((call) => call.kind === "download-installer").length;
  anythingButtonCoverage.installerLaunchCallsAfterConfirm = desktopActionCalls.filter((call) => call.kind === "launch-installer").length;
  const installerDownloadBodies = desktopActionCalls.filter((call) => call.kind === "download-installer").map((call) => JSON.parse(call.body || "{}"));
  const installerLaunchBodies = desktopActionCalls.filter((call) => call.kind === "launch-installer").map((call) => JSON.parse(call.body || "{}"));
  if (installerDownloadBodies.length !== 2 || installerDownloadBodies[0].dryRun !== true || installerDownloadBodies[1].dryRun !== false) {
    throw new Error(`Installer format/download buttons did not call expected dryRun sequence: ${JSON.stringify(desktopActionCalls)}`);
  }
  if (installerLaunchBodies.length !== 2 || installerLaunchBodies[0].dryRun !== true || Object.keys(installerLaunchBodies[1]).length !== 0) {
    throw new Error(`Installer launch confirmation did not call expected dry-run then launch sequence: ${JSON.stringify(desktopActionCalls)}`);
  }
  await navigateSmokePage(window, "parsers", "#section-parsers");
  await window.webContents.executeJavaScript(`(() => {
    window.__ocrTestCalls = [];
    window.__ocrTestOriginalFetch = window.__ocrTestOriginalFetch || window.fetch.bind(window);
    const originalFetch = window.__ocrTestOriginalFetch;
    window.fetch = async (input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      const method = String(init.method || 'GET').toUpperCase();
      const body = typeof init.body === 'string' ? init.body : '';
      if (method !== 'GET' && /\\/api\\/test-ocr$/.test(url)) {
        window.__ocrTestCalls.push({ method, url, body });
        if (window.__mockOcrTestSuccess) {
          return new Response(JSON.stringify({ ok: true, engine: 'cloud', message: 'UI smoke OCR test passed' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }
      return originalFetch(input, init);
    };
    return true;
  })()`);
  await clickWindowButton(window, "测试 OCR", "#section-parsers");
  await waitForWindowCondition(window, "Boolean(document.querySelector('.ocr-test-dialog'))", "OCR test confirmation");
  const ocrGuard = await window.webContents.executeJavaScript(`(() => ({ calls: window.__ocrTestCalls || [], dialog: document.querySelector('.ocr-test-dialog')?.innerText || '' }))()`);
  if (ocrGuard.calls.length !== 0 || !ocrGuard.dialog.includes("确认 OCR 测试")) throw new Error(`OCR test bypassed confirmation: ${JSON.stringify(ocrGuard)}`);
  ocrTestCoverage.callsBeforeConfirm = ocrGuard.calls.length;
  await clickWindowButton(window, "取消", ".ocr-test-dialog");
  await waitForWindowCondition(window, "!document.querySelector('.ocr-test-dialog')", "OCR test confirmation cancelled");
  await clickWindowButton(window, "测试 OCR", "#section-parsers");
  await waitForWindowCondition(window, "Boolean(document.querySelector('.ocr-test-dialog'))", "OCR test confirmation second pass");
  await window.webContents.executeJavaScript(`(() => {
    window.__mockOcrTestSuccess = true;
    const confirmButton = document.querySelector('.ocr-test-dialog .button.primary');
    if (!confirmButton || confirmButton.disabled) throw new Error('OCR confirm button unavailable');
    confirmButton.click();
    return true;
  })()`);
  await waitForWindowCondition(window, "(window.__ocrTestCalls || []).length === 1 && !document.querySelector('.ocr-test-dialog')", "OCR test post-confirm request");
  const ocrConfirmed = await window.webContents.executeJavaScript(`(() => ({ calls: window.__ocrTestCalls || [], toast: document.querySelector('.toast')?.innerText || '' }))()`);
  const ocrConfirmedBody = JSON.parse(ocrConfirmed.calls[0]?.body || "{}");
  ocrTestCoverage.callsAfterConfirm = ocrConfirmed.calls.length;
  ocrTestCoverage.payloadMatches = (
    ocrConfirmedBody.parsers?.ocr?.mode === "cloud"
    && ocrConfirmedBody.parsers?.ocr?.allowCloudOcr === true
    && ocrConfirmedBody.parsers?.ocr?.cloudBaseUrl === "http://127.0.0.1:1/v1/chat/completions"
    && ocrConfirmedBody.parsers?.ocr?.cloudModel === "ui-smoke-vision-model"
  );
  if (ocrTestCoverage.callsAfterConfirm !== 1 || !ocrTestCoverage.payloadMatches) {
    throw new Error(`OCR test confirmation submitted the wrong request: ${JSON.stringify(ocrConfirmed)}`);
  }
  await window.webContents.executeJavaScript(`(() => {
    if (window.__ocrTestOriginalFetch) window.fetch = window.__ocrTestOriginalFetch;
    delete window.__mockOcrTestSuccess;
    return true;
  })()`);
  await navigateSmokePage(window, "anythingllm", "#section-anythingllm");
  await window.webContents.executeJavaScript(`(() => {
    window.__syncConfirmCalls = [];
    window.__syncCallsBeforeConfirm = 0;
    window.__syncCallsAfterConfirm = 0;
    window.__syncConfirmOriginalFetch = window.__syncConfirmOriginalFetch || window.fetch.bind(window);
    const originalFetch = window.__syncConfirmOriginalFetch;
    window.fetch = async (input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      const method = String(init.method || 'GET').toUpperCase();
      if (method !== 'GET' && /\\/api\\/collections\\/[^/]+\\/sync-anythingllm$/.test(url)) {
        window.__syncConfirmCalls.push({ method, url, body: typeof init.body === 'string' ? init.body : '' });
        if (window.__mockSyncAnythingSuccess) {
          return new Response(JSON.stringify({ uploaded: 2, skipped: 1, embedded: 2, remaining: 0 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }
      return originalFetch(input, init);
    };
    return true;
  })()`);
  await clickWindowButton(window, "同步", "#section-anythingllm");
  await waitForWindowCondition(window, "Boolean(document.querySelector('.anything-sync-dialog'))", "AnythingLLM sync confirmation");
  const syncGuard = await window.webContents.executeJavaScript(`(() => ({ calls: window.__syncConfirmCalls || [], dialog: document.querySelector('.anything-sync-dialog')?.innerText || '' }))()`);
  if (syncGuard.calls.length !== 0 || !syncGuard.dialog.includes("同步到 AnythingLLM")) throw new Error(`AnythingLLM sync bypassed confirmation: ${JSON.stringify(syncGuard)}`);
  await window.webContents.executeJavaScript(`(() => {
    window.__syncCallsBeforeConfirm = (window.__syncConfirmCalls || []).length;
    return true;
  })()`);
  await clickWindowButton(window, "取消", ".anything-sync-dialog");
  await waitForWindowCondition(window, "!document.querySelector('.anything-sync-dialog')", "AnythingLLM sync confirmation cancelled");
  await clickWindowButton(window, "同步", "#section-anythingllm");
  await waitForWindowCondition(window, "Boolean(document.querySelector('.anything-sync-dialog'))", "AnythingLLM sync confirmation second pass");
  await window.webContents.executeJavaScript(`(() => {
    window.__mockSyncAnythingSuccess = true;
    return true;
  })()`);
  await clickWindowButton(window, "确认同步", ".anything-sync-dialog");
  await waitForWindowCondition(window, "(window.__syncConfirmCalls || []).length === 1 && !document.querySelector('.anything-sync-dialog')", "AnythingLLM sync post-confirm request");
  const syncConfirmed = await window.webContents.executeJavaScript(`(() => {
    window.__syncCallsAfterConfirm = (window.__syncConfirmCalls || []).length;
    return { calls: window.__syncConfirmCalls || [], toast: document.querySelector('.toast')?.innerText || '' };
  })()`);
  const syncConfirmedBody = JSON.parse(syncConfirmed.calls[0]?.body || "{}");
  if (syncConfirmed.calls.length !== 1 || syncConfirmedBody.maxChunks !== 200) {
    throw new Error(`AnythingLLM sync did not call the expected endpoint after confirmation: ${JSON.stringify(syncConfirmed)}`);
  }
  await navigateSmokePage(window, "documents", ".docs-panel");
  await waitForWindowCondition(
    window,
    "Boolean(Array.from(document.querySelectorAll('.doc-row')).find((row) => row.innerText.includes('ui-smoke-delete.txt'))?.querySelector('input[type=\"checkbox\"]:not(:disabled)'))",
    "AnythingLLM sync returned UI to selectable document state"
  );
  await window.webContents.executeJavaScript(`(() => {
    if (window.__syncConfirmOriginalFetch) window.fetch = window.__syncConfirmOriginalFetch;
    delete window.__mockSyncAnythingSuccess;
    return true;
  })()`);
  await waitForWindowCondition(window, "Array.from(document.querySelectorAll('.doc-row')).some((row) => row.innerText.includes('ui-smoke-single-delete.txt'))", "single-delete smoke document visible");
  await installPostProbe(window, "__singleDeleteCalls", ["\\/api\\/collections\\/[^/]+\\/documents\\/[^/]+$"]);
  await window.webContents.executeJavaScript(`(() => {
    const row = Array.from(document.querySelectorAll('.doc-row')).find((item) => item.innerText.includes('ui-smoke-single-delete.txt'));
    if (!row) throw new Error('Missing single-delete row');
    const deleteButton = row.querySelector('button.mini-action.danger');
    if (!deleteButton || deleteButton.disabled) throw new Error('Single-delete row button unavailable');
    deleteButton.click();
    return true;
  })()`);
  await waitForWindowCondition(window, "Boolean(Array.from(document.querySelectorAll('.confirm-dialog')).find((dialog) => dialog.innerText.includes('ui-smoke-single-delete.txt')))", "single delete confirmation dialog");
  const singleDeleteInitial = await window.webContents.executeJavaScript(`(() => {
    const dialog = Array.from(document.querySelectorAll('.confirm-dialog')).find((item) => item.innerText.includes('ui-smoke-single-delete.txt'));
    const confirmButton = dialog?.querySelector('button.danger');
    return {
      hasDialog: Boolean(dialog),
      confirmDisabled: Boolean(confirmButton?.disabled),
      calls: window.__singleDeleteCalls || []
    };
  })()`);
  if (!singleDeleteInitial.hasDialog || !singleDeleteInitial.confirmDisabled || singleDeleteInitial.calls.length !== 0) {
    throw new Error(`Single delete did not require a filename confirmation: ${JSON.stringify(singleDeleteInitial)}`);
  }
  documentDeleteCoverage.disabledUntilNameMatch = true;
  await fillWindowInput(window, ".confirm-dialog", "input", "ui-smoke-single-delete.txt");
  await window.webContents.executeJavaScript(`(() => {
    const dialog = Array.from(document.querySelectorAll('.confirm-dialog')).find((item) => item.innerText.includes('ui-smoke-single-delete.txt'));
    if (!dialog) throw new Error('Single-delete confirmation dialog disappeared');
    const confirmButton = dialog.querySelector('button.danger');
    if (!confirmButton || confirmButton.disabled) throw new Error('Single-delete confirm button unavailable after filename match');
    confirmButton.click();
    return true;
  })()`);
  await waitForWindowCondition(window, "(window.__singleDeleteCalls || []).length === 1 && !Array.from(document.querySelectorAll('.doc-row')).some((row) => row.innerText.includes('ui-smoke-single-delete.txt'))", "single delete post-confirm removal");
  const singleDeleteCalls = await readPostProbe(window, "__singleDeleteCalls");
  await restorePostProbe(window);
  documentDeleteCoverage.calls = singleDeleteCalls.length;
  documentDeleteCoverage.removed = true;
  uiSmokeCheckpoint("single document delete confirmed");
  await waitForWindowCondition(window, "Array.from(document.querySelectorAll('.doc-row')).some((row) => row.innerText.includes('ui-smoke-delete.txt'))", "delete smoke document visible");
  const selectDeleteRaw = await window.webContents.executeJavaScript(`(() => {
    const row = Array.from(document.querySelectorAll('.doc-row')).find((item) => item.innerText.includes('ui-smoke-delete.txt'));
    if (!row) return JSON.stringify({ ok: false, error: 'missing delete row' });
    const checkbox = row.querySelector('input[type="checkbox"]');
    if (!checkbox) return JSON.stringify({ ok: false, error: 'missing delete checkbox' });
    if (checkbox.disabled) return JSON.stringify({ ok: false, error: 'delete checkbox disabled' });
    checkbox.click();
    return JSON.stringify({ ok: true });
  })()`);
  const selectDeleteResult = JSON.parse(selectDeleteRaw);
  if (!selectDeleteResult.ok) throw new Error(`Unable to select delete smoke document: ${JSON.stringify(selectDeleteResult)}`);
  await clickWindowButton(window, "批量删除", ".docs-panel");
  await waitForWindowCondition(window, "Boolean(document.querySelector('.batch-delete-dialog'))", "batch delete dialog");
  await fillWindowInput(window, ".batch-delete-dialog", "input", collection.slug);
  await clickWindowButton(window, "确认删除 1 个文档", ".batch-delete-dialog");
  await waitForWindowCondition(window, "!document.querySelector('.batch-delete-dialog') && !Array.from(document.querySelectorAll('.doc-row')).some((row) => row.innerText.includes('ui-smoke-delete.txt'))", "batch delete removed");
  batchDeleteCoverage.removed = true;
  await navigateSmokePage(window, "ai", ".ai-control-panel");
  await waitForWindowCondition(window, "Boolean(document.querySelector('.ai-control-panel [data-smoke-command=\"config.save\"]'))", "AI command buttons");
  await window.webContents.executeJavaScript(`(() => {
    window.__aiDryRunCalls = [];
    window.__aiDryRunResponses = [];
    window.__aiBlockedDirectCalls = [];
    window.__aiOriginalFetch = window.__aiOriginalFetch || window.fetch.bind(window);
    const originalFetch = window.__aiOriginalFetch;
    const directWritePatterns = [
      /\\/api\\/collections\\/[^/]+\\/config$/,
      /\\/api\\/collections\\/[^/]+\\/config\\/apply-default$/,
      /\\/api\\/config\\/copy-from-collection\\/[^/]+$/,
      /\\/api\\/collections\\/[^/]+\\/sync-anythingllm$/,
      /\\/api\\/collections\\/[^/]+\\/(upload|upload-jobs|text)$/
    ];
    window.fetch = async (input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      const method = String(init.method || 'GET').toUpperCase();
      const body = typeof init.body === 'string' ? init.body : '';
      if (method !== 'GET' && directWritePatterns.some((pattern) => pattern.test(url))) {
        window.__aiBlockedDirectCalls.push({ method, url, body });
        throw new Error('AI UI bypassed dry-run and called direct write endpoint: ' + method + ' ' + url);
      }
      const response = await originalFetch(input, init);
      if (url.includes('/api/ai/tools/dry-run')) {
        window.__aiDryRunCalls.push({ method, url, body });
        try {
          window.__aiDryRunResponses.push(await response.clone().json());
        } catch {
          window.__aiDryRunResponses.push({ parseError: true });
        }
      }
      return response;
    };
    return true;
  })()`);
  await window.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('.ai-control-panel [data-smoke-command="config.save"]');
    if (!button) throw new Error('AI save command missing');
    if (button.disabled) throw new Error('AI save command disabled');
    button.click();
  })()`);
  await waitForWindowCondition(window, "(window.__aiDryRunResponses || []).length >= 1", "AI save command dry-run");
  await waitForWindowCondition(window, "Boolean(document.querySelector('[data-testid=\"ai-pending-action\"]'))", "AI save pending action");
  await clickWindowButton(window, "取消", "[data-testid=\"ai-pending-action\"]");
  await waitForWindowCondition(window, "!document.querySelector('[data-testid=\"ai-pending-action\"]')", "AI save pending action cancelled");
  await window.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('.ai-control-panel [data-smoke-command="config.applyDefault"]');
    if (!button) throw new Error('AI apply-default command missing');
    if (button.disabled) throw new Error('AI apply-default command disabled');
    button.click();
  })()`);
  await waitForWindowCondition(window, "(window.__aiDryRunResponses || []).length >= 2", "AI apply-default command dry-run");
  await waitForWindowCondition(window, "Boolean(document.querySelector('[data-testid=\"ai-pending-action\"]'))", "AI apply-default pending action");
  await clickWindowButton(window, "确认执行", "[data-testid=\"ai-pending-action\"]");
  await waitForWindowCondition(window, "Boolean(document.querySelector('.apply-default-dialog'))", "AI apply-default opened confirmation dialog");
  const applyDefaultGuard = await window.webContents.executeJavaScript(`(() => ({
    blockedDirectCalls: window.__aiBlockedDirectCalls || [],
    dialog: document.querySelector('.apply-default-dialog')?.innerText || ''
  }))()`);
  if (applyDefaultGuard.blockedDirectCalls.length || !applyDefaultGuard.dialog.includes("应用默认参数到当前知识库")) {
    throw new Error(`AI apply-default did not stop at the confirmation dialog: ${JSON.stringify(applyDefaultGuard)}`);
  }
  await clickWindowButton(window, "取消", ".apply-default-dialog");
  await waitForWindowCondition(window, "!document.querySelector('.apply-default-dialog')", "AI apply-default confirmation cancelled");
  await waitForWindowCondition(window, "!document.querySelector('.ai-control-panel [data-smoke-command=\"anythingllm.sync\"]')?.disabled", "AI sync command enabled");
  await window.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('.ai-control-panel [data-smoke-command="anythingllm.sync"]');
    if (!button) throw new Error('AI sync command missing');
    if (button.disabled) throw new Error('AI sync command disabled');
    button.click();
  })()`);
  await waitForWindowCondition(window, "(window.__aiDryRunResponses || []).length >= 3", "AI sync command dry-run");
  const aiGuard = await window.webContents.executeJavaScript(`(() => {
    const strip = document.querySelector('.ai-policy-strip');
    const result = {
      dryRunCalls: window.__aiDryRunCalls || [],
      dryRunResponses: window.__aiDryRunResponses || [],
      blockedDirectCalls: window.__aiBlockedDirectCalls || [],
      policyRisk: strip?.getAttribute('data-ai-policy-risk') || '',
      policyConfirm: strip?.getAttribute('data-ai-policy-confirm') || '',
      policyBlocked: strip?.getAttribute('data-ai-policy-blocked') || '',
      policyText: strip?.innerText || ''
    };
    if (window.__aiOriginalFetch) window.fetch = window.__aiOriginalFetch;
    return result;
  })()`);
  if (aiGuard.blockedDirectCalls.length) throw new Error(`AI UI made direct write/sync calls: ${JSON.stringify(aiGuard.blockedDirectCalls)}`);
  const aiDryRunBodies = aiGuard.dryRunCalls.map((call) => call.body).join("\n");
  if (!aiDryRunBodies.includes("config.save")) throw new Error(`AI save command did not request config.save dry-run: ${aiDryRunBodies}`);
  if (!aiDryRunBodies.includes("config.applyDefault")) throw new Error(`AI apply-default command did not request config.applyDefault dry-run: ${aiDryRunBodies}`);
  if (!aiDryRunBodies.includes("anythingllm.sync")) throw new Error(`AI sync command did not request anythingllm.sync dry-run: ${aiDryRunBodies}`);
  const aiRiskByTool = new Map();
  for (const response of aiGuard.dryRunResponses) {
    if (response.willExecute !== false) throw new Error(`AI dry-run allowed execution: ${JSON.stringify(response)}`);
    for (const toolId of response.matchedToolIds || []) aiRiskByTool.set(toolId, response);
  }
  const aiSaveDecision = aiRiskByTool.get("config.save");
  const aiApplyDefaultDecision = aiRiskByTool.get("config.applyDefault");
  const aiSyncDecision = aiRiskByTool.get("anythingllm.sync");
  if (!aiSaveDecision?.requiresConfirmation || aiSaveDecision.highestRisk !== "write") throw new Error(`AI save command was not stopped as write-confirmation: ${JSON.stringify(aiSaveDecision)}`);
  if (!aiApplyDefaultDecision?.requiresConfirmation || aiApplyDefaultDecision.highestRisk !== "write") throw new Error(`AI apply-default command was not stopped as write-confirmation: ${JSON.stringify(aiApplyDefaultDecision)}`);
  if (!aiSyncDecision?.requiresConfirmation || aiSyncDecision.highestRisk !== "external-send") throw new Error(`AI sync command was not stopped as external-send confirmation: ${JSON.stringify(aiSyncDecision)}`);
  await window.webContents.executeJavaScript(`(() => {
    const pending = document.querySelector('[data-testid="ai-pending-action"]');
    const cancelButton = pending?.querySelector('.mini-action');
    if (cancelButton && !cancelButton.disabled) cancelButton.click();
    return true;
  })()`);
  await waitForWindowCondition(window, "!document.querySelector('[data-testid=\"ai-pending-action\"]')", "AI pending action cleared before embedding quick smoke");
  await window.webContents.executeJavaScript(`(() => {
    window.__aiEmbeddingDryRunCalls = [];
    window.__aiEmbeddingTestCalls = [];
    window.__aiEmbeddingOriginalFetch = window.__aiEmbeddingOriginalFetch || window.fetch.bind(window);
    const originalFetch = window.__aiEmbeddingOriginalFetch;
    window.fetch = async (input, init = {}) => {
      const targetUrl = typeof input === 'string' ? input : input.url;
      const method = String(init.method || 'GET').toUpperCase();
      const body = typeof init.body === 'string' ? init.body : '';
      if (method === 'POST' && /\\/api\\/test-embedding$/.test(targetUrl)) {
        window.__aiEmbeddingTestCalls.push({ method, url: targetUrl, body });
        return new Response(JSON.stringify({ provider: 'local-hash', model: 'ui-smoke-local-hash-model', dimension: 384 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      const response = await originalFetch(input, init);
      if (method === 'POST' && /\\/api\\/ai\\/tools\\/dry-run$/.test(targetUrl)) {
        window.__aiEmbeddingDryRunCalls.push({ method, url: targetUrl, body });
      }
      return response;
    };
    const button = document.querySelector('.ai-control-panel [data-smoke-command="embedding.test"]');
    if (!button) throw new Error('AI embedding quick command missing');
    if (button.disabled) throw new Error('AI embedding quick command disabled');
    button.click();
    return true;
  })()`);
  await waitForWindowCondition(window, "(window.__aiEmbeddingDryRunCalls || []).length === 1 && Boolean(document.querySelector('[data-testid=\"ai-pending-action\"]'))", "AI embedding quick dry-run pending action");
  await clickWindowButton(window, "确认执行", "[data-testid=\"ai-pending-action\"]");
  await waitForWindowCondition(window, "(window.__aiEmbeddingTestCalls || []).length === 1 && !document.querySelector('[data-testid=\"ai-pending-action\"]')", "AI embedding quick test request");
  const aiEmbeddingTestState = await window.webContents.executeJavaScript(`(() => {
    const result = {
      dryRunCalls: window.__aiEmbeddingDryRunCalls || [],
      testCalls: window.__aiEmbeddingTestCalls || [],
      toast: document.querySelector('.toast')?.innerText || ''
    };
    if (window.__aiEmbeddingOriginalFetch) {
      window.fetch = window.__aiEmbeddingOriginalFetch;
      delete window.__aiEmbeddingOriginalFetch;
    }
    return result;
  })()`);
  const aiEmbeddingDryRunBody = aiEmbeddingTestState.dryRunCalls.map((call) => call.body).join("\n");
  const aiEmbeddingBody = JSON.parse(aiEmbeddingTestState.testCalls[0]?.body || "{}");
  embeddingTestCoverage.aiQuickCalls = aiEmbeddingTestState.testCalls.length;
  embeddingTestCoverage.aiPayloadMatches = (
    aiEmbeddingDryRunBody.includes("embedding.test")
    && aiEmbeddingBody.embedding?.provider === "local-hash"
    && aiEmbeddingBody.embedding?.model === "ui-smoke-local-hash-model"
    && aiEmbeddingBody.embedding?.dimension === 384
  );
  if (embeddingTestCoverage.aiQuickCalls !== 1 || !embeddingTestCoverage.aiPayloadMatches) {
    throw new Error(`AI embedding quick command did not test the expected config: ${JSON.stringify(aiEmbeddingTestState)}`);
  }
  await window.webContents.executeJavaScript(`(() => {
    window.__aiSafetyDryRunCalls = [];
    window.__aiSafetyDirectCalls = [];
    window.__aiSafetyOriginalFetch = window.__aiSafetyOriginalFetch || window.fetch.bind(window);
    const originalFetch = window.__aiSafetyOriginalFetch;
    const directWritePatterns = [
      /\\/api\\/collections\\/[^/]+\\/config$/,
      /\\/api\\/collections\\/[^/]+\\/config\\/apply-default$/,
      /\\/api\\/config\\/copy-from-collection\\/[^/]+$/,
      /\\/api\\/collections\\/[^/]+\\/sync-anythingllm$/,
      /\\/api\\/collections\\/[^/]+\\/(upload|upload-jobs|text)$/
    ];
    window.fetch = async (input, init = {}) => {
      const targetUrl = typeof input === 'string' ? input : input.url;
      const method = String(init.method || 'GET').toUpperCase();
      const body = typeof init.body === 'string' ? init.body : '';
      if (method !== 'GET' && directWritePatterns.some((pattern) => pattern.test(targetUrl))) {
        window.__aiSafetyDirectCalls.push({ method, url: targetUrl, body });
        throw new Error('Safety precheck bypassed dry-run and called direct endpoint: ' + method + ' ' + targetUrl);
      }
      const response = await originalFetch(input, init);
      if (method === 'POST' && /\\/api\\/ai\\/tools\\/dry-run$/.test(targetUrl)) {
        window.__aiSafetyDryRunCalls.push({ method, url: targetUrl, body });
      }
      return response;
    };
    const input = document.querySelector('.ai-prompt-input');
    if (!input) throw new Error('AI prompt input missing before safety precheck');
    const setter = Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value')?.set;
    if (!setter) throw new Error('Missing native textarea setter before safety precheck');
    setter.call(input, '保存当前参数');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const safetyButton = Array.from(document.querySelectorAll('.ai-heading-actions button'))[1];
    if (!safetyButton) throw new Error('Safety precheck button missing');
    if (safetyButton.disabled) throw new Error('Safety precheck button disabled');
    safetyButton.click();
    return true;
  })()`);
  await waitForWindowCondition(window, "(window.__aiSafetyDryRunCalls || []).length === 1 && Boolean(document.querySelector('.ai-policy-strip'))", "AI safety precheck dry-run");
  const aiSafetyState = await window.webContents.executeJavaScript(`(() => {
    const strip = document.querySelector('.ai-policy-strip');
    const result = {
      dryRunCalls: window.__aiSafetyDryRunCalls || [],
      directCalls: window.__aiSafetyDirectCalls || [],
      requiresConfirmation: strip?.getAttribute('data-ai-policy-confirm') === 'true',
      blocked: strip?.getAttribute('data-ai-policy-blocked') === 'true',
      risk: strip?.getAttribute('data-ai-policy-risk') || '',
      text: strip?.innerText || ''
    };
    if (window.__aiSafetyOriginalFetch) {
      window.fetch = window.__aiSafetyOriginalFetch;
      delete window.__aiSafetyOriginalFetch;
    }
    return result;
  })()`);
  aiSafetyPrecheckCoverage.dryRunCalls = aiSafetyState.dryRunCalls.length;
  aiSafetyPrecheckCoverage.blockedDirectCalls = aiSafetyState.directCalls.length;
  aiSafetyPrecheckCoverage.requiresConfirmation = aiSafetyState.requiresConfirmation && aiSafetyState.risk === "write" && !aiSafetyState.blocked;
  if (aiSafetyPrecheckCoverage.dryRunCalls !== 1 || aiSafetyPrecheckCoverage.blockedDirectCalls !== 0 || !aiSafetyPrecheckCoverage.requiresConfirmation) {
    throw new Error(`AI safety precheck button coverage failed: ${JSON.stringify(aiSafetyState)}`);
  }
  await window.webContents.executeJavaScript(`(() => {
    window.__aiSearchDryRunCalls = [];
    window.__aiSearchCalls = [];
    window.__aiSearchOriginalFetch = window.__aiSearchOriginalFetch || window.fetch.bind(window);
    const originalFetch = window.__aiSearchOriginalFetch;
    window.fetch = async (input, init = {}) => {
      const targetUrl = typeof input === 'string' ? input : input.url;
      const method = String(init.method || 'GET').toUpperCase();
      const body = typeof init.body === 'string' ? init.body : '';
      const response = await originalFetch(input, init);
      if (method === 'POST' && /\\/api\\/ai\\/tools\\/dry-run$/.test(targetUrl)) {
        window.__aiSearchDryRunCalls.push({ method, url: targetUrl, body });
      }
      if (method === 'POST' && /\\/api\\/collections\\/[^/]+\\/search$/.test(targetUrl)) {
        window.__aiSearchCalls.push({ method, url: targetUrl, body });
      }
      return response;
    };
    return true;
  })()`);
  await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('.ai-prompt-input');
    if (!input) throw new Error('AI prompt input missing');
    const setter = Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value')?.set;
    if (!setter) throw new Error('Missing native textarea value setter');
    setter.call(input, '搜索 UI_SMOKE_SENTINEL');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const runButton = document.querySelector('.ai-input-actions .button.primary');
    if (!runButton || runButton.disabled) throw new Error('AI run button unavailable for search command');
    runButton.click();
    return true;
  })()`);
  await waitForWindowCondition(window, "(window.__aiSearchDryRunCalls || []).length === 1 && (window.__aiSearchCalls || []).length === 1", "AI free-text search dry-run and search calls");
  await navigateSmokePage(window, "search", ".search-panel");
  await waitForWindowCondition(window, "document.querySelector('.result-row')?.innerText.includes('ui-smoke-note.txt')", "AI free-text search result");
  const aiSearchState = await window.webContents.executeJavaScript(`(() => {
    const result = {
      dryRunCalls: window.__aiSearchDryRunCalls || [],
      searchCalls: window.__aiSearchCalls || [],
      resultText: document.querySelector('.result-row')?.innerText || ''
    };
    if (window.__aiSearchOriginalFetch) {
      window.fetch = window.__aiSearchOriginalFetch;
      delete window.__aiSearchOriginalFetch;
    }
    return result;
  })()`);
  const aiSearchBody = JSON.parse(aiSearchState.searchCalls[0]?.body || "{}");
  if (!aiSearchBody.query?.includes("UI_SMOKE_SENTINEL")) {
    throw new Error(`AI free-text search submitted the wrong query: ${JSON.stringify(aiSearchState)}`);
  }
  aiSearchCoverage.dryRunCalls = aiSearchState.dryRunCalls.length;
  aiSearchCoverage.searchCalls = aiSearchState.searchCalls.length;
  await navigateSmokePage(window, "ai", ".ai-control-panel");
  const aiAttachmentCoverage = { attachmentButtonTriggeredInput: false, chipAdded: false, chipRemoved: false, pendingAction: false, uploadCalls: 0, uploadPayloadMatches: false, chipCleared: false };
  const aiAttachmentButtonRaw = await window.webContents.executeJavaScript(`(async () => {
    try {
      const inputs = Array.from(document.querySelectorAll('input.hidden-file-input[type="file"]'));
      const input = inputs[1];
      if (!input) return JSON.stringify({ ok: false, error: 'Missing AI hidden file input', inputCount: inputs.length });
      let clickCount = 0;
      const originalClick = input.click.bind(input);
      input.click = () => {
        clickCount += 1;
      };
      const button = document.querySelector('.ai-input-actions .button.secondary');
      if (!button) return JSON.stringify({ ok: false, error: 'Missing AI attachment button' });
      if (button.disabled) return JSON.stringify({ ok: false, error: 'AI attachment button disabled' });
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      input.click = originalClick;
      return JSON.stringify({ ok: true, clickCount });
    } catch (error) {
      return JSON.stringify({ ok: false, error: String(error?.message || error) });
    }
  })()`);
  const aiAttachmentButtonState = JSON.parse(aiAttachmentButtonRaw);
  aiAttachmentCoverage.attachmentButtonTriggeredInput = aiAttachmentButtonState.ok && aiAttachmentButtonState.clickCount === 1;
  if (!aiAttachmentCoverage.attachmentButtonTriggeredInput) {
    throw new Error(`AI attachment button did not trigger hidden file input: ${JSON.stringify(aiAttachmentButtonState)}`);
  }
  const injectAiAttachment = async () => {
    const raw = await window.webContents.executeJavaScript(`(() => {
      try {
        const input = Array.from(document.querySelectorAll('input.hidden-file-input[type="file"]'))[1];
        if (!input) return JSON.stringify({ ok: false, error: 'Missing AI hidden file input for injection' });
        if (typeof DataTransfer !== 'function') return JSON.stringify({ ok: false, error: 'DataTransfer unavailable for AI attachment' });
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(new File(['UI_SMOKE_AI_ATTACHMENT import through AI control'], 'ui-ai-attachment.txt', { type: 'text/plain' }));
        input.files = dataTransfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return JSON.stringify({ ok: true, fileCount: input.files?.length || 0 });
      } catch (error) {
        return JSON.stringify({ ok: false, error: String(error?.message || error) });
      }
    })()`);
    const state = JSON.parse(raw);
    if (!state.ok) throw new Error(`Unable to inject AI attachment: ${JSON.stringify(state)}`);
    await waitForWindowCondition(window, "Array.from(document.querySelectorAll('.ai-file-chip')).some((chip) => chip.innerText.includes('ui-ai-attachment.txt'))", "AI attachment chip appears");
  };
  await injectAiAttachment();
  aiAttachmentCoverage.chipAdded = true;
  await window.webContents.executeJavaScript(`(() => {
    const chip = Array.from(document.querySelectorAll('.ai-file-chip')).find((item) => item.innerText.includes('ui-ai-attachment.txt'));
    const removeButton = chip?.querySelector('button');
    if (!removeButton || removeButton.disabled) throw new Error('AI attachment remove button unavailable');
    removeButton.click();
    return true;
  })()`);
  await waitForWindowCondition(window, "!Array.from(document.querySelectorAll('.ai-file-chip')).some((chip) => chip.innerText.includes('ui-ai-attachment.txt'))", "AI attachment chip removed");
  aiAttachmentCoverage.chipRemoved = true;
  await injectAiAttachment();
  await window.webContents.executeJavaScript(`(() => {
    window.__aiImportDryRunCalls = [];
    window.__aiImportUploadCalls = [];
    window.__aiImportOriginalFetch = window.__aiImportOriginalFetch || window.fetch.bind(window);
    const originalFetch = window.__aiImportOriginalFetch;
    window.fetch = async (input, init = {}) => {
      const targetUrl = typeof input === 'string' ? input : input.url;
      const method = String(init.method || 'GET').toUpperCase();
      if (method === 'POST' && /\\/api\\/ai\\/tools\\/dry-run$/.test(targetUrl)) {
        const response = await originalFetch(input, init);
        window.__aiImportDryRunCalls.push({ method, url: targetUrl, body: typeof init.body === 'string' ? init.body : '' });
        return response;
      }
      if (method === 'POST' && /\\/api\\/collections\\/[^/]+\\/upload-jobs$/.test(targetUrl)) {
        const form = init.body instanceof FormData ? init.body : null;
        window.__aiImportUploadCalls.push({
          method,
          url: targetUrl,
          files: form ? form.getAll('files').map((file) => file.name || String(file)) : []
        });
      }
      return originalFetch(input, init);
    };
    const button = document.querySelector('.ai-control-panel [data-smoke-command="documents.import"]');
    if (!button) throw new Error('AI import quick command missing');
    if (button.disabled) throw new Error('AI import quick command disabled');
    button.click();
    return true;
  })()`);
  await waitForWindowCondition(window, "(window.__aiImportDryRunCalls || []).length === 1 && Boolean(document.querySelector('[data-testid=\"ai-pending-action\"]'))", "AI import quick pending action");
  aiAttachmentCoverage.pendingAction = true;
  await clickWindowButton(window, "确认执行", "[data-testid=\"ai-pending-action\"]");
  await waitForWindowCondition(window, "Boolean(document.querySelector('.processing-risk-dialog'))", "AI import processing risk confirmation");
  const aiImportGuard = await window.webContents.executeJavaScript(`(() => ({ uploadCalls: window.__aiImportUploadCalls || [] }))()`);
  if (aiImportGuard.uploadCalls.length !== 0) throw new Error(`AI import bypassed processing risk confirmation: ${JSON.stringify(aiImportGuard)}`);
  await clickWindowButton(window, "确认继续", ".processing-risk-dialog");
  await waitForWindowCondition(window, "(window.__aiImportUploadCalls || []).length === 1 && !document.querySelector('.processing-risk-dialog')", "AI import upload request");
  await waitForWindowCondition(window, "!Array.from(document.querySelectorAll('.ai-file-chip')).some((chip) => chip.innerText.includes('ui-ai-attachment.txt'))", "AI attachment chip cleared after import");
  const aiImportState = await window.webContents.executeJavaScript(`(() => {
    const result = {
      dryRunCalls: window.__aiImportDryRunCalls || [],
      uploadCalls: window.__aiImportUploadCalls || [],
      chipText: Array.from(document.querySelectorAll('.ai-file-chip')).map((chip) => chip.innerText).join('\\n')
    };
    if (window.__aiImportOriginalFetch) {
      window.fetch = window.__aiImportOriginalFetch;
      delete window.__aiImportOriginalFetch;
    }
    return result;
  })()`);
  aiAttachmentCoverage.uploadCalls = aiImportState.uploadCalls.length;
  aiAttachmentCoverage.uploadPayloadMatches = aiImportState.dryRunCalls.map((call) => call.body).join("\n").includes("documents.import")
    && aiImportState.uploadCalls[0]?.files?.includes("ui-ai-attachment.txt");
  aiAttachmentCoverage.chipCleared = !aiImportState.chipText.includes("ui-ai-attachment.txt");
  if (
    aiAttachmentCoverage.uploadCalls !== 1
    || !aiAttachmentCoverage.uploadPayloadMatches
    || !aiAttachmentCoverage.chipCleared
  ) {
    throw new Error(`AI attachment import coverage failed: ${JSON.stringify(aiImportState)}`);
  }
  await clickWindowButton(window, "策略/审计", ".ai-control-panel");
  await waitForWindowCondition(window, "Boolean(document.querySelector('[data-testid=\"ai-policy-panel\"]'))", "AI policy panel opened");
  await clickWindowButton(window, "刷新策略", "[data-testid=\"ai-policy-panel\"]");
  await waitForWindowCondition(window, "document.querySelectorAll('[data-testid=\"ai-tool-card\"]').length >= 8", "AI policy tools loaded");
  await clickWindowButton(window, "刷新审计", "[data-testid=\"ai-policy-panel\"]");
  await waitForWindowCondition(window, "document.querySelector('[data-testid=\"ai-audit-list\"]')?.innerText.includes('config.save')", "AI audit records loaded");
  const aiPolicyState = await window.webContents.executeJavaScript(`(() => {
    const panelText = document.querySelector('[data-testid="ai-policy-panel"]')?.innerText || '';
    return {
      toolCards: document.querySelectorAll('[data-testid="ai-tool-card"]').length,
      auditRows: document.querySelectorAll('[data-testid="ai-audit-list"] article').length,
      auditText: panelText,
      hasSecret: /ui-smoke-anything-key|ui-smoke-cloud-ocr-key|secret/i.test(panelText)
    };
  })()`);
  if (aiPolicyState.toolCards < 8 || aiPolicyState.auditRows < 1 || aiPolicyState.hasSecret) {
    throw new Error(`AI policy/audit panel did not load safely: ${JSON.stringify(aiPolicyState)}`);
  }
  aiPolicyCoverage.toolCards = aiPolicyState.toolCards;
  aiPolicyCoverage.auditRows = aiPolicyState.auditRows;
  aiPolicyCoverage.auditHasSecret = aiPolicyState.hasSecret;
  await navigateSmokePage(window, "search", ".search-panel");
  await window.webContents.executeJavaScript(`(() => {
    const setNativeValue = (element, value) => {
      const setter = Object.getOwnPropertyDescriptor(element.constructor.prototype, 'value')?.set;
      setter.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const input = document.querySelector('.search-row input:not(.topk)');
    setNativeValue(input, 'UI_SMOKE_SENTINEL');
    const searchButton = Array.from(document.querySelectorAll('button')).find((button) => button.innerText.trim() === '检索');
    if (!searchButton || searchButton.disabled) throw new Error('Search button unavailable');
    searchButton.click();
  })()`);
  await waitForWindowCondition(window, "document.querySelector('.result-row')?.innerText.includes('ui-smoke-note.txt')", "search result");
  searchDetailCoverage.hasSearchResult = true;
  await waitForWindowCondition(window, "Boolean(document.querySelector('.search-panel .search-row .button.secondary:not(:disabled)'))", "citation copy button enabled");
  const citationCopyState = await window.webContents.executeJavaScript(`(async () => {
    window.__citationCopyCommands = [];
    window.__citationOriginalExecCommand = document.execCommand;
    document.execCommand = (command) => {
      const textareas = Array.from(document.querySelectorAll('textarea'));
      window.__citationCopyCommands.push({
        command,
        text: document.activeElement?.value || textareas[textareas.length - 1]?.value || ''
      });
      return command === 'copy';
    };
    const button = document.querySelector('.search-panel .search-row .button.secondary');
    if (!button || button.disabled) return { ok: false, error: 'citation copy button unavailable' };
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const result = {
      ok: true,
      commands: window.__citationCopyCommands,
      toast: document.querySelector('.toast')?.innerText || ''
    };
    document.execCommand = window.__citationOriginalExecCommand;
    delete window.__citationOriginalExecCommand;
    return result;
  })()`);
  citationCopyCoverage.calls = citationCopyState.commands?.length || 0;
  citationCopyCoverage.copiedTextMatches = Boolean(
    citationCopyState.commands?.[0]?.text.includes("ui-smoke-note.txt")
    && citationCopyState.commands?.[0]?.text.includes("#1")
    && citationCopyState.commands?.[0]?.text.includes("UI_SMOKE_SENTINEL")
  );
  if (!citationCopyState.ok || citationCopyCoverage.calls !== 1 || !citationCopyCoverage.copiedTextMatches) {
    throw new Error(`Citation copy coverage failed: ${JSON.stringify(citationCopyState)}`);
  }
  uiSmokeCheckpoint("citation copy button clicked");
  await waitForWindowCondition(window, "Boolean(Array.from(document.querySelectorAll('.result-row button')).find((button) => button.innerText.trim() === '打开' && !button.disabled))", "search result open button enabled");
  await clickWindowButton(window, "打开", ".result-row");
  await waitForWindowCondition(window, "document.querySelector('.document-detail-panel')?.innerText.includes('ui-smoke-note.txt')", "document detail opened");
  searchDetailCoverage.hasDocumentDetail = true;
  await waitForWindowCondition(window, "Array.from(document.querySelectorAll('.document-detail-panel button')).some((button) => button.innerText.trim() === '清理 AnythingLLM (1)')", "AnythingLLM cleanup button");
  await window.webContents.executeJavaScript(`(() => {
    window.__anythingCleanupCalls = [];
    window.__anythingCleanupOriginalFetch = window.__anythingCleanupOriginalFetch || window.fetch.bind(window);
    const originalFetch = window.__anythingCleanupOriginalFetch;
    window.fetch = async (input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      const method = String(init.method || 'GET').toUpperCase();
      if (method !== 'GET' && /\\/api\\/collections\\/[^/]+\\/documents\\/[^/]+\\/retry-anythingllm-cleanup$/.test(url)) window.__anythingCleanupCalls.push({ method, url });
      return originalFetch(input, init);
    };
    return true;
  })()`);
  await clickWindowButton(window, "清理 AnythingLLM (1)", ".document-detail-panel");
  await waitForWindowCondition(window, "Boolean(document.querySelector('.anything-cleanup-dialog'))", "AnythingLLM cleanup confirmation");
  const cleanupGuard = await window.webContents.executeJavaScript(`(() => ({ calls: window.__anythingCleanupCalls || [], dialog: document.querySelector('.anything-cleanup-dialog')?.innerText || '' }))()`);
  if (cleanupGuard.calls.length !== 0 || !cleanupGuard.dialog.includes("清理 AnythingLLM 远端记录")) throw new Error(`AnythingLLM cleanup bypassed confirmation: ${JSON.stringify(cleanupGuard)}`);
  await clickWindowButton(window, "取消", ".anything-cleanup-dialog");
  await waitForWindowCondition(window, "!document.querySelector('.anything-cleanup-dialog')", "AnythingLLM cleanup confirmation cancelled");
  await window.webContents.executeJavaScript(`(() => {
    if (window.__anythingCleanupOriginalFetch) window.fetch = window.__anythingCleanupOriginalFetch;
    return true;
  })()`);
  await navigateSmokePage(window, "anythingllm", "#section-anythingllm");
  await clickWindowButton(window, "刷新队列", "[data-testid=\"anything-cleanup-queue\"]");
  await waitForWindowCondition(window, "document.querySelector('[data-testid=\"anything-cleanup-queue\"]')?.innerText.includes('ui-smoke-orphan.pdf')", "global AnythingLLM cleanup queue entry");
  await waitForWindowCondition(window, "document.querySelector('[data-testid=\"anything-cleanup-queue\"]')?.innerText.includes('缺少 API key')", "global AnythingLLM cleanup queue missing-key badge");
  await waitForWindowCondition(window, "!document.querySelector('[data-testid=\"cleanup-queue-retry-all\"]')?.disabled", "global AnythingLLM cleanup queue retry button enabled");
  await installPostProbe(window, "__anythingCleanupQueueCalls", ["\\/api\\/anythingllm\\/cleanup-queue\\/retry$"]);
  await clickWindowButton(window, "重试全部", "[data-testid=\"anything-cleanup-queue\"]");
  await waitForWindowCondition(window, "Boolean(document.querySelector('.anything-cleanup-queue-dialog'))", "global AnythingLLM cleanup queue confirmation");
  const cleanupQueueGuard = await window.webContents.executeJavaScript(`(() => ({ calls: window.__anythingCleanupQueueCalls || [], dialog: document.querySelector('.anything-cleanup-queue-dialog')?.innerText || '' }))()`);
  if (cleanupQueueGuard.calls.length !== 0 || !cleanupQueueGuard.dialog.includes("重试 AnythingLLM 清理队列")) throw new Error(`AnythingLLM cleanup queue retry bypassed confirmation: ${JSON.stringify(cleanupQueueGuard)}`);
  await clickWindowButton(window, "取消", ".anything-cleanup-queue-dialog");
  await waitForWindowCondition(window, "!document.querySelector('.anything-cleanup-queue-dialog')", "global AnythingLLM cleanup queue confirmation cancelled");
  const singleCleanupRetryGuard = await window.webContents.executeJavaScript(`(() => {
    const entry = document.querySelector('[data-testid="anything-cleanup-queue"] .cleanup-queue-entry');
    const button = entry?.querySelector('button.mini-action.danger');
    if (!entry || !button || button.disabled) return { ok: false, error: 'single cleanup retry button unavailable' };
    const entryId = entry.getAttribute('data-cleanup-entry-id') || '';
    button.click();
    return {
      ok: true,
      entryId,
      callsBeforeClick: (window.__anythingCleanupQueueCalls || []).length
    };
  })()`);
  if (!singleCleanupRetryGuard.ok) {
    throw new Error(`Unable to click single cleanup queue retry: ${JSON.stringify(singleCleanupRetryGuard)}`);
  }
  await waitForWindowCondition(window, "Boolean(document.querySelector('.anything-cleanup-queue-dialog'))", "single AnythingLLM cleanup queue confirmation");
  const singleCleanupRetryDialog = await window.webContents.executeJavaScript(`(() => ({
    calls: window.__anythingCleanupQueueCalls || [],
    dialog: document.querySelector('.anything-cleanup-queue-dialog')?.innerText || ''
  }))()`);
  cleanupQueueSingleRetryCoverage.dialog = Boolean(singleCleanupRetryDialog.dialog);
  cleanupQueueSingleRetryCoverage.callsBeforeConfirm = singleCleanupRetryDialog.calls.length;
  if (cleanupQueueSingleRetryCoverage.callsBeforeConfirm !== 0 || !cleanupQueueSingleRetryCoverage.dialog) {
    throw new Error(`Single cleanup queue retry bypassed confirmation: ${JSON.stringify(singleCleanupRetryDialog)}`);
  }
  await window.webContents.executeJavaScript(`(() => {
    const confirmButton = document.querySelector('.anything-cleanup-queue-dialog .button.danger');
    if (!confirmButton || confirmButton.disabled) throw new Error('Single cleanup queue confirm button unavailable');
    confirmButton.click();
    return true;
  })()`);
  await waitForWindowCondition(window, "(window.__anythingCleanupQueueCalls || []).length === 1", "single cleanup queue retry post request");
  const singleCleanupRetryCalls = await readPostProbe(window, "__anythingCleanupQueueCalls");
  const singleCleanupRetryBody = JSON.parse(singleCleanupRetryCalls[0]?.body || "{}");
  cleanupQueueSingleRetryCoverage.submitCalls = singleCleanupRetryCalls.length;
  cleanupQueueSingleRetryCoverage.payloadMatches = Array.isArray(singleCleanupRetryBody.ids)
    && singleCleanupRetryBody.ids.length === 1
    && singleCleanupRetryBody.ids[0] === singleCleanupRetryGuard.entryId;
  if (!cleanupQueueSingleRetryCoverage.payloadMatches) {
    throw new Error(`Single cleanup queue retry submitted the wrong payload: ${JSON.stringify({ singleCleanupRetryGuard, singleCleanupRetryCalls })}`);
  }
  await waitForWindowCondition(
    window,
    "!document.querySelector('.anything-cleanup-queue-dialog') && !document.querySelector('.sidebar-status .icon-button')?.disabled",
    "single cleanup queue retry completed",
  );
  uiSmokeCheckpoint("single cleanup queue retry confirmed");
  await restorePostProbe(window);
  await navigateSmokePage(window, "jobs", ".task-mini");
  await window.webContents.executeJavaScript(`(() => {
    window.__taskCancelCalls = [];
    window.__taskCancelStatus = 'running';
    window.__taskCancelOriginalFetch = window.__taskCancelOriginalFetch || window.fetch.bind(window);
    const originalFetch = window.__taskCancelOriginalFetch;
    window.fetch = async (input, init = {}) => {
      const targetUrl = typeof input === 'string' ? input : input.url;
      const method = String(init.method || 'GET').toUpperCase();
      if (method === 'GET' && /\\/api\\/jobs(?:\\?|$)/.test(targetUrl)) {
        return new Response(JSON.stringify({
          jobs: [{
            id: 'ui-smoke-cancel-job',
            kind: 'upload',
            collectionSlug: ${JSON.stringify(collection.slug)},
            fileName: 'ui-smoke-cancel-job.txt',
            status: window.__taskCancelStatus,
            phase: window.__taskCancelStatus === 'cancelled' ? 'cancelled' : 'embedding',
            progress: window.__taskCancelStatus === 'cancelled' ? 1 : 0.42,
            message: window.__taskCancelStatus === 'cancelled' ? 'cancelled by UI smoke' : 'running for UI smoke',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            cancelRequested: false
          }]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (method === 'POST' && /\\/api\\/jobs\\/ui-smoke-cancel-job\\/cancel$/.test(targetUrl)) {
        window.__taskCancelStatus = 'cancelled';
        window.__taskCancelCalls.push({ method, url: targetUrl });
        return new Response(JSON.stringify({
          job: {
            id: 'ui-smoke-cancel-job',
            kind: 'upload',
            collectionSlug: ${JSON.stringify(collection.slug)},
            fileName: 'ui-smoke-cancel-job.txt',
            status: 'cancelled',
            phase: 'cancelled',
            progress: 1,
            message: 'cancelled by UI smoke',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            cancelRequested: true
          }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return originalFetch(input, init);
    };
    const refreshButton = document.querySelector('.sidebar-status .icon-button');
    if (!refreshButton || refreshButton.disabled) throw new Error('Sidebar refresh button unavailable for task cancel smoke');
    refreshButton.click();
    return true;
  })()`);
  await waitForWindowCondition(window, "document.querySelector('.task-mini')?.innerText.includes('ui-smoke-cancel-job.txt')", "task mini fake running job");
  await window.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('.task-mini .mini-action.invert');
    if (!button || button.disabled) throw new Error('Task cancel button unavailable');
    button.click();
    return true;
  })()`);
  await waitForWindowCondition(window, "(window.__taskCancelCalls || []).length === 1 && document.querySelector('.task-mini')?.innerText.includes('cancelled by UI smoke')", "task cancel post request");
  const taskCancelState = await window.webContents.executeJavaScript(`(() => {
    const result = {
      calls: window.__taskCancelCalls || [],
      taskText: document.querySelector('.task-mini')?.innerText || ''
    };
    if (window.__taskCancelOriginalFetch) {
      window.fetch = window.__taskCancelOriginalFetch;
      delete window.__taskCancelOriginalFetch;
    }
    return result;
  })()`);
  taskCancelCoverage.calls = taskCancelState.calls.length;
  taskCancelCoverage.updated = taskCancelState.taskText.includes('cancelled by UI smoke');

  await installPostProbe(window, "__onboardingResetCalls", ["\\/api\\/onboarding\\/reset$"]);
  const onboardingSidebarResetState = await window.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('.first-run .first-run-actions button[title]');
    if (!button || button.disabled) return { ok: false, error: 'sidebar onboarding reset button unavailable' };
    button.click();
    return { ok: true };
  })()`);
  if (!onboardingSidebarResetState.ok) {
    throw new Error(`Unable to click sidebar onboarding reset button: ${JSON.stringify(onboardingSidebarResetState)}`);
  }
  await waitForWindowCondition(window, "(window.__onboardingResetCalls || []).length === 1 && Boolean(document.querySelector('.onboarding-dialog'))", "sidebar onboarding reset opened wizard");
  const onboardingResetState = await window.webContents.executeJavaScript(`(() => {
    const footerButtons = Array.from(document.querySelectorAll('.onboarding-dialog .onboarding-footer button'));
    const finishButton = footerButtons[2];
    const resetButton = footerButtons[0];
    return {
      calls: window.__onboardingResetCalls || [],
      reopened: Boolean(document.querySelector('.onboarding-dialog')),
      finishDisabled: Boolean(finishButton?.disabled),
      resetDisabled: Boolean(resetButton?.disabled)
    };
  })()`);
  onboardingResetCoverage.sidebarCalls = onboardingResetState.calls.length;
  onboardingResetCoverage.reopened = onboardingResetState.reopened;
  onboardingResetCoverage.finishDisabled = onboardingResetState.finishDisabled;
  if (!onboardingResetCoverage.reopened || !onboardingResetCoverage.finishDisabled) {
    throw new Error(`Onboarding sidebar reset did not restore wizard state: ${JSON.stringify(onboardingResetState)}`);
  }
  await window.webContents.executeJavaScript(`(() => {
    const resetButton = document.querySelector('.onboarding-dialog .onboarding-footer button');
    if (!resetButton || resetButton.disabled) throw new Error('Onboarding dialog reset button unavailable');
    resetButton.click();
    return true;
  })()`);
  await waitForWindowCondition(window, "(window.__onboardingResetCalls || []).length === 2 && Boolean(document.querySelector('.onboarding-dialog'))", "dialog onboarding reset request");
  await window.webContents.executeJavaScript(`(() => {
    const footerButtons = Array.from(document.querySelectorAll('.onboarding-dialog .onboarding-footer button'));
    const closeButton = footerButtons[1];
    if (!closeButton || closeButton.disabled) throw new Error('Onboarding close button unavailable after reset');
    closeButton.click();
    return true;
  })()`);
  await waitForWindowCondition(window, "!document.querySelector('.onboarding-dialog')", "onboarding dialog closed after reset coverage");
  const onboardingResetCalls = await readPostProbe(window, "__onboardingResetCalls");
  onboardingResetCoverage.sidebarCalls = Math.min(onboardingResetCalls.length, 1);
  onboardingResetCoverage.dialogCalls = Math.max(onboardingResetCalls.length - 1, 0);
  onboardingResetCoverage.closed = true;
  await restorePostProbe(window);
  uiSmokeCheckpoint("onboarding reset buttons clicked");

  const finalState = await window.webContents.executeJavaScript(`(() => ({
    onboardingClosed: !document.querySelector('.onboarding-dialog'),
    hasSearchResult: Boolean(document.querySelector('.result-row')),
    hasDocumentDetail: Boolean(document.querySelector('.document-detail-panel')),
    batchDeleteRemoved: !Array.from(document.querySelectorAll('.doc-row')).some((row) => row.innerText.includes('ui-smoke-delete.txt')),
    aiDryRunCalls: window.__aiDryRunCalls?.length ?? 0,
    aiBlockedDirectCalls: window.__aiBlockedDirectCalls?.length ?? 0,
    aiToolCards: document.querySelectorAll('[data-testid="ai-tool-card"]').length,
    aiAuditRows: document.querySelectorAll('[data-testid="ai-audit-list"] article').length,
    aiAuditHasSecret: /ui-smoke-anything-key|ui-smoke-cloud-ocr-key|secret/i.test(document.querySelector('[data-testid="ai-policy-panel"]')?.innerText || ''),
    mcpResourceRows: document.querySelectorAll('[data-testid="mcp-resource-list"] .mcp-resource-row').length,
    copyDefaultCalls: window.__copyDefaultCalls?.length ?? 0,
    desktopActionCallsBeforeConfirm: window.__desktopActionCalls?.length ?? 0,
    ocrTestCallsBeforeConfirm: window.__ocrTestCalls?.length ?? 0,
    syncCallsBeforeConfirm: window.__syncCallsBeforeConfirm ?? 0,
    syncCallsAfterConfirm: window.__syncCallsAfterConfirm ?? 0,
    cleanupCallsBeforeConfirm: window.__anythingCleanupCalls?.length ?? 0,
    cleanupQueueCallsBeforeConfirm: window.__anythingCleanupQueueCalls?.length ?? 0,
    anythingConnectionTestCalls: window.__anythingButtonCalls?.filter((call) => call.kind === 'test-anythingllm').length ?? 0,
    anythingDesktopTestCalls: window.__anythingButtonCalls?.filter((call) => call.kind === 'desktop-test').length ?? 0,
    installerDownloadCalls: window.__desktopActionCalls?.filter((call) => call.kind === 'download-installer').length ?? 0,
    installerLaunchCallsAfterConfirm: window.__desktopActionCalls?.filter((call) => call.kind === 'launch-installer').length ?? 0,
    riskUploadCalls: window.__riskUploadCalls?.length ?? 0,
    riskImportCalls: window.__riskImportCalls?.length ?? 0,
    riskImportSelectedCalls: window.__riskImportSelectedCalls?.length ?? 0,
    riskReprocessCalls: window.__riskReprocessCalls?.length ?? 0,
    riskBatchReprocessCalls: window.__riskBatchReprocessCalls?.length ?? 0,
    aiSearchDryRunCalls: window.__aiSearchDryRunCalls?.length ?? 0,
    aiSearchCalls: window.__aiSearchCalls?.length ?? 0,
    singleDeleteCalls: window.__singleDeleteCalls?.length ?? 0,
    taskCancelCalls: window.__taskCancelCalls?.length ?? 0,
    nativeDialogCalls: window.__nativeDialogCalls?.length ?? 0,
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    visibleDocumentRows: document.querySelectorAll('.doc-row').length,
    firstRunText: document.querySelector('.first-run')?.innerText || ''
  }))()`);
  finalState.hasSearchResult = searchDetailCoverage.hasSearchResult;
  finalState.hasDocumentDetail = searchDetailCoverage.hasDocumentDetail;
  finalState.batchDeleteRemoved = batchDeleteCoverage.removed;
  finalState.mcpResourceRows = mcpResourceUiState.rows;
  finalState.riskUploadCalls = processingRiskCoverage.upload;
  finalState.riskImportCalls = processingRiskCoverage.importPaths;
  finalState.riskImportSelectedCalls = processingRiskCoverage.importSelected;
  finalState.riskReprocessCalls = processingRiskCoverage.reprocess;
  finalState.riskBatchReprocessCalls = processingRiskCoverage.batchReprocess;
  finalState.aiToolCards = aiPolicyCoverage.toolCards;
  finalState.aiAuditRows = aiPolicyCoverage.auditRows;
  finalState.aiAuditHasSecret = aiPolicyCoverage.auditHasSecret;
  finalState.aiSafetyPrecheckDryRunCalls = aiSafetyPrecheckCoverage.dryRunCalls;
  finalState.aiSafetyPrecheckDirectCalls = aiSafetyPrecheckCoverage.blockedDirectCalls;
  finalState.aiSafetyPrecheckRequiresConfirmation = aiSafetyPrecheckCoverage.requiresConfirmation;
  finalState.aiSearchDryRunCalls = aiSearchCoverage.dryRunCalls;
  finalState.aiSearchCalls = aiSearchCoverage.searchCalls;
  finalState.aiAttachmentButtonTriggeredInput = aiAttachmentCoverage.attachmentButtonTriggeredInput;
  finalState.aiAttachmentChipAdded = aiAttachmentCoverage.chipAdded;
  finalState.aiAttachmentChipRemoved = aiAttachmentCoverage.chipRemoved;
  finalState.aiAttachmentPendingAction = aiAttachmentCoverage.pendingAction;
  finalState.aiAttachmentUploadCalls = aiAttachmentCoverage.uploadCalls;
  finalState.aiAttachmentUploadPayloadMatches = aiAttachmentCoverage.uploadPayloadMatches;
  finalState.aiAttachmentChipCleared = aiAttachmentCoverage.chipCleared;
  finalState.visibleImportButtonTriggeredInput = visibleImportButtonCoverage.clickTriggeredInput;
  finalState.singleDeleteCalls = documentDeleteCoverage.calls;
  finalState.singleDeleteDisabledUntilNameMatch = documentDeleteCoverage.disabledUntilNameMatch;
  finalState.singleDeleteRemoved = documentDeleteCoverage.removed;
  finalState.citationCopyCalls = citationCopyCoverage.calls;
  finalState.citationCopyMatches = citationCopyCoverage.copiedTextMatches;
  finalState.cleanupQueueCallsBeforeConfirm = cleanupQueueSingleRetryCoverage.callsBeforeConfirm;
  finalState.cleanupQueueSingleRetryDialog = cleanupQueueSingleRetryCoverage.dialog;
  finalState.cleanupQueueSingleRetrySubmitCalls = cleanupQueueSingleRetryCoverage.submitCalls;
  finalState.cleanupQueueSingleRetryPayloadMatches = cleanupQueueSingleRetryCoverage.payloadMatches;
  finalState.onboardingResetSidebarCalls = onboardingResetCoverage.sidebarCalls;
  finalState.onboardingResetDialogCalls = onboardingResetCoverage.dialogCalls;
  finalState.onboardingResetReopened = onboardingResetCoverage.reopened;
  finalState.onboardingResetFinishDisabled = onboardingResetCoverage.finishDisabled;
  finalState.onboardingResetClosed = onboardingResetCoverage.closed;
  finalState.taskCancelCalls = taskCancelCoverage.calls;
  finalState.taskCancelUpdated = taskCancelCoverage.updated;
  finalState.configControlSaveCalls = configControlCoverage.saveCalls;
  finalState.configControlPayloadMatches = configControlCoverage.payloadMatches;
  finalState.configControlPersisted = configControlCoverage.persisted;
  finalState.workspaceChipClicked = workspaceChipCoverage.clicked;
  finalState.workspaceChipPersisted = workspaceChipCoverage.persisted;
  finalState.workspaceChipsClearedAfterDraftChange = workspaceChipCoverage.clearedAfterDraftChange;
  finalState.anythingConnectionTestCalls = anythingButtonCoverage.connectionTestCalls;
  finalState.anythingDesktopTestCalls = anythingButtonCoverage.desktopTestCalls;
  finalState.anythingEnvironmentRefreshCalls = anythingButtonCoverage.environmentRefreshCalls;
  finalState.anythingEnvironmentRefreshUpdatedInput = anythingButtonCoverage.environmentRefreshUpdatedInput;
  finalState.anythingExePathSaveCalls = anythingButtonCoverage.exePathSaveCalls;
  finalState.anythingExePathClearCalls = anythingButtonCoverage.exePathClearCalls;
  finalState.anythingExePathPersisted = anythingButtonCoverage.exePathPersisted;
  finalState.anythingExePathCleared = anythingButtonCoverage.exePathCleared;
  finalState.desktopActionCallsBeforeConfirm = anythingButtonCoverage.desktopSideEffectCallsBeforeConfirm;
  finalState.installerDownloadCalls = anythingButtonCoverage.installerDownloadCalls;
  finalState.installerLaunchCallsAfterConfirm = anythingButtonCoverage.installerLaunchCallsAfterConfirm;
  finalState.ocrTestCallsBeforeConfirm = ocrTestCoverage.callsBeforeConfirm;
  finalState.ocrTestCallsAfterConfirm = ocrTestCoverage.callsAfterConfirm;
  finalState.ocrTestPayloadMatches = ocrTestCoverage.payloadMatches;
  finalState.embeddingConfigButtonCalls = embeddingTestCoverage.configButtonCalls;
  finalState.embeddingConfigPayloadMatches = embeddingTestCoverage.configPayloadMatches;
  finalState.embeddingAiQuickCalls = embeddingTestCoverage.aiQuickCalls;
  finalState.embeddingAiPayloadMatches = embeddingTestCoverage.aiPayloadMatches;
  if (finalState.horizontalOverflow) throw new Error("Final desktop layout has horizontal overflow.");
  if (finalState.nativeDialogCalls !== 0) throw new Error(`Native dialogs were called during UI smoke: ${finalState.nativeDialogCalls}`);
  if (!finalState.batchDeleteRemoved) throw new Error("UI smoke batch delete did not remove the delete document.");
  if (finalState.aiDryRunCalls < 3 || finalState.aiBlockedDirectCalls !== 0) throw new Error(`AI command guard failed: ${JSON.stringify(finalState)}`);
  if (finalState.aiSafetyPrecheckDryRunCalls !== 1 || finalState.aiSafetyPrecheckDirectCalls !== 0 || !finalState.aiSafetyPrecheckRequiresConfirmation) throw new Error(`AI safety precheck coverage failed: ${JSON.stringify(finalState)}`);
  if (finalState.aiSearchDryRunCalls !== 1 || finalState.aiSearchCalls !== 1) throw new Error(`AI free-text search coverage failed: ${JSON.stringify(finalState)}`);
  if (
    !finalState.aiAttachmentButtonTriggeredInput
    || !finalState.aiAttachmentChipAdded
    || !finalState.aiAttachmentChipRemoved
    || !finalState.aiAttachmentPendingAction
    || finalState.aiAttachmentUploadCalls !== 1
    || !finalState.aiAttachmentUploadPayloadMatches
    || !finalState.aiAttachmentChipCleared
  ) throw new Error(`AI attachment import coverage failed: ${JSON.stringify(finalState)}`);
  if (!finalState.visibleImportButtonTriggeredInput) throw new Error(`Visible import button coverage failed: ${JSON.stringify(finalState)}`);
  if (finalState.aiToolCards < 8 || finalState.aiAuditRows < 1 || finalState.aiAuditHasSecret) throw new Error(`AI policy/audit panel coverage failed: ${JSON.stringify(finalState)}`);
  if (finalState.mcpResourceRows !== 7) throw new Error(`MCP resource UI coverage failed: ${JSON.stringify(finalState)}`);
  if (finalState.copyDefaultCalls !== 1) throw new Error(`Copy-default confirmation coverage failed: ${JSON.stringify(finalState)}`);
  if (finalState.desktopActionCallsBeforeConfirm !== 0) throw new Error(`Desktop action confirmation guard failed: ${JSON.stringify(finalState)}`);
  if (finalState.anythingConnectionTestCalls !== 1 || finalState.anythingDesktopTestCalls !== 1) {
    throw new Error(`AnythingLLM test buttons did not submit exactly one request each: ${JSON.stringify(finalState)}`);
  }
  if (finalState.anythingEnvironmentRefreshCalls !== 1 || !finalState.anythingEnvironmentRefreshUpdatedInput) {
    throw new Error(`AnythingLLM environment refresh coverage failed: ${JSON.stringify(finalState)}`);
  }
  if (
    finalState.anythingExePathSaveCalls !== 1
    || finalState.anythingExePathClearCalls !== 1
    || !finalState.anythingExePathPersisted
    || !finalState.anythingExePathCleared
  ) {
    throw new Error(`AnythingLLM exe-path save/clear coverage failed: ${JSON.stringify(finalState)}`);
  }
  if (finalState.installerDownloadCalls !== 2 || finalState.installerLaunchCallsAfterConfirm !== 2) {
    throw new Error(`AnythingLLM installer buttons did not submit the expected request sequence: ${JSON.stringify(finalState)}`);
  }
  if (
    finalState.ocrTestCallsBeforeConfirm !== 0
    || finalState.syncCallsBeforeConfirm !== 0
    || finalState.cleanupCallsBeforeConfirm !== 0
    || finalState.cleanupQueueCallsBeforeConfirm !== 0
  ) throw new Error(`Risk action confirmation guard failed: ${JSON.stringify(finalState)}`);
  if (finalState.ocrTestCallsAfterConfirm !== 1 || !finalState.ocrTestPayloadMatches) throw new Error(`OCR test confirmation coverage failed: ${JSON.stringify(finalState)}`);
  if (
    finalState.embeddingConfigButtonCalls !== 1
    || !finalState.embeddingConfigPayloadMatches
    || finalState.embeddingAiQuickCalls !== 1
    || !finalState.embeddingAiPayloadMatches
  ) throw new Error(`Embedding test coverage failed: ${JSON.stringify(finalState)}`);
  if (
    !finalState.cleanupQueueSingleRetryDialog
    || finalState.cleanupQueueSingleRetrySubmitCalls !== 1
    || !finalState.cleanupQueueSingleRetryPayloadMatches
  ) throw new Error(`Single cleanup queue retry coverage failed: ${JSON.stringify(finalState)}`);
  if (finalState.syncCallsAfterConfirm !== 1) throw new Error(`AnythingLLM sync confirmation did not submit exactly one request: ${JSON.stringify(finalState)}`);
  if (!finalState.workspaceChipClicked || !finalState.workspaceChipPersisted || !finalState.workspaceChipsClearedAfterDraftChange) throw new Error(`Workspace chip guard failed: ${JSON.stringify(finalState)}`);
  if (finalState.citationCopyCalls !== 1 || !finalState.citationCopyMatches) throw new Error(`Citation copy coverage failed: ${JSON.stringify(finalState)}`);
  if (!finalState.singleDeleteDisabledUntilNameMatch || finalState.singleDeleteCalls !== 1 || !finalState.singleDeleteRemoved) throw new Error(`Single-document delete coverage failed: ${JSON.stringify(finalState)}`);
  if (finalState.taskCancelCalls !== 1 || !finalState.taskCancelUpdated) throw new Error(`Task cancel coverage failed: ${JSON.stringify(finalState)}`);
  if (
    finalState.onboardingResetSidebarCalls !== 1
    || finalState.onboardingResetDialogCalls !== 1
    || !finalState.onboardingResetReopened
    || !finalState.onboardingResetFinishDisabled
    || !finalState.onboardingResetClosed
  ) throw new Error(`Onboarding reset coverage failed: ${JSON.stringify(finalState)}`);
  if (finalState.configControlSaveCalls !== 1 || !finalState.configControlPayloadMatches || !finalState.configControlPersisted) {
    throw new Error(`Config control save coverage failed: ${JSON.stringify(finalState)}`);
  }
  if (finalState.riskUploadCalls !== 1 || finalState.riskImportCalls !== 1 || finalState.riskImportSelectedCalls !== 1 || finalState.riskReprocessCalls !== 1 || finalState.riskBatchReprocessCalls !== 1) {
    throw new Error(`Processing-risk confirmation coverage failed: ${JSON.stringify(finalState)}`);
  }
  if (!finalState.hasSearchResult || !finalState.hasDocumentDetail) throw new Error("UI smoke did not reach search/detail state.");
  const payload = { ok: true, url, title: initial.title, collectionSlug: collection.slug, finalState };
  writeSmokeResult(payload);
  console.log(JSON.stringify(payload, null, 2));
  app.quit();
}

async function boot() {
  registerIpcHandlers();
  const url = await startLocalApi();
  if (process.env.VECTOR_FORGE_DATA_DIR_SMOKE === "1") {
    await runDataDirSmoke(url);
    return;
  }
  if (process.env.VECTOR_FORGE_UI_SMOKE === "1") {
    await runUiSmoke(url);
    return;
  }
  if (process.env.VECTOR_FORGE_DESKTOP_SMOKE === "1") {
    await runSmoke(url);
    return;
  }
  await createMainWindow(url);
}

app.whenReady()
  .then(boot)
  .catch((error) => {
    writeSmokeResult({ ok: false, error: error instanceof Error ? error.message : String(error) });
    console.error("[vector-forge-desktop] Fatal startup error", error);
    app.exit(1);
  });

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && appUrl) {
    void createMainWindow(appUrl);
  }
});

app.on("before-quit", closeApiServer);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
