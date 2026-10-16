import fs from "node:fs/promises";
import path from "node:path";
import type { Settings, SpotifySettings, SyncSettings } from "../../shared/types";
import { defaultLibraryDir, settingsDir, settingsFilePath } from "./paths";
import type { SettingsStore } from "./SettingsStore";

async function ensureDirExists(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

/** Settings hold a sync device token and the Spotify tokens, so its directory and file are locked to the owner. */
const CONFIG_DIR_MODE = 0o700;
const CONFIG_FILE_MODE = 0o600;
let tmpCounter = 0;

/** Narrow an arbitrary JSON value into `SyncSettings`, or `null` if it doesn't look right. */
function parseSyncSettings(raw: unknown): SyncSettings | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<SyncSettings>;
  if (typeof r.baseUrl !== "string" || r.baseUrl.trim().length === 0) return null;
  return {
    baseUrl: r.baseUrl,
    deviceToken: typeof r.deviceToken === "string" ? r.deviceToken : null,
    email: typeof r.email === "string" ? r.email : null,
    lastVersion: typeof r.lastVersion === "number" && Number.isFinite(r.lastVersion) ? r.lastVersion : 0,
  };
}

/** Narrow an arbitrary JSON value into `SpotifySettings`, or `null` if any required field is off. */
function parseSpotifySettings(raw: unknown): SpotifySettings | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<SpotifySettings>;
  if (typeof r.refreshToken !== "string" || r.refreshToken.length === 0) return null;
  if (typeof r.accessToken !== "string") return null;
  if (typeof r.accessTokenExpiresAt !== "number" || !Number.isFinite(r.accessTokenExpiresAt)) return null;
  if (typeof r.userId !== "string" || r.userId.length === 0) return null;
  if (!Array.isArray(r.scopes)) return null;
  return {
    accessToken: r.accessToken,
    accessTokenExpiresAt: r.accessTokenExpiresAt,
    refreshToken: r.refreshToken,
    revision: typeof r.revision === "string" ? r.revision : "",
    scopes: r.scopes.filter((s): s is string => typeof s === "string"),
    userId: r.userId,
    displayName: typeof r.displayName === "string" && r.displayName ? r.displayName : r.userId,
    connectedAt: typeof r.connectedAt === "string" ? r.connectedAt : "",
  };
}

/**
 * One writer at a time per process, shared by every store instance: a read-modify-write in
 * `update()` can't interleave with another one or with `set()`.
 */
let writeChain: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.catch(() => undefined);
  return run;
}

/**
 * JSON-file backed {@link SettingsStore}. Settings live at
 * `~/.spotify-local-import/settings.json`; a missing file is treated as
 * "first run" and seeded with defaults (and the default library dir is
 * created) rather than being an error.
 */
export class FileSettingsStore implements SettingsStore {
  async get(): Promise<Settings> {
    const file = settingsFilePath();
    let raw: string;
    try {
      raw = await fs.readFile(file, "utf-8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        const defaults: Settings = {
          libraryDir: defaultLibraryDir(),
          sync: null,
          trackPlays: false,
          playsPromptAnswered: false,
        };
        await this.writeSettings(defaults);
        return defaults;
      }
      throw err;
    }

    let parsed: Partial<Settings>;
    try {
      parsed = JSON.parse(raw) as Partial<Settings>;
    } catch {
      // A corrupt settings.json (e.g. a crash mid-write, or manual editing
      // gone wrong) must not brick the app. Move the bad file aside for
      // inspection and start fresh from defaults, rather than throwing.
      const corruptPath = `${file}.corrupt-${Date.now()}`;
      await fs.rename(file, corruptPath);
      console.warn(`${file} contained invalid JSON; moved it to ${corruptPath} and reset to defaults.`);
      const defaults: Settings = {
        libraryDir: defaultLibraryDir(),
        sync: null,
        trackPlays: false,
        playsPromptAnswered: false,
      };
      await this.writeSettings(defaults);
      return defaults;
    }

    const libraryDir =
      typeof parsed.libraryDir === "string" && parsed.libraryDir.trim().length > 0
        ? parsed.libraryDir
        : defaultLibraryDir();
    const spotifySourceDismissed =
      typeof parsed.spotifySourceDismissed === "boolean" ? parsed.spotifySourceDismissed : false;
    const trackPlays = typeof parsed.trackPlays === "boolean" ? parsed.trackPlays : false;
    const playsPromptAnswered =
      typeof parsed.playsPromptAnswered === "boolean" ? parsed.playsPromptAnswered : false;
    const spotify = parseSpotifySettings(parsed.spotify);
    return {
      libraryDir,
      sync: parseSyncSettings(parsed.sync),
      spotifySourceDismissed,
      trackPlays,
      playsPromptAnswered,
      ...(spotify ? { spotify } : {}),
    };
  }

  set(settings: Settings): Promise<Settings> {
    return exclusive(() => this.writeSettings(settings));
  }

  update(mutator: (current: Settings) => Settings | null): Promise<Settings> {
    return exclusive(async () => {
      const current = await this.get();
      const next = mutator(current);
      return next ? this.writeSettings(next) : current;
    });
  }

  private async writeSettings(settings: Settings): Promise<Settings> {
    const dir = settingsDir();
    await fs.mkdir(dir, { recursive: true, mode: CONFIG_DIR_MODE });
    // mkdir's `mode` only applies when it creates the directory; force it on
    // an already-existing one too (e.g. left over from before this hardening).
    await fs.chmod(dir, CONFIG_DIR_MODE);
    await ensureDirExists(settings.libraryDir);

    const file = settingsFilePath();
    // Write to a tmp file first and rename into place, so a crash mid-write
    // never leaves a half-written (and then unparsable) settings.json.
    const tmpFile = path.join(dir, `.settings.json.tmp-${process.pid}-${Date.now()}-${tmpCounter++}`);
    await fs.writeFile(tmpFile, JSON.stringify(settings, null, 2), { encoding: "utf-8", mode: CONFIG_FILE_MODE });
    await fs.chmod(tmpFile, CONFIG_FILE_MODE);
    await fs.rename(tmpFile, file);
    return settings;
  }
}
