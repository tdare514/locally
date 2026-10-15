import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { shouldStartHidden, startServices } from "../../../electron/lib/background";

describe("shouldStartHidden", () => {
  it("hides the window only when the app was opened at login", () => {
    expect(shouldStartHidden({ wasOpenedAtLogin: true })).toBe(true);
    expect(shouldStartHidden({ wasOpenedAtLogin: false })).toBe(false);
    expect(shouldStartHidden({})).toBe(false);
  });
});

describe("startServices", () => {
  const servers: http.Server[] = [];
  afterEach(() => {
    for (const s of servers.splice(0)) s.close();
  });

  function listen(handler: http.RequestListener): Promise<string> {
    return new Promise((resolve) => {
      const server = http.createServer(handler).listen(0, "127.0.0.1", () => {
        servers.push(server);
        resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
      });
    });
  }

  it("makes one GET to /api/sync/status", async () => {
    const seen: string[] = [];
    const url = await listen((req, res) => {
      seen.push(`${req.method} ${req.url}`);
      res.end("{}");
    });
    expect(await startServices(url)).toBe(true);
    expect(seen).toEqual(["GET /api/sync/status"]);
  });

  it("reports a server error without throwing", async () => {
    const url = await listen((_req, res) => {
      res.statusCode = 500;
      res.end("boom");
    });
    expect(await startServices(url)).toBe(false);
  });

  it("swallows a failed request and reports its message", async () => {
    const onError = vi.fn();
    const failing = vi.fn().mockRejectedValue(new Error("connect refused"));
    expect(await startServices("http://127.0.0.1:1/", failing as unknown as typeof fetch, onError)).toBe(false);
    expect(onError).toHaveBeenCalledWith("connect refused");
  });
});
