import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const rootDir = process.cwd();
const tempDir = await mkdtemp(path.join(os.tmpdir(), "vector-forge-anythingllm-desktop-smoke-"));
const port = 61990;
const anythingPort = 61991;
const tsxCli = path.join(rootDir, "node_modules", "tsx", "dist", "cli.mjs");
const apiSecret = "desktop-smoke-anythingllm-secret";
const fakeExePath = path.join(tempDir, "AnythingLLM.exe");

type FetchResult = {
  response: Response;
  text: string;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown) {
  response.writeHead(statusCode, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function isAuthorized(request: IncomingMessage) {
  return request.headers.authorization === `Bearer ${apiSecret}`;
}

const fakeWorkspaces = [
  { id: 1, name: "Smoke Workspace", slug: "smoke-workspace" },
  { id: 2, name: "Reference Workspace", slug: "reference-workspace" },
];

const anythingServer = createServer((request, response) => {
  const route = request.url ?? "/";
  if (!isAuthorized(request)) {
    sendJson(response, 401, { error: "Unauthorized" });
    return;
  }
  if (request.method === "GET" && route === "/v1/auth") {
    sendJson(response, 200, { authenticated: true });
    return;
  }
  if (request.method === "GET" && route === "/v1/workspaces") {
    sendJson(response, 200, { workspaces: fakeWorkspaces });
    return;
  }
  sendJson(response, 404, { error: `Unhandled fake AnythingLLM route: ${request.method} ${route}` });
});

await new Promise<void>((resolve) => {
  anythingServer.listen(anythingPort, "127.0.0.1", () => resolve());
});

async function fetchRaw(route: string, init?: RequestInit): Promise<FetchResult> {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    ...init,
    headers: init?.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  return { response, text: await response.text() };
}

async function fetchJson<T>(route: string, init?: RequestInit) {
  const result = await fetchRaw(route, init);
  if (!result.response.ok) throw new Error(`${route} ${result.response.status}: ${result.text}`);
  return JSON.parse(result.text) as T;
}

async function waitForApi() {
  for (let i = 0; i < 40; i += 1) {
    try {
      return await fetchJson<{ ok: boolean }>("/api/health");
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw new Error("API did not become ready.");
}

await mkdir(tempDir, { recursive: true });
await writeFile(fakeExePath, "MZ fake AnythingLLM desktop smoke executable");

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

  const initialEnvironment = await fetchJson<{
    api: { apiKeyConfigured: boolean };
    desktop: { configuredExe: { configured: boolean; launchable: boolean } };
    installer: { folder: string; allowedHosts: string[] };
  }>("/api/anythingllm/environment");
  assert(initialEnvironment.api.apiKeyConfigured === false, "Initial environment unexpectedly reported an API key.");
  assert(initialEnvironment.desktop.configuredExe.configured === false, "Initial environment unexpectedly had a configured exe path.");
  assert(initialEnvironment.installer.folder.startsWith(tempDir), "Installer folder escaped the smoke data directory.");
  assert(initialEnvironment.installer.allowedHosts.includes("github.com"), "Installer allowlist did not include GitHub releases.");

  const rejectedExe = await fetchRaw("/api/anythingllm/exe-path", {
    method: "PUT",
    body: JSON.stringify({ exePath: process.execPath }),
  });
  assert(rejectedExe.response.status === 400, "Non-AnythingLLM executable path was accepted.");

  const savedExe = await fetchJson<{
    ok: boolean;
    executable: { path: string; exists: boolean; launchable: boolean };
  }>("/api/anythingllm/exe-path", {
    method: "PUT",
    body: JSON.stringify({ exePath: fakeExePath }),
  });
  assert(savedExe.ok === true, "Saving fake AnythingLLM exe path did not return ok.");
  assert(savedExe.executable.path === fakeExePath, "Saved executable path changed unexpectedly.");
  assert(savedExe.executable.exists === true, "Saved executable was not checked on disk.");
  assert(savedExe.executable.launchable === true, "Saved executable was not marked launchable.");

  const workspacesBeforeConfig = await fetchRaw("/api/anythingllm/workspaces");
  assert(workspacesBeforeConfig.response.status === 400, "Saved-config workspace read unexpectedly worked before API key config.");

  const draftWorkspaces = await fetchJson<{
    ok: boolean;
    apiKeyConfigured: boolean;
    workspaces: Array<{ id: number; name: string; slug: string }>;
  }>("/api/anythingllm/workspaces", {
    method: "POST",
    body: JSON.stringify({
      anythingllm: {
        enabled: true,
        baseUrl: `http://127.0.0.1:${anythingPort}`,
        apiKey: apiSecret,
        workspaceName: "Smoke Workspace",
        workspaceSlug: "smoke-workspace",
        desktopExePath: fakeExePath,
      },
    }),
  });
  const draftWorkspacesJson = JSON.stringify(draftWorkspaces);
  assert(draftWorkspaces.ok === true, "Draft-config workspaces endpoint did not return ok.");
  assert(draftWorkspaces.apiKeyConfigured === true, "Draft-config workspaces endpoint did not report configured API key.");
  assert(draftWorkspaces.workspaces.length === fakeWorkspaces.length, "Draft-config workspaces endpoint did not return fake workspaces.");
  assert(!draftWorkspacesJson.includes(apiSecret), "Draft-config workspaces response leaked the AnythingLLM API key.");

  await fetchJson("/api/config", {
    method: "PUT",
    body: JSON.stringify({
      anythingllm: {
        enabled: true,
        baseUrl: `http://127.0.0.1:${anythingPort}`,
        apiKey: apiSecret,
        workspaceName: "Smoke Workspace",
        workspaceSlug: "smoke-workspace",
        desktopExePath: fakeExePath,
      },
    }),
  });

  const tested = await fetchJson<{
    ok: boolean;
    api: { baseUrl: string; apiKeyConfigured: boolean; authenticated: boolean; ok: boolean };
    desktop: { ready: boolean; executable: { launchable: boolean } };
  }>("/api/anythingllm/test", { method: "POST", body: JSON.stringify({}) });
  const testedJson = JSON.stringify(tested);
  assert(tested.ok === true, "AnythingLLM desktop test did not pass with fake API and executable.");
  assert(tested.api.baseUrl === `http://127.0.0.1:${anythingPort}`, "Test response returned wrong base URL.");
  assert(tested.api.apiKeyConfigured === true, "Test response did not report configured API key.");
  assert(tested.api.authenticated === true && tested.api.ok === true, "Test response did not use the fake auth endpoint.");
  assert(tested.desktop.ready === true && tested.desktop.executable.launchable === true, "Test response did not include executable readiness.");
  assert(!testedJson.includes(apiSecret), "Test response leaked the AnythingLLM API key.");

  const workspaces = await fetchJson<{
    ok: boolean;
    apiKeyConfigured: boolean;
    workspaces: Array<{ id: number; name: string; slug: string }>;
  }>("/api/anythingllm/workspaces");
  const workspacesJson = JSON.stringify(workspaces);
  assert(workspaces.ok === true, "Workspaces endpoint did not return ok.");
  assert(workspaces.apiKeyConfigured === true, "Workspaces endpoint did not report configured API key.");
  assert(workspaces.workspaces.length === fakeWorkspaces.length, "Workspaces endpoint did not return fake workspaces.");
  assert(workspaces.workspaces[0]?.slug === "smoke-workspace", "Workspaces endpoint returned the wrong workspace data.");
  assert(!workspacesJson.includes(apiSecret), "Workspaces response leaked the AnythingLLM API key.");

  const environmentAfterConfig = await fetchJson<{
    api: { apiKeyConfigured: boolean };
    desktop: { configuredExe: { launchable: boolean } };
  }>("/api/anythingllm/environment");
  const environmentJson = JSON.stringify(environmentAfterConfig);
  assert(environmentAfterConfig.api.apiKeyConfigured === true, "Environment did not report configured API key after config save.");
  assert(environmentAfterConfig.desktop.configuredExe.launchable === true, "Environment did not report configured executable readiness.");
  assert(!environmentJson.includes(apiSecret), "Environment response leaked the AnythingLLM API key.");

  const dryDownload = await fetchJson<{
    ok: boolean;
    dryRun: boolean;
    downloaded: boolean;
    installer: { fileName: string; path: string };
  }>("/api/anythingllm/download-installer", {
    method: "POST",
    body: JSON.stringify({
      installerUrl: "https://github.com/Mintplex-Labs/anything-llm/releases/download/v1.0.0/AnythingLLM-Setup.exe",
      dryRun: true,
    }),
  });
  assert(dryDownload.ok === true && dryDownload.dryRun === true, "Download dryRun did not return an explicit dryRun result.");
  assert(dryDownload.downloaded === false, "Download dryRun claimed a real download.");
  assert(dryDownload.installer.fileName === "AnythingLLM-Setup.exe", "Download dryRun chose the wrong installer filename.");
  assert(dryDownload.installer.path.startsWith(tempDir), "Download dryRun target escaped the smoke data directory.");

  const rejectedDownload = await fetchRaw("/api/anythingllm/download-installer", {
    method: "POST",
    body: JSON.stringify({
      installerUrl: `http://127.0.0.1:${anythingPort}/AnythingLLM-Setup.exe`,
      dryRun: true,
    }),
  });
  assert(rejectedDownload.response.status === 400, "Unsafe installer URL was accepted.");

  const openedFolder = await fetchJson<{
    ok: boolean;
    dryRun: boolean;
    opened: boolean;
    folder: string;
  }>("/api/anythingllm/open-installer-folder", {
    method: "POST",
    body: JSON.stringify({ dryRun: true }),
  });
  assert(openedFolder.ok === true && openedFolder.dryRun === true, "Open folder dryRun did not return ok.");
  assert(openedFolder.opened === false, "Open folder dryRun claimed it opened a folder.");
  assert(openedFolder.folder.startsWith(tempDir), "Open folder dryRun escaped the smoke data directory.");

  const launchDryRun = await fetchJson<{
    ok: boolean;
    dryRun: boolean;
    launched: boolean;
    installer: { exists: boolean; fileName: string };
  }>("/api/anythingllm/launch-installer", {
    method: "POST",
    body: JSON.stringify({ fileName: "AnythingLLM-Setup.exe", dryRun: true }),
  });
  assert(launchDryRun.ok === true && launchDryRun.dryRun === true, "Launch installer dryRun did not return ok.");
  assert(launchDryRun.launched === false, "Launch installer dryRun claimed a process launch.");
  assert(launchDryRun.installer.exists === false, "Launch installer dryRun unexpectedly found an installer.");

  const launchMissing = await fetchRaw("/api/anythingllm/launch-installer", {
    method: "POST",
    body: JSON.stringify({ fileName: "AnythingLLM-Setup.exe" }),
  });
  assert(launchMissing.response.status === 404, "Missing installer launch did not fail.");

  const rejectedCors = await fetchRaw("/api/anythingllm/environment", {
    headers: { Origin: "https://example.com" },
  });
  assert(rejectedCors.response.status >= 400, "Non-loopback CORS origin was accepted.");

  console.log(
    JSON.stringify(
      {
        ok: true,
        tempDir,
        exePath: fakeExePath,
        draftWorkspaces: draftWorkspaces.workspaces.map((workspace) => workspace.slug),
        workspaces: workspaces.workspaces.map((workspace) => workspace.slug),
        dryRun: {
          download: dryDownload.downloaded === false,
          openFolder: openedFolder.opened === false,
          launchInstaller: launchDryRun.launched === false,
        },
        boundaries: {
          rejectedExe: rejectedExe.response.status,
          rejectedDownload: rejectedDownload.response.status,
          missingInstaller: launchMissing.response.status,
          corsRejected: rejectedCors.response.status,
        },
      },
      null,
      2,
    ),
  );
} finally {
  server.kill();
  await new Promise((resolve) => setTimeout(resolve, 300));
  await new Promise<void>((resolve) => anythingServer.close(() => resolve()));
  await rm(tempDir, { recursive: true, force: true });
}
