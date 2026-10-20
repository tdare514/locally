import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MAX_SYNC_NAME_BYTES, SYNC_FILE_EXTENSIONS, isPlainSyncName } from "../../src/server/sync/SyncRecord";

const rules = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../../spec/sync-file-names.json", import.meta.url)), "utf8"),
) as { extensions: string[]; maxNameBytes: number };

describe("sync file-name rules (#87)", () => {
  it("the extension list equals spec/sync-file-names.json", () => {
    expect([...SYNC_FILE_EXTENSIONS]).toEqual(rules.extensions);
  });

  it("the byte limit equals spec/sync-file-names.json", () => {
    expect(MAX_SYNC_NAME_BYTES).toBe(rules.maxNameBytes);
  });

  it("counts UTF-8 bytes, not characters", () => {
    expect(isPlainSyncName("あ".repeat(85))).toBe(true); // 255 bytes
    expect(isPlainSyncName("あ".repeat(86))).toBe(false); // 258 bytes, 86 characters
  });
});
