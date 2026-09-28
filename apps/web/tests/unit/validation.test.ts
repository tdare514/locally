import { describe, expect, it } from "vitest";
import { ValidationError } from "../../src/shared/errors";
import { parseImportMeta, parseInspectAudio, parseUpdateMeta, sniffImageMime } from "../../src/server/http/validation";

const JPEG_HEADER = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG_HEADER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function audioFile(name = "track.mp3", bytes = new Uint8Array([1, 2, 3])): File {
  return new File([bytes], name, { type: "audio/mpeg" });
}

describe("sniffImageMime", () => {
  it("accepts real JPEG magic bytes", async () => {
    const file = new File([JPEG_HEADER], "cover.jpg", { type: "image/jpeg" });
    await expect(sniffImageMime(file)).resolves.toBe("image/jpeg");
  });

  it("accepts real PNG magic bytes", async () => {
    const file = new File([PNG_HEADER], "cover.png", { type: "image/png" });
    await expect(sniffImageMime(file)).resolves.toBe("image/png");
  });

  it("rejects plain text pretending to be an image", async () => {
    const file = new File([new TextEncoder().encode("not an image")], "cover.jpg", { type: "image/jpeg" });
    await expect(sniffImageMime(file)).resolves.toBeNull();
  });
});

describe("parseImportMeta", () => {
  function formWith(overrides: {
    meta?: unknown;
    audio?: File[];
    cover?: File;
    skipMeta?: boolean;
  }): FormData {
    const form = new FormData();
    if (!overrides.skipMeta) {
      form.set("meta", JSON.stringify(overrides.meta));
    }
    for (const f of overrides.audio ?? [audioFile()]) {
      form.append("audio", f);
    }
    if (overrides.cover) form.set("cover", overrides.cover);
    return form;
  }

  it("rejects a bad kind", async () => {
    const form = formWith({ meta: { kind: "ep", artist: "A", tracks: [{ title: "T", trackNumber: 1 }] } });
    await expect(parseImportMeta(form)).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a missing artist", async () => {
    const form = formWith({ meta: { kind: "single", artist: "", tracks: [{ title: "T", trackNumber: 1 }] } });
    await expect(parseImportMeta(form)).rejects.toThrow(/artist is required/);
  });

  it("rejects a single with two audio files", async () => {
    const form = formWith({
      meta: {
        kind: "single",
        artist: "A",
        tracks: [
          { title: "T1", trackNumber: 1 },
          { title: "T2", trackNumber: 2 },
        ],
      },
      audio: [audioFile("a.mp3"), audioFile("b.mp3")],
    });
    await expect(parseImportMeta(form)).rejects.toThrow(/exactly one audio file/);
  });

  it("rejects a mismatched track count", async () => {
    const form = formWith({
      meta: { kind: "album", artist: "A", tracks: [{ title: "T1", trackNumber: 1 }] },
      audio: [audioFile("a.mp3"), audioFile("b.mp3")],
    });
    await expect(parseImportMeta(form)).rejects.toThrow(/must match meta\.tracks length/);
  });

  it("accepts a valid single", async () => {
    const form = formWith({
      meta: { kind: "single", artist: "A", tracks: [{ title: "T1", trackNumber: 1 }] },
      audio: [audioFile("a.mp3")],
    });
    const { meta, audioFiles, coverFile } = await parseImportMeta(form);
    expect(meta.kind).toBe("single");
    expect(audioFiles).toHaveLength(1);
    expect(coverFile).toBeNull();
  });
});

describe("parseImportMeta field validation", () => {
  const base = { kind: "album", artist: "A", title: "Album" };

  function formFor(meta: unknown, audioCount = 1): FormData {
    const form = new FormData();
    form.set("meta", JSON.stringify(meta));
    for (let i = 0; i < audioCount; i++) form.append("audio", audioFile(`t${i}.mp3`));
    return form;
  }

  it.each([
    ["a string", "1"],
    ["a path", "../../../../tmp/x"],
    ["negative", -1],
    ["zero", 0],
    ["1000", 1000],
    ["a fraction", 1.5],
    ["null", null],
  ])("rejects a trackNumber that is %s", async (_label, trackNumber) => {
    const form = formFor({ ...base, tracks: [{ title: "T", trackNumber }] });
    await expect(parseImportMeta(form)).rejects.toBeInstanceOf(ValidationError);
    await expect(parseImportMeta(form)).rejects.toThrow(
      /meta\.tracks\[0\]\.trackNumber must be an integer between 1 and 999/
    );
  });

  it("rejects a track title over 200 characters", async () => {
    const form = formFor({ ...base, tracks: [{ title: "x".repeat(201), trackNumber: 1 }] });
    await expect(parseImportMeta(form)).rejects.toThrow(/meta\.tracks\[0\]\.title must be at most 200 characters/);
  });

  it("rejects an artist over 200 characters", async () => {
    const form = formFor({ ...base, artist: "x".repeat(201), tracks: [{ title: "T", trackNumber: 1 }] });
    await expect(parseImportMeta(form)).rejects.toThrow(/meta\.artist must be at most 200 characters/);
  });

  it("rejects control characters in text fields", async () => {
    for (const bad of ["A\u0000B", "line\nbreak", "del\u007f"]) {
      const form = formFor({ ...base, artist: bad, tracks: [{ title: "T", trackNumber: 1 }] });
      await expect(parseImportMeta(form)).rejects.toThrow(/meta\.artist must not contain control characters/);
    }
    const form = formFor({ ...base, tracks: [{ title: "T\u001f", trackNumber: 1 }] });
    await expect(parseImportMeta(form)).rejects.toThrow(/meta\.tracks\[0\]\.title must not contain control characters/);
  });

  it("accepts a normal 12-track album and trims text", async () => {
    const tracks = Array.from({ length: 12 }, (_, i) => ({ title: ` Track ${i + 1} `, trackNumber: i + 1 }));
    const form = formFor({ ...base, artist: "  The Band ", year: "2024", genre: " Rock ", tracks }, 12);
    const { meta, audioFiles } = await parseImportMeta(form);
    expect(meta.artist).toBe("The Band");
    expect(meta.genre).toBe("Rock");
    expect(meta.year).toBe("2024");
    expect(meta.tracks).toHaveLength(12);
    expect(meta.tracks[11]).toEqual({ title: "Track 12", trackNumber: 12 });
    expect(audioFiles).toHaveLength(12);
  });

  it("rejects more than 200 tracks", async () => {
    const tracks = Array.from({ length: 201 }, (_, i) => ({ title: "T", trackNumber: i + 1 }));
    const form = formFor({ ...base, tracks }, 201);
    await expect(parseImportMeta(form)).rejects.toThrow(/meta\.tracks must have at most 200 tracks/);
  });

  it("year is optional but must be a 4-digit string when present", async () => {
    const track = { title: "T", trackNumber: 1 };
    const { meta: noYear } = await parseImportMeta(formFor({ ...base, tracks: [track] }));
    expect(noYear.year).toBeUndefined();
    const { meta: withYear } = await parseImportMeta(formFor({ ...base, year: " 1999 ", tracks: [track] }));
    expect(withYear.year).toBe("1999");
    for (const bad of ["24", "twenty", "2024-01", 2024, null]) {
      await expect(parseImportMeta(formFor({ ...base, year: bad, tracks: [track] }))).rejects.toThrow(
        /meta\.year must be a 4-digit year/
      );
    }
  });

  it("rejects a meta that is valid JSON but not an object", async () => {
    await expect(parseImportMeta(formFor(null))).rejects.toThrow(/meta must be a JSON object/);
    await expect(parseImportMeta(formFor([]))).rejects.toThrow(/meta must be a JSON object/);
  });
});

describe("parseImportMeta duplicate track numbers", () => {
  const base = { kind: "album", artist: "A", title: "Album" };

  function formFor(meta: unknown, audioCount: number): FormData {
    const form = new FormData();
    form.set("meta", JSON.stringify(meta));
    for (let i = 0; i < audioCount; i++) form.append("audio", audioFile(`t${i}.mp3`));
    return form;
  }

  it("rejects two tracks sharing a trackNumber", async () => {
    const tracks = [
      { title: "T1", trackNumber: 1 },
      { title: "T2", trackNumber: 1 },
    ];
    const form = formFor({ ...base, tracks }, 2);
    await expect(parseImportMeta(form)).rejects.toThrow(
      /meta\.tracks\[1\]\.trackNumber duplicates the trackNumber already used by tracks\[0\]/
    );
  });

  it("accepts distinct track numbers", async () => {
    const tracks = [
      { title: "T1", trackNumber: 1 },
      { title: "T2", trackNumber: 2 },
    ];
    const { meta } = await parseImportMeta(formFor({ ...base, tracks }, 2));
    expect(meta.tracks).toHaveLength(2);
  });
});

describe("parseUpdateMeta duplicate track numbers", () => {
  it("rejects two track patches sharing a trackNumber", () => {
    expect(() =>
      parseUpdateMeta({
        tracks: [
          { id: "t1", trackNumber: 3 },
          { id: "t2", trackNumber: 3 },
        ],
      })
    ).toThrow(/tracks\[1\]\.trackNumber duplicates the trackNumber already used by tracks\[0\]/);
  });

  it("ignores patches that don't touch trackNumber", () => {
    expect(() =>
      parseUpdateMeta({
        tracks: [
          { id: "t1", title: "A" },
          { id: "t2", title: "B" },
        ],
      })
    ).not.toThrow();
  });
});

describe("MAX_AUDIO_FILES", () => {
  it("rejects an import with more than 100 audio files", async () => {
    const base = { kind: "album", artist: "A", title: "Album" };
    const tracks = Array.from({ length: 101 }, (_, i) => ({ title: `T${i}`, trackNumber: i + 1 }));
    const form = new FormData();
    form.set("meta", JSON.stringify({ ...base, tracks }));
    for (let i = 0; i < 101; i++) form.append("audio", audioFile(`t${i}.mp3`));
    await expect(parseImportMeta(form)).rejects.toThrow(/At most 100 audio files/);
  });

  it("rejects an inspect request with more than 100 audio files", () => {
    const form = new FormData();
    for (let i = 0; i < 101; i++) form.append("audio", audioFile(`t${i}.mp3`));
    expect(() => parseInspectAudio(form)).toThrow(/At most 100 audio files/);
  });
});

describe("parseInspectAudio per-file size limit", () => {
  it("rejects an audio file over MAX_AUDIO_BYTES", () => {
    const file = new File([new Uint8Array(1)], "big.mp3");
    // Faking a huge upload without allocating 500MB: defineProperty adds an own
    // data property that shadows the inherited `size` getter.
    Object.defineProperty(file, "size", { value: 500 * 1024 * 1024 + 1 });
    const form = new FormData();
    form.append("audio", file);
    expect(() => parseInspectAudio(form)).toThrow(/larger than 500MB/);
  });
});

describe("parseUpdateMeta", () => {
  it("accepts a partial patch, trimming text", () => {
    const patch = parseUpdateMeta({ title: " New ", tracks: [{ id: "t1", trackNumber: 2 }] });
    expect(patch).toEqual({ title: "New", tracks: [{ id: "t1", trackNumber: 2 }] });
    expect(patch.artist).toBeUndefined();
  });

  it("accepts null year and genre (clearing them)", () => {
    expect(parseUpdateMeta({ year: null, genre: null })).toEqual({ year: null, genre: null });
  });

  it("rejects a body that is not an object", () => {
    for (const body of [null, "x", 1, []]) {
      expect(() => parseUpdateMeta(body)).toThrow(ValidationError);
      expect(() => parseUpdateMeta(body)).toThrow(/Request body must be a JSON object/);
    }
  });

  it("rejects a bad trackNumber in a track patch", () => {
    for (const trackNumber of ["../x", 0, 1000, 1.5]) {
      expect(() => parseUpdateMeta({ tracks: [{ id: "t1", trackNumber }] })).toThrow(
        /tracks\[0\]\.trackNumber must be an integer between 1 and 999/
      );
    }
  });

  it("rejects a track patch without a string id", () => {
    expect(() => parseUpdateMeta({ tracks: [{ title: "T" }] })).toThrow(/tracks\[0\]\.id must be a string/);
    expect(() => parseUpdateMeta({ tracks: [{ id: "", title: "T" }] })).toThrow(/tracks\[0\]\.id is required/);
  });

  it("rejects a non-4-digit year, control characters and over-long text", () => {
    expect(() => parseUpdateMeta({ year: "20x4" })).toThrow(/year must be a 4-digit year/);
    expect(() => parseUpdateMeta({ title: "a\u0000b" })).toThrow(/title must not contain control characters/);
    expect(() => parseUpdateMeta({ artist: "x".repeat(201) })).toThrow(/artist must be at most 200 characters/);
  });
});
