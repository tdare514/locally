import { FileSettingsStore } from "./config/FileSettingsStore";
import type { SettingsStore } from "./config/SettingsStore";
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

export interface Services {
  settings: SettingsStore;
  library: LibraryRepository;
  converter: AudioConverter;
  tags: TagService;
  fs: FileSystem;
  layout: ReleaseLayout;
  releases: ReleaseService;
  inspect: InspectService;
}

function buildServices(): Services {
  const settings = new FileSettingsStore();
  const library = new JsonLibraryRepository();
  const converter = new FfmpegConverter();
  const tags = new Id3TagService();
  const fs = new NodeFileSystem();
  const layout = new ReleaseLayout();

  return {
    settings,
    library,
    converter,
    tags,
    fs,
    layout,
    releases: new ReleaseService(settings, library, converter, tags, fs, layout),
    inspect: new InspectService(tags, fs),
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
  const g = globalThis as GlobalWithServices;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = buildServices();
  }
  return g[GLOBAL_KEY];
}
