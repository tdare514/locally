import { LOCAL_ID_PREFIX } from "./LocalTrackResolver";

/** What `GET /v1/me/player` told us, reduced to what counting needs. */
export type PlayerSample =
  | { kind: "idle" }
  | { kind: "item"; uri: string | null; progressMs: number; durationMs: number | null; isPlaying: boolean };

/** The last Locally track seen for a user; stored on `spotify_links` and nothing else is kept. */
export interface SessionState {
  uri: string;
  releaseId: string;
  trackId: string;
  progressMs: number;
  durationMs: number | null;
  /** Epoch ms of the sample that last updated this session. */
  at: number;
  counted: boolean;
}

export interface LocalIds {
  releaseId: string;
  trackId: string;
}

export interface CountOutcome {
  /** The state to store: null clears the session. */
  next: SessionState | null;
  counted: boolean;
}

/** The Mac's resume rules (`PlayCounter.ts`): a seek back of more than 3 s, or 10 minutes apart, is a new play. */
const BACKWARD_SEEK_MS = 3000;
export const SESSION_GAP_MS = 10 * 60 * 1000;
const MAX_THRESHOLD_MS = 30_000;

function isLocalUri(uri: string | null): uri is string {
  return uri !== null && uri.startsWith(LOCAL_ID_PREFIX);
}

/** True when this sample is a local item whose uri differs from the session's, so the caller must resolve it. */
export function needsResolve(prev: SessionState | null, sample: PlayerSample): boolean {
  return sample.kind === "item" && isLocalUri(sample.uri) && prev?.uri !== sample.uri;
}

export function thresholdMs(durationMs: number | null): number {
  return durationMs !== null && durationMs > 0 ? Math.min(MAX_THRESHOLD_MS, 0.9 * durationMs) : MAX_THRESHOLD_MS;
}

/** True when a sample of the same uri, at `progressMs` and time `at`, is still `prev`'s session (no big seek back, no long gap). */
export function continuesSession(prev: SessionState, progressMs: number, at: number): boolean {
  return progressMs >= prev.progressMs - BACKWARD_SEEK_MS && at - prev.at <= SESSION_GAP_MS;
}

/**
 * One step of the server's counting rule (#303 §5). Pure: `ids` is only read when `needsResolve` is true
 * (null means the uri did not resolve); otherwise the session's own ids are reused.
 * - idle (a 204) keeps the session as it is;
 * - an item that isn't local, or doesn't resolve, clears it;
 * - a session counts once, at the first sample at or past the threshold that is playing, or in the same session
 *   with progress that moved forward (it played in between, then was paused). A new session counts only while
 *   playing, so a track first seen paused past the threshold never counts, however often it is seen.
 */
export function countSample(prev: SessionState | null, sample: PlayerSample, at: number, ids: LocalIds | null): CountOutcome {
  if (sample.kind === "idle") return { next: prev, counted: false };
  if (!isLocalUri(sample.uri)) return { next: null, counted: false };

  const uri = sample.uri;
  const sameUri = prev !== null && prev.uri === uri;
  const resolved = sameUri ? { releaseId: prev.releaseId, trackId: prev.trackId } : ids;
  if (!resolved) return { next: null, counted: false };

  const sameSession = prev !== null && sameUri && continuesSession(prev, sample.progressMs, at);
  const alreadyCounted = sameSession && prev.counted;

  let counted = false;
  if (!alreadyCounted && sample.progressMs >= thresholdMs(sample.durationMs)) {
    counted = sample.isPlaying || (sameSession && sample.progressMs > prev.progressMs);
  }

  return {
    next: {
      uri,
      releaseId: resolved.releaseId,
      trackId: resolved.trackId,
      progressMs: sample.progressMs,
      durationMs: sample.durationMs,
      at,
      counted: alreadyCounted || counted,
    },
    counted,
  };
}
