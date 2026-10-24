/** Layout decisions for the Mac pages at the library's width (#294), pure so they can be tested. */

/** The release page puts the details beside the sleeve once the pane is wider than this (px). */
export const DETAILS_BESIDE_MIN_PANE = 900;

/** Whether the release page's details sit beside the sleeve. An unmeasured pane (null) stacks them. */
export function detailsBesideSleeve(paneWidth: number | null): boolean {
  return paneWidth !== null && paneWidth > DETAILS_BESIDE_MIN_PANE;
}

/** Air between the last content and the release bar, on top of the bar's own height (px). */
export const BAR_CLEARANCE = 48;

/** Bottom padding a page keeps so its last content clears the bar: the bar's measured height plus 48. */
export function barPadding(barHeight: number): number {
  return Math.ceil(barHeight) + BAR_CLEARANCE;
}

/** The bar's height before it is measured: its minimum. */
export const BAR_MIN_HEIGHT = 68;
