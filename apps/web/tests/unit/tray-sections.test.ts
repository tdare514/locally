import { describe, expect, it } from "vitest";
import {
  Reservations,
  compactSubline,
  focusAfterLeave,
  hideKeyFor,
  isReady,
  landedOnEmptySpace,
  otherSectionCopy,
  runOneAtATime,
  showAddAll,
  showTryAllAgain,
  sinceLabel,
  traySections,
  visiblePending,
} from "../../src/lib/tray-sections";
import type { PendingFromPhone } from "../../src/shared/types";

const row = (id: string, extra: Partial<PendingFromPhone> = {}): PendingFromPhone => ({
  id,
  origin: "ios",
  title: id,
  artist: "kwaylone",
  kind: "single",
  trackCount: 1,
  ...extra,
});

describe("sections", () => {
  it("puts a row in exactly one group, ready only when its audio is on the server", () => {
    const rows = [row("a"), row("b", { filesState: "arriving" }), row("c", { filesState: "waiting" }), row("d")];
    const { ready, other } = traySections(rows);
    expect(ready.map((p) => p.id)).toEqual(["a", "d"]);
    expect(other.map((p) => p.id)).toEqual(["c", "b"]); // waiting, then still sending
    expect(ready.length + other.length).toBe(rows.length);
    expect(rows.filter((p) => isReady(p) && other.includes(p))).toEqual([]);
    expect(isReady({ ...row("x"), filesState: "ready" as never })).toBe(true);
  });

  it("shows Add all from two ready rows and Try all again while any row is waiting", () => {
    expect(showAddAll([row("a")])).toBe(false);
    expect(showAddAll([row("a"), row("b")])).toBe(true);
    expect(showTryAllAgain([row("a", { filesState: "arriving" })])).toBe(false);
    expect(showTryAllAgain([row("a", { filesState: "arriving" }), row("b", { filesState: "waiting" })])).toBe(true);
  });
});

describe("copy by origin mix", () => {
  it("names the iPhone when every row came from it", () => {
    const c = otherSectionCopy([row("a"), row("b")]);
    expect(c.name).toBe("Waiting on your iPhone");
    expect(c.line).toBe("Their audio hasn't arrived yet. Open Locally on your iPhone to finish sending them.");
    expect(c.asked).toBe("Asked your iPhone to send them again.");
    expect(c.later).toBe("Try again in a few minutes.");
  });

  it("says that device for one other origin", () => {
    const c = otherSectionCopy([row("a", { origin: "web" }), row("b", { origin: "web" })]);
    expect(c.name).toBe("Waiting on that device");
    expect(c.line).toContain("Open Locally on that device");
  });

  it("says your devices for a mix, including two other origins", () => {
    for (const rows of [
      [row("a"), row("b", { origin: "web" })],
      [row("a", { origin: "web" }), row("b", { origin: "future" })],
    ]) {
      const c = otherSectionCopy(rows);
      expect(c.name).toBe("Waiting on your devices");
      expect(c.line).toContain("Open Locally on those devices");
      expect(c.asked).toBe("Asked your devices to send them again.");
    }
  });

  it("uses no em or en dashes", () => {
    const c = otherSectionCopy([row("a")]);
    expect(JSON.stringify(c)).not.toMatch(/[–—]/);
  });
});

describe("compact row line", () => {
  it("reads artist, tracks and the date", () => {
    expect(compactSubline(row("a", { sentAt: "2026-09-27T12:00:00Z" }))).toBe("kwaylone, 1 track, since 27 Sep");
    expect(compactSubline(row("a", { trackCount: 6 }))).toBe("kwaylone, 6 tracks");
    expect(sinceLabel("nonsense")).toBe("");
  });
});

describe("Hide by version", () => {
  it("keys on the server version, else updatedAt", () => {
    expect(hideKeyFor({ version: 7, updatedAt: "x" })).toBe("v7");
    expect(hideKeyFor({ updatedAt: "2026-01-01" })).toBe("u2026-01-01");
  });

  it("hides at the hidden version and brings a newer version back", () => {
    const rows = [row("a", { hideKey: "v1" }), row("b", { hideKey: "v1" }), row("c")];
    expect(visiblePending(rows, { a: "v1" }).map((p) => p.id)).toEqual(["b", "c"]);
    expect(visiblePending(rows, { a: "v0" }).map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(visiblePending([row("a", { hideKey: "v2" })], { a: "v1" })).toHaveLength(1);
  });
});

describe("reservations", () => {
  it("never reserves a release twice, whichever control asked", () => {
    const r = new Reservations();
    expect(r.reserve(["a", "b"])).toEqual(["a", "b"]);
    expect(r.reserve(["b", "c"])).toEqual(["c"]);
    r.release("a");
    expect(r.reserve(["a"])).toEqual(["a"]);
  });

  it("sends the snapshot one at a time, reserved up front, releasing each at its turn's end", async () => {
    const r = new Reservations();
    const events: string[] = [];
    let active = 0;
    let overlap = 0;
    await runOneAtATime(
      r,
      ["a", "b", "c"],
      async (id) => {
        active++;
        overlap = Math.max(overlap, active);
        events.push(`send ${id}`);
        // Every snapshot row is still held, including the ones waiting their turn.
        expect(["a", "b", "c"].filter((x) => r.has(x)).length).toBeGreaterThan(0);
        if (id === "a") expect(r.has("b") && r.has("c")).toBe(true);
        await Promise.resolve();
        active--;
        if (id === "b") throw new Error("failed");
      },
      (ids) => events.push(`reserved ${ids.join("")}`),
      (id) => events.push(`released ${id}`)
    );
    expect(overlap).toBe(1);
    expect(events).toEqual([
      "reserved abc",
      "send a", "released a",
      "send b", "released b",
      "send c", "released c",
    ]);
  });

  it("leaves a row another control is already sending to that send", async () => {
    const r = new Reservations();
    r.reserve(["b"]);
    const sent: string[] = [];
    const mine = await runOneAtATime(r, ["a", "b"], async (id) => void sent.push(id), () => {}, () => {});
    expect(mine).toEqual(["a"]);
    expect(sent).toEqual(["a"]);
    expect(r.has("b")).toBe(true);
  });
});

describe("focus after a row leaves", () => {
  const rows = (...ids: string[]) => ids.map((id) => ({ id, hasControl: true }));
  it("goes to the next row's control, else the previous, else the header action, else the tray", () => {
    expect(focusAfterLeave(rows("a", "b", "c"), "b", true)).toEqual({ kind: "row", id: "c" });
    expect(focusAfterLeave(rows("a", "b", "c"), "c", true)).toEqual({ kind: "row", id: "b" });
    expect(focusAfterLeave(rows("a"), "a", true)).toEqual({ kind: "header" });
    expect(focusAfterLeave(rows("a"), "a", false)).toEqual({ kind: "tray" });
  });

  it("skips rows with no control now", () => {
    const list = [
      { id: "a", hasControl: true },
      { id: "b", hasControl: true },
      { id: "c", hasControl: false },
    ];
    expect(focusAfterLeave(list, "b", false)).toEqual({ kind: "row", id: "a" });
  });
});

describe("outside press", () => {
  const el = (hit: boolean) => ({ closest: () => (hit ? {} : null) });
  it("is empty space only when no control is under the press", () => {
    expect(landedOnEmptySpace(el(false))).toBe(true);
    expect(landedOnEmptySpace(el(true))).toBe(false);
    expect(landedOnEmptySpace(null)).toBe(true);
  });
});
