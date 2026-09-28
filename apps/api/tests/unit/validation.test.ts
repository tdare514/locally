import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { emailSchema, fileNameSchema, releaseRecordSchema, type TrackRecord } from "../../src/shared/types";
import { MAX_JSON_BODY_BYTES, parseJsonBody, parseParam } from "../../src/server/http/validation";
import { ValidationError } from "../../src/shared/errors";
import { makeReleaseRecord } from "../support/fixtures";

function makeTracks(count: number): TrackRecord[] {
  return Array.from({ length: count }, (_, i) => ({
    id: crypto.randomUUID(),
    title: `Track ${i + 1}`,
    trackNumber: i + 1,
    file: `${String(i + 1).padStart(3, "0")}.mp3`,
    bytes: 1000,
    durationSec: 60,
  }));
}

describe("fileNameSchema", () => {
  it("accepts a plain name with an allowed extension", () => {
    expect(fileNameSchema.safeParse("01 - Night Drive.mp3").success).toBe(true);
    expect(fileNameSchema.safeParse("cover.jpeg").success).toBe(true);
    expect(fileNameSchema.safeParse("cover.PNG").success).toBe(true);
  });

  it("rejects path separators", () => {
    expect(fileNameSchema.safeParse("../../etc/passwd.mp3").success).toBe(false);
    expect(fileNameSchema.safeParse("a/b.mp3").success).toBe(false);
    expect(fileNameSchema.safeParse("a\\b.mp3").success).toBe(false);
  });

  it("rejects a disallowed extension", () => {
    expect(fileNameSchema.safeParse("track.wav").success).toBe(false);
    expect(fileNameSchema.safeParse("script.exe").success).toBe(false);
  });

  it("rejects a name longer than 200 characters", () => {
    const long = `${"a".repeat(201)}.mp3`;
    expect(fileNameSchema.safeParse(long).success).toBe(false);
  });
});

describe("emailSchema", () => {
  it("trims and lowercases", () => {
    const result = emailSchema.safeParse("  Person@Example.com  ");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("person@example.com");
  });

  it("rejects a non-email string", () => {
    expect(emailSchema.safeParse("not-an-email").success).toBe(false);
  });
});

describe("releaseRecordSchema", () => {
  it("accepts a spec-shaped record", () => {
    const record = makeReleaseRecord();
    expect(releaseRecordSchema.safeParse(record).success).toBe(true);
  });

  it("rejects a record with a bad year", () => {
    const record = makeReleaseRecord({ year: "not-a-year" });
    expect(releaseRecordSchema.safeParse(record).success).toBe(false);
  });

  it("rejects a track file name with a path separator", () => {
    const record = makeReleaseRecord();
    record.tracks[0]!.file = "../evil.mp3";
    expect(releaseRecordSchema.safeParse(record).success).toBe(false);
  });

  it("rejects an empty tracks array", () => {
    const record = makeReleaseRecord({ tracks: [] });
    expect(releaseRecordSchema.safeParse(record).success).toBe(false);
  });

  it("accepts syncVersion 2 with a coverHash, syncVersion 1 without one, and rejects a malformed hash", () => {
    const hash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    expect(releaseRecordSchema.safeParse(makeReleaseRecord({ syncVersion: 2, coverHash: hash })).success).toBe(true);
    expect(releaseRecordSchema.safeParse(makeReleaseRecord({ syncVersion: 2, coverHash: null })).success).toBe(true);
    expect(releaseRecordSchema.parse(makeReleaseRecord()).coverHash).toBeUndefined();
    expect(releaseRecordSchema.safeParse(makeReleaseRecord({ syncVersion: 2, coverHash: "abc" })).success).toBe(false);
    expect(releaseRecordSchema.safeParse(makeReleaseRecord({ syncVersion: 3 as never })).success).toBe(false);
  });

  it("accepts exactly 500 tracks and rejects 501", () => {
    const at500 = makeReleaseRecord({ tracks: makeTracks(500) });
    expect(releaseRecordSchema.safeParse(at500).success).toBe(true);

    const at501 = makeReleaseRecord({ tracks: makeTracks(501) });
    expect(releaseRecordSchema.safeParse(at501).success).toBe(false);
  });
});

describe("parseJsonBody / parseParam", () => {
  it("throws ValidationError (not a zod error) on invalid JSON", async () => {
    const request = new Request("http://localhost/x", { method: "POST", body: "{not json" });
    await expect(parseJsonBody(request, emailSchema)).rejects.toThrow(ValidationError);
  });

  it("throws ValidationError with a readable message on schema mismatch", async () => {
    const request = new Request("http://localhost/x", {
      method: "POST",
      body: JSON.stringify({ email: "nope" }),
      headers: { "content-type": "application/json" },
    });
    await expect(parseJsonBody(request, emailSchema)).rejects.toThrow(ValidationError);
  });

  it("parseParam returns the parsed value on success", () => {
    expect(parseParam("person@example.com", emailSchema)).toBe("person@example.com");
  });

  it("rejects a body whose declared content-length exceeds the max, without reading it", async () => {
    const request = new Request("http://localhost/x", {
      method: "POST",
      body: JSON.stringify({ email: "person@example.com" }),
      headers: { "content-type": "application/json", "content-length": String(MAX_JSON_BODY_BYTES + 1) },
    });
    await expect(parseJsonBody(request, emailSchema)).rejects.toThrow(ValidationError);
  });

  it("rejects a body whose actual size exceeds the max", async () => {
    const oversized = JSON.stringify({ email: "a".repeat(MAX_JSON_BODY_BYTES) + "@example.com" });
    const request = new Request("http://localhost/x", {
      method: "POST",
      body: oversized,
      headers: { "content-type": "application/json" },
    });
    await expect(parseJsonBody(request, emailSchema)).rejects.toThrow(ValidationError);
  });
});
