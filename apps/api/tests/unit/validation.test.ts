import { describe, expect, it } from "vitest";
import { emailSchema, fileNameSchema, releaseRecordSchema } from "../../src/shared/types";
import { parseJsonBody, parseParam } from "../../src/server/http/validation";
import { ValidationError } from "../../src/shared/errors";
import { makeReleaseRecord } from "../support/fixtures";

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
});
