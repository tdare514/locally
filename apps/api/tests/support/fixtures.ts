import crypto from "node:crypto";
import type { ReleaseRecord } from "../../src/shared/types";

/** A spec-shaped `ReleaseRecord` (see spec/sync.md) with sane defaults, for tests to tweak. */
export function makeReleaseRecord(overrides: Partial<ReleaseRecord> = {}): ReleaseRecord {
  const now = new Date().toISOString();
  return {
    syncVersion: 1,
    id: crypto.randomUUID(),
    kind: "single",
    title: "Night Drive",
    artist: "Chromatics",
    year: "2024",
    genre: null,
    cover: "cover.jpg",
    tracks: [
      {
        id: crypto.randomUUID(),
        title: "Night Drive",
        trackNumber: 1,
        file: "01 - Night Drive.mp3",
        bytes: 5_120_000,
        durationSec: 61.2,
      },
    ],
    origin: "mac",
    originDevice: "Toby's MacBook",
    createdAt: now,
    updatedAt: now,
    deleted: false,
    ...overrides,
  };
}
