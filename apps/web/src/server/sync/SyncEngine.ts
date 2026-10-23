import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { PendingFilesState, PendingFromPhone, Release, SyncStatus } from "../../shared/types";
import { DEFAULT_SYNC_BASE_URL } from "../../shared/types";
import { NotFoundError, PublicError, ValidationError } from "../../shared/errors";
import type { SettingsStore } from "../config/SettingsStore";
import type { FileSystem } from "../fs/FileSystem";
import { assertReadablePath, assertWritable, isAdoptedCoverPath } from "../adopt/guards";
import type { ReleaseService } from "../releases/ReleaseService";
import type { ReleaseSyncHooks } from "../releases/ReleaseSyncHooks";
import type { PlayCountStore } from "../plays/PlayCountStore";
import { batchPlayEntries, pendingPlayEntries } from "../plays/releasePlays";
import { invalidateServerSummary } from "../plays/serverSummary";
import {
  CoverHashSchema,
  SyncRecordRejectedError,
  fromSyncRecord,
  parseSyncRecord,
  toSyncRecord,
  type SyncRecord,
} from "./SyncRecord";
import type {
  CreateShareRequest,
  CreateShareResponse,
  FriendShare,
  ReceivedShare,
  SentSharesView,
} from "../../shared/shares";
import {
  RELEASE_PAGE_LIMIT,
  SyncConflictError,
  SyncRequestError,
  type MeResult,
  type SyncApi,
  type SyncFileToUpload,
} from "./SyncApi";
import type { MissingMark, SyncState, SyncStateStore } from "./SyncState";
import { hideKeyFor } from "../../lib/tray-sections";

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

/** The Mac re-sends its own releases' missing files (#218) at most this often, unless nudged or asked. */
export const SELF_HEAL_SPACING_MS = 6 * 60 * 60_000;

/** A release whose record is this old and whose files are still missing has "never reached" the server. */
export const NEVER_REACHED_AFTER_MS = 60 * 60_000;

/** After the phone re-sends a release, the next files-missing check is due within this long. */
export const RESENT_RECHECK_MS = 2 * 60_000;

/**
 * Where a pending release's files stand. No mark (the check did not list it, or never ran) is the
 * normal case. A mark is "arriving" on a release's first sighting while its record is under an hour
 * old, and "waiting" once a later check lists it again or the record is an hour old (counted from
 * the phone's re-send when there was one).
 */
function filesStateFor(record: SyncRecord, mark: MissingMark | undefined, nowMs: number): PendingFilesState | undefined {
  if (!mark) return undefined;
  const ageMs = nowMs - Date.parse(mark.resentAt ?? record.updatedAt);
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
    hideKey: hideKeyFor(record),
    sentAt: record.updatedAt,
  };
}

/**
 * Lowercase hex sha256 of a file's bytes. Covers are small images, so this
 * reads the whole file rather than adding a streaming `sha256` method to
 * `FileSystem` (which already exposes `readFile`) and updating every fake
 * that implements it.
 */
/** At most one localId re-push per adopted release in this long (#307). */
export const LOCAL_ID_REPUSH_MS = 24 * 60 * 60 * 1000;

/** True when the Mac holds a localId for a track that the pulled record has without one. */
function lostLocalId(local: Release, record: SyncRecord): boolean {
  const remote = new Map(record.tracks.map((t) => [t.id, t]));
  return local.tracks.some((t) => t.localId && remote.has(t.id) && !remote.get(t.id)?.localId);
}

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
  /** When the files-missing check is next due (#172); null is due now. In memory, so a restart simply checks again. */
  private nextMissingCheckMs: number | null = null;
  /** "Resync Mac and phone" was pressed (#218): the next reconcile heals this Mac's releases at once. In memory. */
  private healRequested = false;
  /** After a failed heal attempt, no new attempt before this (a 429 must not be retried every 30 s). In memory. */
  private nextHealAttemptMs: number | null = null;
  /** Live shares sent to this account (#182), from the last reconcile. In memory: the next reconcile refills it. */
  private received: ReceivedShare[] = [];
  /** Shares claimed here whose import then failed: they stay in the tray so the owner can try again. */
  private stuckClaims = new Set<string>();
  /** `publicSharesEnabled` from the last `GET /v1/me`; false until it has said true. */
  private publicShares = false;

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
      // Only the hidden releases still pending, so a sent or removed one doesn't linger in the payload.
      hiddenFromTray: Object.fromEntries(
        Object.entries(state.hiddenFromTray ?? {}).filter(([id]) => Object.hasOwn(state.pendingFromPhone, id))
      ),
      fromFriends: this.friendShares(),
      quota: this.quota,
    };
  }

  /** The tray's "From your friends" rows: shares not claimed yet, plus any claimed here whose import failed. */
  private friendShares(): FriendShare[] {
    return this.received
      .filter((r) => r.claimedAt === null || this.stuckClaims.has(r.id))
      .map((r) => ({
        id: r.id,
        fromEmail: r.from.email,
        title: r.snapshot.title,
        artist: r.snapshot.artist,
        kind: r.snapshot.kind,
        trackCount: r.snapshot.tracks.length,
        hasCover: r.snapshot.cover !== null,
        createdAt: r.createdAt,
      }));
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
    await this.settings.update((current) =>
      current.sync && version > current.sync.lastVersion
        ? { ...current, sync: { ...current.sync, lastVersion: version } }
        : null,
    );
  }

  private async pushOne(api: SyncApi, release: Release): Promise<void> {
    // `filePath`/`coverPath` come from the on-disk index, which is no more trusted here
    // than in `ReleaseService`: a tampered entry must not cause a file outside the
    // library to be statSize'd, hashed, or uploaded to the sync service. Checked before
    // any of that I/O happens.
    const settings = await this.settings.get();
    this.assertInsideLibrary(settings.libraryDir, release, settings.adoptRoots ?? []);

    const trackBytes: Record<string, number> = {};
    for (const t of release.tracks) {
      if (release.adopted) {
        // Details only: the size is informational, and an adopted file may have gone missing (#245).
        trackBytes[t.id] = await this.fs.statSize(t.filePath).catch(() => 0);
      } else {
        trackBytes[t.id] = await this.fs.statSize(t.filePath);
      }
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
      // An adopted release uploads only its cover: its audio is already where it is needed (#245).
      if (release.adopted) break;
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
        // An adopted record can't be sent to Spotify from anywhere: never offered in the tray, so it is
        // never counted as pending or missing (#245).
        if (!local && record.source === "adopted") continue;
        if (local?.adopted) {
          // Adopted releases are read-only here: a remote edit is not applied (it would re-tag the files).
          delete state.pendingFromPhone[record.id];
          delete state.missingFiles[record.id];
          // An older client edited it and dropped the track localIds the Mac holds: put them back (#307).
          if (record.source === "adopted" && lostLocalId(local, record)) this.queueLocalIdPush(state, local.id);
          continue;
        }
        if (!local) {
          // Any origin but "mac" is another device ("ios", "web", or one this build has never
          // heard of): offered in the tray, never mistaken for this Mac's own.
          if (record.origin !== "mac") {
            const prev = state.pendingFromPhone[record.id] as (SyncRecord & { version?: number }) | undefined;
            // Only a newer server version means the phone sent it again; the same version pulled
            // twice (a page fetched again) changes nothing. A pending record saved before versions
            // were kept counts as re-sent.
            const resent =
              prev !== undefined &&
              record.id in state.missingFiles &&
              (prev.version === undefined || record.version > prev.version);
            state.pendingFromPhone[record.id] = record;
            if (resent) {
              // The phone re-sent it: show "arriving" again and look again soon.
              const nowMs = this.now().getTime();
              state.missingFiles[record.id] = {
                firstSeenMissingAt: new Date(nowMs).toISOString(),
                stillMissing: false,
                resentAt: new Date(nowMs).toISOString(),
              };
              const soon = nowMs + RESENT_RECHECK_MS;
              this.nextMissingCheckMs =
                this.nextMissingCheckMs === null ? null : Math.min(this.nextMissingCheckMs, soon);
            }
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

  /**
   * Queues a push of an adopted release so its track localIds reach the server (#307): forgets the
   * pushed marker, so the back-fill in `reconcile` sends it. At most once a day per release, or a
   * server that keeps stripping the field would make every reconcile push again. Edits `state` in
   * place; the caller saves it. Returns whether it queued.
   */
  private queueLocalIdPush(state: SyncState, releaseId: string): boolean {
    const queued = (state.localIdQueuedAt ??= {});
    const nowMs = this.now().getTime();
    const last = Date.parse(queued[releaseId] ?? "");
    if (Number.isFinite(last) && nowMs - last < LOCAL_ID_REPUSH_MS) return false;
    queued[releaseId] = new Date(nowMs).toISOString();
    delete state.pushedUpdatedAt[releaseId];
    return true;
  }

  /** The one-time back-fill (#307): queues a push of every adopted release that has localIds. */
  private async queueLocalIdBackfill(): Promise<void> {
    const state = await this.syncState.get();
    if (state.localIdBackfilled) return;
    for (const release of await this.releases.list()) {
      if (release.adopted && release.tracks.some((t) => t.localId)) this.queueLocalIdPush(state, release.id);
    }
    state.localIdBackfilled = true;
    await this.syncState.set(state);
  }

  private isOwnEcho(record: SyncRecord): boolean {
    return record.origin === "mac" && record.originDevice === this.deviceName();
  }

  /**
   * Same shape as `ReleaseService.assertInsideLibrary`: inside the library dir and not the dir itself.
   * An adopted release (#245) is read from its tracks' place inside the adopt roots (after realpath) and
   * its cover from Locally's app data; nothing else outside the library.
   */
  private assertInsideLibrary(libraryDir: string, release: Release, adoptRoots: readonly string[] = []): void {
    const message = `Refusing to sync a file outside the library directory (release ${release.id})`;
    for (const t of release.tracks) {
      assertReadablePath(this.fs, libraryDir, release.adopted ? adoptRoots : [], t.filePath, message);
    }
    if (!release.coverPath) return;
    if (release.adopted) {
      if (!isAdoptedCoverPath(this.fs, release.coverPath)) throw new ValidationError(message);
    } else {
      assertReadablePath(this.fs, libraryDir, [], release.coverPath, message);
    }
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
      await this.pullReceivedShares(api);
      await this.queueLocalIdBackfill();

      await this.backFill(api, null);

      let me: MeResult | null = null;
      try {
        me = await api.me();
        this.quota = me.quota;
        this.publicShares = me.publicSharesEnabled === true;
      } catch {
        // Quota is a nice-to-have on the status card; don't fail the whole run for it.
      }

      // Never throws: a failed or refused check just waits for the next eligible one.
      const healed = await this.checkMissingFiles(api, me);
      if (healed.length > 0) await this.backFill(api, new Set(healed));

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
   * Back-fill: pushes each local release (only those in `only`, when given) whose current
   * `updatedAt` hasn't been pushed yet.
   */
  private async backFill(api: SyncApi, only: Set<string> | null): Promise<void> {
    const state = await this.syncState.get();
    const localReleases = await this.releases.list();
    for (const release of localReleases) {
      if (only && !only.has(release.id)) continue;
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
          // Likewise a record the service refuses for good (400/422) must not hold the rest back.
          if (err instanceof SyncRequestError && (err.status === 400 || err.status === 422)) {
            console.warn(`SyncEngine: skipping push of release ${release.id}: ${err.message}`);
            continue;
          }
          throw err;
        }
      }
    }
  }

  /**
   * Sends every play count that is ahead of what was last pushed, and every day bucket above its
   * pushed marker (#202), at most 500 entries, 400 days per entry and 2,000 day rows per request.
   * Each entry carries its absolute `count` and only its changed days, each as an absolute value.
   * A request is recorded as pushed once the service accepts it. A failure throws with the rest
   * still pending, so the next reconcile (offline, 5xx) picks them up; a count that grew while a
   * request was in flight stays pending too, because the marker is the value that was sent.
   *
   * A batch the service refuses for good (a 4xx other than 401 and 429) is skipped for this
   * reconcile, left unmarked, and the later batches still go, so one bad batch can't hold the
   * rest back forever. If that batch carried days (a skewed clock, or a service from before #201),
   * it is sent once more without them and, if accepted, only its counts are marked: the days stay
   * pending so totals keep flowing. A sign-out while a request is in flight (the store's epoch
   * moved) stops the push and marks nothing: those counts belong to the account that just went away.
   * A pass that ends without throwing, without a refused batch and without a reset marks the days
   * as in sync.
   */
  private async pushPlays(api: SyncApi): Promise<void> {
    const store = this.playStore;
    if (!store) return;
    const epoch = store.pushedEpoch();
    const before = await store.get();
    let refused = false;
    for (const batch of batchPlayEntries(pendingPlayEntries(before))) {
      if (store.pushedEpoch() !== epoch) return;
      const hasDays = batch.some((e) => e.days !== undefined);
      let result;
      let sentDays = hasDays;
      try {
        result = await api.pushPlays(batch);
      } catch (err) {
        const status = permanentPlayRejection(err);
        if (status === null) throw err;
        refused = true;
        if (!this.loggedPlayRejection) {
          this.loggedPlayRejection = true;
          console.warn(`SyncEngine: the sync service refused a batch of ${batch.length} play counts (HTTP ${status}); ${hasDays ? "retrying it without days" : "skipping it"}`);
        }
        if (!hasDays) continue;
        try {
          result = await api.pushPlays(batch.map((e) => ({ releaseId: e.releaseId, trackId: e.trackId, count: e.count })));
          sentDays = false;
        } catch (retryErr) {
          if (permanentPlayRejection(retryErr) === null) throw retryErr;
          continue;
        }
      }
      if (result.ignored > 0) {
        console.warn(`SyncEngine: the sync service ignored ${result.ignored} of ${batch.length} play counts`);
      }
      const days = sentDays
        ? Object.fromEntries(batch.filter((e) => e.days).map((e) => [e.trackId, Object.fromEntries(e.days!.map((d) => [d.day, d.count]))]))
        : undefined;
      await store.markPushed(Object.fromEntries(batch.map((e) => [e.trackId, e.count])), epoch, days);
      // A service summary read before this push must not be merged with markers read after it.
      invalidateServerSummary();
    }
    // A pass with nothing refused re-arms the log for the next time something is.
    if (!refused) this.loggedPlayRejection = false;
    // In sync means every pending day reached the service under this account: a refused batch (even
    // one whose counts went through without days) leaves its days off, so the summary merge keeps
    // subtracting this Mac's local days rather than risk counting a copy the service still holds twice.
    if (!refused && !before.daysInSync && store.pushedEpoch() === epoch) await store.markDaysInSync(epoch);
  }

  /**
   * One files-missing call (`api.missingFiles()`) serves two jobs, and runs only when one is due.
   *
   * Tray (#172): marks the pending phone releases whose files never landed: one listed for the first
   * time is "arriving", one listed again is "waiting", one no longer listed drops out. Due only while
   * something is pending and at most every `MISSING_CHECK_SPACING_MS`, an attempt counting even when it
   * fails. A service that answers 404 (before #170) clears the marks, which is today's plain tray.
   *
   * Heal (#218): the Mac's own releases the service lists as missing files get those names (and a
   * listed cover's hash) dropped from the upload bookkeeping, so the back-fill sends them again. Due
   * when never run, every `SELF_HEAL_SPACING_MS`, when the clock moved back, when `me.resyncRequestedAt`
   * is newer than the last run, or after "Resync Mac and phone". A release the server holds in a newer
   * version, or whose files are gone from disk, is left alone. A 404 waits the full spacing.
   *
   * Never fails the reconcile: a failed call, a 429 from the per-device limit included, leaves the
   * state as it was, backs off for `MISSING_CHECK_SPACING_MS` and shows no error line. Returns the ids
   * of the releases whose bookkeeping was cleared, for the caller to push again.
   */
  private async checkMissingFiles(api: SyncApi, me: MeResult | null): Promise<string[]> {
    const nowMs = this.now().getTime();
    const before = await this.syncState.get();

    let trayDue = false;
    if (Object.keys(before.pendingFromPhone).length > 0) {
      // A due time further off than one spacing means the clock moved back; check rather than wait.
      const untilDue = this.nextMissingCheckMs === null ? 0 : this.nextMissingCheckMs - nowMs;
      trayDue = !(untilDue > 0 && untilDue <= MISSING_CHECK_SPACING_MS);
    }

    const lastMs = before.lastMissingFilesCheckAt ? Date.parse(before.lastMissingFilesCheckAt) : NaN;
    const nudgeMs = me?.resyncRequestedAt ? Date.parse(me.resyncRequestedAt) : NaN;
    // The stored time can run ahead of this clock by the service's skew (it is the later of the two), so
    // only a stored time more than one check spacing in the future means the clock moved back.
    const spacingDue =
      Number.isNaN(lastMs) || nowMs - lastMs >= SELF_HEAL_SPACING_MS || lastMs - nowMs > MISSING_CHECK_SPACING_MS;
    const nudged = !Number.isNaN(nudgeMs) && !Number.isNaN(lastMs) && nudgeMs > lastMs;
    // A backoff further off than one spacing means the clock moved back; try rather than wait.
    const backoff = this.nextHealAttemptMs === null ? 0 : this.nextHealAttemptMs - nowMs;
    const backedOff = backoff > 0 && backoff <= MISSING_CHECK_SPACING_MS;
    const healDue = (spacingDue || nudged || this.healRequested) && !backedOff;

    if (!trayDue && !healDue) return [];
    if (trayDue) this.nextMissingCheckMs = nowMs + MISSING_CHECK_SPACING_MS;

    let result;
    try {
      result = await api.missingFiles();
    } catch {
      // Quiet skip: 429, an outage or a bad reply all keep the marks and the bookkeeping as they are.
      if (healDue) this.nextHealAttemptMs = nowMs + MISSING_CHECK_SPACING_MS;
      return [];
    }

    // The library is read before the state is re-read, so the write below follows the last await.
    const healed: string[] = [];
    const healPlan: { release: Release; names: string[] }[] = [];
    if (healDue && result) {
      const local = new Map((await this.releases.list()).map((r) => [r.id, r]));
      for (const entry of result.releases) {
        const release = local.get(entry.id);
        if (!release) continue; // a phone release: the tray handles it
        if (Date.parse(entry.recordUpdatedAt) > Date.parse(release.updatedAt)) {
          console.info(`SyncEngine: not re-sending release ${release.id}: the service holds a newer version`);
          continue;
        }
        // An adopted release re-sends only its cover (#245): its audio may be gone from disk.
        const cover = release.coverPath ? [release.coverPath] : [];
        const paths = release.adopted ? cover : [...release.tracks.map((t) => t.filePath), ...cover];
        let onDisk = true;
        for (const p of paths) if (!(await this.fs.exists(p))) onDisk = false;
        if (!onDisk) {
          console.warn(`SyncEngine: not re-sending release ${release.id}: a file is missing on disk`);
          continue;
        }
        healPlan.push({ release, names: entry.missing });
      }
    }

    // Read again: an accept during the request may have taken a release out of the tray.
    const state = await this.syncState.get();
    if (trayDue) {
      const listed = new Set((result?.releases ?? []).map((r) => r.id));
      const marks: Record<string, MissingMark> = {};
      for (const id of Object.keys(state.pendingFromPhone)) {
        if (!listed.has(id)) continue;
        const earlier = state.missingFiles[id];
        marks[id] = earlier
          ? {
              ...earlier,
              // An early re-check after a re-send must not flip it to waiting mid-upload.
              stillMissing:
                earlier.stillMissing || nowMs - Date.parse(earlier.firstSeenMissingAt) >= MISSING_CHECK_SPACING_MS,
            }
          : { firstSeenMissingAt: new Date(nowMs).toISOString(), stillMissing: false };
      }
      state.missingFiles = marks;
    }
    if (healDue) {
      for (const { release, names } of healPlan) {
        const left = (state.uploadedFiles[release.id] ?? []).filter((n) => !names.includes(n));
        if (state.uploadedFiles[release.id]) state.uploadedFiles[release.id] = left;
        if (release.coverPath && names.includes(path.basename(release.coverPath))) delete state.coverHash[release.id];
        delete state.pushedUpdatedAt[release.id];
        healed.push(release.id);
      }
      const marked = result ? Math.max(nowMs, Number.isNaN(nudgeMs) ? 0 : nudgeMs) : nowMs;
      state.lastMissingFilesCheckAt = new Date(marked).toISOString();
      this.healRequested = false;
      this.nextHealAttemptMs = null;
    }
    await this.syncState.set(state);
    return healed;
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
    this.nextMissingCheckMs = null;
    // The Mac heals its own releases in this reconcile, ahead of asking the phone to do the same.
    this.healRequested = true;
    this.nextHealAttemptMs = null;
    await this.reconcile();
    const api = this.apiFactory(settings.sync.baseUrl, settings.sync.deviceToken);
    try {
      const asked = await api.requestResync();
      if (asked) {
        // The Mac's own nudge must not trigger a second heal on the next reconcile.
        const state = await this.syncState.get();
        const stored = state.lastMissingFilesCheckAt ? Date.parse(state.lastMissingFilesCheckAt) : NaN;
        const returned = Date.parse(asked.resyncRequestedAt);
        if (!Number.isNaN(returned) && (Number.isNaN(stored) || returned > stored)) {
          state.lastMissingFilesCheckAt = new Date(returned).toISOString();
          await this.syncState.set(state);
        }
      }
      return { asked: asked !== null };
    } catch (err) {
      if (err instanceof SyncRequestError && err.status === 429) return { asked: false };
      throw err;
    }
  }

  // --- Inbox ("From your devices") ----------------------------------------

  /**
   * Hide (#295): takes a pending release out of this Mac's tray at the version it has now. Nothing
   * is deleted anywhere; a newer version has another token and shows again.
   */
  async hideFromTray(id: string): Promise<void> {
    let found = false;
    await this.syncState.update((current) => {
      const record = Object.hasOwn(current.pendingFromPhone, id) ? current.pendingFromPhone[id] : undefined;
      if (!record) return null;
      found = true;
      const hidden = Object.fromEntries(
        Object.entries(current.hiddenFromTray ?? {}).filter(([other]) => Object.hasOwn(current.pendingFromPhone, other))
      );
      hidden[id] = hideKeyFor(record);
      return { ...current, hiddenFromTray: hidden };
    });
    if (!found) throw new NotFoundError(`No pending release ${id} from your phone`);
  }

  /** Undo for Hide: the release shows in the tray again. Quietly does nothing when it wasn't hidden. */
  async unhideFromTray(id: string): Promise<void> {
    await this.syncState.update((current) => {
      if (!current.hiddenFromTray || !Object.hasOwn(current.hiddenFromTray, id)) return null;
      const rest = { ...current.hiddenFromTray };
      delete rest[id];
      return { ...current, hiddenFromTray: rest };
    });
  }

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
    // Nothing to download or send for a details-only record (#245).
    assertWritable({ adopted: record.source === "adopted", title: record.title });
    // The tray never offers Send here; this stops a stale tray from walking into the 404 below.
    const filesState = filesStateFor(record, state.missingFiles[id], this.now().getTime());
    if (filesState === "arriving") {
      throw new PublicError(
        record.origin === "ios" ? "Your phone is still sending this one." : "That device is still sending this one."
      );
    }
    if (filesState === "waiting") {
      throw new PublicError(
        "The audio hasn't arrived yet. Use Resync in the tray to ask for it again."
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

  // --- Sharing (#146, #182) -----------------------------------------------

  private async signedInApi(): Promise<SyncApi> {
    const ctx = await this.currentApi();
    if (!ctx) throw new PublicError("Sign in to sync first");
    return ctx.api;
  }

  /**
   * Refills the received list from `GET /v1/shares?role=received`. Never fails the reconcile: a service
   * from before sharing (404) empties the list; any other failure keeps what was there.
   */
  private async pullReceivedShares(api: SyncApi): Promise<void> {
    try {
      const all: ReceivedShare[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 10; page++) {
        const result = await api.listReceivedShares(cursor, 100);
        all.push(...result.shares);
        if (!result.nextCursor) break;
        cursor = result.nextCursor;
      }
      this.received = all;
      const ids = new Set(all.map((r) => r.id));
      for (const id of this.stuckClaims) if (!ids.has(id)) this.stuckClaims.delete(id);
    } catch (err) {
      if (err instanceof SyncRequestError && err.status === 404) this.received = [];
    }
  }

  /** Whether the Link option may show: asks the service now, false on any failure or when signed out. */
  async shareOptions(): Promise<{ signedIn: boolean; publicSharesEnabled: boolean }> {
    const ctx = await this.currentApi();
    if (!ctx) return { signedIn: false, publicSharesEnabled: false };
    try {
      const me = await ctx.api.me();
      this.publicShares = me.publicSharesEnabled === true;
    } catch {
      // Keep the last answer from a reconcile.
    }
    return { signedIn: true, publicSharesEnabled: this.publicShares };
  }

  /** Shares a release, or some of its tracks. The release must be this Mac's own and not added in place. */
  async createShare(body: CreateShareRequest): Promise<CreateShareResponse> {
    const api = await this.signedInApi();
    const release = await this.releases.get(body.releaseId);
    if (!release) throw new NotFoundError(`No release ${body.releaseId}`);
    assertWritable({ adopted: release.adopted === true, title: release.title });
    if (body.trackIds && body.trackIds.some((id) => !release.tracks.some((t) => t.id === id))) {
      throw new ValidationError("Some of those tracks are not on this release");
    }
    // The service only knows a release once its record is pushed; push a pending one first.
    const state = await this.syncState.get();
    if (state.pushedUpdatedAt[release.id] !== release.updatedAt) await this.push(release);
    if (body.visibility === "public" && !(await this.shareOptions()).publicSharesEnabled) {
      throw new ValidationError("Share links are not switched on yet");
    }
    return api.createShare(body);
  }

  /** One page of the shares this account sent, for Settings. */
  async sentShares(cursor: string | null): Promise<SentSharesView> {
    const api = await this.signedInApi();
    return api.listSentShares(cursor, 50);
  }

  /** `DELETE /v1/shares/:id`. */
  async revokeShare(id: string): Promise<void> {
    const api = await this.signedInApi();
    await api.revokeShare(id);
  }

  /** How many people (and whether a link) a release is still shared with: the delete confirm's number. */
  async liveShareSummary(releaseId: string): Promise<{ people: number; link: boolean }> {
    const ctx = await this.currentApi();
    if (!ctx) return { people: 0, link: false };
    const nowMs = this.now().getTime();
    const people = new Set<string>();
    let link = false;
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const result = await ctx.api.listSentShares(cursor, 100);
      for (const share of result.shares) {
        if (share.releaseId !== releaseId || share.revokedAt !== null) continue;
        if (share.expiresAt !== null && Date.parse(share.expiresAt) <= nowMs) continue;
        for (const r of share.recipients) people.add(r.email);
        if (share.hasLink) link = true;
      }
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }
    return { people: people.size, link };
  }

  /** A short-lived address for a received share's cover, for the tray's sleeve. */
  async friendCoverUrl(id: string): Promise<string> {
    const share = this.received.find((r) => r.id === id);
    const cover = share?.snapshot.cover;
    if (!share || !cover) throw new NotFoundError("No cover for that share");
    const api = await this.signedInApi();
    return (await api.shareFileUrl(id, cover)).url;
  }

  /** Dismisses a received share from the tray; it still works if claimed later from elsewhere. */
  async hideFriendShare(id: string): Promise<void> {
    const api = await this.signedInApi();
    if (!this.received.some((r) => r.id === id)) throw new NotFoundError("No share from a friend with that id");
    await api.hideShare(id);
    this.received = this.received.filter((r) => r.id !== id);
    this.stuckClaims.delete(id);
  }

  /**
   * "Send to Spotify" on a share from a friend: claims it, downloads its files, and writes a NEW
   * release (a fresh id, origin this Mac) tagged exactly as the snapshot says, through the same
   * `ReleaseService` path as a release from the phone (so `ReleaseLayout` and the inside-checks
   * apply). It syncs like any other release afterwards. A failure after the claim leaves the row in
   * the tray (`stuckClaims`) so it can be tried again.
   */
  async acceptFriendShare(id: string): Promise<Release> {
    const api = await this.signedInApi();
    const share = this.received.find((r) => r.id === id);
    if (!share) throw new NotFoundError("No share from a friend with that id");
    const snap = share.snapshot;
    const nowIso = this.now().toISOString();
    const coverHash = CoverHashSchema.safeParse(snap.coverHash);
    let record: SyncRecord;
    try {
      record = parseSyncRecord({
        syncVersion: 2,
        id: crypto.randomUUID(),
        kind: snap.kind,
        title: snap.title,
        artist: snap.artist,
        year: snap.year,
        genre: snap.genre,
        cover: snap.cover,
        coverHash: coverHash.success ? coverHash.data : null,
        tracks: snap.tracks.map((t) => ({
          id: crypto.randomUUID(),
          title: t.title,
          trackNumber: t.trackNumber,
          ...(t.discNumber !== undefined ? { discNumber: t.discNumber } : {}),
          file: t.file,
          bytes: t.bytes,
          durationSec: t.durationSec ?? null,
        })),
        origin: "mac",
        originDevice: this.deviceName(),
        createdAt: nowIso,
        updatedAt: nowIso,
        deleted: false,
      });
    } catch (err) {
      if (err instanceof SyncRecordRejectedError) {
        throw new PublicError("This share names a file Locally won't use, so it can't be added.");
      }
      throw new PublicError("This share could not be read, so it can't be added.");
    }
    const names = [...record.tracks.map((t) => t.file), ...(record.cover ? [record.cover] : [])];
    if (new Set(names).size !== names.length) throw new PublicError("This share lists the same file twice, so it can't be added.");

    await api.claimShare(id);
    this.stuckClaims.add(id);
    const dir = await this.fs.makeTempDir("sli-share-accept-");
    try {
      // `names` passed `isPlainSyncName` in `parseSyncRecord`, and `importSynced` checks each again.
      for (const name of names) {
        const { url } = await api.shareFileUrl(id, name);
        await api.downloadFile(url, path.join(dir, name));
      }
      const release = await this.releases.importSynced(record, dir, {
        ...(snap.releaseDate ? { releaseDate: snap.releaseDate } : {}),
      });
      this.stuckClaims.delete(id);
      this.received = this.received.filter((r) => r.id !== id);
      // Best effort: the claim already took it off other devices' trays.
      await api.hideShare(id).catch(() => undefined);
      void this.push(release);
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
