import type { App, BrowserWindow, Dialog, Shell } from "electron";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { parseUpdateEnvelope, isNewer, UpdateError, type UpdateBuild } from "./update-manifest";
import { BUNDLE_ID, UPDATE_MANIFEST_URL, UPDATE_PUBLIC_KEY_PEM } from "./updateConfig";

const execFileAsync = promisify(execFile);

export function readBundleInfo(appPath: string): { id: string; version: string } {
  let plist: string;
  try {
    plist = fs.readFileSync(path.join(appPath, "Contents", "Info.plist"), "utf8");
  } catch {
    throw new UpdateError("The downloaded app has no Info.plist");
  }
  const read = (key: string): string => {
    const m = plist.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`));
    if (!m) throw new UpdateError(`The downloaded app is missing ${key}`);
    return m[1];
  };
  return { id: read("CFBundleIdentifier"), version: read("CFBundleShortVersionString") };
}

export function isInside(parent: string, child: string): boolean {
  const p = path.resolve(parent);
  const c = path.resolve(child);
  return c === p || c.startsWith(p + path.sep);
}

export async function downloadVerified(opts: {
  url: string;
  sha256: string;
  size: number;
  destDir: string;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  fs.mkdirSync(opts.destDir, { recursive: true, mode: 0o700 });
  const file = path.join(opts.destDir, `download-${crypto.randomUUID()}.zip`);
  const cap = Math.floor(opts.size * 1.5);
  try {
    const res = await fetchImpl(opts.url, { redirect: "error" });
    if (!res.ok || !res.body) throw new UpdateError(`Download failed (${res.status})`);
    const out = fs.createWriteStream(file, { mode: 0o600 });
    const hash = crypto.createHash("sha256");
    const reader = res.body.getReader();
    let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > cap) {
          await reader.cancel();
          throw new UpdateError("Download is larger than expected");
        }
        hash.update(value);
        if (!out.write(value)) await new Promise<void>((r) => out.once("drain", () => r()));
      }
    } finally {
      await new Promise<void>((resolve) => out.end(() => resolve()));
    }
    if (hash.digest("hex") !== opts.sha256) throw new UpdateError("Download does not match its checksum");
    return file;
  } catch (err) {
    fs.rmSync(file, { force: true });
    throw err;
  }
}

export type Unzip = (zipPath: string, destDir: string) => Promise<void>;

export const dittoUnzip: Unzip = async (zipPath, destDir) => {
  await execFileAsync("/usr/bin/ditto", ["-x", "-k", zipPath, destDir]);
};

export async function installUpdate(opts: {
  zipPath: string;
  updatesDir: string;
  currentApp: string;
  currentVersion: string;
  bundleId: string;
  unzip?: Unzip;
}): Promise<string> {
  const { zipPath, updatesDir, currentApp } = opts;
  if (!path.isAbsolute(currentApp) || !currentApp.endsWith(".app")) {
    throw new UpdateError("Cannot locate the running app bundle");
  }
  const unpackDir = path.join(updatesDir, `unpacked-${crypto.randomUUID()}`);
  if (!isInside(updatesDir, zipPath) || !isInside(updatesDir, unpackDir)) {
    throw new UpdateError("Update files are outside the updates folder");
  }
  fs.mkdirSync(unpackDir, { recursive: true, mode: 0o700 });
  try {
    await (opts.unzip ?? dittoUnzip)(zipPath, unpackDir);
    const newApp = path.join(unpackDir, path.basename(currentApp));
    const st = fs.lstatSync(newApp, { throwIfNoEntry: false });
    if (!st || st.isSymbolicLink() || !st.isDirectory()) {
      throw new UpdateError("The download does not contain the app");
    }
    const info = readBundleInfo(newApp);
    if (info.id !== opts.bundleId) throw new UpdateError("The download is not Locally");
    if (!isNewer(info.version, opts.currentVersion)) throw new UpdateError("The download is not newer");
    try {
      fs.accessSync(path.dirname(currentApp), fs.constants.W_OK);
    } catch {
      throw new UpdateError(`${path.dirname(currentApp)} is not writable`);
    }
    const oldApp = `${currentApp}.old`;
    fs.rmSync(oldApp, { recursive: true, force: true });
    fs.renameSync(currentApp, oldApp);
    try {
      fs.renameSync(newApp, currentApp);
    } catch (err) {
      fs.renameSync(oldApp, currentApp);
      throw new UpdateError(`Could not move the new app into place: ${err instanceof Error ? err.message : String(err)}`);
    }
    return currentApp;
  } finally {
    fs.rmSync(unpackDir, { recursive: true, force: true });
    fs.rmSync(zipPath, { force: true });
  }
}

export function cleanupAfterUpdate(currentApp: string, updatesDir: string): void {
  try {
    fs.rmSync(`${currentApp}.old`, { recursive: true, force: true });
  } catch {
    // best effort
  }
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(updatesDir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (!name.startsWith("download-") && !name.startsWith("unpacked-")) continue;
    try {
      fs.rmSync(path.join(updatesDir, name), { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
}

export function shouldCheck(lastCheckMs: number | null, nowMs: number, intervalMs = 6 * 3600 * 1000): boolean {
  return lastCheckMs === null || nowMs - lastCheckMs >= intervalMs;
}

export function appBundleFromExecPath(execPath: string): string {
  return path.resolve(execPath, "..", "..", "..");
}

const MANUAL_HELP = "You can download it yourself, unzip it, and replace Locally in your Applications folder.";

export function initUpdater(deps: {
  app: App;
  dialog: Dialog;
  shell: Shell;
  getWindow: () => BrowserWindow | null;
}): { checkNow: (manual: boolean) => Promise<void> } {
  const { app, dialog, shell, getWindow } = deps;
  const enabled = Boolean(
    app.isPackaged &&
      UPDATE_MANIFEST_URL &&
      UPDATE_PUBLIC_KEY_PEM &&
      !process.env.LOCALLY_DESKTOP_SMOKE &&
      !process.env.LOCALLY_DESKTOP_URL,
  );
  const updatesDir = path.join(app.getPath("userData"), "updates");
  const currentApp = appBundleFromExecPath(process.execPath);
  const stateFile = path.join(updatesDir, "last-check.json");
  let busy = false;

  const readLastCheck = (): number | null => {
    try {
      const v = (JSON.parse(fs.readFileSync(stateFile, "utf8")) as { lastCheck?: unknown }).lastCheck;
      return typeof v === "number" ? v : null;
    } catch {
      return null;
    }
  };
  const writeLastCheck = (): void => {
    try {
      fs.mkdirSync(updatesDir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(stateFile, JSON.stringify({ lastCheck: Date.now() }), { mode: 0o600 });
    } catch {
      // not fatal
    }
  };

  const show = (options: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> => {
    const win = getWindow();
    return win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options);
  };

  async function fetchManifest(): Promise<ReturnType<typeof parseUpdateEnvelope>> {
    const res = await fetch(UPDATE_MANIFEST_URL, { redirect: "error", cache: "no-store" });
    if (!res.ok) throw new UpdateError(`Update check failed (${res.status})`);
    return parseUpdateEnvelope(await res.text(), {
      publicKeyPem: UPDATE_PUBLIC_KEY_PEM,
      allowedHost: new URL(UPDATE_MANIFEST_URL).hostname,
    });
  }

  async function install(build: UpdateBuild): Promise<void> {
    const zipPath = await downloadVerified({ url: build.url, sha256: build.sha256, size: build.size, destDir: updatesDir });
    await installUpdate({
      zipPath,
      updatesDir,
      currentApp,
      currentVersion: app.getVersion(),
      bundleId: BUNDLE_ID,
    });
    await execFileAsync("/usr/bin/open", ["-n", currentApp]);
    app.quit();
  }

  async function checkNow(manual: boolean): Promise<void> {
    if (!enabled) {
      if (manual) {
        await show({
          type: "info",
          message: "Updates aren't set up in this build",
          detail: "Automatic updates only work in the packaged app once an update source is configured.",
          buttons: ["OK"],
        });
      }
      return;
    }
    if (busy) return;
    busy = true;
    let build: UpdateBuild | null = null;
    try {
      let manifest;
      try {
        manifest = await fetchManifest();
      } catch (err) {
        if (!manual) {
          console.error("[updater]", err);
          return;
        }
        throw err;
      } finally {
        writeLastCheck();
      }
      const candidate = manifest.builds[process.arch];
      if (!candidate || !isNewer(manifest.version, app.getVersion())) {
        if (manual) {
          await show({ type: "info", message: `You're up to date (version ${app.getVersion()})`, buttons: ["OK"] });
        }
        return;
      }
      build = candidate;
      const choice = await show({
        type: "info",
        message: `Locally ${manifest.version} is available`,
        detail: manifest.notes,
        buttons: ["Download and Install", "Later"],
        defaultId: 0,
        cancelId: 1,
      });
      if (choice.response !== 0) return;
      await install(build);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const buttons = build ? ["Open Download", "OK"] : ["OK"];
      const choice = await show({
        type: "error",
        message: "Locally could not update",
        detail: `${message}\n\n${MANUAL_HELP}`,
        buttons,
        defaultId: buttons.length - 1,
        cancelId: buttons.length - 1,
      });
      if (build && choice.response === 0) void shell.openExternal(build.url);
    } finally {
      busy = false;
    }
  }

  if (enabled) {
    cleanupAfterUpdate(currentApp, updatesDir);
    setTimeout(() => {
      if (shouldCheck(readLastCheck(), Date.now())) void checkNow(false);
    }, 10_000).unref();
  }
  return { checkNow };
}
