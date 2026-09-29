import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { waitForServer } from "../../../electron/lib/waitForServer";

let server: http.Server | null = null;

afterEach(async () => {
  const s = server;
  server = null;
  if (s) await new Promise<void>((r) => s.close(() => r()));
});

async function listen(status = 200): Promise<number> {
  server = http.createServer((_req, res) => {
    res.statusCode = status;
    res.end("ok");
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", () => r()));
  return (server.address() as AddressInfo).port;
}

describe("waitForServer", () => {
  it("resolves once the server answers", async () => {
    const port = await listen();
    await expect(
      waitForServer(`http://127.0.0.1:${port}/`, { timeoutMs: 2000, isAlive: () => true })
    ).resolves.toBeUndefined();
  });

  it("rejects when the process is no longer alive", async () => {
    const port = await listen();
    await expect(
      waitForServer(`http://127.0.0.1:${port}/`, { timeoutMs: 2000, isAlive: () => false })
    ).rejects.toThrow(/exited/);
  });

  it("rejects on timeout against a closed port", async () => {
    const port = await listen();
    await new Promise<void>((r) => server!.close(() => r()));
    server = null;
    await expect(
      waitForServer(`http://127.0.0.1:${port}/`, { timeoutMs: 400, isAlive: () => true })
    ).rejects.toThrow(/did not respond/);
  });

  it("keeps waiting while the server answers 5xx", async () => {
    const port = await listen(503);
    await expect(
      waitForServer(`http://127.0.0.1:${port}/`, { timeoutMs: 400, isAlive: () => true })
    ).rejects.toThrow(/did not respond/);
  });
});
