import type { SyncSettings } from "../../shared/types";

/**
 * Validates and applies a change to `sync.baseUrl` (issue #11).
 *
 * Security rule: `deviceToken` is a bearer credential issued by the host at
 * `sync.baseUrl`. If the user points the app at a different host, the next
 * reconcile must never carry that token to the new host — so changing the
 * base URL always signs the Mac out (clears `deviceToken`, `email`, and
 * `lastVersion`). Re-saving the *same* base URL is a no-op that preserves
 * the existing session. We also require `https:` for any non-loopback host,
 * since the token would otherwise cross the network in the clear.
 *
 * The settings policy (`src/server/config/settingsUpdate.ts`) also resets the local
 * `SyncState` (pushed versions, uploaded files, cover hashes, pending phone
 * releases) whenever this function returns a fresh `sync` object, since that
 * bookkeeping was built against the old host and must not be read as if it
 * applied to the new one.
 */

export type SyncBaseUrlResult = { ok: true; sync: SyncSettings } | { ok: false; error: string };

/** True for localhost/loopback hostnames only (not `*.localhost`, not LAN IPs). */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

export function applySyncBaseUrlChange(
  current: SyncSettings | null,
  rawBaseUrl: string
): SyncBaseUrlResult {
  const trimmed = rawBaseUrl.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "sync.baseUrl must be a non-empty string" };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "sync.baseUrl must be a valid URL" };
  }

  const isHttps = parsed.protocol === "https:";
  const isHttp = parsed.protocol === "http:";
  if (!isHttps && !(isHttp && isLoopbackHost(parsed.hostname))) {
    return {
      ok: false,
      error: "sync.baseUrl must use https (http is only allowed for localhost)",
    };
  }

  const baseUrl = parsed.toString().replace(/\/$/, "");

  if (current === null) {
    return { ok: true, sync: { baseUrl, deviceToken: null, email: null, lastVersion: 0 } };
  }

  if (current.baseUrl === baseUrl) {
    return { ok: true, sync: current };
  }

  // The base URL changed: the existing token was issued for the old host
  // and must never be sent to the new one, so this signs the Mac out.
  return { ok: true, sync: { baseUrl, deviceToken: null, email: null, lastVersion: 0 } };
}
