import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import type { ImportMeta } from "../../../lib/types";
import { SUPPORTED_AUDIO_EXT, SUPPORTED_IMAGE_EXT } from "../../../lib/types";
import { importRelease } from "../../../lib/releases";
import { badRequest, errorResponse } from "../../../lib/http";
import { MAX_AUDIO_BYTES, MAX_COVER_BYTES, sniffImageMime } from "../../../lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function hasExt(name: string, exts: readonly string[]): boolean {
  return exts.includes(path.extname(name).toLowerCase());
}

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();

    const metaRaw = form.get("meta");
    if (typeof metaRaw !== "string") {
      return badRequest("meta field (JSON string) is required");
    }

    let meta: ImportMeta;
    try {
      meta = JSON.parse(metaRaw) as ImportMeta;
    } catch {
      return badRequest("meta field must be valid JSON");
    }

    if (meta.kind !== "single" && meta.kind !== "album") {
      return badRequest("meta.kind must be 'single' or 'album'");
    }
    if (typeof meta.artist !== "string" || meta.artist.trim().length === 0) {
      return badRequest("meta.artist is required");
    }
    if (!Array.isArray(meta.tracks) || meta.tracks.length === 0) {
      return badRequest("meta.tracks must be a non-empty array");
    }

    const audioEntries = form.getAll("audio").filter((v): v is File => v instanceof File);
    if (audioEntries.length === 0) {
      return badRequest("At least one audio file is required");
    }
    if (meta.kind === "single" && audioEntries.length !== 1) {
      return badRequest("A single must have exactly one audio file");
    }
    if (audioEntries.length !== meta.tracks.length) {
      return badRequest("Number of audio files must match meta.tracks length");
    }
    for (const f of audioEntries) {
      if (!hasExt(f.name, SUPPORTED_AUDIO_EXT)) {
        return badRequest(`Unsupported audio file type: ${f.name}`);
      }
      if (f.size === 0) {
        return badRequest(`${f.name} is empty`);
      }
      if (f.size > MAX_AUDIO_BYTES) {
        return badRequest(`${f.name} is larger than 500MB`);
      }
    }

    const coverEntry = form.get("cover");
    let coverFile: File | null = null;
    if (coverEntry instanceof File && coverEntry.size > 0) {
      if (!hasExt(coverEntry.name, SUPPORTED_IMAGE_EXT)) {
        return badRequest(`Unsupported cover image type: ${coverEntry.name}`);
      }
      if (coverEntry.size > MAX_COVER_BYTES) {
        return badRequest("Cover image must be 10MB or smaller");
      }
      if (!(await sniffImageMime(coverEntry))) {
        return badRequest("Cover image must be a real JPEG or PNG");
      }
      coverFile = coverEntry;
    }

    const release = await importRelease(meta, coverFile, audioEntries);
    return NextResponse.json(release);
  } catch (err) {
    return errorResponse(err);
  }
}
