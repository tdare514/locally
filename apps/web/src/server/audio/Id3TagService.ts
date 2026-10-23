import fs from "node:fs/promises";
import path from "node:path";
import NodeID3 from "node-id3";
import { parseFile } from "music-metadata";
import { isDiscNumber } from "../../shared/discs";
import { makeReleaseDate, releaseDateFromTag, releaseDateIso, releaseDateValue, releaseYear, storedReleaseDate, type ReleaseDate } from "../../shared/releaseDate";
import type { ReadTagsResult, TagService, WriteTagsInput } from "./TagService";

function mimeForCover(coverPath: string): string {
  const ext = path.extname(coverPath).toLowerCase();
  if (ext === ".png") return "image/png";
  return "image/jpeg";
}

/** An ID3v2.3 file's TYER (YYYY) with its TDAT (DDMM) as a date; null when either is missing or the pair is not a real date. */
function dateFromTyerTdat(native: Record<string, { id: string; value: unknown }[]>): ReleaseDate | null {
  const frames = native["ID3v2.3"];
  if (!frames) return null;
  const text = (id: string) => {
    const value = frames.find((f) => f.id === id)?.value;
    return typeof value === "string" ? value.trim() : null;
  };
  const tyer = text("TYER");
  const tdat = text("TDAT");
  if (!tyer || !tdat || !/^\d{4}$/.test(tyer) || !/^\d{4}$/.test(tdat)) return null;
  const date = makeReleaseDate(Number(tyer), Number(tdat.slice(2)), Number(tdat.slice(0, 2)));
  return date ?? null;
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
    // Spotify reads an mp3's year from TYER only (#234), so TYER always holds the year; TDRC holds the full date
    // when there is one. TDAT is not written. With no year both frames are named `undefined`, so an earlier
    // write's date does not survive.
    const date = storedReleaseDate(input.year, input.releaseDate);
    if (date) {
      tags.year = releaseYear(date);
      tags.recordingTime = releaseDateIso(date);
    } else if (input.year) {
      // An old synced year that is not four digits: TYER as before, but never in TDRC, which is a timestamp.
      tags.year = input.year;
      tags.recordingTime = undefined;
    } else {
      tags.year = undefined;
      tags.recordingTime = undefined;
    }
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
    let date = common.date != null ? releaseDateFromTag(String(common.date)) : null;
    if (!date || date.month === undefined) date = dateFromTyerTdat(meta.native) ?? date;
    return {
      title: common.title ?? null,
      artist: common.artist ?? null,
      album: common.album ?? null,
      year: date ? releaseYear(date) : common.year != null ? String(common.year) : null,
      releaseDate: date ? (releaseDateValue(date) ?? null) : null,
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
