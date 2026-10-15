import { z } from "zod";

/** Highest play count a device may report for one track (`spec/sync.md`, "Play counts"). */
export const MAX_PLAY_COUNT = 1_000_000;
/** Most entries in one `PUT /v1/plays` body. */
export const MAX_PLAY_ENTRIES = 500;

/** One entry of the `PUT /v1/plays` body: this device's absolute count for a track. */
export const PlayEntrySchema = z
  .object({
    releaseId: z.uuid(),
    trackId: z.uuid(),
    count: z.number().int().min(0).max(MAX_PLAY_COUNT),
  })
  .strict();
export type PlayEntry = z.infer<typeof PlayEntrySchema>;

/**
 * Body of `PUT /v1/plays`. Strict, like the service: a body naming a device or user (or anything
 * else unknown) is refused. `spec/fixtures/plays/*` is parsed with this in the tests.
 */
export const PlayCountsRequestSchema = z
  .object({ counts: z.array(PlayEntrySchema).min(1).max(MAX_PLAY_ENTRIES) })
  .strict();
export type PlayCountsRequest = z.infer<typeof PlayCountsRequestSchema>;

export const PlayCountsResultSchema = z.object({
  accepted: z.number().int().min(0),
  ignored: z.number().int().min(0),
});
export type PlayCountsResult = z.infer<typeof PlayCountsResultSchema>;

/** Reply of `GET /v1/releases/:id/plays`. Parsed, not trusted: it comes from the network. */
export const ServerReleasePlaysSchema = z.object({
  tracks: z.array(
    z.object({
      trackId: z.string(),
      total: z.number().int().min(0),
      devices: z.array(
        z.object({
          deviceId: z.string(),
          name: z.string(),
          platform: z.string(),
          count: z.number().int().min(0),
          current: z.boolean(),
        }),
      ),
    }),
  ),
});
export type ServerReleasePlays = z.infer<typeof ServerReleasePlaysSchema>;
