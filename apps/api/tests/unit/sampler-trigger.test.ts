import { describe, expect, it, vi } from "vitest";
import { callSampler, runMinute } from "../../trigger/sampler-trigger";

function clock(reply: () => number | null) {
  let t = 0;
  let calls = 0;
  return {
    calls: () => calls,
    deps: {
      call: async () => {
        calls += 1;
        t += 500;
        return reply();
      },
      sleep: async (ms: number) => {
        t += ms;
      },
      now: () => t,
    },
  };
}

describe("runMinute", () => {
  it("makes 6 calls a minute on 10 s gaps", async () => {
    const c = clock(() => 10_000);
    expect(await runMinute(c.deps)).toBe(6);
    expect(c.calls()).toBe(6);
  });

  it("makes 2 calls a minute on 30 s gaps", async () => {
    expect(await runMinute(clock(() => 30_000).deps)).toBe(2);
  });

  it("falls back to 30 s when a call fails", async () => {
    expect(await runMinute(clock(() => null).deps)).toBe(2);
  });

  it("clamps a 1 s gap to 5 s and never exceeds 12 calls", async () => {
    const n = await runMinute(clock(() => 1_000).deps);
    expect(n).toBeLessThanOrEqual(12);
    expect(n).toBe(11);
  });
});

describe("callSampler", () => {
  const env = { SAMPLER_URL: "https://sampler.test/v1/internal/spotify-sample", SAMPLER_SECRET: "s3cret" };

  it("POSTs with the bearer header and returns nextInMs", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ nextInMs: 10_000 }));
    expect(await callSampler(env, fetchImpl as unknown as typeof fetch)).toBe(10_000);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(env.SAMPLER_URL);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer s3cret");
  });

  it("returns null on a 401, a non-number nextInMs and a thrown fetch, without logging the secret", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const as = (f: () => Promise<Response>) => f as unknown as typeof fetch;
    expect(await callSampler(env, as(async () => new Response("no", { status: 401 })))).toBeNull();
    expect(await callSampler(env, as(async () => Response.json({ nextInMs: "10" })))).toBeNull();
    expect(await callSampler(env, as(async () => { throw new Error("boom s3cret"); }))).toBeNull();
    expect(log.mock.calls.map((c) => String(c[0])).join("\n")).not.toContain("s3cret");
    log.mockRestore();
  });
});
