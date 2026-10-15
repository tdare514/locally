import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PendingRow } from "../../src/components/PhoneInbox";
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

  it("an arriving row says so quietly, keeps Send, and shows no Resync", () => {
    const { html, text } = render({ ...base, filesState: "arriving" });
    expect(text).toContain("Still arriving from your phone…");
    expect(html).toContain('aria-label="Send Phone Song to Spotify"');
    expect(text).not.toMatch(/resync|never reached/i);
    expect(html).not.toMatch(/text-danger|role="alert"/);
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
      "Still arriving from that device…"
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
