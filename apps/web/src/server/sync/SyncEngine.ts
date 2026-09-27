import os from "node:os";
import path from "node:path";
import type { PendingFromPhone, Release, SyncStatus } from "../../shared/types";
import { DEFAULT_SYNC_BASE_URL } from "../../shared/types";
import { NotFoundError, PublicError } from "../../shared/errors";
import type { SettingsStore } from "../config/SettingsStore";
import type { FileSystem } from "../fs/FileSystem";
import type { ReleaseService } from "../releases/ReleaseService";
import type { ReleaseSyncHooks } from "../releases/ReleaseSyncHooks";
import { fromSyncRecord, toSyncRecord, type SyncRecord } from "./SyncRecord";
import { SyncConflictError, type SyncApi, type SyncFileToUpload } from "./SyncApi";
import type { SyncStateStore } from "./SyncState";

/** Builds a `SyncApi` for a given base URL/token; a factory (not a singleton) because both can change while the app runs. */
export type SyncApiFactory = (baseUrl: string, token: string | null) => SyncApi;

function pendingSummary(record: SyncRecord): PendingFromPhone {
  const meta = fromSyncRecord(record);
  return { id: meta.id, title: meta.title, artist: meta.artist, kind: meta.kind, trackCount: meta.tracks.length };
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

  constructor(
    private readonly settings: SettingsStore,
    private readonly syncState: SyncStateStore,
    private readonly releases: ReleaseService,
    private readonly fs: FileSystem,
    private readonly apiFactory: SyncApiFactory,
    private readonly deviceName: () => string = () => os.hostname()
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
    return {
      signedIn,
      email: settings.sync?.email ?? null,
      baseUrl: settings.sync?.baseUrl ?? DEFAULT_SYNC_BASE_URL,
      deviceName: signedIn ? this.deviceName() : null,
      lastRunAt: this.lastRunAt,
      lastError: this.lastError,
      pendingFromPhone: Object.values(state.pendingFromPhone).map(pendingSummary),
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
      const result = await ctx.api.deleteRelease(id);

      const state = await this.syncState.get();
      delete state.pushedUpdatedAt[id];
      delete state.uploadedFiles[id];
      delete state.pendingFromPhone[id];
      await this.syncState.set(state);

      await this.bumpLastVersion(result.version);
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
    const trackBytes: Record<string, number> = {};
    for (const t of release.tracks) {
      trackBytes[t.id] = await this.fs.statSize(t.filePath);
    }
    const record = toSyncRecord(release, "mac", this.deviceName(), trackBytes);

    const state = await this.syncState.get();
    const already = new Set(state.uploadedFiles[release.id] ?? []);
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
    let result: { version: number };
    try {
      result = await api.putRelease(record);
    } catch (err) {
      if (err instanceof SyncConflictError) {
        await this.pullOnce(api);
        result = await api.putRelease(record);
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
      await this.syncState.set(afterUpload);
    }

    const afterPut = await this.syncState.get();
    afterPut.pushedUpdatedAt[release.id] = release.updatedAt;
    await this.syncState.set(afterPut);
    await this.bumpLastVersion(result.version);
  }

  // --- Pull / reconcile (incoming) --------------------------------------

  private async pullOnce(api: SyncApi): Promise<void> {
    const settings = await this.settings.get();
    if (!settings.sync) return;

    const { releases: remoteRecords, nextVersion } = await api.listReleases(settings.sync.lastVersion);
    if (remoteRecords.length === 0) {
      await this.bumpLastVersion(nextVersion);
      return;
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
        delete state.pendingFromPhone[record.id];
        continue;
      }

      const local = await this.releases.get(record.id);
      if (!local) {
        if (record.origin !== "mac") {
          state.pendingFromPhone[record.id] = record;
        }
        continue;
      }

      delete state.pendingFromPhone[record.id];
      if (record.updatedAt > local.updatedAt) {
        await this.releases.applyRemote(record);
        state.pushedUpdatedAt[record.id] = record.updatedAt;
      }
    }

    await this.syncState.set(state);
    await this.bumpLastVersion(nextVersion);
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
          await this.pushOne(api, release);
        }
      }

      try {
        const me = await api.me();
        this.quota = me.quota;
      } catch {
        // Quota is a nice-to-have on the status card; don't fail the whole run for it.
      }

      this.lastError = null;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
    } finally {
      this.lastRunAt = new Date().toISOString();
      this.running = false;
    }
  }

  // --- Inbox ("From your phone") ----------------------------------------

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
