import { z } from "zod";
import { parseDay } from "./playDays";

/** Highest play count a device may report for one track (`spec/sync.md`, "Play counts"). */
export const MAX_PLAY_COUNT = 1_000_000;
/** Most entries in one `PUT /v1/plays` body. */
export const MAX_PLAY_ENTRIES = 500;

/** Most day rows one entry may carry (#201). */
export const MAX_PLAY_DAYS_PER_ENTRY = 400;
/** Most day rows in one `PUT /v1/plays` body, over all its entries (#201). */
export const MAX_PLAY_DAYS_PER_REQUEST = 2000;

/** One day bucket of an entry: this device's absolute count for the track on a real `YYYY-MM-DD` date. */
export const PlayDaySchema = z
  .object({
    day: z.string().refine((value) => parseDay(value) !== null, "day must be a real YYYY-MM-DD date"),
    count: z.number().int().min(0).max(MAX_PLAY_COUNT),
  })
  .strict();
export type PlayDay = z.infer<typeof PlayDaySchema>;

/** One entry of the `PUT /v1/plays` body: this device's absolute count for a track, and optionally for some of its days. */
export const PlayEntrySchema = z
  .object({
    releaseId: z.uuid(),
    trackId: z.uuid(),
    count: z.number().int().min(0).max(MAX_PLAY_COUNT),
    /** Where the plays were counted (#338). Absent means "spotify"; the Mac sends it for Locally plays only. */
    source: z.enum(["spotify", "locally"]).optional(),
    days: z
      .array(PlayDaySchema)
      .max(MAX_PLAY_DAYS_PER_ENTRY)
      .refine((days) => new Set(days.map((d) => d.day)).size === days.length, "Duplicate day in one entry")
      .optional(),
  })
  .strict();
export type PlayEntry = z.infer<typeof PlayEntrySchema>;

/**
 * Body of `PUT /v1/plays`. Strict, like the service: a body naming a device or user (or anything
 * else unknown) is refused. `spec/fixtures/plays/*` is parsed with this in the tests.
 */
export const PlayCountsRequestSchema = z
  .object({ counts: z.array(PlayEntrySchema).min(1).max(MAX_PLAY_ENTRIES) })
  .strict()
  .refine(
    (body) => body.counts.reduce((sum, entry) => sum + (entry.days?.length ?? 0), 0) <= MAX_PLAY_DAYS_PER_REQUEST,
    `At most ${MAX_PLAY_DAYS_PER_REQUEST} day rows per request`,
  );
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

/** Reply of `GET /v1/plays/summary` (one page). Parsed, not trusted: it comes from the network. */
export const ServerPlaysSummaryPageSchema = z.object({
  tracks: z.array(
    z.object({
      trackId: z.string(),
      releaseId: z.string(),
      plays: z.number().int().min(0),
      /** The calling device's own share of `plays` (#216); absent from an older service. */
      devicePlays: z.number().int().min(0).optional(),
      lastPlayedDay: z.string(),
      /** Play events (#398): absent from an older service. `lastPlayedAt` is epoch ms; null when the track has no events. */
      lastPlayedAt: z.number().int().nullable().optional(),
      listenedMs: z.number().int().min(0).optional(),
      events: z.number().int().min(0).optional(),
    }),
  ),
  allTime: z.array(
    z.object({
      trackId: z.string(),
      releaseId: z.string(),
      plays: z.number().int().min(0),
      devicePlays: z.number().int().min(0).optional(),
      lastPlayedAt: z.number().int().nullable().optional(),
      listenedMs: z.number().int().min(0).optional(),
      events: z.number().int().min(0).optional(),
    }),
  ),
  nextCursor: z.string().nullable(),
});
export type ServerPlaysSummaryPage = z.infer<typeof ServerPlaysSummaryPageSchema>;

/** One event of the `PUT /v1/plays/events` body (`spec/sync.md`, "Play events"). Strict: never a `deviceId`. */
export const PlayEventWireSchema = z
  .object({
    id: z.uuid(),
    releaseId: z.uuid(),
    trackId: z.uuid(),
    source: z.enum(["spotify", "locally"]),
    startedAt: z.number().int().min(0),
    day: z.string().refine((value) => parseDay(value) !== null, "day must be a real YYYY-MM-DD date"),
    listenedMs: z.number().int().min(0).max(86_400_000),
  })
  .strict();
export type PlayEventWire = z.infer<typeof PlayEventWireSchema>;

/** Most events in one `PUT /v1/plays/events` body. */
export const MAX_PLAY_EVENTS_PER_REQUEST = 500;

/** Reply of `GET /v1/plays/events` (one page). Parsed, not trusted: it comes from the network. */
export const ServerPlayEventsPageSchema = z.object({
  events: z.array(
    PlayEventWireSchema.extend({
      device: z.object({ id: z.string(), name: z.string(), platform: z.string(), current: z.boolean() }),
    }),
  ),
  nextCursor: z.string().nullable(),
});
export type ServerPlayEventsPage = z.infer<typeof ServerPlayEventsPageSchema>;
