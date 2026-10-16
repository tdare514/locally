import { MAX_FILE_NAME_BYTES, type ReleaseRecord } from "../../shared/types";

/**
 * The file names a release already stores that are over the byte limit (#87). The PUT, upload and
 * download routes accept exactly these past the limit, so a record saved under the older
 * 200-UTF-16-unit rule keeps working. Only the length gets this allowance.
 */
export function storedLongNames(record: Pick<ReleaseRecord, "tracks" | "cover">): Set<string> {
  const names = new Set<string>();
  for (const name of [...record.tracks.map((t) => t.file), ...(record.cover ? [record.cover] : [])]) {
    if (new TextEncoder().encode(name).length > MAX_FILE_NAME_BYTES) names.add(name);
  }
  return names;
}
