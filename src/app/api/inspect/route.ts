import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { SUPPORTED_AUDIO_EXT } from "../../../lib/types";
import { readTags } from "../../../lib/tags";
import { makeTempDir, removeRecursive, saveWebFileToDisk } from "../../../lib/fsutil";
import { badRequest, errorResponse } from "../../../lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function hasExt(name: string, exts: readonly string[]): boolean {
  return exts.includes(path.extname(name).toLowerCase());
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const audioEntries = form.getAll("audio").filter((v): v is File => v instanceof File);
  if (audioEntries.length === 0) {
    return badRequest("At least one audio file is required");
  }
  for (const f of audioEntries) {
    if (!hasExt(f.name, SUPPORTED_AUDIO_EXT)) {
      return badRequest(`Unsupported audio file type: ${f.name}`);
    }
  }

  const tempDir = await makeTempDir("sli-inspect-");
  try {
    const files = [];
    for (let i = 0; i < audioEntries.length; i++) {
      const file = audioEntries[i];
      const ext = path.extname(file.name) || ".dat";
      const tempPath = path.join(tempDir, `f-${i}${ext}`);
      await saveWebFileToDisk(file, tempPath);
      try {
        const tags = await readTags(tempPath);
        files.push({ name: file.name, ...tags });
      } catch (err) {
        console.error(`Failed to read tags for ${file.name}:`, err);
        files.push({
          name: file.name,
          title: null,
          artist: null,
          album: null,
          year: null,
          genre: null,
          durationSec: null,
          hasCover: false,
        });
      }
    }
    return NextResponse.json({ files });
  } catch (err) {
    return errorResponse(err);
  } finally {
    await removeRecursive(tempDir);
  }
}
