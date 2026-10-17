import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PendingRow, SectionHeader } from "../../src/components/PhoneInbox";
import type { PendingFromPhone } from "../../src/shared/types";

const base: PendingFromPhone = {
  id: "rel-1",
  origin: "ios",
  title: "Phone Song",
  artist: "Phone Artist",
  kind: "single",
  trackCount: 1,
};

/** The row as text: tags dropped, entities decoded, so the owner-facing copy can be compared. */
function render(
  item: PendingFromPhone,
  extra: { busy?: boolean; compact?: boolean } = {}
): { html: string; text: string } {
  const html = renderToStaticMarkup(
    createElement(PendingRow, {
      item,
      leaving: false,
      busy: extra.busy,
      compact: extra.compact ?? item.filesState !== undefined,
      onSend: () => {},
      onHide: () => {},
    })
  );
  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return { html, text };
}

describe("PendingRow files states (#172)", () => {
  it("a normal row is today's row: the sleeve is the Send button and nothing else is added", () => {
    const { html, text } = render(base);
    expect(html).toContain('aria-label="Send Phone Song to Spotify"');
    expect(text).toContain("from your iPhone");
    expect(text).not.toMatch(/arriving|waiting|resync/i);
  });

  it("an arriving row is greyed out with three dots, cannot be sent, and has no Hide", () => {
    const { html, text } = render({ ...base, filesState: "arriving" });
    expect(html).not.toContain("<button");
    expect(html).not.toContain("Send Phone Song to Spotify");
    expect(html).not.toContain("group/send");
    expect(html).toContain("opacity-50 grayscale");
    expect(html.match(/sending-dots/g)).toHaveLength(1);
    expect(html.match(/h-1 w-1 bg-white/g)).toHaveLength(3);
    expect(html).not.toContain("<svg"); // no music note or plus
    // Title and artist stay readable in muted colours.
    expect(text).toContain("Phone Song");
    expect(text).toContain("Phone Artist");
    expect(text).toContain("1 track");
    expect(html).toContain("text-text-muted\">Phone Song");
    expect(html).toContain("text-text-dim");
    expect(html).toContain("sr-only");
    expect(text).toContain("Still being sent from your phone.");
    expect(text).not.toMatch(/resync|never reached|Still arriving/i);
    expect(html).not.toMatch(/text-danger|role="alert"/);
  });

  it("a waiting row is compact, has no Send and no per-row retry, and offers Hide", () => {
    const { html, text } = render({ ...base, title: "kwaylone", artist: "kwaylone", sentAt: "2026-09-27T12:00:00Z", filesState: "waiting" });
    expect(text).toContain("kwaylone, 1 track, since 27 Sep");
    expect(html).not.toContain("Send kwaylone to Spotify");
    expect(text).not.toMatch(/Resync|Waiting on your phone|hasn't arrived/);
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Hide kwaylone"');
    expect(html).toContain("group-focus-within/row:opacity-100");
    expect(html).toContain("opacity-60");
    expect(html).toContain("h-10 w-10");
  });

  it("a reserved row shows the sending look and its controls are off", () => {
    const ready = render(base, { busy: true });
    expect(ready.html).toMatch(/<button[^>]*disabled/);
    expect(ready.html).toContain("sending-dots");
    const waiting = render({ ...base, filesState: "waiting" }, { busy: true });
    expect(waiting.html.match(/<button[^>]*disabled/g)).toHaveLength(1);
    expect(waiting.html).toContain("sending-dots");
  });

  it("a release with no cover is the card square with the double note and a black label", () => {
    const { html } = render(base);
    expect(html).toContain("bg-card");
    expect(html).toContain("text-text-dim");
    expect(html).toContain("bg-[#050505] ring-1 ring-[#1E1E1E]");
    expect(html).not.toContain("color-mix");
  });

  it("a section header has the count in the heading's name and one action of the same class", () => {
    const html = renderToStaticMarkup(
      createElement(SectionHeader, { id: "h", name: "Ready to add", count: 2, action: { label: "Add all", busy: false, onClick: () => {} } })
    );
    expect(html).toContain("<h3");
    expect(html.replace(/<[^>]+>/g, "")).toBe("Ready to add, 2Add all");
    expect(html).toContain('class="btn-save"');
    const none = renderToStaticMarkup(createElement(SectionHeader, { id: "h", name: "Ready to add", count: 1 }));
    expect(none).not.toContain("<button");
  });

  it("keeps the origin label on a ready row and has no uppercase labels", () => {
    expect(render({ ...base, origin: "web" }).text).toContain("from the web");
    for (const filesState of ["arriving", "waiting"] as const) {
      expect(render({ ...base, filesState }).html).not.toMatch(/uppercase|tracking-wide/);
    }
  });
});
