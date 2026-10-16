import type { SettingsStore } from "../../src/server/config/SettingsStore";
import type { Settings } from "../../src/shared/types";

export class MemorySettings implements SettingsStore {
  value: Settings = { libraryDir: "/tmp/lib", sync: null };
  async get(): Promise<Settings> {
    return structuredClone(this.value);
  }
  async set(settings: Settings): Promise<Settings> {
    this.value = structuredClone(settings);
    return settings;
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
  scopes: ["playlist-read-private"],
  userId: "u1",
  displayName: "Sam",
  connectedAt: "2026-01-01T00:00:00.000Z",
};
