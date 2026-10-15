import type { Release, SettingsResponse, SpotifySourceStatus, SyncStatus, Track } from "../../shared/types";

/**
 * Invented sample library for the public read-only demo (#139). Every artist,
 * title and path here is fictional; nothing is read from disk.
 */

const DEMO_DIR = "/Users/demo/Music/Locally";

function tracks(releaseId: string, folder: string, list: [string, number][]): Track[] {
  return list.map(([title, durationSec], i) => ({
    id: `${releaseId}-t${i + 1}`,
    title,
    trackNumber: i + 1,
    filePath: `${DEMO_DIR}/${folder}/${String(i + 1).padStart(2, "0")} ${title}.mp3`,
    originalName: `${title}.wav`,
    durationSec,
  }));
}

function release(
  id: string,
  kind: Release["kind"],
  title: string,
  artist: string,
  year: string,
  genre: string,
  list: [string, number][],
  createdAt: string,
): Release {
  const folder = `${artist}/${title}`;
  return {
    id,
    kind,
    title,
    artist,
    year,
    genre,
    coverPath: `${DEMO_DIR}/${folder}/cover.jpg`,
    folderPath: `${DEMO_DIR}/${folder}`,
    tracks: tracks(id, folder, list),
    createdAt,
    updatedAt: createdAt,
  };
}

export const DEMO_RELEASES: Release[] = [
  release("demo-glasshouse-summer", "single", "Glasshouse Summer", "Mira Valdane", "2024", "Dream pop",
    [["Glasshouse Summer", 214]], "2024-06-14T09:30:00.000Z"),
  release("demo-paper-lanterns", "album", "Paper Lanterns", "The Quiet Orchard", "2022", "Indie folk",
    [["Low Tide Morning", 231], ["Paper Lanterns", 198], ["Orchard Gate", 256], ["Slow Letters", 207], ["Hollow Branch", 289], ["Lantern Out", 176]],
    "2023-02-03T18:12:00.000Z"),
  release("demo-night-bus-to-nowhere", "single", "Night Bus to Nowhere", "Juno Kessler", "2025", "Synthwave",
    [["Night Bus to Nowhere", 247]], "2025-01-22T21:05:00.000Z"),
  release("demo-saltwater-hymns", "album", "Saltwater Hymns", "Okoro & the Tidemarks", "2019", "Soul",
    [["First Light on the Pier", 262], ["Saltwater Hymn", 304], ["Rope and Ember", 221], ["Harbour Lights", 275], ["Where the Gulls Sleep", 238], ["Amen, Tide", 319], ["Low Water", 192]],
    "2021-09-09T11:40:00.000Z"),
  release("demo-static-bloom", "single", "Static Bloom", "Pale Meridian", "2023", "Electronic",
    [["Static Bloom", 189]], "2023-10-30T15:20:00.000Z"),
  release("demo-copper-sky-sessions", "album", "Copper Sky Sessions", "Dax Holloway Trio", "2016", "Jazz",
    [["Copper Sky", 342], ["Quarter Past Blue", 296], ["Rooftop Waltz", 258], ["Understudy", 311]],
    "2020-04-18T13:00:00.000Z"),
];

export const DEMO_SETTINGS_RESPONSE: SettingsResponse = {
  libraryDir: DEMO_DIR,
  sync: { baseUrl: "https://locally-sync-api.vercel.app", email: null, signedIn: false, lastVersion: 0 },
  trackPlays: false,
};

/** Signed out, nothing pending. */
export const DEMO_SYNC_STATUS: SyncStatus = {
  signedIn: false,
  email: null,
  baseUrl: "https://locally-sync-api.vercel.app",
  deviceName: null,
  lastRunAt: null,
  lastError: null,
  pendingFromPhone: [],
  quota: null,
};

/** Spotify can already see the folder, so the "can't see this yet" prompt stays hidden. */
export const DEMO_SPOTIFY_SOURCE: SpotifySourceStatus = {
  libraryDir: DEMO_DIR,
  watching: true,
  dismissed: false,
};

export function findDemoRelease(id: string): Release | undefined {
  return DEMO_RELEASES.find((r) => r.id === id);
}
