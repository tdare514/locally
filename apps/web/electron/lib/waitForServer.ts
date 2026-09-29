import http from "node:http";

const POLL_MS = 150;

function probe(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve((res.statusCode ?? 500) < 500);
    });
    req.setTimeout(2000, () => req.destroy());
    req.on("error", () => resolve(false));
  });
}

/** Poll `url` until it answers with a status below 500; reject on exit or timeout. */
export async function waitForServer(
  url: string,
  opts: { timeoutMs: number; isAlive: () => boolean }
): Promise<void> {
  const deadline = Date.now() + opts.timeoutMs;
  for (;;) {
    if (!opts.isAlive()) throw new Error("Server process exited before it was ready");
    if (await probe(url)) return;
    if (Date.now() >= deadline) throw new Error(`Server did not respond within ${opts.timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}
