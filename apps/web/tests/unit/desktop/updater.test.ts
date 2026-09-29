import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appBundleFromExecPath,
  cleanupAfterUpdate,
  downloadVerified,
  installUpdate,
  isInside,
  shouldCheck,
} from "../../../electron/lib/updater";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "locally-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");

describe("downloadVerified", () => {
  const bytes = Buffer.from("hello update bytes");
  const fake = (body: Buffer) => (async () => new Response(new Uint8Array(body))) as unknown as typeof fetch;

  it("writes the verified file", async () => {
    const destDir = path.join(root, "updates");
    const file = await downloadVerified({
      url: "https://x.test/a.zip",
      sha256: sha(bytes),
      size: bytes.length,
      destDir,
      fetchImpl: fake(bytes),
    });
    expect(fs.readFileSync(file)).toEqual(bytes);
  });

  it("removes the file on a hash mismatch", async () => {
    const destDir = path.join(root, "updates");
    await expect(
      downloadVerified({ url: "https://x.test/a.zip", sha256: "0".repeat(64), size: bytes.length, destDir, fetchImpl: fake(bytes) }),
    ).rejects.toThrow();
    expect(fs.readdirSync(destDir)).toEqual([]);
  });

  it("removes the file when the body overruns the declared size", async () => {
    const destDir = path.join(root, "updates");
    const big = Buffer.alloc(100, 1);
    await expect(
      downloadVerified({ url: "https://x.test/a.zip", sha256: sha(big), size: 10, destDir, fetchImpl: fake(big) }),
    ).rejects.toThrow();
    expect(fs.readdirSync(destDir)).toEqual([]);
  });
});

function makeApp(dir: string, id: string, version: string, marker: string): string {
  const app = path.join(dir, "Locally.app");
  fs.mkdirSync(path.join(app, "Contents"), { recursive: true });
  fs.writeFileSync(
    path.join(app, "Contents", "Info.plist"),
    `<plist><dict><key>CFBundleIdentifier</key>\n<string>${id}</string><key>CFBundleShortVersionString</key><string>${version}</string></dict></plist>`,
  );
  fs.writeFileSync(path.join(app, "marker"), marker);
  return app;
}

describe("installUpdate", () => {
  function setup(newId: string, newVersion: string) {
    const installDir = path.join(root, "Applications");
    const updatesDir = path.join(root, "updates");
    fs.mkdirSync(installDir);
    fs.mkdirSync(updatesDir);
    const currentApp = makeApp(installDir, "com.test.locally", "0.1.0", "old");
    const prepared = path.join(root, "prepared");
    fs.mkdirSync(prepared);
    makeApp(prepared, newId, newVersion, "new");
    const zipPath = path.join(updatesDir, "download-1.zip");
    fs.writeFileSync(zipPath, "zip");
    const unzip = async (_zip: string, dest: string) => {
      fs.cpSync(path.join(prepared, "Locally.app"), path.join(dest, "Locally.app"), { recursive: true });
    };
    const run = () =>
      installUpdate({ zipPath, updatesDir, currentApp, currentVersion: "0.1.0", bundleId: "com.test.locally", unzip });
    return { currentApp, run };
  }

  it("swaps the bundle and keeps the old one as .old", async () => {
    const { currentApp, run } = setup("com.test.locally", "0.2.0");
    await run();
    expect(fs.readFileSync(path.join(currentApp, "marker"), "utf8")).toBe("new");
    expect(fs.readFileSync(path.join(`${currentApp}.old`, "marker"), "utf8")).toBe("old");
  });

  it("refuses the wrong bundle id and leaves the app alone", async () => {
    const { currentApp, run } = setup("com.evil.app", "0.2.0");
    await expect(run()).rejects.toThrow();
    expect(fs.readFileSync(path.join(currentApp, "marker"), "utf8")).toBe("old");
    expect(fs.existsSync(`${currentApp}.old`)).toBe(false);
  });

  it("refuses a version that is not newer", async () => {
    const { currentApp, run } = setup("com.test.locally", "0.1.0");
    await expect(run()).rejects.toThrow();
    expect(fs.readFileSync(path.join(currentApp, "marker"), "utf8")).toBe("old");
    expect(fs.existsSync(`${currentApp}.old`)).toBe(false);
  });
});

describe("helpers", () => {
  it("cleanupAfterUpdate removes .old and leftovers", () => {
    const app = path.join(root, "Locally.app");
    fs.mkdirSync(`${app}.old`);
    const updates = path.join(root, "updates");
    fs.mkdirSync(path.join(updates, "unpacked-x"), { recursive: true });
    fs.writeFileSync(path.join(updates, "download-x.zip"), "z");
    fs.writeFileSync(path.join(updates, "last-check.json"), "{}");
    cleanupAfterUpdate(app, updates);
    expect(fs.existsSync(`${app}.old`)).toBe(false);
    expect(fs.readdirSync(updates)).toEqual(["last-check.json"]);
  });

  it("shouldCheck respects the interval", () => {
    expect(shouldCheck(null, 1000)).toBe(true);
    expect(shouldCheck(1000, 2000)).toBe(false);
    expect(shouldCheck(0, 7 * 3600 * 1000)).toBe(true);
  });

  it("appBundleFromExecPath finds the .app", () => {
    expect(appBundleFromExecPath("/Applications/Locally.app/Contents/MacOS/Locally")).toBe("/Applications/Locally.app");
  });

  it("isInside is not fooled by prefix siblings", () => {
    expect(isInside("/a/b", "/a/b/c")).toBe(true);
    expect(isInside("/a/b", "/a/b")).toBe(true);
    expect(isInside("/a/b", "/a/bc")).toBe(false);
    expect(isInside("/a/b", "/a/b/../c")).toBe(false);
  });
});
