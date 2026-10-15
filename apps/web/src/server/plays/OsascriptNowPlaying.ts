import { execFile } from "node:child_process";
import type { NowPlayingResult, SpotifyPlayerState, SpotifyNowPlaying } from "./SpotifyNowPlaying";

/**
 * Fixed JXA script: nothing from Spotify or the user is ever put into it. `running()` is
 * checked first and does not launch Spotify. Spotify's `duration` is in milliseconds.
 */
export const NOW_PLAYING_SCRIPT = `
const app = Application('Spotify');
let out;
if (!app.running()) {
  out = { running: false };
} else {
  let state = 'stopped';
  try { state = String(app.playerState()); } catch (e) {}
  let id = null;
  let durationMs = 0;
  try {
    const t = app.currentTrack;
    id = String(t.id());
    durationMs = Number(t.duration());
  } catch (e) {}
  let positionSec = 0;
  try { positionSec = Number(app.playerPosition()); } catch (e) {}
  out = { running: true, state: state, positionSec: positionSec, id: id, durationMs: durationMs };
}
JSON.stringify(out);
`;

const OSASCRIPT = "/usr/bin/osascript";
const TIMEOUT_MS = 4000;

export type ExecFn = (
  file: string,
  args: string[],
  options: { timeout: number },
) => Promise<{ stdout: string; stderr: string }>;

const defaultExec: ExecFn = (file, args, options) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { timeout: options.timeout, encoding: "utf-8" }, (err, stdout, stderr) => {
      if (err) {
        const e = err as Error & { stderr?: string };
        e.stderr = stderr;
        reject(e);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });

const STATES: readonly string[] = ["playing", "paused", "stopped"];

function parseOutput(stdout: string): NowPlayingResult {
  let json: unknown;
  try {
    json = JSON.parse(stdout.trim());
  } catch {
    return { error: "failed" };
  }
  if (!json || typeof json !== "object") return { error: "failed" };
  const j = json as Record<string, unknown>;
  if (j.running === false) return { running: false };
  if (j.running !== true) return { error: "failed" };
  const state = typeof j.state === "string" && STATES.includes(j.state) ? (j.state as SpotifyPlayerState) : "stopped";
  const positionSec = typeof j.positionSec === "number" && Number.isFinite(j.positionSec) ? j.positionSec : 0;
  const durationMs = typeof j.durationMs === "number" && Number.isFinite(j.durationMs) ? j.durationMs : 0;
  const id = typeof j.id === "string" && j.id.length > 0 ? j.id : null;
  return { running: true, state, id, positionSec, durationMs };
}

/** {@link SpotifyNowPlaying} backed by one `osascript -l JavaScript` call. */
export class OsascriptNowPlaying implements SpotifyNowPlaying {
  constructor(private readonly exec: ExecFn = defaultExec) {}

  async read(): Promise<NowPlayingResult> {
    try {
      const { stdout } = await this.exec(OSASCRIPT, ["-l", "JavaScript", "-e", NOW_PLAYING_SCRIPT], {
        timeout: TIMEOUT_MS,
      });
      return parseOutput(stdout);
    } catch (err) {
      const e = err as { message?: unknown; stderr?: unknown };
      const text = `${typeof e?.message === "string" ? e.message : ""}\n${typeof e?.stderr === "string" ? e.stderr : ""}`;
      if (text.includes("-1743")) return { error: "permission-denied" };
      return { error: "failed" };
    }
  }
}
