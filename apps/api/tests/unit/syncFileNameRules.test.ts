import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MAX_FILE_NAME_BYTES, SUPPORTED_FILE_EXT, fileNameSchema } from "../../src/shared/types";

const rules = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../../spec/sync-file-names.json", import.meta.url)), "utf8"),
) as { extensions: string[]; maxNameBytes: number };

describe("sync file-name rules (#87)", () => {
  it("the extension list equals spec/sync-file-names.json", () => {
    expect([...SUPPORTED_FILE_EXT]).toEqual(rules.extensions);
  });

  it("the byte limit equals spec/sync-file-names.json", () => {
    expect(MAX_FILE_NAME_BYTES).toBe(rules.maxNameBytes);
  });

  it("counts UTF-8 bytes, not characters", () => {
    expect(fileNameSchema.safeParse(`${"あ".repeat(83)}ab.mp3`).success).toBe(true); // 255 bytes
    expect(fileNameSchema.safeParse(`${"あ".repeat(83)}abc.mp3`).success).toBe(false); // 256 bytes, 90 characters
  });
});
