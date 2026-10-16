import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import TrackList, { type EditableTrack } from "../../src/components/TrackList";

const tracks: EditableTrack[] = [
  { key: "t-c", title: "Cathedral" },
  { key: "t-a", title: "Afterglow" },
  { key: "t-b", title: "Bluebird" },
];

function render(props: Partial<Parameters<typeof TrackList>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(TrackList, { tracks, onChange: () => {}, ...props }),
  );
}

describe("TrackList markup", () => {
  it("renders rows in the order given, numbered by position", () => {
    const html = render();
    const keys = [...html.matchAll(/data-key="([^"]+)"/g)].map((m) => m[1]);
    expect(keys).toEqual(["t-c", "t-a", "t-b"]);
    const titles = [...html.matchAll(/value="([^"]*)"/g)].map((m) => m[1]);
    expect(titles).toEqual(["Cathedral", "Afterglow", "Bluebird"]);
    const numbers = [...html.matchAll(/tabular-nums[^>]*>(\d+)</g)].map((m) => m[1]);
    expect(numbers).toEqual(["1", "2", "3"]);
  });

  it("lets the page show through: no card blocks and no 'Audio file' caption", () => {
    const html = render();
    expect(html).not.toMatch(/bg-card|border-border|bg-elevated/);
    expect(html).not.toContain("Audio file");
    expect(html).not.toContain("Move track up");
  });

  it("gives every row a grip, and a remove button only when asked", () => {
    expect(render().match(/data-handle/g)).toHaveLength(3);
    expect(render().match(/Remove /g)).toBeNull();
    expect(render({ onRemove: () => {} }).match(/aria-label="Remove /g)).toHaveLength(3);
  });

  it("shows the glass tile on every row, hidden until the row is held", () => {
    const html = render();
    expect(html.match(/track-tile glass-fake glass-frost/g)).toHaveLength(3);
  });

  it("has a live region and a keyboard hint for reordering", () => {
    const html = render();
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Alt");
  });

  it("is read-only in the demo: no grip, titles locked", () => {
    const html = render({ readOnly: true });
    expect(html).not.toContain("data-handle");
    expect(html).not.toContain("cursor-grab");
    expect(html.match(/readOnly=""|readonly=""/g)).toHaveLength(3);
  });

  it("groups rows under quiet sentence-case disc headings only when there is more than one disc", () => {
    const discs = [1, 1, 2];
    const html = render({ tracks: tracks.map((t, i) => ({ ...t, discNumber: discs[i] })) });
    expect([...html.matchAll(/data-disc-heading[^>]*>Disc (\d+)</g)].map((m) => m[1])).toEqual(["1", "2"]);
    // Headings sit between rows without changing them: same rows, same order, same numbers.
    expect([...html.matchAll(/data-key="([^"]+)"/g)].map((m) => m[1])).toEqual(["t-c", "t-a", "t-b"]);
    expect([...html.matchAll(/tabular-nums[^>]*>(\d+)</g)].map((m) => m[1])).toEqual(["1", "2", "3"]);
    const headingTags = html.match(/<li[^>]*data-disc-heading[^>]*>/g) ?? [];
    expect(headingTags).toHaveLength(2);
    for (const tag of headingTags) expect(tag).not.toMatch(/uppercase|tracking-/);
    expect(html.indexOf("Disc 1")).toBeLessThan(html.indexOf('data-key="t-c"'));
    expect(html.indexOf("Disc 2")).toBeGreaterThan(html.indexOf('data-key="t-a"'));
    expect(html.indexOf("Disc 2")).toBeLessThan(html.indexOf('data-key="t-b"'));
  });

  it("shows no disc headings for a single disc or no discs", () => {
    expect(render()).not.toContain("data-disc-heading");
    expect(render({ tracks: tracks.map((t) => ({ ...t, discNumber: 1 })) })).not.toContain("data-disc-heading");
  });

  it("shows each track's total plays at the right, quietly, before the grip (#107)", () => {
    const html = render({ plays: { "t-c": 12, "t-a": 1 } });
    expect([...html.matchAll(/data-plays[^>]*>([^<]*)</g)].map((m) => m[1])).toEqual(["12 plays", "1 play"]);
    const tag = html.match(/<span[^>]*data-plays[^>]*>/)?.[0] ?? "";
    expect(tag).toContain("tabular-nums");
    expect(tag).toContain("text-text-muted");
    expect(tag).not.toMatch(/uppercase|tracking-/);
    // Within the first row: after the title field, before its grip.
    const row = html.slice(html.indexOf('data-key="t-c"'), html.indexOf('data-key="t-a"'));
    expect(row.indexOf("data-plays")).toBeGreaterThan(row.indexOf("<input"));
    expect(row.indexOf("data-plays")).toBeLessThan(row.indexOf("data-handle"));
    // The numbers still read 1, 2, 3 for the drag code to rewrite.
    expect([...html.matchAll(/data-number[^>]*>(\d+)</g)].map((m) => m[1])).toEqual(["1", "2", "3"]);
  });

  it("shows nothing for a track with no plays, no entry, or no plays prop", () => {
    expect(render({ plays: { "t-c": 0 } })).not.toContain("data-plays");
    expect(render({ plays: { other: 5 } })).not.toContain("data-plays");
    expect(render()).not.toContain("data-plays");
  });

  it("shows the plays in the demo's read-only list too, without a grip", () => {
    const html = render({ readOnly: true, plays: { "t-b": 3 } });
    expect(html).toContain("3 plays");
    expect(html).not.toContain("data-handle");
  });

  it("says so when there are no tracks", () => {
    expect(render({ tracks: [] })).toContain("No tracks yet.");
  });
});

describe("TrackList playlists line (#212)", () => {
  const ref = (n: string) => ({ id: n.padEnd(22, "x"), name: n });
  const lineOf = (html: string) => /data-playlists-line[^>]*>([^<]*)</.exec(html)?.[1] ?? null;
  const withPlaylists = (names: string[]) =>
    render({ playlists: { "t-a": names.map(ref) }, onOpenPlaylist: () => {} });

  it("says which playlists: one, two, and five", () => {
    expect(lineOf(withPlaylists(["Night drive"]))).toBe("In Night drive");
    expect(lineOf(withPlaylists(["Night drive", "Gym"]))).toBe("In Night drive and Gym");
    expect(lineOf(withPlaylists(["Night drive", "Gym", "A", "B", "C"]))).toBe("In Night drive, Gym and 3 more");
  });

  it("shows nothing for no playlists, no entry, or no opener", () => {
    expect(withPlaylists([])).not.toContain("data-playlists-line");
    expect(render()).not.toContain("data-playlists-line");
    expect(render({ playlists: { "t-a": [ref("Gym")] } })).not.toContain("data-playlists-line");
  });

  it("is a closed disclosure button (aria-expanded, no aria-haspopup), and no popover until clicked", () => {
    const html = withPlaylists(["Gym"]);
    expect(html).toMatch(/<button[^>]*data-playlists-line[^>]*aria-expanded="false"/);
    expect(html).not.toMatch(/<button[^>]*data-playlists-line[^>]*aria-haspopup/);
    expect(html).not.toContain("playlist-pop");
  });
});

describe("TrackList disc menu buttons (#222)", () => {
  const buttons = (html: string) => [...html.matchAll(/aria-label="(Track \d+, disc options)"/g)].map((m) => m[1]);

  it("turns the number into a menu button on every row but the first of an editable list", () => {
    const html = render();
    expect(buttons(html)).toEqual(["Track 2, disc options", "Track 3, disc options"]);
    expect(html).toContain('aria-haspopup="menu"');
  });

  it("gives the first row of disc 2 a button too, and leaves one-track, read-only and view lists plain", () => {
    const discs = tracks.map((t, i) => ({ ...t, discNumber: i < 2 ? 1 : 2 }));
    expect(buttons(render({ tracks: discs }))).toEqual(["Track 2, disc options", "Track 3, disc options"]);
    expect(buttons(render({ tracks: tracks.slice(0, 1) }))).toEqual([]);
    expect(buttons(render({ readOnly: true }))).toEqual([]);
    expect(buttons(render({ view: { "t-c": { durationSec: 1 } } }))).toEqual([]);
  });
});
