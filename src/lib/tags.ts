import fs from "node:fs/promises";
import path from "node:path";
import NodeID3 from "node-id3";
import { parseFile } from "music-metadata";

export interface WriteTagsInput {
  title: string;
  artist: string;
  albumArtist: string;
  album: string;
  year?: string | null;
  genre?: string | null;
  trackNumber: number;
  trackTotal: number;
  coverPath?: string | null;
}

export interface ReadTagsResult {
  title: string | null;
  artist: string | null;
  album: string | null;
  year: string | null;
  genre: string | null;
  durationSec: number | null;
  hasCover: boolean;
}

function mimeForCover(coverPath: string): string {
  const ext = path.extname(coverPath).toLowerCase();
  if (ext === ".png") return "image/png";
  return "image/jpeg";
}

/** Write ID3v2 tags (including cover art, if provided) into an mp3 file at filePath. */
export async function writeTags(filePath: string, input: WriteTagsInput): Promise<void> {
  const tags: NodeID3.Tags = {
    title: input.title,
    artist: input.artist,
    performerInfo: input.albumArtist,
    album: input.album,
    trackNumber: `${input.trackNumber}/${input.trackTotal}`,
  };

  if (input.year) tags.year = input.year;
  if (input.genre) tags.genre = input.genre;

  if (input.coverPath) {
    const imageBuffer = await fs.readFile(input.coverPath);
    tags.image = {
      mime: mimeForCover(input.coverPath),
      type: { id: 3, name: "front cover" },
      description: "Cover",
      imageBuffer,
    };
  }

  const result = NodeID3.update(tags, filePath);
  if (result instanceof Error) {
    throw result;
  }
}

/** Read existing tags from a media file (any format music-metadata supports). */
export async function readTags(filePath: string): Promise<ReadTagsResult> {
  const meta = await parseFile(filePath);
  const common = meta.common;
  return {
    title: common.title ?? null,
    artist: common.artist ?? null,
    album: common.album ?? null,
    year: common.year != null ? String(common.year) : null,
    genre: common.genre && common.genre.length > 0 ? common.genre[0] : null,
    durationSec: meta.format.duration ?? null,
    hasCover: Array.isArray(common.picture) && common.picture.length > 0,
  };
}
