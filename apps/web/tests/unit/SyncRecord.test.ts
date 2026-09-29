import { describe, expect, it } from "vitest";
import {
  SYNC_FILE_EXTENSIONS,
  SyncRecordRejectedError,
  SyncRecordSchema,
  fromSyncRecord,
  hasSyncFileExtension,
  isPlainSyncName,
  parseSyncRecord,
  toSyncRecord,
  type SyncRecord,
} from "../../src/server/sync/SyncRecord";
import type { Release } from "../../src/shared/types";

function validRecord(overrides: Partial<SyncRecord> = {}): SyncRecord {
  return {
    syncVersion: 1,
    id: "3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90",
    kind: "album",
    title: "Night Drive",
    artist: "Chromatics",
    year: "2024",
    genre: null,
    cover: "cover.jpg",
    tracks: [
      { id: "t1", title: "Intro", trackNumber: 1, file: "01 - Intro.mp3", bytes: 5120000, durationSec: 61.2 },
    ],
    origin: "mac",
    originDevice: "Toby's MacBook",
    createdAt: "2026-09-27T20:00:00Z",
    updatedAt: "2026-09-27T20:00:00Z",
    deleted: false,
    ...overrides,
  };
}

function release(overrides: Partial<Release> = {}): Release {
  return {
    id: "rel-1",
    kind: "album",
    title: "Night Drive",
    artist: "Chromatics",
    year: "2024",
    genre: null,
    coverPath: "/library/Chromatics/Night Drive/cover.jpg",
    folderPath: "/library/Chromatics/Night Drive",
    tracks: [
      {
        id: "t1",
        title: "Intro",
        trackNumber: 1,
        filePath: "/library/Chromatics/Night Drive/01 - Intro.mp3",
        originalName: "intro.wav",
        durationSec: 61.2,
      },
    ],
    createdAt: "2026-09-27T20:00:00.000Z",
    updatedAt: "2026-09-27T20:00:00.000Z",
    ...overrides,
  };
}

describe("SyncRecordSchema / parseSyncRecord", () => {
  it("accepts a record matching spec/sync.md exactly", () => {
    expect(() => parseSyncRecord(validRecord())).not.toThrow();
  });

  it("accepts a null year/genre/cover", () => {
    expect(() => parseSyncRecord(validRecord({ year: null, genre: null, cover: null }))).not.toThrow();
  });

  it("rejects an unknown kind", () => {
    expect(() => parseSyncRecord(validRecord({ kind: "ep" as never }))).toThrow();
  });

  it("rejects an unknown origin", () => {
    expect(() => parseSyncRecord(validRecord({ origin: "android" as never }))).toThrow();
  });

  it("rejects a track with a non-numeric trackNumber", () => {
    const bad = validRecord();
    bad.tracks = [{ ...bad.tracks[0], trackNumber: "1" as never }];
    expect(() => parseSyncRecord(bad)).toThrow();
  });

  it("rejects a track missing its file name", () => {
    const bad = validRecord();
    bad.tracks = [{ ...bad.tracks[0], file: "" }];
    expect(() => parseSyncRecord(bad)).toThrow();
  });

  it("accepts a syncVersion 2 record with a coverHash, and with a null coverHash", () => {
    const hash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    expect(() => parseSyncRecord(validRecord({ syncVersion: 2, coverHash: hash }))).not.toThrow();
    expect(() => parseSyncRecord(validRecord({ syncVersion: 2, cover: null, coverHash: null }))).not.toThrow();
  });

  it("accepts a syncVersion 1 record with no coverHash key at all", () => {
    const old = validRecord() as Partial<SyncRecord>;
    delete old.coverHash;
    expect(SyncRecordSchema.parse(old).coverHash).toBeUndefined();
  });

  it("rejects a malformed coverHash and an unknown syncVersion", () => {
    expect(() => parseSyncRecord(validRecord({ syncVersion: 2, coverHash: "abc" }))).toThrow();
    expect(() => parseSyncRecord(validRecord({ syncVersion: 2, coverHash: "E3B0".repeat(16) }))).toThrow();
    expect(() => parseSyncRecord(validRecord({ syncVersion: 3 as never }))).toThrow();
  });

  it("rejects a missing deleted flag", () => {
    const bad = validRecord() as Partial<SyncRecord>;
    delete bad.deleted;
    expect(() => SyncRecordSchema.parse(bad)).toThrow();
  });
});

describe("toSyncRecord", () => {
  it("keeps the same id, basenames the track/cover paths, and stamps origin/device", () => {
    const record = toSyncRecord(release(), "mac", "Toby's MacBook");

    expect(record.id).toBe("rel-1");
    expect(record.syncVersion).toBe(2);
    expect(record.cover).toBe("cover.jpg");
    expect(record.tracks).toHaveLength(1);
    expect(record.tracks[0].file).toBe("01 - Intro.mp3");
    expect(record.tracks[0].id).toBe("t1");
    expect(record.origin).toBe("mac");
    expect(record.originDevice).toBe("Toby's MacBook");
    expect(record.deleted).toBe(false);
    // No bytes map supplied: pure function never touches disk, defaults to 0.
    expect(record.tracks[0].bytes).toBe(0);
  });

  it("uses supplied byte sizes keyed by track id", () => {
    const record = toSyncRecord(release(), "mac", "dev", { t1: 12345 });
    expect(record.tracks[0].bytes).toBe(12345);
  });

  it("has no cover when the release has none", () => {
    const record = toSyncRecord(release({ coverPath: null }), "mac", "dev");
    expect(record.cover).toBeNull();
  });

  it("sorts tracks by trackNumber", () => {
    const r = release({
      tracks: [
        { id: "b", title: "B", trackNumber: 2, filePath: "/lib/b.mp3", originalName: "b.mp3", durationSec: null },
        { id: "a", title: "A", trackNumber: 1, filePath: "/lib/a.mp3", originalName: "a.mp3", durationSec: null },
      ],
    });
    const record = toSyncRecord(r, "mac", "dev");
    expect(record.tracks.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("produces a record that validates against the schema", () => {
    expect(() => parseSyncRecord(toSyncRecord(release(), "mac", "dev"))).not.toThrow();
  });

  it("defaults coverHash to null, and includes the hash it is given", () => {
    expect(toSyncRecord(release(), "mac", "dev").coverHash).toBeNull();

    const hash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    const record = toSyncRecord(release(), "mac", "dev", {}, hash);
    expect(record.coverHash).toBe(hash);
  });
});

describe("fromSyncRecord", () => {
  it("round-trips the metadata fields toSyncRecord produced", () => {
    const record = toSyncRecord(release(), "ios", "Toby's iPhone");
    const meta = fromSyncRecord(record);

    expect(meta.id).toBe("rel-1");
    expect(meta.kind).toBe("album");
    expect(meta.title).toBe("Night Drive");
    expect(meta.artist).toBe("Chromatics");
    expect(meta.cover).toBe("cover.jpg");
    expect(meta.tracks).toHaveLength(1);
    expect(meta.tracks[0]).toMatchObject({ id: "t1", title: "Intro", trackNumber: 1, file: "01 - Intro.mp3" });
  });

  it("passes coverHash through, and normalises a missing key to null", () => {
    const hash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    expect(fromSyncRecord(validRecord({ syncVersion: 2, coverHash: hash })).coverHash).toBe(hash);

    const withoutKey = validRecord() as Partial<SyncRecord>;
    delete withoutKey.coverHash;
    expect(fromSyncRecord(withoutKey as SyncRecord).coverHash).toBeNull();
  });

  it("sorts tracks by trackNumber", () => {
    const record = validRecord({
      tracks: [
        { id: "b", title: "B", trackNumber: 2, file: "b.mp3", bytes: 1, durationSec: null },
        { id: "a", title: "A", trackNumber: 1, file: "a.mp3", bytes: 1, durationSec: null },
      ],
    });
    const meta = fromSyncRecord(record);
    expect(meta.tracks.map((t) => t.id)).toEqual(["a", "b"]);
  });
});

describe("SyncRecordSchema refuses file names with an unsupported extension", () => {
  it.each(SYNC_FILE_EXTENSIONS)("hasSyncFileExtension accepts every listed extension: %s", (ext) => {
    expect(hasSyncFileExtension(`track.${ext}`)).toBe(true);
    expect(hasSyncFileExtension(`track.${ext.toUpperCase()}`)).toBe(true);
  });

  const rejectedAsTrackFile = [
    "01 - Intro.wav",
    "01 - Intro.flac",
    "01 - Intro",
    "01 - Intro.mp3.bak",
    "01 - Intro.mp",
    "mp3",
  ];
  const rejectedAsCover = ["cover.gif", "cover.webp", "cover.jpg ", "mp3"];

  it.each(rejectedAsTrackFile)("rejects %j as a track file", (file) => {
    expect(() =>
      parseSyncRecord(validRecord({ tracks: [{ ...validRecord().tracks[0], file }] })),
    ).toThrow();
  });

  it.each(rejectedAsCover)("rejects %j as a cover", (cover) => {
    expect(() => parseSyncRecord(validRecord({ cover }))).toThrow();
  });

  it.each(["01 - Intro.MP3", "01 - Intro.Mp3", "01 - Intro.m4a", "01 - Intro.M4A", "a.b.mp3"])(
    "accepts %j as a track file",
    (file) => {
      expect(() =>
        parseSyncRecord(validRecord({ tracks: [{ ...validRecord().tracks[0], file }] })),
      ).not.toThrow();
    },
  );

  it.each(["cover.jpg", "cover.JPG", "cover.jpeg", "cover.JPEG", "cover.png", "cover.PNG"])(
    "accepts %j as a cover",
    (cover) => {
      expect(() => parseSyncRecord(validRecord({ cover }))).not.toThrow();
    },
  );

  it("accepts a null cover", () => {
    expect(() => parseSyncRecord(validRecord({ cover: null }))).not.toThrow();
  });

  it("accepts release and track ids without a file extension", () => {
    expect(() => parseSyncRecord(validRecord())).not.toThrow();
    expect(validRecord().id).toBe("3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90");
  });

  const extensionTableReject = [
    ...rejectedAsTrackFile,
    ...rejectedAsCover.filter((c) => c !== "cover.jpg "),
    "cover.jpg ",
  ];
  const extensionTableAccept = [
    "01 - Intro.MP3",
    "01 - Intro.Mp3",
    "01 - Intro.m4a",
    "01 - Intro.M4A",
    "a.b.mp3",
    "cover.jpg",
    "cover.JPG",
    "cover.jpeg",
    "cover.JPEG",
    "cover.png",
    "cover.PNG",
    "file.MP3",
    "file.M4A",
    "file.JPG",
    "file.JPEG",
    "file.PNG",
  ];

  it.each(extensionTableReject)("hasSyncFileExtension rejects %j", (name) => {
    expect(hasSyncFileExtension(name)).toBe(false);
  });

  it.each(extensionTableAccept)("hasSyncFileExtension accepts %j", (name) => {
    expect(hasSyncFileExtension(name)).toBe(true);
  });
});

describe("SyncRecordSchema refuses names that are not plain file names", () => {
  const hostile = [
    "../x.mp3",
    "..\\x.mp3",
    "a/b.mp3",
    "a\\b.mp3",
    "/etc/passwd",
    ".",
    "..",
    ".hidden.mp3",
    "",
    "bad\u0000name.mp3",
    "bad\nname.mp3",
    "x".repeat(256),
  ];

  it.each(hostile)("rejects %j as a track file", (name) => {
    const record = validRecord({ tracks: [{ ...validRecord().tracks[0], file: name }] });
    expect(() => parseSyncRecord(record)).toThrow();
  });

  it.each(hostile)("rejects %j as a cover", (name) => {
    expect(() => parseSyncRecord(validRecord({ cover: name }))).toThrow();
  });

  it.each(hostile)("rejects %j as a release id", (name) => {
    expect(() => parseSyncRecord(validRecord({ id: name }))).toThrow();
  });

  it.each(hostile)("rejects %j as a track id", (name) => {
    const record = validRecord({ tracks: [{ ...validRecord().tracks[0], id: name }] });
    expect(() => parseSyncRecord(record)).toThrow();
  });

  it("accepts ordinary names from both platforms", () => {
    expect(isPlainSyncName("01 - Intro.mp3")).toBe(true);
    expect(isPlainSyncName("Chromatics - Night Drive - 01 - Intro.m4a")).toBe(true);
    expect(isPlainSyncName("cover.jpg")).toBe(true);
    expect(isPlainSyncName("3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90")).toBe(true);
    expect(isPlainSyncName("Étude Nº 3 (live) [2024].mp3")).toBe(true);
    expect(isPlainSyncName("a".repeat(255))).toBe(true);
    expect(() => parseSyncRecord(validRecord({ cover: null }))).not.toThrow();
  });
});

function caught(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error("expected the call to throw");
}

describe("parseSyncRecord distinguishes a refused name from a broken record", () => {
  it("throws SyncRecordRejectedError for a track file with an unsupported extension, naming the record and the field", () => {
    const record = validRecord();
    const bad = { ...record, tracks: [{ ...record.tracks[0], file: "01 - Intro.wav" }] };
    expect(() => parseSyncRecord(bad)).toThrow(SyncRecordRejectedError);
    const err = caught(() => parseSyncRecord(bad)) as SyncRecordRejectedError;
    expect(err.recordId).toBe(record.id);
    expect(err.reasons).toHaveLength(1);
    expect(err.reasons[0]).toContain("tracks.0.file");
  });

  it("throws SyncRecordRejectedError for a cover with an unsupported extension", () => {
    expect(() => parseSyncRecord(validRecord({ cover: "cover.gif" }))).toThrow(SyncRecordRejectedError);
  });

  it("throws SyncRecordRejectedError for a track file containing a path separator", () => {
    const record = validRecord();
    const bad = { ...record, tracks: [{ ...record.tracks[0], file: "../x.mp3" }] };
    expect(() => parseSyncRecord(bad)).toThrow(SyncRecordRejectedError);
  });

  it("throws a zod error, not SyncRecordRejectedError, for a record missing updatedAt", () => {
    const rest: Partial<SyncRecord> = validRecord();
    delete rest.updatedAt;
    const err = caught(() => parseSyncRecord(rest));
    expect(err).not.toBeInstanceOf(SyncRecordRejectedError);
    expect((err as { issues?: unknown }).issues).toBeDefined();
  });

  it("throws a zod error, not SyncRecordRejectedError, for a record whose tracks are missing", () => {
    const rest: Partial<SyncRecord> = validRecord();
    delete rest.tracks;
    const err = caught(() => parseSyncRecord(rest));
    expect(err).not.toBeInstanceOf(SyncRecordRejectedError);
    expect((err as { issues?: unknown }).issues).toBeDefined();
  });
});
