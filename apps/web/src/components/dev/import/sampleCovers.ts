/**
 * Sample covers for the #159 import prototype (dev only): square, no text, no scripts, no
 * external references, drawn here so the prototype needs no asset in `public/`. Each cover also
 * has a pale, washed-out copy (`paleSrc`) for the develop beat, which cross-fades
 * opacity between two stacked images instead of animating a filter on a large one.
 */
export interface SampleCover {
  id: string;
  /** The cover itself, as a data URI. */
  src: string;
  /** The same artwork as an undeveloped print (pale, washed out, warm grey), also sharp. */
  paleSrc: string;
}

interface Drawing {
  id: string;
  defs: string;
  body: string;
}

// Base fills are oversized so colour runs right up to the edges.
const DRAWINGS: Drawing[] = [
  // Low tide: coral sky going to plum, a pale sun on the waterline.
  {
    id: "low-tide",
    defs: `<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="600"><stop offset="0" stop-color="#ff6a3d"/><stop offset="0.6" stop-color="#e0245e"/><stop offset="1" stop-color="#5b1a8c"/></linearGradient>`,
    body: `<rect x="-100" y="-100" width="800" height="800" fill="url(#g)"/>
<circle cx="300" cy="330" r="150" fill="#ffd9a0"/>
<g fill="#2a0f3d"><rect x="-100" y="372" width="800" height="12"/><rect x="-100" y="404" width="800" height="20"/><rect x="-100" y="448" width="800" height="400"/></g>
<g fill="#ffb199"><rect x="140" y="470" width="320" height="8"/><rect x="200" y="500" width="200" height="8" fill-opacity="0.6"/></g>`,
  },
  // Night swim: deep blue water, concentric pale rings.
  {
    id: "night-swim",
    defs: `<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="600" y2="600"><stop offset="0" stop-color="#0a2a7a"/><stop offset="1" stop-color="#00a6b8"/></linearGradient>`,
    body: `<rect x="-100" y="-100" width="800" height="800" fill="url(#g)"/>
<g fill="none" stroke="#d8f6ff"><circle cx="300" cy="300" r="70" stroke-width="10"/><circle cx="300" cy="300" r="140" stroke-width="7" stroke-opacity="0.7"/><circle cx="300" cy="300" r="210" stroke-width="5" stroke-opacity="0.45"/><circle cx="300" cy="300" r="280" stroke-width="3" stroke-opacity="0.25"/></g>
<circle cx="300" cy="300" r="26" fill="#fff4c9"/>`,
  },
  // Moss: green going to chartreuse, a cream square set off-centre.
  {
    id: "moss",
    defs: `<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0" y1="600" x2="600" y2="0"><stop offset="0" stop-color="#14503d"/><stop offset="1" stop-color="#9bc53d"/></linearGradient>`,
    body: `<rect x="-100" y="-100" width="800" height="800" fill="url(#g)"/>
<rect x="190" y="150" width="250" height="250" fill="#f3ecd2"/>
<rect x="150" y="190" width="250" height="250" fill="#14503d" fill-opacity="0.55"/>
<circle cx="440" cy="440" r="46" fill="#f3ecd2"/>`,
  },
];

const OPEN = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" width="600" height="600">`;
// A print that has barely started to show: most of the colour drained, the blacks lifted, a little
// bright, with a faint warm-grey cast (the lift is higher in red than in blue). Sharp, no blur: the
// develop cross-fades from this to the real art, so no filter is ever animated.
const PALE = `<filter id="pale" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0.2"/><feColorMatrix type="matrix" values="0.62 0 0 0 0.31  0 0.62 0 0 0.29  0 0 0.62 0 0.25  0 0 0 1 0"/></filter>`;

function dataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export const SAMPLE_COVERS: SampleCover[] = DRAWINGS.map(({ id, defs, body }) => ({
  id,
  src: dataUri(`${OPEN}<defs>${defs}</defs>${body}</svg>`),
  paleSrc: dataUri(`${OPEN}<defs>${defs}${PALE}</defs><g filter="url(#pale)">${body}</g></svg>`),
}));
