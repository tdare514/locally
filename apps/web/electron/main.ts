import { app, BrowserWindow, dialog, shell } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findFreePort } from "./lib/freePort";
import { migrateLegacyConfig } from "./lib/migrateConfig";
import { buildServerEnv } from "./lib/serverEnv";
import { waitForServer } from "./lib/waitForServer";

// Single-window Mac shell around Next's standalone server. The server binds 127.0.0.1
// only (ADR 0003); this file adds no place to write beyond the app's config dir.

const SMOKE = process.env.LOCALLY_DESKTOP_SMOKE === "1";
const EXTERNAL_SCHEMES = new Set(["http:", "https:", "spotify:"]);

app.setName("Locally");
// ~/Library/Application Support/Locally (ADR 0004). LOCALLY_DESKTOP_USER_DATA is a developer
// override so smoke runs and manual tests never touch the real folder; never user input.
const userDataOverride = process.env.LOCALLY_DESKTOP_USER_DATA?.trim();
app.setPath("userData", userDataOverride || path.join(app.getPath("appData"), "Locally"));

let child: ChildProcess | null = null;
let killTimer: NodeJS.Timeout | null = null;

function openExternal(target: string): void {
  try {
    if (EXTERNAL_SCHEMES.has(new URL(target).protocol)) void shell.openExternal(target);
  } catch {
    // not a URL; ignore
  }
}

function pipeLines(stream: NodeJS.ReadableStream, sink: (line: string) => void): void {
  let buf = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    buf += chunk;
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      sink(buf.slice(0, idx));
      buf = buf.slice(idx + 1);
    }
  });
  stream.on("end", () => {
    if (buf) sink(buf);
  });
}

function stopChild(): void {
  const proc = child;
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
  proc.kill("SIGTERM");
  killTimer = setTimeout(() => {
    if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
  }, 2000);
  killTimer.unref();
}

function fail(reason: string): void {
  if (SMOKE) {
    console.log(`smoke-fail ${reason}`);
    app.exit(1);
    return;
  }
  dialog.showErrorBox("Locally could not start", reason);
  app.quit();
}

function resolveDevUrl(raw: string): string {
  const parsed = new URL(raw);
  if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
    throw new Error(`LOCALLY_DESKTOP_URL must point at 127.0.0.1 or localhost, got ${parsed.hostname}`);
  }
  return parsed.toString();
}

async function startServer(): Promise<string> {
  const devUrl = process.env.LOCALLY_DESKTOP_URL;
  if (devUrl) return resolveDevUrl(devUrl);

  const serverDir = app.isPackaged
    ? path.join(process.resourcesPath, "standalone")
    : path.join(__dirname, "..", "..", ".next", "standalone");
  const entry = path.join(serverDir, "server.js");
  if (!fs.existsSync(entry)) {
    throw new Error(`Server build not found at ${entry}. Run \`npm run desktop:build\` first.`);
  }

  const port = await findFreePort();
  const bundledFfmpeg = path.join(process.resourcesPath, "ffmpeg");
  const ffmpegPath = app.isPackaged && fs.existsSync(bundledFfmpeg) ? bundledFfmpeg : undefined;
  const env = buildServerEnv({
    base: process.env,
    port,
    configDir: app.getPath("userData"),
    ffmpegPath,
    extraPathDirs: ["/opt/homebrew/bin", "/usr/local/bin"],
  });
  env.ELECTRON_RUN_AS_NODE = "1";

  const proc = spawn(process.execPath, [entry], {
    cwd: serverDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child = proc;
  pipeLines(proc.stdout!, (l) => console.log(`[server] ${l}`));
  pipeLines(proc.stderr!, (l) => console.error(`[server] ${l}`));
  proc.on("exit", (code, signal) => console.log(`[server] exited code=${code} signal=${signal}`));

  const url = `http://127.0.0.1:${port}/`;
  await waitForServer(url, { timeoutMs: 20000, isAlive: () => proc.exitCode === null && proc.signalCode === null });
  return url;
}

function openWindow(url: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 800,
    minHeight: 560,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  const origin = new URL(url).origin;
  win.webContents.on("will-navigate", (event, target) => {
    let sameOrigin = false;
    try {
      sameOrigin = new URL(target).origin === origin;
    } catch {
      // unparseable: treat as foreign
    }
    if (!sameOrigin) {
      event.preventDefault();
      openExternal(target);
    }
  });
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    openExternal(target);
    return { action: "deny" };
  });

  if (SMOKE) {
    win.webContents.once("did-finish-load", () => {
      console.log(`smoke-ok ${url} ${win.webContents.getTitle()}`);
      app.exit(0);
    });
    win.webContents.once("did-fail-load", (_e, code, desc) => fail(`load failed ${code} ${desc}`));
  }
  void win.loadURL(url);
  return win;
}

app.on("window-all-closed", () => app.quit());
app.on("before-quit", stopChild);
app.on("will-quit", stopChild);
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    stopChild();
    app.quit();
  });
}
// The child must not outlive an abrupt exit (e.g. smoke mode's app.exit).
process.on("exit", () => {
  if (killTimer) clearTimeout(killTimer);
  if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
});

app
  .whenReady()
  .then(async () => {
    // Against a developer `next dev` server the config dir is that server's own, so
    // there is nothing to migrate; only the spawned standalone server reads userData.
    if (!process.env.LOCALLY_DESKTOP_URL) {
      const legacy = path.join(os.homedir(), ".spotify-local-import");
      const { copied } = migrateLegacyConfig(legacy, app.getPath("userData"));
      if (copied.length > 0) console.log(`[desktop] migrated config: ${copied.join(", ")}`);
    }

    const url = await startServer();
    openWindow(url);
  })
  .catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)));
