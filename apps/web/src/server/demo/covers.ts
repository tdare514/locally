/**
 * Hand-written abstract covers for the demo library (#139): square, no text,
 * no scripts, no external references. One per release in `library.ts`.
 */
export { DEMO_SETTINGS_RESPONSE, DEMO_SYNC_STATUS, DEMO_SPOTIFY_SOURCE } from "./library";

const open = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" width="600" height="600">`;

const COVERS: Record<string, string> = {
  // Warm coral and gold: low sun over glass panes.
  "demo-glasshouse-summer": `${open}
<defs><linearGradient id="a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff7a59"/><stop offset="1" stop-color="#ffd166"/></linearGradient>
<radialGradient id="b" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#fff3c4"/><stop offset="1" stop-color="#fff3c4" stop-opacity="0"/></radialGradient></defs>
<rect width="600" height="600" fill="url(#a)"/>
<circle cx="300" cy="330" r="260" fill="url(#b)"/>
<circle cx="300" cy="330" r="110" fill="#fff6d6"/>
<g fill="none" stroke="#fff" stroke-opacity="0.45" stroke-width="6"><path d="M100 60V540M200 60V540M300 60V540M400 60V540M500 60V540M60 200H540M60 400H540"/></g>
<rect y="470" width="600" height="130" fill="#b8325a" fill-opacity="0.75"/></svg>`,

  // Deep forest green and cream: lantern circles on dusk.
  "demo-paper-lanterns": `${open}
<defs><linearGradient id="a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0f3d33"/><stop offset="1" stop-color="#1d6b52"/></linearGradient></defs>
<rect width="600" height="600" fill="url(#a)"/>
<circle cx="170" cy="190" r="92" fill="#f4e3b2"/><circle cx="400" cy="140" r="64" fill="#e9b872"/>
<circle cx="450" cy="360" r="120" fill="#f4e3b2" fill-opacity="0.9"/><circle cx="210" cy="430" r="58" fill="#e9b872"/>
<circle cx="300" cy="300" r="30" fill="#fbf4dc"/>
<rect x="0" y="540" width="600" height="14" fill="#f4e3b2" fill-opacity="0.5"/></svg>`,

  // Hot magenta and electric blue: neon horizon.
  "demo-night-bus-to-nowhere": `${open}
<defs><linearGradient id="a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#14052e"/><stop offset="0.6" stop-color="#6a1b9a"/><stop offset="1" stop-color="#ff2e93"/></linearGradient>
<linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe14d"/><stop offset="1" stop-color="#ff2e93"/></linearGradient></defs>
<rect width="600" height="600" fill="url(#a)"/>
<circle cx="300" cy="330" r="170" fill="url(#s)"/>
<g fill="#14052e"><rect y="320" width="600" height="14"/><rect y="352" width="600" height="20"/><rect y="394" width="600" height="28"/></g>
<rect y="440" width="600" height="160" fill="#14052e"/>
<g fill="#22d3ee"><rect x="0" y="470" width="600" height="6"/><rect x="0" y="510" width="600" height="6" fill-opacity="0.6"/><rect x="0" y="550" width="600" height="6" fill-opacity="0.3"/></g></svg>`,

  // Navy and sea teal: waves and a pale sun.
  "demo-saltwater-hymns": `${open}
<defs><linearGradient id="a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e8f4f2"/><stop offset="0.45" stop-color="#7fd1c7"/><stop offset="1" stop-color="#0b2a4a"/></linearGradient></defs>
<rect width="600" height="600" fill="url(#a)"/>
<circle cx="420" cy="170" r="80" fill="#fff"/>
<path d="M0 330C100 290 200 370 300 330S500 290 600 330V600H0Z" fill="#12507a"/>
<path d="M0 410C100 370 200 450 300 410S500 370 600 410V600H0Z" fill="#0d3b66"/>
<path d="M0 490C100 450 200 530 300 490S500 450 600 490V600H0Z" fill="#0b2a4a"/></svg>`,

  // Acid lime on near black: blooming concentric rings.
  "demo-static-bloom": `${open}
<defs><radialGradient id="a" cx="0.5" cy="0.5" r="0.7"><stop offset="0" stop-color="#1b1f24"/><stop offset="1" stop-color="#05070a"/></radialGradient></defs>
<rect width="600" height="600" fill="url(#a)"/>
<g fill="none" stroke="#c6ff3d"><circle cx="300" cy="300" r="40" stroke-width="18"/><circle cx="300" cy="300" r="95" stroke-width="12" stroke-opacity="0.85"/>
<circle cx="300" cy="300" r="160" stroke-width="8" stroke-opacity="0.6"/><circle cx="300" cy="300" r="235" stroke-width="5" stroke-opacity="0.4"/><circle cx="300" cy="300" r="320" stroke-width="3" stroke-opacity="0.25"/></g>
<g fill="#c6ff3d"><rect x="40" y="60" width="120" height="8"/><rect x="40" y="84" width="70" height="8" fill-opacity="0.5"/><rect x="440" y="520" width="120" height="8"/><rect x="490" y="496" width="70" height="8" fill-opacity="0.5"/></g></svg>`,

  // Burnt copper and rust: stacked bands with a half disc.
  "demo-copper-sky-sessions": `${open}
<defs><linearGradient id="a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d9772b"/><stop offset="1" stop-color="#7a2e1a"/></linearGradient></defs>
<rect width="600" height="600" fill="url(#a)"/>
<rect y="90" width="600" height="60" fill="#f2b872" fill-opacity="0.55"/>
<rect y="190" width="600" height="36" fill="#f2b872" fill-opacity="0.35"/>
<path d="M120 440A180 180 0 0 1 480 440Z" fill="#2b1209"/>
<rect y="440" width="600" height="160" fill="#3d1a0d"/>
<rect y="470" width="600" height="8" fill="#f2b872" fill-opacity="0.6"/></svg>`,
};

/** Releases added for the artist pages (#288) show a drawing from above instead of a new one. */
const ALIASES: Record<string, string> = {
  "demo-velvet-hours": "demo-static-bloom",
  "demo-pink-static": "demo-copper-sky-sessions",
  "demo-low-orbit": "demo-night-bus-to-nowhere",
  "demo-afterimage": "demo-paper-lanterns",
};

export function getDemoCover(id: string): string | undefined {
  const own = Object.hasOwn(ALIASES, id) ? ALIASES[id] : id;
  return Object.hasOwn(COVERS, own) ? COVERS[own] : undefined;
}
