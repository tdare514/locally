export const runtime = "nodejs";
export const dynamic = "force-static";

/**
 * The one stylesheet of the public share page (#146). Served from this app so the page's CSP
 * can stay `default-src 'none'` with `style-src 'self'`: no inline styles, no third-party assets.
 * Text on the background is at least 4.5:1 (#1c1b19 on #faf8f4 is about 16:1; #1d4ed8 on #faf8f4 about 6:1).
 */
const CSS = `*,*::before,*::after{box-sizing:border-box}
body{margin:0;background:#faf8f4;color:#1c1b19;font:1rem/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:40rem;margin:0 auto;padding:2rem 1.25rem 4rem}
h1{font-size:1.75rem;line-height:1.2;margin:0 0 .25rem}
h2{font-size:1.125rem;margin:2rem 0 .5rem}
.release{display:flex;flex-wrap:wrap;gap:1.5rem;align-items:flex-end}
.cover{width:12rem;height:12rem;object-fit:cover;border-radius:.75rem;background:#e8e4dc}
.artist{font-size:1.125rem;margin:0}
.meta{margin:.25rem 0 0;color:#4a4740}
.tracks{padding-left:2rem;margin:0 0 1.5rem}
.tracks li{padding:.25rem 0}
.duration{color:#4a4740;margin-left:.5rem}
.button{display:inline-block;padding:.65rem 1.25rem;border-radius:.5rem;background:#1d4ed8;color:#fff;font-weight:600;text-decoration:none}
.button:hover{background:#1e40af}
.button:focus-visible{outline:3px solid #1c1b19;outline-offset:2px}
@media (prefers-color-scheme:dark){body{background:#161513;color:#f1eee8}.meta,.duration{color:#c9c4ba}.cover{background:#2a2825}}
`;

export function GET(): Response {
  return new Response(CSS, {
    headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" },
  });
}
