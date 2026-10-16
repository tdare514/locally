/** Where the sleeves of the stats fan sit (#145). Pure: the fan component turns these numbers into
 * CSS. The fan holds up to five sleeves, the top five by plays, passed in rank order. */

export const FAN_MAX = 5;

export interface FanSlot {
  /** Steps from the middle of the fan, left negative. Whole numbers for an odd count, halves for an even one. */
  offset: number;
  /** Tilt in degrees; negative leans left. */
  angle: number;
  /** Stacking, higher on top: number one over the rest, then the inner ones over the outer. */
  layer: number;
}

/** Degrees of tilt per step from the middle, by how many sleeves there are: a thin fan opens a
 * little wider per step so two or three sleeves still read as a fan. */
const DEGREES_PER_STEP = [0, 0, 14, 12, 11.5, 11];

/**
 * One slot per item, in rank order. Number one is in the middle, with silver on its left and bronze
 * on its right, then four on the left and five on the right. With fewer than five the same rule
 * runs on what there is and the set is centred, so there are no empty slots: three is the
 * sidebar's podium, two puts silver and gold side by side, one is a lone sleeve. An even count
 * leaves the gold half a step right of the middle.
 */
export function fanLayout(count: number): FanSlot[] {
  const n = Math.max(0, Math.min(FAN_MAX, Math.floor(count)));
  if (n === 0) return [];
  const lefts: number[] = [];
  const rights: number[] = [];
  for (let i = 1; i < n; i++) (i % 2 === 1 ? lefts : rights).push(i);
  const leftToRight = [...lefts.reverse(), 0, ...rights];
  const slots: FanSlot[] = new Array(n);
  const degrees = DEGREES_PER_STEP[n] ?? 0;
  leftToRight.forEach((rank, position) => {
    const offset = position - (n - 1) / 2;
    slots[rank] = {
      offset,
      angle: offset * degrees,
      layer: 50 - Math.round(Math.abs(offset) * 2) * 10 - rank,
    };
  });
  return slots;
}
