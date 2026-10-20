/**
 * Cloudflare Worker that drives the Spotify sampler (#303). A `* * * * *` cron starts it; within each
 * minute it POSTs the sampler route, then waits the `nextInMs` the reply asks for. No dependencies.
 */
export const WINDOW_MS = 55_000; // stop scheduling calls past this point in the minute
export const FALLBACK_GAP_MS = 30_000; // when the reply has no usable nextInMs
export const MIN_GAP_MS = 5_000;
export const MAX_GAP_MS = 60_000;
const MAX_CALLS = 12;

export interface TriggerDeps {
  call: () => Promise<number | null>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

/** One cron minute: call, then sleep the gap the sampler asked for (clamped to 5..60 s, 30 s if missing), until the next call would land past 55 s. Returns how many calls it made. Never more than 12. */
export async function runMinute(deps: TriggerDeps): Promise<number> {
  const start = deps.now();
  let calls = 0;
  while (calls < MAX_CALLS) {
    const asked = await deps.call();
    calls += 1;
    const gap = Math.min(MAX_GAP_MS, Math.max(MIN_GAP_MS, asked ?? FALLBACK_GAP_MS));
    if (deps.now() - start + gap > WINDOW_MS) break;
    await deps.sleep(gap);
  }
  return calls;
}

export interface TriggerEnv {
  SAMPLER_URL: string;
  SAMPLER_SECRET: string;
}

/** POSTs the sampler; the `nextInMs` of an ok JSON reply, else null. Logs the status or error name only. */
export async function callSampler(env: TriggerEnv, fetchImpl: typeof fetch = fetch): Promise<number | null> {
  try {
    const res = await fetchImpl(env.SAMPLER_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.SAMPLER_SECRET}` },
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) {
      console.log(JSON.stringify({ event: "sampler_call_failed", status: res.status }));
      return null;
    }
    const body = (await res.json()) as { nextInMs?: unknown };
    return typeof body.nextInMs === "number" && Number.isFinite(body.nextInMs) ? body.nextInMs : null;
  } catch (err) {
    console.log(JSON.stringify({ event: "sampler_call_failed", error: err instanceof Error ? err.name : "unknown" }));
    return null;
  }
}

const worker = {
  async scheduled(_controller: unknown, env: TriggerEnv, ctx: { waitUntil(promise: Promise<unknown>): void }): Promise<void> {
    ctx.waitUntil(runMinute({ call: () => callSampler(env), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: Date.now }));
  },
};

export default worker;
