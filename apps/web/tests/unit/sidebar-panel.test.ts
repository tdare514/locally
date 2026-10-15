import { describe, expect, it } from "vitest";
import {
  DEFAULT_WIDGETS,
  menuButtonClick,
  pinChange,
  toggleWidget,
  widgetsOnCount,
  type WidgetState,
} from "../../src/lib/sidebar-panel";

const mouse = { keyboard: false, hoverReveal: true };

describe("menuButtonClick", () => {
  it("opens a closed panel", () => {
    expect(menuButtonClick({ open: false, pinned: false }, mouse)).toEqual({
      open: true,
      pinned: false,
      shift: null,
      focusPanel: false,
    });
  });

  it("opens a closed panel the same way when Open on hover is off", () => {
    expect(menuButtonClick({ open: false, pinned: false }, { keyboard: false, hoverReveal: false })).toMatchObject({
      open: true,
      pinned: false,
    });
  });

  it("pins a panel that is already open from the hover", () => {
    expect(menuButtonClick({ open: true, pinned: false }, mouse)).toEqual({
      open: true,
      pinned: true,
      shift: "in",
      focusPanel: false,
    });
  });

  it("closes a panel it opened itself when Open on hover is off", () => {
    expect(menuButtonClick({ open: true, pinned: false }, { keyboard: false, hoverReveal: false })).toEqual({
      open: false,
      pinned: false,
      shift: null,
      focusPanel: false,
    });
  });

  it("unpins and closes a pinned panel, sliding the pane back out", () => {
    for (const hoverReveal of [true, false]) {
      for (const keyboard of [true, false]) {
        expect(menuButtonClick({ open: true, pinned: true }, { keyboard, hoverReveal })).toEqual({
          open: false,
          pinned: false,
          shift: "out",
          focusPanel: false,
        });
      }
    }
  });

  it("opens from the keyboard and moves focus into the panel, never pinning", () => {
    expect(menuButtonClick({ open: false, pinned: false }, { keyboard: true, hoverReveal: true })).toEqual({
      open: true,
      pinned: false,
      shift: null,
      focusPanel: true,
    });
    // Already open from the hover: Enter still just moves focus in.
    expect(menuButtonClick({ open: true, pinned: false }, { keyboard: true, hoverReveal: true })).toEqual({
      open: true,
      pinned: false,
      shift: null,
      focusPanel: true,
    });
  });
});

describe("pinChange", () => {
  it("pinning keeps the panel showing and slides the pane in", () => {
    expect(pinChange(true)).toEqual({ open: true, pinned: true, shift: "in", focusPanel: false });
  });

  it("unpinning leaves the panel floating and slides the pane out", () => {
    expect(pinChange(false)).toEqual({ open: true, pinned: false, shift: "out", focusPanel: false });
  });
});

describe("widgets", () => {
  it("start with the three lists on and the shelf off", () => {
    expect(DEFAULT_WIDGETS).toEqual({ shelf: false, tracks: true, albums: true, artists: true });
    expect(widgetsOnCount(DEFAULT_WIDGETS)).toBe(3);
  });

  it("toggles one widget without touching the others", () => {
    const next = toggleWidget(DEFAULT_WIDGETS, "shelf");
    expect(next).toEqual({ shelf: true, tracks: true, albums: true, artists: true });
    expect(DEFAULT_WIDGETS.shelf).toBe(false);
    expect(toggleWidget(next, "albums").albums).toBe(false);
  });

  it("keeps the last widget on", () => {
    const one: WidgetState = { shelf: false, tracks: false, albums: true, artists: false };
    expect(toggleWidget(one, "albums")).toBe(one);
    // Another widget can still be switched on, and then the first can go.
    const two = toggleWidget(one, "tracks");
    expect(widgetsOnCount(two)).toBe(2);
    expect(toggleWidget(two, "albums").albums).toBe(false);
  });

  it("lets the shelf be the one widget left", () => {
    const shelfOnly: WidgetState = { shelf: true, tracks: false, albums: false, artists: false };
    expect(toggleWidget(shelfOnly, "shelf")).toBe(shelfOnly);
  });
});
