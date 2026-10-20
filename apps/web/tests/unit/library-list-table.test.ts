import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LibrarySection, formatAddedDate } from "../../src/components/LibraryView";
import type { Release } from "../../src/shared/types";

function release(partial: Partial<Release> & { id: string }): Release {
  return {
    kind: "single",
    title: "Title",
    artist: "Artist",
    year: null,
    genre: null,
    coverPath: null,
    folderPath: `/lib/${partial.id}`,
    createdAt: "2026-02-06T12:00:00.000Z",
    updatedAt: "2026-02-06T12:00:00.000Z",
    tracks: [],
    ...partial,
  } as Release;
}

function render(releases: Release[], open = true): string {
  return renderToStaticMarkup(
    createElement(LibrarySection, {
      label: "Albums",
      bodyId: "library-albums",
      open,
      onToggleOpen: () => {},
      count: releases.length,
      releases,
      onSelectRelease: () => {},
      selecting: false,
      selected: new Set<string>(),
      disabled: false,
      onToggle: () => {},
      coverSize: 1,
      onFocusRelease: () => {},
    }),
  );
}

describe("LibrarySection table", () => {
  const full = release({
    id: "a",
    kind: "album",
    title: "Night Drive",
    artist: "Band",
    genre: "Synthwave",
    year: "2024",
    tracks: [{ id: "t1" }, { id: "t2" }, { id: "t3" }] as unknown as Release["tracks"],
  });

  it("renders genre, year, track count and a formatted added date", () => {
    const html = render([full]);
    expect(html).toContain("Synthwave");
    expect(html).toContain("2024");
    expect(html).toContain(">3<");
    expect(html).toContain(formatAddedDate(full.createdAt));
    expect(html).not.toContain("3 tracks");
  });

  it("formats the date like Feb 6, 2026 in en-US", () => {
    expect(formatAddedDate("2026-02-06T12:00:00.000Z", "en-US")).toBe("Feb 6, 2026");
  });

  it("renders nothing for a missing genre or year", () => {
    const html = render([release({ id: "b" })]);
    expect(html).not.toContain("null");
    expect(html).not.toContain("—");
    expect(html).toContain('truncate text-xs text-text-muted"></span>');
  });

  it("renders sentence case header labels once per section, hidden from assistive tech", () => {
    const html = render([full, release({ id: "c", title: "Other" })]);
    for (const label of ["Title", "Genre", "Year", "Tracks", "Added"]) {
      expect(html.split(`>${label}</span>`).length - 1).toBe(1);
    }
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("uppercase");
  });
});

describe("LibrarySection fold (#260)", () => {
  const one = release({ id: "a", title: "Night Drive" });

  it("the header is one button with aria-expanded and aria-controls inside the h2", () => {
    const html = render([one]);
    expect(html).toMatch(/<h2[^>]*><button[^>]*aria-expanded="true"[^>]*aria-controls="library-albums"/);
    expect(html).toContain('id="library-albums"');
  });
  it("folded: aria-expanded false, the controlled body exists and is hidden, the rows are not rendered", () => {
    const html = render([one], false);
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("Night Drive");
    expect(html).toMatch(/<div id="library-albums" hidden=""/);
    expect(html).toContain("Albums");
  });
});
