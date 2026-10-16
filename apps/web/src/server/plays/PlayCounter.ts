import type { SpotifyPlayerState } from "./SpotifyNowPlaying";

export const LOCAL_ID_PREFIX = "spotify:local:";

export interface PlaySample {
  /** Wall-clock time of the sample, ms since epoch. */
  at: number;
  running: boolean;
  state: SpotifyPlayerState;
  id: string | null;
  positionSec: number;
  durationMs: number;
}

const BACKWARD_SEEK_SEC = 3;
const SEEK_SLACK_SEC = 2;
const MAX_THRESHOLD_SEC = 30;

interface Previous {
  at: number;
  positionSec: number;
  playing: boolean;
}

/** The last session before a reset, so a continuation of the same play isn't counted again (#228). */
interface LastSession {
  id: string;
  positionSec: number;
  at: number;
  listenedSec: number;
  counted: boolean;
}

/**
 * Pure state machine that decides when a Spotify local-file play counts. No I/O, no timers:
 * the caller feeds it samples and gets back the id when a play counts (once per session).
 */
export class PlayCounter {
  private sessionId: string | null = null;
  private listenedSec = 0;
  private counted = false;
  private prev: Previous | null = null;
  private last: LastSession | null = null;

  /** Feed one sample. Returns the Spotify id when this sample makes a play count, else null. */
  push(sample: PlaySample): string | null {
    const id = sample.running ? sample.id : null;
    if (!id || !id.startsWith(LOCAL_ID_PREFIX)) {
      this.reset();
      return null;
    }

    const wentBack = this.prev !== null && sample.positionSec < this.prev.positionSec - BACKWARD_SEEK_SEC;
    if (id !== this.sessionId || wentBack) {
      this.remember();
      this.sessionId = id;
      this.listenedSec = 0;
      this.counted = false;
      this.prev = null;
      // The same track resuming where the last session left off (the source switched, or Spotify
      // quit and came back) is the same play, not a new one. A replay from the start is not.
      const last = this.last;
      if (
        !wentBack &&
        last &&
        last.id === id &&
        sample.positionSec >= last.positionSec - BACKWARD_SEEK_SEC &&
        sample.positionSec <= last.positionSec + (sample.at - last.at) / 1000 + SEEK_SLACK_SEC
      ) {
        this.listenedSec = last.listenedSec;
        this.counted = last.counted;
      }
    }

    const playing = sample.state === "playing";
    if (playing && this.prev?.playing) {
      const delta = sample.positionSec - this.prev.positionSec;
      const wallGapSec = (sample.at - this.prev.at) / 1000;
      if (delta > 0 && delta <= wallGapSec + SEEK_SLACK_SEC) this.listenedSec += delta;
    }
    this.prev = { at: sample.at, positionSec: sample.positionSec, playing };

    if (this.counted) return null;
    const durationSec = sample.durationMs > 0 ? sample.durationMs / 1000 : 0;
    const threshold = durationSec > 0 ? Math.min(MAX_THRESHOLD_SEC, 0.9 * durationSec) : MAX_THRESHOLD_SEC;
    if (this.listenedSec >= threshold) {
      this.counted = true;
      return id;
    }
    return null;
  }

  /** Keep the session that is ending, replacing any older memory. */
  private remember(): void {
    if (this.sessionId && this.prev) {
      this.last = {
        id: this.sessionId,
        positionSec: this.prev.positionSec,
        at: this.prev.at,
        listenedSec: this.listenedSec,
        counted: this.counted,
      };
    }
  }

  private reset(): void {
    this.remember();
    this.sessionId = null;
    this.listenedSec = 0;
    this.counted = false;
    this.prev = null;
  }
}
