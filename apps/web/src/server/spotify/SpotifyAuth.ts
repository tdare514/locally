import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { SettingsStore } from "../config/SettingsStore";
import type { SpotifySettings } from "../../shared/types";
import { SPOTIFY_REDIRECT_PORT, SPOTIFY_SCOPES } from "./config";
import {
  SPOTIFY_TOKEN_URL,
  SpotifyApiError,
  fetchMe,
  type FetchLike,
} from "./SpotifyClient";

const LISTEN_HOST = "127.0.0.1";
const PENDING_TTL_MS = 10 * 60_000;

export const PORT_BUSY_MESSAGE = (port: number) =>
  `Port ${port} is in use, so Spotify sign-in can't finish. Quit what's using it and try again.`;
const DENIED_MESSAGE = "Spotify sign-in was cancelled.";
const FAILED_MESSAGE = "Spotify sign-in didn't finish. Try again.";
const TIMEOUT_MESSAGE = "Spotify sign-in timed out. Try again.";

/** A sign-in that couldn't start. The message is safe to show. */
export class SpotifyAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpotifyAuthError";
  }
}

export function base64Url(buf: Buffer): string {
  return buf.toString("base64url");
}

/** A 64-character PKCE code verifier. */
export function newVerifier(): string {
  return base64Url(crypto.randomBytes(48));
}

export function challengeFor(verifier: string): string {
  return base64Url(crypto.createHash("sha256").update(verifier).digest());
}

export function newState(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function buildAuthorizeUrl(p: {
  clientId: string;
  redirectUri: string;
  challenge: string;
  state: string;
}): string {
  const q = [
    ["response_type", "code"],
    ["client_id", p.clientId],
    ["redirect_uri", p.redirectUri],
    ["code_challenge_method", "S256"],
    ["code_challenge", p.challenge],
    ["state", p.state],
    ["scope", SPOTIFY_SCOPES],
  ];
  return `https://accounts.spotify.com/authorize?${q.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function page(message: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Locally</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font:16px system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#111;color:#eee}p{max-width:28rem;padding:1rem;text-align:center}</style></head><body><p>${escapeHtml(message)}</p></body></html>`;
}

function statesMatch(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

interface Pending {
  verifier: string;
  state: string;
  startedAt: number;
  redirectUri: string;
}

export interface SpotifyAuthOptions {
  settings: SettingsStore;
  clientId: string;
  fetch?: FetchLike;
  now?: () => number;
  /** Listener port. Tests pass 0 for an ephemeral one; Spotify only accepts the registered 8888. */
  port?: number;
  /** How long a sign-in may stay open. */
  ttlMs?: number;
}

export interface CallbackResult {
  status: number;
  message: string;
}

/**
 * Spotify sign-in with PKCE (#239). `start()` opens a one-shot listener on 127.0.0.1 for the
 * redirect; it closes after the first callback that carries the right `state`, or after 10
 * minutes. The verifier and state live in memory only, for one sign-in at a time.
 */
export class SpotifyAuth {
  private readonly settings: SettingsStore;
  private readonly clientId: string;
  private readonly fetchFn: FetchLike;
  private readonly now: () => number;
  private readonly port: number;
  private readonly ttlMs: number;

  private pending: Pending | null = null;
  private finishing = false;
  private server: http.Server | null = null;
  private timer: NodeJS.Timeout | null = null;
  private generation = 0;
  /** Why the last sign-in failed, for Settings. Cleared when a new one starts. */
  lastError: string | null = null;

  constructor(opts: SpotifyAuthOptions) {
    this.settings = opts.settings;
    this.clientId = opts.clientId;
    this.fetchFn = opts.fetch ?? ((input, init) => fetch(input, init));
    this.now = opts.now ?? Date.now;
    this.port = opts.port ?? SPOTIFY_REDIRECT_PORT;
    this.ttlMs = opts.ttlMs ?? PENDING_TTL_MS;
  }

  /** True while the browser step or the code exchange is open. */
  isPending(): boolean {
    return this.pending !== null || this.finishing;
  }

  /** Begin a sign-in, replacing any earlier one. Returns the URL for the browser. */
  async start(): Promise<{ authorizeUrl: string }> {
    this.cancel();
    this.lastError = null;
    const gen = ++this.generation;

    const host = { expected: "" };
    const server = http.createServer((req, res) => void this.onRequest(req, res, host.expected));
    server.on("error", () => undefined); // after listening; a failure here just ends the sign-in
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (err: Error) => reject(err);
        server.once("error", onError);
        server.listen({ port: this.port, host: LISTEN_HOST, exclusive: true }, () => {
          server.off("error", onError);
          resolve();
        });
      });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "EADDRINUSE") throw new SpotifyAuthError(PORT_BUSY_MESSAGE(this.port));
      throw new SpotifyAuthError("Couldn't start Spotify sign-in on this Mac.");
    }
    if (gen !== this.generation) {
      // A newer start() or a cancel() ran while we were binding.
      server.close();
      throw new SpotifyAuthError("Spotify sign-in was replaced by a newer one.");
    }

    const listenPort = (server.address() as AddressInfo).port;
    host.expected = `${LISTEN_HOST}:${listenPort}`;
    const redirectUri = `http://${host.expected}/callback`;
    const verifier = newVerifier();
    const state = newState();
    this.pending = { verifier, state, startedAt: this.now(), redirectUri };
    this.server = server;
    this.timer = setTimeout(() => {
      if (this.generation !== gen || this.finishing) return;
      this.cancel();
      this.lastError = TIMEOUT_MESSAGE;
    }, this.ttlMs);
    this.timer.unref();

    return {
      authorizeUrl: buildAuthorizeUrl({ clientId: this.clientId, redirectUri, challenge: challengeFor(verifier), state }),
    };
  }

  /** Stop any pending sign-in and close its listener. */
  cancel(): void {
    this.generation++;
    this.pending = null;
    this.closeListener();
  }

  private closeListener(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const server = this.server;
    this.server = null;
    if (server) {
      server.close();
      server.closeIdleConnections();
    }
  }

  private async onRequest(req: http.IncomingMessage, res: http.ServerResponse, expectedHost: string): Promise<void> {
    // A DNS-rebinding page reaches this port under its own Host name. Refuse before anything else.
    if (req.headers.host !== expectedHost) {
      this.respond(res, 400, "This sign-in link isn't valid. Start again from Locally.");
      return;
    }
    let url: URL | null = null;
    try {
      url = new URL(req.url ?? "", `http://${LISTEN_HOST}`);
    } catch {
      url = null;
    }
    if (req.method !== "GET" || !url || url.pathname !== "/callback") {
      this.respond(res, 404, "Not found.");
      return;
    }
    const { status, message } = await this.handleCallback(url.searchParams);
    this.respond(res, status, message);
  }

  private respond(res: http.ServerResponse, status: number, message: string): void {
    res.writeHead(status, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
      Connection: "close",
    });
    res.end(page(message));
  }

  /**
   * Handle the redirect from Spotify. A missing, unknown or reused `state` is refused and changes
   * nothing, so a stray request can't end or poison a real sign-in. A matching `state` is
   * consumed before anything else happens: it works once.
   */
  async handleCallback(params: URLSearchParams): Promise<CallbackResult> {
    const pending = this.pending;
    const state = params.get("state");
    if (!pending || !state || !statesMatch(state, pending.state)) {
      return { status: 400, message: "This sign-in link isn't valid. Start again from Locally." };
    }
    this.pending = null;
    this.finishing = true;
    this.closeListener();
    const gen = this.generation;
    try {
      if (params.get("error")) {
        this.lastError = DENIED_MESSAGE;
        return { status: 400, message: DENIED_MESSAGE };
      }
      const code = params.get("code");
      if (!code) {
        this.lastError = FAILED_MESSAGE;
        return { status: 400, message: FAILED_MESSAGE };
      }
      await this.exchange(code, pending, gen);
      this.lastError = null;
      return { status: 200, message: "Connected to Spotify. You can close this tab and go back to Locally." };
    } catch (err) {
      const message = err instanceof SpotifyApiError && err.code === "notOnTesterList" ? err.message : FAILED_MESSAGE;
      this.lastError = message;
      return { status: 400, message };
    } finally {
      this.finishing = false;
    }
  }

  private async exchange(code: string, pending: Pending, gen: number): Promise<void> {
    let res: Response;
    try {
      res = await this.fetchFn(SPOTIFY_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: pending.redirectUri,
          client_id: this.clientId,
          code_verifier: pending.verifier,
        }).toString(),
      });
    } catch {
      throw new SpotifyApiError("offline", "Couldn't reach Spotify. Check your connection.");
    }
    if (!res.ok) throw new SpotifyApiError("http", `Spotify refused the sign-in (${res.status}).`);
    const body = (await res.json().catch(() => null)) as {
      access_token?: unknown;
      refresh_token?: unknown;
      expires_in?: unknown;
      scope?: unknown;
    } | null;
    if (
      !body ||
      typeof body.access_token !== "string" ||
      typeof body.refresh_token !== "string" ||
      !body.refresh_token ||
      typeof body.expires_in !== "number"
    ) {
      throw new SpotifyApiError("http", "Spotify sent an answer Locally couldn't read.");
    }
    const me = await fetchMe(body.access_token, this.fetchFn);
    const now = this.now();
    const connection: SpotifySettings = {
      accessToken: body.access_token,
      accessTokenExpiresAt: now + body.expires_in * 1000,
      refreshToken: body.refresh_token,
      revision: crypto.randomBytes(8).toString("hex"),
      scopes: typeof body.scope === "string" && body.scope ? body.scope.split(/\s+/) : SPOTIFY_SCOPES.split(" "),
      userId: me.id,
      displayName: me.displayName,
      connectedAt: new Date(now).toISOString(),
    };
    // The check and the write are one step: a disconnect (or a new start) that ran during the
    // earlier awaits, or that is queued ahead of this write, wins and nothing is stored.
    let stored = false;
    await this.settings.update((current) => {
      if (gen !== this.generation) return null;
      stored = true;
      return { ...current, spotify: connection };
    });
    if (!stored) throw new SpotifyAuthError("Spotify sign-in was cancelled.");
  }

  /** Disconnect: stop any pending sign-in and delete the stored tokens. */
  async disconnect(): Promise<void> {
    this.cancel();
    await this.settings.update((current) => {
      if (!current.spotify) return null;
      const { spotify: _removed, ...rest } = current;
      void _removed;
      return rest;
    });
  }
}
