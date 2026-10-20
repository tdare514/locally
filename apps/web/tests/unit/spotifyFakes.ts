import type { SettingsStore } from "../../src/server/config/SettingsStore";
import type { Settings } from "../../src/shared/types";

/**
 * An in-memory store with the same one-writer-at-a-time rule as FileSettingsStore. `holdWrites()`
 * makes the next write wait, after its mutator has run, until the returned function is called.
 */
export class MemorySettings implements SettingsStore {
  value: Settings = { libraryDir: "/tmp/lib", sync: null };
  private chain: Promise<unknown> = Promise.resolve();
  private hold: Promise<void> | null = null;
  /** Resolves when a write is waiting on the hold. */
  holdReached: Promise<void> = Promise.resolve();

  holdWrites(): () => void {
    let release!: () => void;
    let reached!: () => void;
    this.hold = new Promise<void>((r) => (release = r));
    this.holdReached = new Promise<void>((r) => (reached = r));
    this.onHold = reached;
    return () => {
      this.hold = null;
      release();
    };
  }
  private onHold: (() => void) | null = null;

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }
  private async write(next: Settings): Promise<Settings> {
    const hold = this.hold;
    if (hold) {
      this.onHold?.();
      await hold;
    }
    this.value = structuredClone(next);
    return next;
  }
  async get(): Promise<Settings> {
    return structuredClone(this.value);
  }
  set(settings: Settings): Promise<Settings> {
    return this.exclusive(() => this.write(settings));
  }
  update(mutator: (current: Settings) => Settings | null): Promise<Settings> {
    return this.exclusive(async () => {
      const current = structuredClone(this.value);
      const next = mutator(current);
      return next ? this.write(next) : current;
    });
  }
}

export interface Call {
  url: string;
  init?: RequestInit;
}

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
}

/** A fake fetch that answers from `handler` and records every call. No network. */
export function fakeFetch(handler: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = async (url: string, init?: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    return handler(call);
  };
  return { fn, calls };
}

export function formOf(call: Call): URLSearchParams {
  return new URLSearchParams(String(call.init?.body ?? ""));
}

export const SAMPLE_SPOTIFY = {
  accessToken: "AT-old",
  accessTokenExpiresAt: 1_000_000,
  refreshToken: "RT-old",
  revision: "rev-A",
  scopes: ["playlist-read-private"],
  userId: "u1",
  displayName: "Sam",
  connectedAt: "2026-01-01T00:00:00.000Z",
};
