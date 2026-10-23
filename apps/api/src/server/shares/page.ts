import type { ShareSnapshot } from "../../shared/types";

/** Where the one stylesheet of the public page is served from (`src/app/share-assets/share.css/route.ts`). */
export const SHARE_STYLESHEET_PATH = "/share-assets/share.css";

/** Escapes text for an HTML text or double-quoted attribute position. Every snapshot field goes through this: ID3-derived text is untrusted. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

const HEAD = (title: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="referrer" content="no-referrer">
<title>${title}</title>
<link rel="stylesheet" href="${SHARE_STYLESHEET_PATH}">
</head>
`;

/** The one page every unknown, revoked, expired or disabled link answers with: a constant, so the bytes never differ. */
export const NOT_FOUND_PAGE = `${HEAD("Not found - Locally")}<body>
<main>
<h1>Not found</h1>
<p>This link doesn't work. It may have been removed or may have expired.</p>
</main>
</body>
</html>
`;

/** The public page for one public share. `token` is only ever put in same-site paths, percent-encoded and escaped. */
export function renderSharePage(snapshot: ShareSnapshot, token: string): string {
  const base = `/s/${encodeURIComponent(token)}`;
  const title = escapeHtml(snapshot.title);
  const artist = escapeHtml(snapshot.artist);
  const year = snapshot.releaseDate ?? snapshot.year;
  const cover = snapshot.cover
    ? `<img class="cover" src="${escapeHtml(`${base}/files/${encodeURIComponent(snapshot.cover)}`)}" alt="Cover of ${title}" width="320" height="320">\n`
    : "";
  const tracks = snapshot.tracks
    .map((track) => {
      const duration = track.durationSec === undefined ? "" : ` <span class="duration">${formatDuration(track.durationSec)}</span>`;
      return `<li value="${track.trackNumber}">${escapeHtml(track.title)}${duration}</li>`;
    })
    .join("\n");
  return `${HEAD(`${title} by ${artist} - Locally`)}<body>
<main>
<header class="release">
${cover}<div>
<h1>${title}</h1>
<p class="artist">${artist}</p>
${year ? `<p class="meta">${escapeHtml(year)}</p>\n` : ""}</div>
</header>
<section aria-labelledby="tracks-heading">
<h2 id="tracks-heading">${snapshot.kind === "album" ? "Tracks" : "Track"}</h2>
<ol class="tracks">
${tracks}
</ol>
<p><a class="button" href="${escapeHtml(`${base}/zip`)}">Download</a></p>
</section>
<section aria-labelledby="claim-heading">
<h2 id="claim-heading">Claim in Locally</h2>
<p>Have Locally? Copy this page's link and paste it into From your friends.</p>
<p>Locally is invite-only right now.</p>
</section>
</main>
</body>
</html>
`;
}
