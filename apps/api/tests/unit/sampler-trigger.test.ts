import { describe, expect, it, vi } from "vitest";
import { callSampler, runMinute } from "../../trigger/sampler-trigger";

function clock(reply: () => number | null, latency = 500) {
  let t = 0;
  let calls = 0;
  const starts: number[] = [];
  const sleeps: number[] = [];
  return {
    calls: () => calls,
    starts,
    sleeps,
    deps: {
      call: async () => {
        calls += 1;
        starts.push(t);
        t += latency;
        return reply();
      },
      sleep: async (ms: number) => {
        sleeps.push(ms);
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
    expect(n).toBe(12);
  });
});

describe("runMinute start-to-start gaps", () => {
  it("starts calls exactly every 10 s despite 2 s call latency", async () => {
    const c = clock(() => 10_000, 2_000);
    expect(await runMinute(c.deps)).toBe(6);
    expect(c.starts).toEqual([0, 10_000, 20_000, 30_000, 40_000, 50_000]);
  });

  it("starts at 0 and 30 s on 30 s gaps with 2 s latency", async () => {
    const c = clock(() => 30_000, 2_000);
    await runMinute(c.deps);
    expect(c.starts).toEqual([0, 30_000]);
  });

  it("sleeps 0, never a negative time, when a call is slower than its gap", async () => {
    const c = clock(() => 10_000, 12_000);
    await runMinute(c.deps);
    expect(c.starts).toEqual([0, 12_000, 24_000, 36_000, 48_000]);
    expect(c.sleeps.every((ms) => ms === 0)).toBe(true);
  });

  it("never starts a call past 55 s, however slow the calls", async () => {
    const c = clock(() => 10_000, 20_000);
    await runMinute(c.deps);
    expect(c.starts).toEqual([0, 20_000, 40_000]);
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
