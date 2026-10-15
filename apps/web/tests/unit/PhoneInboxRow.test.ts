import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { orderRows, PendingRow, SendingFooter } from "../../src/components/PhoneInbox";
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
  extra: { outcome?: "asked" | "later"; resyncing?: boolean } = {}
): { html: string; text: string } {
  const html = renderToStaticMarkup(
    createElement(PendingRow, {
      item,
      leaving: false,
      onSend: () => {},
      onResync: () => {},
      resyncing: extra.resyncing ?? false,
      outcome: extra.outcome,
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

  it("an arriving row is greyed out with three dots, cannot be sent, and shows no Resync", () => {
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

  it("orders ready, then waiting, then arriving, keeping the order within each group", () => {
    const row = (id: string, filesState?: PendingFromPhone["filesState"]): PendingFromPhone => ({
      ...base,
      id,
      ...(filesState ? { filesState } : {}),
    });
    const ordered = orderRows([
      row("a1", "arriving"),
      row("w1", "waiting"),
      row("r1"),
      row("a2", "arriving"),
      row("r2"),
      row("w2", "waiting"),
    ]);
    expect(ordered.map((p) => p.id)).toEqual(["r1", "r2", "w1", "w2", "a1", "a2"]);
  });

  it("shows the footer once when rows are arriving, and not at all otherwise", () => {
    const foot = (pending: PendingFromPhone[]) =>
      renderToStaticMarkup(createElement(SendingFooter, { pending })).replace(/<[^>]+>/g, "");
    const arriving = (id: string, origin = "ios"): PendingFromPhone => ({ ...base, id, origin, filesState: "arriving" });
    expect(foot([arriving("a")])).toBe("Still sending this one from your phone…");
    expect(foot([arriving("a"), arriving("b")])).toBe("Still sending these from your phone…");
    expect(foot([arriving("a", "web")])).toBe("Still sending this one from that device…");
    expect(foot([arriving("a"), arriving("b", "web")])).toBe("Still sending these…");
    expect(foot([base, { ...base, id: "w", filesState: "waiting" }])).toBe("");
    expect(foot([])).toBe("");
  });

  it("a waiting phone row shows the copy and the Resync button, and offers no Send", () => {
    const { html, text } = render({ ...base, filesState: "waiting" });
    expect(text).toContain("Waiting on your phone");
    expect(text).toContain("This song's files never reached the server.");
    expect(text).toContain("Resync Mac and phone");
    expect(html).toContain("<button");
    expect(html).not.toContain("Send Phone Song to Spotify");
    expect(html).not.toContain('title="Send to Spotify"');
    // The one button left is Resync.
    expect(html.match(/<button/g)).toHaveLength(1);
  });

  it("a waiting album row names the album, not a song", () => {
    const { text } = render({ ...base, kind: "album", trackCount: 6, filesState: "waiting" });
    expect(text).toContain("This album's files never reached the server.");
    expect(text).not.toContain("This song's");
  });

  it("after Resync it shows what happened in place of the button", () => {
    const { html, text } = render({ ...base, filesState: "waiting" }, { outcome: "asked" });
    expect(text).toContain("Asked your phone to send it again. Open Locally on your iPhone to finish.");
    expect(html).not.toContain("<button");
    expect(text).not.toContain("Resync Mac and phone");
  });

  it("when the request had to wait it says to try again, with the button still there", () => {
    const { html, text } = render({ ...base, filesState: "waiting" }, { outcome: "later" });
    expect(text).toContain("Try again in a few minutes.");
    expect(text).toContain("Resync Mac and phone");
    expect(text).not.toContain("Asked your phone");
    expect(html.match(/<button/g)).toHaveLength(1);
  });

  it("disables the button while the request is in flight", () => {
    const { html } = render({ ...base, filesState: "waiting" }, { resyncing: true });
    expect(html).toMatch(/<button[^>]*disabled/);
  });

  it("uses the generic wording for the web and unknown origins", () => {
    for (const origin of ["web", "future-thing"]) {
      const { text } = render({ ...base, origin, filesState: "waiting" });
      expect(text, origin).toContain("Waiting on that device");
      expect(text, origin).toContain("Resync");
      expect(text, origin).not.toMatch(/Resync Mac and phone|your phone/);
    }
    const asked = render({ ...base, origin: "web", filesState: "waiting" }, { outcome: "asked" });
    expect(asked.text).toContain("Asked that device to send it again. Open Locally there to finish.");
    expect(render({ ...base, origin: "web", filesState: "arriving" }).text).toContain(
      "Still being sent from your other device."
    );
  });

  it("keeps the origin label on every state", () => {
    expect(render({ ...base, origin: "web", filesState: "waiting" }).text).toContain("from the web");
    expect(render({ ...base, origin: "ios", filesState: "arriving" }).text).toContain("from your iPhone");
  });

  it("has no uppercase labels", () => {
    for (const filesState of ["arriving", "waiting"] as const) {
      expect(render({ ...base, filesState }).html).not.toMatch(/uppercase|tracking-wide/);
    }
  });
});
