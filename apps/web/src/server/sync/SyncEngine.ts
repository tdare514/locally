import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { PendingFilesState, PendingFromPhone, Release, SyncStatus } from "../../shared/types";
import { DEFAULT_SYNC_BASE_URL } from "../../shared/types";
import { NotFoundError, PublicError, ValidationError } from "../../shared/errors";
import type { SettingsStore } from "../config/SettingsStore";
import type { FileSystem } from "../fs/FileSystem";
import type { ReleaseService } from "../releases/ReleaseService";
import type { ReleaseSyncHooks } from "../releases/ReleaseSyncHooks";
import type { PlayCountStore } from "../plays/PlayCountStore";
import { batchPlayEntries, pendingPlayEntries } from "../plays/releasePlays";
import { fromSyncRecord, toSyncRecord, type SyncRecord } from "./SyncRecord";
import {
  RELEASE_PAGE_LIMIT,
  SyncConflictError,
  SyncRequestError,
  type SyncApi,
  type SyncFileToUpload,
} from "./SyncApi";
import type { MissingMark, SyncStateStore } from "./SyncState";

/** Builds a `SyncApi` for a given base URL/token; a factory (not a singleton) because both can change while the app runs. */
export type SyncApiFactory = (baseUrl: string, token: string | null) => SyncApi;

/** The HTTP status of a 4xx the service will keep giving for the same batch (not 401, which is a
 * sign-in problem, or 429, which is "slow down"), or null for any other failure. */
function permanentPlayRejection(err: unknown): number | null {
  if (err instanceof SyncConflictError) return 409;
  if (err instanceof SyncRequestError && err.status >= 400 && err.status < 500 && err.status !== 429) {
    return err.status;
  }
  return null;
}

/** Guard against a misbehaving or hostile server: a `pullOnce` reconcile stops after this many pages. */
export const MAX_PULL_PAGES_PER_RECONCILE = 100;

/** The files-missing check (#172) runs at most this often, and only while releases are pending. */
export const MISSING_CHECK_SPACING_MS = 10 * 60_000;

/** A release whose record is this old and whose files are still missing has "never reached" the server. */
export const NEVER_REACHED_AFTER_MS = 60 * 60_000;

/**
 * Where a pending release's files stand. No mark (the check did not list it, or never ran) is the
 * normal case. A mark is "arriving" on a release's first sighting while its record is under an hour
 * old, and "waiting" once a later check lists it again or the record is an hour old.
 */
function filesStateFor(record: SyncRecord, mark: MissingMark | undefined, nowMs: number): PendingFilesState | undefined {
  if (!mark) return undefined;
  const ageMs = nowMs - Date.parse(record.updatedAt);
  return mark.stillMissing || ageMs >= NEVER_REACHED_AFTER_MS ? "waiting" : "arriving";
}

function pendingSummary(record: SyncRecord, filesState: PendingFilesState | undefined): PendingFromPhone {
  const meta = fromSyncRecord(record);
  return {
    id: meta.id,
    origin: record.origin,
    title: meta.title,
    artist: meta.artist,
    kind: meta.kind,
    trackCount: meta.tracks.length,
    ...(filesState ? { filesState } : {}),
  };
}

/**
 * Lowercase hex sha256 of a file's bytes. Covers are small images, so this
 * reads the whole file rather than adding a streaming `sha256` method to
 * `FileSystem` (which already exposes `readFile`) and updating every fake
 * that implements it.
 */
async function sha256File(fs: FileSystem, filePath: string): Promise<string> {
  const bytes = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function contentTypeFor(name: string): string {
  const ext = path.extname(name).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".m4a") return "audio/mp4";
  return "audio/mpeg";
}

/**
 * Mirrors the local library to the hosted sync service (`spec/sync.md`).
 * Push and tombstone are wired in as `ReleaseSyncHooks` so `ReleaseService`
 * can fire-and-forget them after a successful local mutation; `reconcile()`
 * is the pull side, run on a timer (see `startPolling`) and on demand from
 * "Sync now". Every public method swallows its own errors into `lastError`
 * rather than throwing back into the caller - a flaky sync service should
 * never fail the user's import/edit/delete.
 */
export class SyncEngine implements ReleaseSyncHooks {
  private running = false;
  private lastRunAt: string | null = null;
  private lastError: string | null = null;
  private quota: SyncStatus["quota"] = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  /** So a batch the service keeps refusing logs once, not on every reconcile. */
  private loggedPlayRejection = false;
  /** When the files-missing check last ran (#172): in memory, so a restart simply checks again. */
  private lastMissingCheckMs: number | null = null;

  constructor(
    private readonly settings: SettingsStore,
    private readonly syncState: SyncStateStore,
    private readonly releases: ReleaseService,
    private readonly fs: FileSystem,
    private readonly apiFactory: SyncApiFactory,
    private readonly deviceName: () => string = () => os.hostname(),
    /** This Mac's play counts (#107); null in tests that don't care, which skips the play push. */
    private readonly playStore: PlayCountStore | null = null,
    /** The clock; tests pass a fake one to step through the "arriving" and "waiting" states. */
    private readonly now: () => Date = () => new Date()
  ) {}

  // --- ReleaseSyncHooks -----------------------------------------------------

  onImported(release: Release): void {
    void this.push(release);
  }

  onUpdated(release: Release): void {
    void this.push(release);
  }

  onCoverReplaced(release: Release): void {
    void this.push(release);
  }

  onDeleted(release: Release): void {
    void this.tombstone(release.id);
  }

  // --- Status -----------------------------------------------------------

  async status(): Promise<SyncStatus> {
    const settings = await this.settings.get();
    const state = await this.syncState.get();
    const signedIn = !!settings.sync?.deviceToken;
    const nowMs = this.now().getTime();
    return {
      signedIn,
      email: settings.sync?.email ?? null,
      baseUrl: settings.sync?.baseUrl ?? DEFAULT_SYNC_BASE_URL,
      deviceName: signedIn ? this.deviceName() : null,
      lastRunAt: this.lastRunAt,
      lastError: this.lastError,
      pendingFromPhone: Object.values(state.pendingFromPhone).map((record) =>
        pendingSummary(record, filesStateFor(record, state.missingFiles[record.id], nowMs))
      ),
      quota: this.quota,
    };
  }

  // --- Push / tombstone (outgoing) --------------------------------------

  private async currentApi(): Promise<{ api: SyncApi; baseUrl: string; token: string } | null> {
    const settings = await this.settings.get();
    if (!settings.sync?.deviceToken) return null;
    const baseUrl = settings.sync.baseUrl;
    const token = settings.sync.deviceToken;
    return { api: this.apiFactory(baseUrl, token), baseUrl, token };
  }

  async push(release: Release): Promise<void> {
    try {
      const ctx = await this.currentApi();
      if (!ctx) return;
      await this.pushOne(ctx.api, release);
      this.lastError = null;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
    } finally {
      this.lastRunAt = new Date().toISOString();
    }
  }

  async tombstone(id: string): Promise<void> {
    try {
      const ctx = await this.currentApi();
      if (!ctx) return;
      await ctx.api.deleteRelease(id);

      const state = await this.syncState.get();
      delete state.pushedUpdatedAt[id];
      delete state.uploadedFiles[id];
      delete state.coverHash[id];
      delete state.pendingFromPhone[id];
      delete state.missingFiles[id];
      await this.syncState.set(state);

      // `lastVersion` only advances on a pull (see `pullOnce`): the version a
      // write returns can sit above another device's write this Mac hasn't
      // pulled yet, and jumping to it would skip that write for good.
      this.lastError = null;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
    } finally {
      this.lastRunAt = new Date().toISOString();
    }
  }

  private async bumpLastVersion(version: number): Promise<void> {
    const settings = await this.settings.get();
    if (settings.sync && version > settings.sync.lastVersion) {
      await this.settings.set({ ...settings, sync: { ...settings.sync, lastVersion: version } });
    }
  }

  private async pushOne(api: SyncApi, release: Release): Promise<void> {
    // `filePath`/`coverPath` come from the on-disk index, which is no more trusted here
    // than in `ReleaseService`: a tampered entry must not cause a file outside the
    // library to be statSize'd, hashed, or uploaded to the sync service. Checked before
    // any of that I/O happens.
    const settings = await this.settings.get();
    this.assertInsideLibrary(settings.libraryDir, release);

    const trackBytes: Record<string, number> = {};
    for (const t of release.tracks) {
      trackBytes[t.id] = await this.fs.statSize(t.filePath);
    }
    const coverHash = release.coverPath ? await sha256File(this.fs, release.coverPath) : null;
    const record = toSyncRecord(release, "mac", this.deviceName(), trackBytes, coverHash);

    const state = await this.syncState.get();
    const already = new Set(state.uploadedFiles[release.id] ?? []);
    // `uploadedFiles` is keyed by name alone, so it can't tell a replaced
    // cover (same name, new bytes) from a no-op. Treat it as not-yet-uploaded
    // whenever the hash of what's on disk now differs from what was last
    // uploaded, regardless of what `uploadedFiles` says.
    if (record.cover && state.coverHash[release.id] !== record.coverHash) {
      already.delete(record.cover);
    }
    const toUpload: { name: string; bytes: number; filePath: string }[] = [];

    for (const t of record.tracks) {
      if (already.has(t.file)) continue;
      const local = release.tracks.find((x) => x.id === t.id);
      if (!local) continue;
      toUpload.push({ name: t.file, bytes: t.bytes, filePath: local.filePath });
    }
    if (record.cover && release.coverPath && !already.has(record.cover)) {
      toUpload.push({
        name: record.cover,
        bytes: await this.fs.statSize(release.coverPath),
        filePath: release.coverPath,
      });
    }

    // PUT the record before requesting upload URLs: a release id only
    // belongs to this user once a row exists for it (`POST .../files` 404s
    // otherwise), so the metadata write has to land first. The record can
    // describe files that haven't finished uploading yet without issue.
    try {
      await api.putRelease(record);
    } catch (err) {
      if (err instanceof SyncConflictError) {
        await this.pullOnce(api);
        await api.putRelease(record);
      } else {
        throw err;
      }
    }

    if (toUpload.length > 0) {
      const files: SyncFileToUpload[] = toUpload.map((f) => ({
        name: f.name,
        bytes: f.bytes,
        contentType: contentTypeFor(f.name),
      }));
      const { uploads } = await api.createUploads(release.id, files);
      const uploadByName = new Map(uploads.map((u) => [u.name, u]));
      for (const f of toUpload) {
        const target = uploadByName.get(f.name);
        if (!target) continue; // server didn't offer an upload URL for this one; retried next reconcile
        await api.uploadFile(target, f.filePath);
      }
      const afterUpload = await this.syncState.get();
      afterUpload.uploadedFiles[release.id] = [...already, ...toUpload.map((f) => f.name)];
      if (record.coverHash) {
        afterUpload.coverHash[release.id] = record.coverHash;
      } else {
        delete afterUpload.coverHash[release.id];
      }
      await this.syncState.set(afterUpload);
    }

    const afterPut = await this.syncState.get();
    afterPut.pushedUpdatedAt[release.id] = release.updatedAt;
    await this.syncState.set(afterPut);
    // No `bumpLastVersion` here, as in `tombstone`: the next pull brings this
    // record back and `isOwnEcho` handles it.
  }

  // --- Pull / reconcile (incoming) --------------------------------------

  private async pullOnce(api: SyncApi): Promise<void> {
    const settings = await this.settings.get();
    if (!settings.sync) return;

    // A local cursor, not a re-read of `settings.sync.lastVersion`, drives each
    // iteration: only a pulled page's `nextVersion` ever advances `lastVersion`
    // (issue #37 — pushes must never advance it), and reading it back from
    // settings each time would just reproduce the value this loop already has.
    let cursor = settings.sync.lastVersion;

    for (let page = 0; page < MAX_PULL_PAGES_PER_RECONCILE; page++) {
      const { releases: remoteRecords, nextVersion, hasMore } = await api.listReleases(cursor, RELEASE_PAGE_LIMIT);

      if (remoteRecords.length === 0) {
        await this.bumpLastVersion(nextVersion);
        if (!hasMore) return;
        if (nextVersion <= cursor) {
          throw new Error("Sync pull stalled: the server reported more releases without advancing the cursor.");
        }
        cursor = nextVersion;
        continue;
      }

      const state = await this.syncState.get();

      for (const record of remoteRecords) {
        if (record.deleted) {
          const local = await this.releases.get(record.id);
          if (local) {
            await this.releases.delete(record.id);
          }
          delete state.pushedUpdatedAt[record.id];
          delete state.uploadedFiles[record.id];
          delete state.coverHash[record.id];
          delete state.pendingFromPhone[record.id];
          delete state.missingFiles[record.id];
          continue;
        }

        const local = await this.releases.get(record.id);
        if (!local) {
          // Any origin but "mac" is another device ("ios", "web", or one this build has never
          // heard of): offered in the tray, never mistaken for this Mac's own.
          if (record.origin !== "mac") {
            state.pendingFromPhone[record.id] = record;
          }
          continue;
        }

        delete state.pendingFromPhone[record.id];
        delete state.missingFiles[record.id];
        if (record.updatedAt > local.updatedAt) {
          // A v1 record (no `coverHash` key) or one without a cover carries no
          // change signal, so the cover is left alone as before.
          const coverName = record.cover;
          const coverHash = typeof record.coverHash === "string" ? record.coverHash : null;
          let coverChanged = false;
          if (coverName && coverHash) {
            const localCoverHash = local.coverPath ? await sha256File(this.fs, local.coverPath) : null;
            coverChanged = localCoverHash !== coverHash;
          }

          if (coverChanged && coverName && coverHash) {
            const dir = await this.fs.makeTempDir("sli-sync-cover-");
            try {
              try {
                const { url } = await api.downloadUrl(record.id, coverName);
                await api.downloadFile(url, path.join(dir, coverName));
              } catch (err) {
                // A record can be visible before the other device finishes
                // uploading its cover (spec/sync.md), same as
                // acceptFromPhone's downloads. Throw rather than falling back
                // to a text-only update: the error propagates out of
                // pullOnce uncaught, so this run's `syncState.set` and
                // `bumpLastVersion` never happen and the whole record - cover
                // included - is retried in full on the next reconcile.
                const message = err instanceof Error ? err.message : "";
                if (/not found|404/i.test(message)) {
                  throw new PublicError(
                    "The other device hasn't finished uploading this cover yet. It will retry on the next sync."
                  );
                }
                throw err;
              }
              await this.releases.applyRemote(record, { newCoverPath: path.join(dir, coverName) });
              state.coverHash[record.id] = coverHash;
              // The Mac just downloaded these bytes from remote storage, so they're
              // already there - record the cover as uploaded to avoid re-uploading
              // what was just pulled down.
              const already = new Set(state.uploadedFiles[record.id] ?? []);
              already.add(coverName);
              state.uploadedFiles[record.id] = [...already];
            } finally {
              await this.fs.removeRecursive(dir);
            }
          } else {
            await this.releases.applyRemote(record);
          }

          // A record this Mac wrote itself, back newer than its local copy, is
          // a push whose `PUT` landed but whose uploads then failed. Leaving
          // `pushedUpdatedAt` behind makes the back-fill below finish that
          // push (only files not in `uploadedFiles` go up again); marking it
          // pushed here would strand those files for good.
          if (!this.isOwnEcho(record)) {
            state.pushedUpdatedAt[record.id] = record.updatedAt;
          }
        }
      }

      await this.syncState.set(state);
      await this.bumpLastVersion(nextVersion);

      if (!hasMore) return;
      if (nextVersion <= cursor) {
        throw new Error("Sync pull stalled: the server reported more releases without advancing the cursor.");
      }
      cursor = nextVersion;
    }

    throw new Error(`Sync pull did not finish after ${MAX_PULL_PAGES_PER_RECONCILE} pages; stopping this reconcile.`);
  }

  private isOwnEcho(record: SyncRecord): boolean {
    return record.origin === "mac" && record.originDevice === this.deviceName();
  }

  /** Same shape as `ReleaseService.assertInsideLibrary`: inside the library dir and not the dir itself. */
  private assertInsideLibrary(libraryDir: string, release: Release): void {
    const checkPath = (target: string) => {
      if (!this.fs.isInside(libraryDir, target) || path.resolve(target) === path.resolve(libraryDir)) {
        throw new ValidationError(`Refusing to sync a file outside the library directory (release ${release.id})`);
      }
    };
    for (const t of release.tracks) checkPath(t.filePath);
    if (release.coverPath) checkPath(release.coverPath);
  }

  /**
   * Guarded against overlapping runs; safe to call from a timer and from
   * "Sync now" at once. `running` is set synchronously (before the first
   * `await`) so two calls made back-to-back in the same tick can't both slip
   * past the guard.
   */
  async reconcile(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const settings = await this.settings.get();
      if (!settings.sync?.deviceToken) return;

      const api = this.apiFactory(settings.sync.baseUrl, settings.sync.deviceToken);

      await this.pullOnce(api);

      // Back-fill: push any local release whose current `updatedAt` hasn't been pushed yet.
      const state = await this.syncState.get();
      const localReleases = await this.releases.list();
      for (const release of localReleases) {
        if (state.pushedUpdatedAt[release.id] !== release.updatedAt) {
          try {
            await this.pushOne(api, release);
          } catch (err) {
            // A tampered index entry must not block every other release from syncing;
            // any other failure (network, server error, ...) still aborts the run as before,
            // and this release is retried on the next reconcile.
            if (err instanceof ValidationError) {
              console.warn(`SyncEngine: skipping push of release ${release.id}: ${err.message}`);
              continue;
            }
            throw err;
          }
        }
      }

      await this.checkMissingFiles(api);

      try {
        const me = await api.me();
        this.quota = me.quota;
      } catch {
        // Quota is a nice-to-have on the status card; don't fail the whole run for it.
      }

      // After the releases above, so the service already holds the release each count belongs to
      // (it ignores counts for a release it doesn't have).
      await this.pushPlays(api);

      this.lastError = null;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
    } finally {
      this.lastRunAt = new Date().toISOString();
      this.running = false;
    }
  }

  /**
   * Sends every play count that is ahead of what was last pushed, at most 500 per request, and
   * records each request as pushed once the service accepts it. A failure throws with the rest
   * still pending, so the next reconcile (offline, 5xx) picks them up; a count that grew while a
   * request was in flight stays pending too, because the marker is the value that was sent.
   *
   * A batch the service refuses for good (a 4xx other than 401 and 429) is skipped for this
   * reconcile, left unmarked, and the later batches still go, so one bad batch can't hold the
   * rest back forever. A sign-out while a request is in flight (the store's epoch moved) stops
   * the push and marks nothing: those counts belong to the account that just went away.
   */
  private async pushPlays(api: SyncApi): Promise<void> {
    const store = this.playStore;
    if (!store) return;
    const epoch = store.pushedEpoch();
    const pending = pendingPlayEntries(await store.get());
    let refused = false;
    for (const batch of batchPlayEntries(pending)) {
      if (store.pushedEpoch() !== epoch) return;
      let result;
      try {
        result = await api.pushPlays(batch);
      } catch (err) {
        const status = permanentPlayRejection(err);
        if (status === null) throw err;
        refused = true;
        if (!this.loggedPlayRejection) {
          this.loggedPlayRejection = true;
          console.warn(`SyncEngine: the sync service refused a batch of ${batch.length} play counts (HTTP ${status}); skipping it`);
        }
        continue;
      }
      if (result.ignored > 0) {
        console.warn(`SyncEngine: the sync service ignored ${result.ignored} of ${batch.length} play counts`);
      }
      await store.markPushed(Object.fromEntries(batch.map((e) => [e.trackId, e.count])), epoch);
    }
    // A pass with nothing refused re-arms the log for the next time something is.
    if (!refused) this.loggedPlayRejection = false;
  }

  /**
   * Asks the service which pending releases have files that never landed (#172) and updates their
   * marks: a release listed for the first time is "arriving", one listed again is "waiting", and
   * one no longer listed drops out. Runs only while something is pending and at most every
   * `MISSING_CHECK_SPACING_MS`, an attempt counting even when it fails so an outage or a rate limit
   * is not hammered. Never fails the reconcile: a failed check, a 429 from the per-device limit
   * included, leaves the marks as they were and waits for the next eligible check with no error
   * line, and a service that answers 404 (before #170) clears them, which is today's plain tray.
   */
  private async checkMissingFiles(api: SyncApi): Promise<void> {
    if (Object.keys((await this.syncState.get()).pendingFromPhone).length === 0) return;

    const nowMs = this.now().getTime();
    const sinceLast = this.lastMissingCheckMs === null ? Infinity : nowMs - this.lastMissingCheckMs;
    // A negative gap means the clock moved back; check rather than wait out the difference.
    if (sinceLast >= 0 && sinceLast < MISSING_CHECK_SPACING_MS) return;
    this.lastMissingCheckMs = nowMs;

    let result;
    try {
      result = await api.missingFiles();
    } catch {
      return; // quiet skip: 429, an outage or a bad reply all keep the marks as they are
    }

    // Read again: an accept during the request may have taken a release out of the tray.
    const state = await this.syncState.get();
    const listed = new Set((result?.releases ?? []).map((r) => r.id));
    const marks: Record<string, MissingMark> = {};
    for (const id of Object.keys(state.pendingFromPhone)) {
      if (!listed.has(id)) continue;
      const earlier = state.missingFiles[id];
      marks[id] = earlier
        ? { firstSeenMissingAt: earlier.firstSeenMissingAt, stillMissing: true }
        : { firstSeenMissingAt: new Date(nowMs).toISOString(), stillMissing: false };
    }
    state.missingFiles = marks;
    await this.syncState.set(state);
  }

  /**
   * "Resync Mac and phone" (#172): reconciles now, then asks the account's other devices to upload
   * again. `asked` is false when the request did not go through for a reason that passes with time:
   * the per-device limit (429, the Mac's own checks share it) or a service with no such request
   * (404, before #170). The reconcile has run either way, and the tray says "Try again in a few
   * minutes" rather than showing an error. The phone does the uploading; when the files land, a
   * later check drops the release from the missing list.
   */
  async resync(): Promise<{ asked: boolean }> {
    const settings = await this.settings.get();
    if (!settings.sync?.deviceToken) {
      throw new PublicError("Sign in to sync first");
    }
    await this.reconcile();
    const api = this.apiFactory(settings.sync.baseUrl, settings.sync.deviceToken);
    try {
      return { asked: (await api.requestResync()) !== null };
    } catch (err) {
      if (err instanceof SyncRequestError && err.status === 429) return { asked: false };
      throw err;
    }
  }

  // --- Inbox ("From your devices") ----------------------------------------

  async acceptFromPhone(id: string): Promise<Release> {
    const settings = await this.settings.get();
    if (!settings.sync?.deviceToken) {
      throw new PublicError("Sign in to sync first");
    }
    const state = await this.syncState.get();
    const record = state.pendingFromPhone[id];
    if (!record) {
      throw new NotFoundError(`No pending release ${id} from your phone`);
    }
    // The tray never offers Send here; this stops a stale tray from walking into the 404 below.
    if (filesStateFor(record, state.missingFiles[id], this.now().getTime()) === "waiting") {
      throw new PublicError(
        "This song's files never reached the server. Use Resync in the tray to ask for them again."
      );
    }

    const api = this.apiFactory(settings.sync.baseUrl, settings.sync.deviceToken);
    const dir = await this.fs.makeTempDir("sli-sync-accept-");
    try {
      const names = [...record.tracks.map((t) => t.file), ...(record.cover ? [record.cover] : [])];
      for (const name of names) {
        try {
          const { url } = await api.downloadUrl(id, name);
          await api.downloadFile(url, path.join(dir, name));
        } catch (err) {
          // A record can be visible before the phone finishes uploading its files (spec/sync.md).
          const message = err instanceof Error ? err.message : "";
          if (/not found|404/i.test(message)) {
            throw new PublicError("Your phone hasn't finished uploading this song yet. Try again in a moment.");
          }
          throw err;
        }
      }

      const release = await this.releases.importSynced(record, dir);

      const fresh = await this.syncState.get();
      delete fresh.pendingFromPhone[id];
      delete fresh.missingFiles[id];
      fresh.pushedUpdatedAt[id] = record.updatedAt;
      fresh.uploadedFiles[id] = names;
      await this.syncState.set(fresh);

      return release;
    } finally {
      await this.fs.removeRecursive(dir);
    }
  }

  // --- Polling ------------------------------------------------------------

  /** Starts reconciling on a timer (idempotent - calling it twice keeps one timer). */
  startPolling(intervalMs = 30_000): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      void this.reconcile();
    }, intervalMs);
    if (typeof this.pollTimer.unref === "function") {
      this.pollTimer.unref();
    }
  }

  stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}
