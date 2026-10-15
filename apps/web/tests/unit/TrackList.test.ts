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

  it("says so when there are no tracks", () => {
    expect(render({ tracks: [] })).toContain("No tracks yet.");
  });
});
