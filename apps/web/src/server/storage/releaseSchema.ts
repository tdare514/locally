import { z } from "zod";

/**
 * Zod mirror of `Release`/`Track` (`src/shared/types.ts`), used to validate entries read back
 * from `library.json`. That file is otherwise trusted as our own output, but sync writes it from
 * network-sourced records and a hand-edited or corrupted file is possible too, so a malformed
 * entry should be skipped on read rather than crash every list/find call - or, worse, be trusted
 * enough to reach `ReleaseService`'s path checks with the wrong shape. Loose, so fields this
 * schema doesn't list yet survive a read-modify-write instead of being stripped.
 */
export const TrackSchema = z.looseObject({
  id: z.string(),
  title: z.string(),
  trackNumber: z.number(),
  filePath: z.string(),
  originalName: z.string(),
  durationSec: z.number().nullable(),
});

export const ReleaseSchema = z.looseObject({
  id: z.string(),
  kind: z.union([z.literal("single"), z.literal("album")]),
  title: z.string(),
  artist: z.string(),
  year: z.string().nullable(),
  genre: z.string().nullable(),
  coverPath: z.string().nullable(),
  folderPath: z.string(),
  tracks: z.array(TrackSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
