/**
 * The content type each supported file extension maps to. Both clients
 * (`apps/web`, `apps/ios`) derive a file's `contentType` from its extension
 * using this exact map; `ReleaseFilesService.createUploads` enforces
 * server-side that a client's declared `contentType` matches it, and the
 * local-download route uses it to set the response's `Content-Type` header.
 */
export const MIME_BY_EXT: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

function extensionOf(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

/** The content type a file name is expected to carry, or `undefined` for an unrecognised extension. */
export function expectedContentTypeFor(name: string): string | undefined {
  return MIME_BY_EXT[extensionOf(name)];
}
