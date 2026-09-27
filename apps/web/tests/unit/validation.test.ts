import { describe, expect, it } from "vitest";
import { ValidationError } from "../../src/shared/errors";
import { parseImportMeta, sniffImageMime } from "../../src/server/http/validation";

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
