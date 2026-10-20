import { describe, expect, it } from "vitest";
import { trackArtist, trackColumns, trackGridTemplate } from "../../src/lib/track-columns";
import { BAR_CLEARANCE, DETAILS_BESIDE_MIN_PANE, barPadding, detailsBesideSleeve } from "../../src/lib/page-layout";

describe("trackColumns (#294)", () => {
  it("shows both optional columns in a wide table", () => {
    expect(trackColumns(900)).toEqual({ plays: true, playlists: true });
    expect(trackColumns(760)).toEqual({ plays: true, playlists: true });
  });
  it("drops In playlists under 760", () => {
    expect(trackColumns(759)).toEqual({ plays: true, playlists: false });
    expect(trackColumns(560)).toEqual({ plays: true, playlists: false });
  });
  it("drops Plays under 560 too", () => {
    expect(trackColumns(559)).toEqual({ plays: false, playlists: false });
    expect(trackColumns(0)).toEqual({ plays: false, playlists: false });
  });
  it("shows both while the table is not measured yet", () => {
    expect(trackColumns(null)).toEqual({ plays: true, playlists: true });
  });
});

describe("trackArtist (#294)", () => {
  it("prefers the track's own artist, then the release's, then Unknown artist", () => {
    expect(trackArtist("Feat Artist", "Release Artist")).toBe("Feat Artist");
    expect(trackArtist(undefined, "Release Artist")).toBe("Release Artist");
    expect(trackArtist("  ", " Release Artist ")).toBe("Release Artist");
    expect(trackArtist(null, "")).toBe("Unknown artist");
    expect(trackArtist(undefined, undefined)).toBe("Unknown artist");
  });
});

describe("trackGridTemplate (#294)", () => {
  it("lists the columns that are shown, in order", () => {
    expect(trackGridTemplate({ plays: true, playlists: true }, 0)).toBe("2rem minmax(0,1fr) 4.5rem minmax(0,15rem) 5.5rem");
    expect(trackGridTemplate({ plays: true, playlists: false }, 32)).toBe("2rem minmax(0,1fr) 4.5rem 5.5rem 32px");
    expect(trackGridTemplate({ plays: false, playlists: false }, 64)).toBe("2rem minmax(0,1fr) 5.5rem 64px");
  });
});

describe("page layout (#294)", () => {
  it("puts the details beside the sleeve only when the pane is wider than about 900", () => {
    expect(detailsBesideSleeve(null)).toBe(false);
    expect(detailsBesideSleeve(DETAILS_BESIDE_MIN_PANE)).toBe(false);
    expect(detailsBesideSleeve(DETAILS_BESIDE_MIN_PANE + 1)).toBe(true);
    expect(detailsBesideSleeve(600)).toBe(false);
  });
  it("pads the content by the bar's height plus 48", () => {
    expect(barPadding(68)).toBe(68 + BAR_CLEARANCE);
    expect(barPadding(68.4)).toBe(69 + BAR_CLEARANCE);
    expect(barPadding(120)).toBe(168);
  });
});
