import { FileSettingsStore } from "./config/FileSettingsStore";
import type { SettingsStore } from "./config/SettingsStore";
import { settingsDir } from "./config/paths";
import { recoverLibraryMove } from "./library/LibraryMover";
import { setRecoveryGate } from "./library/writeActivity";
import type { Settings } from "../shared/types";
import { JsonLibraryRepository } from "./storage/JsonLibraryRepository";
import type { LibraryRepository } from "./storage/LibraryRepository";
import { FfmpegConverter } from "./audio/FfmpegConverter";
import type { AudioConverter } from "./audio/AudioConverter";
import { Id3TagService } from "./audio/Id3TagService";
import type { TagService } from "./audio/TagService";
import { NodeFileSystem } from "./fs/NodeFileSystem";
import type { FileSystem } from "./fs/FileSystem";
import { ReleaseLayout } from "./releases/ReleaseLayout";
import { ReleaseService } from "./releases/ReleaseService";
import { InspectService } from "./releases/InspectService";
import { FileSyncStateStore } from "./sync/FileSyncStateStore";
import type { SyncStateStore } from "./sync/SyncState";
import { HttpSyncApi } from "./sync/SyncApi";
import { SyncEngine, type SyncApiFactory } from "./sync/SyncEngine";
import { LocalFilesIndexDetector } from "./spotify/SpotifySourceDetector";
import type { SpotifySourceDetector } from "./spotify/SpotifySourceDetector";
import { FilePlayCountStore } from "./plays/FilePlayCountStore";
import type { PlayCountStore } from "./plays/PlayCountStore";
import { OsascriptNowPlaying } from "./plays/OsascriptNowPlaying";
import { LocallyNowPlaying } from "./plays/LocallyNowPlaying";
import { PlayTracker } from "./plays/PlayTracker";
import type { ReleaseSyncHooks } from "./releases/ReleaseSyncHooks";
import { SpotifyAuth } from "./spotify/SpotifyAuth";
import { SwitchingNowPlaying } from "./plays/SwitchingNowPlaying";
import { WebApiNowPlaying } from "./plays/WebApiNowPlaying";
import { SpotifyClient } from "./spotify/SpotifyClient";
import { SPOTIFY_CLIENT_ID } from "./spotify/config";
import { PlaylistIndex } from "./spotify/PlaylistIndex";
import { FilePlaylistCacheStore } from "./spotify/PlaylistCacheStore";
import { AdoptService } from "./adopt/AdoptService";
import { FileAdoptProposalStore } from "./adopt/FileAdoptProposalStore";
import { CloudPlays } from "./spotify/CloudPlays";
import { isDemo } from "./demo";

export interface Services {
  settings: SettingsStore;
  library: LibraryRepository;
  converter: AudioConverter;
  tags: TagService;
  fs: FileSystem;
  layout: ReleaseLayout;
  releases: ReleaseService;
  inspect: InspectService;
  syncState: SyncStateStore;
  syncApiFactory: SyncApiFactory;
  syncEngine: SyncEngine;
  spotify: SpotifySourceDetector;
  spotifyAuth: SpotifyAuth;
  spotifyClient: SpotifyClient;
  playlistIndex: PlaylistIndex;
  playStore: PlayCountStore;
  playTracker: PlayTracker;
  locallyPlaying: LocallyNowPlaying;
  nowPlaying: SwitchingNowPlaying;
  cloudPlays: CloudPlays;
  adopt: AdoptService;
}

class GatedSettingsStore implements SettingsStore {
  constructor(private readonly inner: SettingsStore, private readonly ready: Promise<unknown>) {}
  get() {
    return this.ready.then(() => this.inner.get());
  }
  set(settings: Settings) {
    return this.ready.then(() => this.inner.set(settings));
  }
  update(mutator: (current: Settings) => Settings | null) {
    return this.ready.then(() => this.inner.update(mutator));
  }
}

function buildServices(): Services {
  // Settings reads wait for the start-up check of an unfinished library move (#335), so nothing reads the
  // library folder before recovery has put it right.
  const rawSettings = new FileSettingsStore();
  const moveRecovery = recoverLibraryMove({
    settings: rawSettings,
    library: new JsonLibraryRepository(),
    dataDir: settingsDir(),
  }).catch((err) => console.warn("Library move recovery failed:", err));
  setRecoveryGate(moveRecovery);
  const settings: SettingsStore = new GatedSettingsStore(rawSettings, moveRecovery);
  const library = new JsonLibraryRepository();
  // LOCALLY_FFMPEG is set by the Electron shell to a bundled binary; never user input.
  const converter = new FfmpegConverter(process.env.LOCALLY_FFMPEG?.trim() || undefined);
  const tags = new Id3TagService();
  const fs = new NodeFileSystem();
  const layout = new ReleaseLayout();
  const releases = new ReleaseService(settings, library, converter, tags, fs, layout);
  const syncState = new FileSyncStateStore();
  const syncApiFactory: SyncApiFactory = (baseUrl, token) => new HttpSyncApi(baseUrl, token);
  const playStore = new FilePlayCountStore();
  const syncEngine = new SyncEngine(settings, syncState, releases, fs, syncApiFactory, undefined, playStore);

  // Late-wire the engine as ReleaseService's sync hooks (see ReleaseSyncHooks
  // for why this can't be a constructor parameter: SyncEngine itself depends
  // on this same ReleaseService instance).
  // A local delete also drops that release's play counts (#106); composed here so
  // sync/ stays untouched.
  const hooks: ReleaseSyncHooks = {
    onImported: (release) => syncEngine.onImported(release),
    onUpdated: (release) => syncEngine.onUpdated(release),
    onCoverReplaced: (release) => syncEngine.onCoverReplaced(release),
    onDeleted: (release) => {
      syncEngine.onDeleted(release);
      playStore.removeRelease(release.id).catch((err) => {
        console.warn("Could not remove play counts for a deleted release:", err instanceof Error ? err.message : err);
      });
    },
  };
  releases.setSyncHooks(hooks);
  // Reconcile with the sync service every 30s while signed in; reconcile()
  // itself is a cheap no-op when signed out. `buildServices()` only runs once
  // per process (memoised below), so this only starts one timer.
  syncEngine.startPolling();

  // Opt-in Spotify play tracker (#106): only polls while Settings > trackPlays is on.
  // With "Count plays on my other devices" on, the Spotify account is the one source (#228).
  const spotifyClient = new SpotifyClient({ settings, clientId: SPOTIFY_CLIENT_ID });
  const nowPlaying = new SwitchingNowPlaying({
    web: new WebApiNowPlaying(spotifyClient),
    appleScript: new OsascriptNowPlaying(),
    settings,
  });
  // Online counting (#307): while the sync service counts this account's plays, the tracker stands down.
  const cloudPlays = new CloudPlays({ settings, apiFactory: syncApiFactory });
  const locallyPlaying = new LocallyNowPlaying();
  const playTracker = new PlayTracker(nowPlaying, settings, library, playStore, undefined, undefined, undefined, undefined, cloudPlays, locallyPlaying);
  settings
    .get()
    .then((s) => playTracker.setEnabled(s.trackPlays === true))
    .catch(() => undefined);

  return {
    settings,
    library,
    converter,
    tags,
    fs,
    layout,
    releases,
    inspect: new InspectService(tags, fs),
    syncState,
    syncApiFactory,
    syncEngine,
    spotify: new LocalFilesIndexDetector(),
    spotifyAuth: new SpotifyAuth({ settings, clientId: SPOTIFY_CLIENT_ID }),
    spotifyClient,
    playlistIndex: new PlaylistIndex({ client: spotifyClient, store: new FilePlaylistCacheStore(), settings, library }),
    playStore,
    playTracker,
    locallyPlaying,
    nowPlaying,
    cloudPlays,
    adopt: new AdoptService({ settings, library, fs, proposals: new FileAdoptProposalStore() }),
  };
}

// Memoised on `globalThis` (not a module-level `let`) so Next's dev-mode hot
// reload, which re-evaluates route modules but not the process, doesn't spin
// up duplicate singletons (e.g. a second JsonLibraryRepository with its own
// mutex map) on every edit-and-save.
const GLOBAL_KEY = Symbol.for("spotify-local-import.services");

interface GlobalWithServices {
  [GLOBAL_KEY]?: Services;
}

/** Lazily build and memoise the app's service singletons. */
export function getServices(): Services {
  // The demo build must never reach the disk, settings or sync services (#139).
  if (isDemo()) {
    throw new Error("getServices() is not available in the demo build");
  }
  const g = globalThis as GlobalWithServices;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = buildServices();
  }
  return g[GLOBAL_KEY];
}
