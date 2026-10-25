import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StatsList } from "../../src/components/stats/StatsRows";
import type { StatItem } from "../../src/lib/play-stats";
import { lastPlayedAtLabel } from "../../src/lib/play-stats";

const at = new Date(2025, 9, 12, 18, 30).getTime();
const item: StatItem = {
  id: "t", rank: 1, title: "Song", subtitle: "Artist", plays: 3, cover: null, releaseId: "r",
  lastPlayedDay: "2025-10-12", lastPlayedAt: at, minutes: null,
};

function html(): string {
  return renderToStaticMarkup(
    createElement(StatsList, {
      items: [item], label: "Tracks", round: false, today: "2026-10-24", linkArtists: false,
      onOpen: () => undefined, initialShown: 100, onShownChange: () => undefined,
    }),
  );
}

describe("a stats row's last-played label (#398)", () => {
  it("wraps instead of truncating, and carries the full label as its title", () => {
    const label = lastPlayedAtLabel(at, "2026-10-24");
    const span = html().match(/<span class="st-row-last[^"]*"[^>]*>/)?.[0] ?? "";
    expect(span).not.toContain("truncate");
    expect(span).toContain("text-sm text-text-muted");
    expect(span).toContain("text-left");
    expect(span).toContain(`title="${label}"`);
  });
});
