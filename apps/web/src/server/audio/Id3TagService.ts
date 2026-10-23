import fs from "node:fs/promises";
import path from "node:path";
import NodeID3 from "node-id3";
import { parseFile } from "music-metadata";
import { isDiscNumber } from "../../shared/discs";
import type { ReadTagsResult, TagService, WriteTagsInput } from "./TagService";

function mimeForCover(coverPath: string): string {
  const ext = path.extname(coverPath).toLowerCase();
  if (ext === ".png") return "image/png";
  return "image/jpeg";
}

/** `TagService` implemented with `node-id3` (write) and `music-metadata` (read). */
export class Id3TagService implements TagService {
  async write(filePath: string, input: WriteTagsInput): Promise<void> {
    const tags: NodeID3.Tags = {
      title: input.title,
      artist: input.artist,
      performerInfo: input.albumArtist,
      album: input.album,
      trackNumber: `${input.trackNumber}/${input.trackTotal}`,
    };

    // `NodeID3.update` merges into the tags already in the file, so a TPOS left by an earlier write
    // (or carried over by ffmpeg) would survive. Naming the frame with `undefined` replaces it with
    // nothing, so a release with no discs ends up with no TPOS.
    tags.partOfSet =
      input.discNumber != null && input.discTotal != null ? `${input.discNumber}/${input.discTotal}` : undefined;
    if (input.year) tags.year = input.year;
    if (input.releaseDate) tags.recordingTime = input.releaseDate;
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

  async read(filePath: string): Promise<ReadTagsResult> {
    const meta = await parseFile(filePath);
    const common = meta.common;
    const discNo = common.disk?.no;
    return {
      title: common.title ?? null,
      artist: common.artist ?? null,
      album: common.album ?? null,
      year: common.year != null ? String(common.year) : null,
      genre: common.genre && common.genre.length > 0 ? common.genre[0] : null,
      durationSec: meta.format.duration ?? null,
      hasCover: Array.isArray(common.picture) && common.picture.length > 0,
      trackNumber: common.track?.no ?? null,
      trackTotal: common.track?.of ?? null,
      discNumber: isDiscNumber(discNo) ? discNo : null,
      discTotal: common.disk?.of ?? null,
    };
  }
}
