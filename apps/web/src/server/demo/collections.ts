import type { CollectionRecord } from "../../shared/collections";

/** Three invented collections for the public demo (#349), made from the demo library's invented releases. */
const AT = "2026-10-20T20:00:00.000Z";

function demo(id: string, name: string, items: CollectionRecord["items"], at: string): CollectionRecord {
  return { syncVersion: 1, id, name, items, origin: "mac", originDevice: "Demo Mac", createdAt: at, updatedAt: at, deleted: false };
}

export const DEMO_COLLECTIONS: CollectionRecord[] = [
  demo(
    "9c1e2f40-6b3a-4d7e-8a51-2f0c9d4b7e13",
    "Late drives",
    [
      { kind: "release", releaseId: "demo-night-bus-to-nowhere" },
      { kind: "track", releaseId: "demo-afterimage", trackId: "demo-afterimage-t3" },
      { kind: "release", releaseId: "demo-static-bloom" },
      { kind: "track", releaseId: "demo-paper-lanterns", trackId: "demo-paper-lanterns-t1" },
      { kind: "track", releaseId: "demo-velvet-hours", trackId: "demo-velvet-hours-t5" },
      { kind: "release", releaseId: "demo-low-orbit" },
    ],
    AT,
  ),
  demo(
    "5b7d2a10-3c4e-4f68-9a21-8e6f1d0c2b34",
    "Sunday morning",
    [
      { kind: "release", releaseId: "demo-paper-lanterns" },
      { kind: "track", releaseId: "demo-saltwater-hymns", trackId: "demo-saltwater-hymns-t1" },
      { kind: "track", releaseId: "demo-copper-sky-sessions", trackId: "demo-copper-sky-sessions-t2" },
    ],
    "2026-10-21T09:00:00.000Z",
  ),
  demo(
    "e2a41c77-0d95-4b30-a1f2-7c5d3e8f9a06",
    "Try later",
    [{ kind: "track", releaseId: "demo-glasshouse-summer", trackId: "demo-glasshouse-summer-t1" }],
    "2026-10-22T18:30:00.000Z",
  ),
];
