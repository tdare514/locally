import { execFile } from "node:child_process";
import type { NowPlayingResult, SpotifyPlayerState, SpotifyNowPlaying } from "./SpotifyNowPlaying";

/**
 * Fixed JXA script: nothing from Spotify or the user is ever put into it. It must never
 * launch Spotify (#106, #148), so it targets the running process by pid, not the app by
 * name: an event to a process that has gone fails instead of relaunching it. A quit
 * mid-poll reads as not running; only -1743 (no Automation permission) is rethrown, so
 * it still maps to permission-denied. Spotify's `duration` is in milliseconds.
 */
export const NOW_PLAYING_SCRIPT = `
ObjC.import('AppKit');
function readSpotify() {
  const apps = $.NSRunningApplication.runningApplicationsWithBundleIdentifier('com.spotify.client');
  if (Number(apps.count) === 0) return { running: false };
  const proc = apps.objectAtIndex(0);
  if (proc.isTerminated) return { running: false };
  try {
    const app = Application(proc.processIdentifier);
    const state = String(app.playerState());
    let id = null;
    let durationMs = 0;
    try {
      const t = app.currentTrack;
      id = String(t.id());
      durationMs = Number(t.duration());
    } catch (e) {
      if (e.errorNumber === -1743) throw e;
    }
    const positionSec = Number(app.playerPosition());
    if (proc.isTerminated) return { running: false };
    return { running: true, state: state, positionSec: positionSec, id: id, durationMs: durationMs };
  } catch (e) {
    if (e.errorNumber === -1743) throw e;
    return { running: false };
  }
}
JSON.stringify(readSpotify());
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
