import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "../../../src/shared/types";
import type { Services } from "../../../src/server/container";

type ExecFileCallback = (err: Error | null) => void;

let execCalls: { cmd: string; args: string[] }[];
let execError: Error | null;

vi.mock("node:child_process", () => ({
  execFile: (cmd: string, args: string[], cb: ExecFileCallback) => {
    execCalls.push({ cmd, args });
    queueMicrotask(() => cb(execError));
  },
}));

let services: Services;

vi.mock("../../../src/server/container", () => ({
  getServices: () => services,
}));

import { POST } from "../../../src/app/api/reveal/route";

let settingsValue: Settings;
let platformDescriptor: PropertyDescriptor | undefined;

/** Lexical `isInside` matching `NodeFileSystem`: the base itself is inside. */
class FakeFileSystem {
  isInside(base: string, target: string): boolean {
    const rel = path.relative(path.resolve(base), path.resolve(target));
    if (rel === "") return true;
    return !path.isAbsolute(rel) && rel.split(path.sep)[0] !== "..";
  }
}

class FakeSettingsStore {
  async get(): Promise<Settings> {
    return settingsValue;
  }
  async set(next: Settings): Promise<Settings> {
    settingsValue = next;
    return next;
  }
}

function revealRequest(body?: unknown): NextRequest {
  return new NextRequest("http://localhost/api/reveal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  execCalls = [];
  execError = null;
  settingsValue = { libraryDir: "/tmp/lib", sync: null };
  services = {
    settings: new FakeSettingsStore(),
    fs: new FakeFileSystem(),
  } as unknown as Services;

  platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { configurable: true, value: "darwin" });
});

afterEach(() => {
  if (platformDescriptor) {
    Object.defineProperty(process, "platform", platformDescriptor);
  }
});

describe("POST /api/reveal", () => {
  it("rejects when not running on macOS", async () => {
    Object.defineProperty(process, "platform", { configurable: true, value: "linux" });

    const res = await POST(revealRequest({ path: "/tmp/lib/Artist" }));

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/macOS/);
    expect(execCalls).toEqual([]);
  });

  it("reveals the library dir when the body has no path", async () => {
    const res = await POST(revealRequest({}));

    expect(res.status).toBe(200);
    expect(execCalls).toEqual([{ cmd: "open", args: ["-R", path.resolve("/tmp/lib")] }]);
  });

  it("reveals a path inside the library", async () => {
    const target = "/tmp/lib/Artist/Title";
    const res = await POST(revealRequest({ path: target }));

    expect(res.status).toBe(200);
    expect(execCalls).toEqual([{ cmd: "open", args: ["-R", path.resolve(target)] }]);
  });

  it("rejects a path outside the library without shelling out", async () => {
    const res = await POST(revealRequest({ path: "/etc/passwd" }));

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/inside the library/);
    expect(JSON.stringify(body)).not.toContain("passwd");
    expect(execCalls).toEqual([]);
  });

  it("rejects an empty path string", async () => {
    const res = await POST(revealRequest({ path: "   " }));

    expect(res.status).toBe(400);
    expect(execCalls).toEqual([]);
  });

  it("maps an open(1) failure to a 500 without leaking the path", async () => {
    execError = new Error("open failed: /Users/someone/secret/path");

    const res = await POST(revealRequest({ path: "/tmp/lib/Artist" }));

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).not.toContain("/Users/someone/secret");
  });
});
