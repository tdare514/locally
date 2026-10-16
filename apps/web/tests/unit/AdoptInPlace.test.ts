import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AdoptService, type AdoptProposalStore } from "../../src/server/adopt/AdoptService";
import type { AdoptFileTags, AdoptTagReader } from "../../src/server/adopt/AdoptScanner";
import { FileAdoptProposalStore } from "../../src/server/adopt/FileAdoptProposalStore";
import { isReadablePath } from "../../src/server/adopt/guards";
import { buildLocalId } from "../../src/server/adopt/localId";
import type { AudioConverter } from "../../src/server/audio/AudioConverter";
import type { ReadTagsResult, TagService, WriteTagsInput } from "../../src/server/audio/TagService";
import type { SettingsStore } from "../../src/server/config/SettingsStore";
import { NodeFileSystem } from "../../src/server/fs/NodeFileSystem";
import { parseAdoptBody } from "../../src/server/http/validation";
import { resolveLocalTrack } from "../../src/server/plays/LocalTrackResolver";
import { ReleaseService } from "../../src/server/releases/ReleaseService";
import { FileSyncStateStore } from "../../src/server/sync/FileSyncStateStore";
import { SyncEngine } from "../../src/server/sync/SyncEngine";
import type { SyncApi } from "../../src/server/sync/SyncApi";
import { toSyncRecord, type SyncRecord } from "../../src/server/sync/SyncRecord";
import { JsonLibraryRepository } from "../../src/server/storage/JsonLibraryRepository";
import { ValidationError } from "../../src/shared/errors";
import type { Release, Settings, Track } from "../../src/shared/types";

class FakeSettings implements SettingsStore {
  constructor(public settings: Settings) {}
  async get() {
    return this.settings;
  }
  async set(s: Settings) {
    this.settings = s;
    return s;
  }
  async update(m: (c: Settings) => Settings | null) {
    const n = m(this.settings);
    if (n) this.settings = n;
    return this.settings;
  }
}

class RecordingTags implements TagService {
  writes: string[] = [];
  async write(filePath: string, input?: WriteTagsInput) {
    void input;
    this.writes.push(filePath);
  }
  async read(): Promise<ReadTagsResult> {
    return { title: null, artist: null, album: null, year: null, genre: null, durationSec: 1, hasCover: false };
  }
}

const noConverter: AudioConverter = {
  async toMp3() {
    throw new Error("no conversion expected");
  },
};

let base: string;
let root: string;
let libDir: string;
let configDir: string;
let originalEnv: string | undefined;
let settings: FakeSettings;
let repo: JsonLibraryRepository;
const nodeFs = new NodeFileSystem();
const tags = new RecordingTags();

const TAGS: Record<string, Partial<AdoptFileTags>> = {};
const readTags: AdoptTagReader = async (file) => ({
  title: null,
  artist: "Artist",
  albumArtist: "Artist",
  album: "Album",
  year: "2020",
  genre: "Rock",
  trackNumber: 1,
  discNumber: null,
  durationSec: 61.9,
  hasCover: true,
  hasVideo: false,
  ...TAGS[path.basename(file)],
});

beforeEach(async () => {
  originalEnv = process.env.LOCALLY_CONFIG_DIR;
  base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "sli-adopt-inplace-")));
  root = path.join(base, "Spotify Music");
  libDir = path.join(base, "Library");
  configDir = path.join(base, "config");
  await fs.mkdir(path.join(root, "A"), { recursive: true });
  await fs.mkdir(path.join(root, "B"), { recursive: true });
  await fs.mkdir(libDir, { recursive: true });
  process.env.LOCALLY_CONFIG_DIR = configDir;
  for (const k of Object.keys(TAGS)) delete TAGS[k];
  tags.writes = [];
  settings = new FakeSettings({ libraryDir: libDir, sync: null, adoptRoots: [root] });
  repo = new JsonLibraryRepository();
});

afterEach(async () => {
  if (originalEnv === undefined) delete process.env.LOCALLY_CONFIG_DIR;
  else process.env.LOCALLY_CONFIG_DIR = originalEnv;
  await fs.rm(base, { recursive: true, force: true });
});

async function writeAudio(rel: string, tagsFor: Partial<AdoptFileTags> = {}): Promise<string> {
  const p = path.join(root, rel);
  await fs.writeFile(p, crypto.randomBytes(64));
  TAGS[path.basename(p)] = tagsFor;
  return p;
}

async function snapshot(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (d: string) => {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      const st = await fs.stat(full);
      if (e.isDirectory()) {
        out[full] = `dir ${st.mtimeMs}`;
        await walk(full);
      } else {
        const hash = crypto.createHash("sha256").update(await fs.readFile(full)).digest("hex");
        out[full] = `${hash} ${st.mtimeMs} ${st.size}`;
      }
    }
  };
  await walk(dir);
  return out;
}

function memoryProposals(): AdoptProposalStore {
  return new FileAdoptProposalStore();
}

function adoptService(extra: Partial<ConstructorParameters<typeof AdoptService>[0]> = {}) {
  return new AdoptService({
    settings,
    library: repo,
    fs: nodeFs,
    proposals: memoryProposals(),
    readTags,
    extractCover: async () => ({ bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), format: "image/jpeg" }),
    ...extra,
  });
}

function releaseService() {
  return new ReleaseService(settings, repo, noConverter, tags, nodeFs);
}

async function adoptAll(): Promise<Release[]> {
  const svc = adoptService();
  const proposal = await svc.scan();
  const result = await svc.adopt(proposal.groups.map((g) => g.key));
  return result.releases;
}

describe("adopt in place", () => {
  it("adds releases without writing a byte inside the adopt root", async () => {
    await writeAudio("A/one.mp3", { title: "One", trackNumber: 1 });
    await writeAudio("A/two.mp3", { title: "Two", trackNumber: 2 });
    await writeAudio("B/solo.m4a", { title: "Solo", album: null });
    const before = await snapshot(root);

    const svc = adoptService();
    const proposal = await svc.scan();
    expect(proposal.groups).toHaveLength(2);
    const result = await svc.adopt(proposal.groups.map((g) => g.key));

    expect(await snapshot(root)).toEqual(before);
    expect(result.releases).toHaveLength(2);
    const album = result.releases.find((r) => r.kind === "album")!;
    expect(album.adopted).toBe(true);
    expect(album.folderPath).toBe(path.join(root, "A"));
    expect(album.tracks.map((t) => t.filePath)).toEqual([path.join(root, "A/one.mp3"), path.join(root, "A/two.mp3")]);
    expect(album.tracks[0].localId).toBe(buildLocalId("Artist", "Album", "One", 61.9));
    expect(album.tracks[0].durationSec).toBe(61.9);
    expect(album.coverPath).toBe(path.join(configDir, "adopted-covers", `${album.id}.jpg`));
    expect((await fs.readFile(album.coverPath!)).length).toBe(7);
    expect(tags.writes).toEqual([]);
  });

  it("gives no cover when the file has no art, and adopting twice does not duplicate", async () => {
    await writeAudio("A/one.mp3", { title: "One", hasCover: false });
    const svc = adoptService({ extractCover: async () => null });
    const proposal = await svc.scan();
    const keys = proposal.groups.map((g) => g.key);
    const first = await svc.adopt(keys);
    expect(first.releases[0].coverPath).toBeNull();
    const second = await svc.adopt(keys);
    expect(second.releases).toHaveLength(0);
    expect(second.alreadyAdopted).toEqual(keys);
    expect(await repo.list(libDir)).toHaveLength(1);
  });

  it("marks a track missing when its file is gone on re-scan, and never deletes the release", async () => {
    const f = await writeAudio("A/one.mp3", { title: "One" });
    const [release] = await adoptAll();
    await fs.rm(f);
    await adoptService().scan();
    const after = await repo.find(libDir, release.id);
    expect(after?.tracks[0].missing).toBe(true);
    expect(after?.updatedAt).toBe(release.updatedAt);
  });
});

describe("write guards refuse an adopted release", () => {
  let release: Release;
  let before: Record<string, string>;
  beforeEach(async () => {
    await writeAudio("A/one.mp3", { title: "One" });
    [release] = await adoptAll();
    before = await snapshot(root);
  });
  afterEach(async () => {
    expect(await snapshot(root)).toEqual(before);
    expect(tags.writes).toEqual([]);
  });

  it("re-tag (update)", async () => {
    await expect(releaseService().update(release.id, { title: "New" })).rejects.toThrow(/read-only/);
  });

  it("cover replace", async () => {
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 1])], "c.jpg", { type: "image/jpeg" });
    await expect(releaseService().replaceCover(release.id, file)).rejects.toThrow(/read-only/);
  });

  it("applying a remote edit", async () => {
    const record = toSyncRecord(release, "ios", "phone");
    await expect(releaseService().applyRemote({ ...record, title: "Remote" })).rejects.toThrow(/read-only/);
  });

  it("accept / Send of an adopted record", async () => {
    const record = toSyncRecord(release, "mac", "other");
    await expect(releaseService().importSynced(record, base)).rejects.toThrow(/read-only/);
    const state = new FileSyncStateStore();
    const s = await state.get();
    s.pendingFromPhone[release.id] = record;
    await state.set(s);
    settings.settings = { ...settings.settings, sync: { baseUrl: "https://x.test", deviceToken: "t", email: "a@b.c", lastVersion: 0 } };
    const engine = new SyncEngine(settings, state, releaseService(), nodeFs, () => ({}) as SyncApi);
    await expect(engine.acceptFromPhone(release.id)).rejects.toThrow(/read-only/);
  });
});

describe("forgetting", () => {
  it("delete and forget remove only the record, leaving the files and the root intact", async () => {
    const f1 = await writeAudio("A/one.mp3", { title: "One" });
    await writeAudio("B/two.mp3", { title: "Two", album: "Other" });
    const [a, b] = await adoptAll();
    const before = await snapshot(root);

    await releaseService().delete(a.id);
    await releaseService().forget(b.id);

    expect(await repo.list(libDir)).toHaveLength(0);
    expect(await snapshot(root)).toEqual(before);
    await expect(fs.stat(f1)).resolves.toBeTruthy();
    await expect(fs.stat(a.coverPath!)).rejects.toThrow();
  });

  it("forget refuses a release that is not adopted", async () => {
    const plain: Release = { ...(await sampleAdopted()), adopted: undefined };
    await repo.upsert(libDir, plain);
    await expect(releaseService().forget(plain.id)).rejects.toBeInstanceOf(ValidationError);
  });
});

async function sampleAdopted(): Promise<Release> {
  const file = path.join(root, "A", "x.mp3");
  await fs.writeFile(file, Buffer.from("x"));
  const track: Track = {
    id: "t1",
    title: "X",
    trackNumber: 1,
    filePath: file,
    originalName: "x.mp3",
    durationSec: 10,
    localId: buildLocalId("Artist", "Album", "X", 10),
  };
  return {
    id: "rel-x",
    kind: "single",
    title: "Album",
    artist: "Artist",
    year: null,
    genre: null,
    coverPath: null,
    folderPath: path.join(root, "A"),
    tracks: [track],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    adopted: true,
  };
}

/** Records every call the engine makes to the sync service. */
function fakeApi(remote: SyncRecord[] = []) {
  const calls = { put: [] as SyncRecord[], createUploads: [] as { id: string; names: string[] }[], uploads: [] as string[] };
  const api = {
    putRelease: async (r: SyncRecord) => {
      calls.put.push(r);
      return { version: 1 };
    },
    createUploads: async (id: string, files: { name: string }[]) => {
      calls.createUploads.push({ id, names: files.map((f) => f.name) });
      return { uploads: files.map((f) => ({ name: f.name, url: `fake://${f.name}`, method: "PUT", headers: {} })) };
    },
    uploadFile: async (_t: unknown, filePath: string) => {
      calls.uploads.push(filePath);
    },
    listReleases: async () => ({ releases: remote.map((r) => ({ ...r, version: 2 })), nextVersion: 2, hasMore: false }),
    me: async () => ({ user: { id: "u", email: "a@b.c" }, device: { id: "d", name: "n" }, quota: null, devices: [] }),
    missingFiles: async () => ({ releases: [], checkedAt: "" }),
    deleteRelease: async () => ({ version: 3 }),
  } as unknown as SyncApi;
  return { api, calls };
}

function engineFor(api: SyncApi) {
  settings.settings = { ...settings.settings, sync: { baseUrl: "https://x.test", deviceToken: "t", email: "a@b.c", lastVersion: 0 } };
  const state = new FileSyncStateStore();
  return { engine: new SyncEngine(settings, state, releaseService(), nodeFs, () => api, () => "mac-1"), state };
}

describe("details-only sync", () => {
  it("pushes source adopted and uploads only the cover", async () => {
    await writeAudio("A/one.mp3", { title: "One" });
    await writeAudio("A/two.mp3", { title: "Two", trackNumber: 2 });
    const [release] = await adoptAll();
    const { api, calls } = fakeApi();
    const { engine, state } = engineFor(api);

    await engine.push(release);

    expect(calls.put).toHaveLength(1);
    expect(calls.put[0].source).toBe("adopted");
    expect(calls.put[0].tracks.map((t) => t.file)).toEqual(["one.mp3", "two.mp3"]);
    expect(calls.createUploads).toEqual([{ id: release.id, names: [`${release.id}.jpg`] }]);
    expect(calls.uploads).toEqual([release.coverPath]);
    const s = await state.get();
    expect(s.uploadedFiles[release.id]).toEqual([`${release.id}.jpg`]);
    expect(s.pushedUpdatedAt[release.id]).toBe(release.updatedAt);
  });

  it("still pushes when an adopted file has gone missing, and keeps it out of pending", async () => {
    const f = await writeAudio("A/one.mp3", { title: "One" });
    const [release] = await adoptAll();
    await fs.rm(f);
    const { api, calls } = fakeApi();
    const { engine } = engineFor(api);
    await engine.push(release);
    expect(calls.put[0].tracks[0].bytes).toBe(0);
    expect(calls.uploads).toEqual([release.coverPath]);
  });

  it("refuses to read an adopted track outside the adopt roots", async () => {
    await writeAudio("A/one.mp3", { title: "One" });
    const [release] = await adoptAll();
    settings.settings = { ...settings.settings, adoptRoots: [path.join(base, "elsewhere")] };
    const { api, calls } = fakeApi();
    const { engine } = engineFor(api);
    await engine.push(release);
    expect(calls.put).toHaveLength(0);
  });

  it("a remote tombstone forgets the release and leaves the files", async () => {
    const f = await writeAudio("A/one.mp3", { title: "One" });
    const [release] = await adoptAll();
    const tomb: SyncRecord = { ...toSyncRecord(release, "mac", "mac-1"), deleted: true };
    const { api } = fakeApi([tomb]);
    const { engine } = engineFor(api);
    await engine.reconcile();
    expect(await repo.list(libDir)).toHaveLength(0);
    await expect(fs.stat(f)).resolves.toBeTruthy();
  });

  it("an adopted record from elsewhere never lands in the tray", async () => {
    await writeAudio("A/one.mp3", { title: "One" });
    const [release] = await adoptAll();
    await repo.remove(libDir, release.id);
    const remote: SyncRecord = toSyncRecord(release, "mac", "other-mac");
    const { api } = fakeApi([remote]);
    const { engine, state } = engineFor(api);
    await engine.reconcile();
    expect(Object.keys((await state.get()).pendingFromPhone)).toEqual([]);
  });
});

function adoptedRelease(id: string, title: string, album: string, artist: string, seconds: number, rawLocalId?: string): Release {
  return {
    id,
    kind: "single",
    title: album || title,
    artist,
    year: null,
    genre: null,
    coverPath: null,
    folderPath: "/x",
    adopted: true,
    createdAt: "",
    updatedAt: "",
    tracks: [
      {
        id: `${id}-t`,
        title,
        trackNumber: 1,
        filePath: `/x/${id}.mp3`,
        originalName: `${id}.mp3`,
        durationSec: seconds,
        localId: rawLocalId ?? buildLocalId(artist, album, title, seconds),
      },
    ],
  };
}

describe("play matching", () => {
  it("resolves a spotify:local id with an empty album to its adopted track", () => {
    const r = adoptedRelease("a", "Loose Song", "", "Band", 200);
    const id = "spotify:local:Band::Loose+Song:200";
    expect(resolveLocalTrack(id, [r])).toEqual({ kind: "match", releaseId: "a", trackId: "a-t" });
  });

  it("compares decoded parts, so Spotify's different escaping still matches", () => {
    const r = adoptedRelease("a", "Don't (Stop)!", "Alb", "Band", 100);
    expect(r.tracks[0].localId).toContain("Don't");
    expect(resolveLocalTrack("spotify:local:Band:Alb:Don%27t+%28Stop%29%21:100", [r])).toMatchObject({ kind: "match" });
    expect(resolveLocalTrack("spotify:local:Band:Alb:Don't+(Stop)!:101", [r])).toMatchObject({ kind: "match" });
  });

  it("is case-sensitive and respects the length tolerance", () => {
    const r = adoptedRelease("a", "Song", "Alb", "Band", 100);
    expect(resolveLocalTrack("spotify:local:band:Alb:Song:100", [r])).toEqual({ kind: "none" });
    expect(resolveLocalTrack("spotify:local:Band:Alb:Song:110", [r])).toEqual({ kind: "none" });
  });

  it("counts two matching adopted copies once, for the first", () => {
    const one = adoptedRelease("first", "Song", "Alb", "Band", 100);
    const two = adoptedRelease("second", "Song", "Alb", "Band", 100);
    expect(resolveLocalTrack("spotify:local:Band:Alb:Song:100", [one, two])).toEqual({
      kind: "match",
      releaseId: "first",
      trackId: "first-t",
    });
  });
});

describe("read check", () => {
  it("allows inside the adopt roots, refuses outside, refuses a symlink that leaves a root", async () => {
    const outside = path.join(base, "Secret");
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, "s.mp3"), "s");
    await fs.writeFile(path.join(root, "A", "in.mp3"), "i");
    await fs.symlink(outside, path.join(root, "link"));
    await fs.symlink(path.join(outside, "s.mp3"), path.join(root, "A", "file-link.mp3"));

    expect(isReadablePath(nodeFs, libDir, [root], path.join(root, "A", "in.mp3"))).toBe(true);
    expect(isReadablePath(nodeFs, libDir, [root], path.join(outside, "s.mp3"))).toBe(false);
    expect(isReadablePath(nodeFs, libDir, [root], path.join(root, "..", "Secret", "s.mp3"))).toBe(false);
    expect(isReadablePath(nodeFs, libDir, [root], path.join(root, "link", "s.mp3"))).toBe(false);
    expect(isReadablePath(nodeFs, libDir, [root], path.join(root, "A", "file-link.mp3"))).toBe(false);
    expect(isReadablePath(nodeFs, libDir, [], path.join(root, "A", "in.mp3"))).toBe(false);
    expect(isReadablePath(nodeFs, libDir, [root], path.join(libDir, "x", "y.mp3"))).toBe(true);
  });

  it("a root removed after adoption does not make anything readable", async () => {
    const gone = path.join(base, "Gone");
    expect(isReadablePath(nodeFs, libDir, [gone], path.join(base, "Other", "x.mp3"))).toBe(false);
  });
});

describe("parseAdoptBody", () => {
  it("accepts a list of keys and refuses anything else", () => {
    expect(parseAdoptBody({ keys: ["abc"] })).toEqual({ keys: ["abc"] });
    expect(() => parseAdoptBody({ keys: [] })).toThrow(ValidationError);
    expect(() => parseAdoptBody({ keys: [1] })).toThrow(ValidationError);
    expect(() => parseAdoptBody({ keys: ["a"], path: "/etc" })).toThrow(ValidationError);
    expect(() => parseAdoptBody(null)).toThrow(ValidationError);
  });
});
