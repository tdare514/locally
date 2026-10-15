import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_WIDGETS } from "../../src/lib/sidebar-panel";
import {
  loadSidebarPrefs,
  parseOpenOnHover,
  parsePeriod,
  parsePinned,
  parseWidgets,
  saveSidebarOpenOnHover,
  saveSidebarPeriod,
  saveSidebarPinned,
  saveSidebarWidgets,
} from "../../src/lib/sidebar-prefs";

describe("parsePinned", () => {
  it("is docked only when saved as true", () => {
    expect(parsePinned("true")).toBe(true);
    expect(parsePinned("false")).toBe(false);
    expect(parsePinned(null)).toBe(false);
    expect(parsePinned("1")).toBe(false);
    expect(parsePinned("TRUE")).toBe(false);
  });
});

describe("parseOpenOnHover", () => {
  it("is on unless saved as false", () => {
    expect(parseOpenOnHover(null)).toBe(true);
    expect(parseOpenOnHover("true")).toBe(true);
    expect(parseOpenOnHover("false")).toBe(false);
    expect(parseOpenOnHover("garbage")).toBe(true);
  });
});

describe("parseWidgets", () => {
  it("reads saved widgets", () => {
    const raw = JSON.stringify({ shelf: true, tracks: false, albums: true, artists: false });
    expect(parseWidgets(raw)).toEqual({ shelf: true, tracks: false, albums: true, artists: false });
  });

  it("falls back to the defaults for nothing, bad JSON, and non-objects", () => {
    expect(parseWidgets(null)).toEqual(DEFAULT_WIDGETS);
    expect(parseWidgets("")).toEqual(DEFAULT_WIDGETS);
    expect(parseWidgets("{nope")).toEqual(DEFAULT_WIDGETS);
    expect(parseWidgets("[]")).toEqual(DEFAULT_WIDGETS);
    expect(parseWidgets("null")).toEqual(DEFAULT_WIDGETS);
    expect(parseWidgets("7")).toEqual(DEFAULT_WIDGETS);
  });

  it("keeps the default for a widget that is missing or not a boolean", () => {
    expect(parseWidgets(JSON.stringify({ shelf: true, tracks: "no" }))).toEqual({
      shelf: true,
      tracks: true,
      albums: true,
      artists: true,
    });
  });

  it("never loads with every widget off", () => {
    const raw = JSON.stringify({ shelf: false, tracks: false, albums: false, artists: false });
    expect(parseWidgets(raw)).toEqual(DEFAULT_WIDGETS);
  });
});

describe("parsePeriod", () => {
  it("reads the three periods and is this week otherwise", () => {
    expect(parsePeriod("today")).toBe("today");
    expect(parsePeriod("week")).toBe("week");
    expect(parsePeriod("month")).toBe("month");
    expect(parsePeriod(null)).toBe("week");
    expect(parsePeriod("")).toBe("week");
    expect(parsePeriod("all")).toBe("week");
    expect(parsePeriod("Today")).toBe("week");
    expect(parsePeriod("constructor")).toBe("week");
  });
});

describe("sidebar storage", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubStorage() {
    const data = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => void data.set(key, value),
      },
    });
    return data;
  }

  it("loads the defaults when nothing was saved", () => {
    stubStorage();
    expect(loadSidebarPrefs()).toEqual({ pinned: false, openOnHover: true, widgets: DEFAULT_WIDGETS, period: "week" });
  });

  it("round-trips pinned, Open on hover, the widgets and the period", () => {
    stubStorage();
    saveSidebarPinned(true);
    saveSidebarOpenOnHover(false);
    saveSidebarWidgets({ shelf: true, tracks: true, albums: false, artists: false });
    saveSidebarPeriod("today");
    expect(loadSidebarPrefs()).toEqual({
      pinned: true,
      openOnHover: false,
      widgets: { shelf: true, tracks: true, albums: false, artists: false },
      period: "today",
    });
  });

  it("uses the defaults when storage is blocked", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    vi.stubGlobal("window", { localStorage: blocked });
    expect(loadSidebarPrefs()).toEqual({ pinned: false, openOnHover: true, widgets: DEFAULT_WIDGETS, period: "week" });
    expect(() => saveSidebarPinned(true)).not.toThrow();
    expect(() => saveSidebarOpenOnHover(false)).not.toThrow();
    expect(() => saveSidebarWidgets(DEFAULT_WIDGETS)).not.toThrow();
    expect(() => saveSidebarPeriod("month")).not.toThrow();
  });
});
