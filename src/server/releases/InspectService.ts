import path from "node:path";
import type { TagService } from "../audio/TagService";
import type { FileSystem } from "../fs/FileSystem";

export interface InspectedFile {
  name: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  year: string | null;
  genre: string | null;
  durationSec: number | null;
  hasCover: boolean;
}

/**
 * Backs `POST /api/inspect`: reads existing tags off uploaded audio files
 * (to prefill the import form) without storing anything. Files are saved to
 * a scratch temp dir, read, then cleaned up.
 */
export class InspectService {
  constructor(
    private readonly tags: TagService,
    private readonly fs: FileSystem
  ) {}

  async inspect(audioFiles: File[]): Promise<InspectedFile[]> {
    const tempDir = await this.fs.makeTempDir("sli-inspect-");
    try {
      const files: InspectedFile[] = [];
      for (let i = 0; i < audioFiles.length; i++) {
        const file = audioFiles[i];
        const ext = path.extname(file.name) || ".dat";
        const tempPath = path.join(tempDir, `f-${i}${ext}`);
        await this.fs.saveWebFile(file, tempPath);
        try {
          const tags = await this.tags.read(tempPath);
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
      return files;
    } finally {
      await this.fs.removeRecursive(tempDir);
    }
  }
}
