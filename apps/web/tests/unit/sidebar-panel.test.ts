import { describe, expect, it } from "vitest";
import {
  DEFAULT_WIDGETS,
  INITIAL_PANEL,
  isHeldOpen,
  isShown,
  panelReduce,
  toggleWidget,
  widgetsOnCount,
  type PanelEvent,
  type PanelModel,
  type WidgetState,
} from "../../src/lib/sidebar-panel";

/** Plays events one after the other, from a closed panel unless told otherwise. */
function run(events: PanelEvent[], from: PanelModel = INITIAL_PANEL): PanelModel {
  return events.reduce(panelReduce, from);
}

const enterRail: PanelEvent[] = [{ type: "pointer-enter" }, { type: "hover-rail" }];
const leave: PanelEvent[] = [{ type: "pointer-leave" }, { type: "grace-elapsed", keyboardInside: false }];
const clickMenu: PanelEvent = { type: "menu-click", keyboard: false };
const pressMenu: PanelEvent = { type: "menu-click", keyboard: true };

describe("a panel opened by the hover", () => {
  it("shows when the pointer reaches the rail, and is not held open", () => {
    const m = run(enterRail);
    expect(m.openedBy).toBe("hover");
    expect(isShown(m)).toBe(true);
    expect(isHeldOpen(m)).toBe(false);
  });

  it("closes once the pointer has left and the grace period is over", () => {
    expect(run([...enterRail, ...leave]).openedBy).toBeNull();
  });

  it("stays while the pointer is back over the sidebar when the grace period ends", () => {
    const m = run([...enterRail, { type: "pointer-leave" }, { type: "pointer-enter" }, { type: "grace-elapsed", keyboardInside: false }]);
    expect(m.openedBy).toBe("hover");
  });

  it("stays while keyboard focus is inside when the grace period ends", () => {
    const m = run([...enterRail, { type: "pointer-leave" }, { type: "grace-elapsed", keyboardInside: true }]);
    expect(m.openedBy).toBe("hover");
  });

  it("opens on keyboard focus on the rail, and closes the same way", () => {
    const m = run([{ type: "focus-rail" }]);
    expect(m.openedBy).toBe("hover");
    expect(run([{ type: "grace-elapsed", keyboardInside: false }], m).openedBy).toBeNull();
  });
});

describe("Open on hover off", () => {
  const off = run([{ type: "prefs", pinned: false, hoverReveal: false }]);

  it("never opens on hover or on keyboard focus", () => {
    expect(run(enterRail, off).openedBy).toBeNull();
    expect(run([{ type: "focus-rail" }], off).openedBy).toBeNull();
  });

  it("opens on the menu button and keeps the panel when the pointer leaves", () => {
    const m = run([...enterRail, clickMenu, ...leave], off);
    expect(m.openedBy).toBe("click");
    expect(isShown(m)).toBe(true);
  });

  it("holds a panel the hover had opened once hovering is switched off", () => {
    const m = run([...enterRail, { type: "hover-reveal", on: false }, ...leave]);
    expect(m.hoverReveal).toBe(false);
    expect(m.openedBy).toBe("click");
  });
});

describe("a panel opened by the menu button", () => {
  const opened = run([...enterRail, clickMenu]);

  it("opens a closed panel and holds it open", () => {
    const m = run([{ type: "pointer-enter" }, clickMenu]);
    expect(m.openedBy).toBe("click");
    expect(isHeldOpen(m)).toBe(true);
    expect(m.focusTick).toBe(0);
  });

  it("holds a panel that was already open from the hover", () => {
    expect(opened.openedBy).toBe("click");
    expect(opened.pinned).toBe(false);
  });

  it("stays when the pointer leaves, in either Open on hover mode", () => {
    expect(run(leave, opened).openedBy).toBe("click");
    const off = run([{ type: "prefs", pinned: false, hoverReveal: false }, clickMenu, ...leave]);
    expect(off.openedBy).toBe("click");
  });

  it("stays when the pointer comes back to the rail, instead of turning into a hover panel", () => {
    expect(run([...leave, ...enterRail], opened).openedBy).toBe("click");
  });

  it("closes on a second click of the menu button", () => {
    const m = run([clickMenu], opened);
    expect(m.openedBy).toBeNull();
    expect(isShown(m)).toBe(false);
  });

  it("closes on Escape", () => {
    expect(run([{ type: "escape" }], opened).openedBy).toBeNull();
  });

  it("closes when a page is chosen", () => {
    expect(run([{ type: "page-chosen" }], opened).openedBy).toBeNull();
  });

  it("does not close on anything else (no outside click closes it)", () => {
    const m = run([{ type: "focus-rail" }, { type: "hover-rail" }, { type: "grace-elapsed", keyboardInside: false }], opened);
    expect(m.openedBy).toBe("click");
  });

  it("opens from the keyboard with focus moving into the panel, and a second press closes it", () => {
    const m = run([pressMenu]);
    expect(m.openedBy).toBe("click");
    expect(m.focusTick).toBe(1);
    const again = run([pressMenu], m);
    expect(again.openedBy).toBeNull();
    expect(again.focusTick).toBe(1);
  });

  it("holds a panel the keyboard focus had revealed, and moves focus into it", () => {
    const m = run([{ type: "focus-rail" }, pressMenu]);
    expect(m.openedBy).toBe("click");
    expect(m.focusTick).toBe(1);
  });
});

describe("Escape", () => {
  it("closes a hover panel", () => {
    expect(run([{ type: "escape" }], run(enterRail)).openedBy).toBeNull();
  });

  it("leaves a docked panel alone", () => {
    const docked = run([{ type: "pin", pinned: true }]);
    expect(run([{ type: "escape" }], docked)).toBe(docked);
  });
});

describe("choosing a page", () => {
  it("closes a hover panel at once, with no grace period", () => {
    const m = run([...enterRail, { type: "page-chosen" }]);
    expect(m.openedBy).toBeNull();
    expect(isShown(m)).toBe(false);
  });

  it("does not let the hover open it again while the pointer stays over the sidebar", () => {
    const m = run([...enterRail, { type: "page-chosen" }, { type: "hover-rail" }, { type: "hover-rail" }]);
    expect(m.openedBy).toBeNull();
    expect(m.suppressed).toBe(true);
  });

  it("opens again once the pointer has left the sidebar and come back", () => {
    const left = run([...enterRail, { type: "page-chosen" }, { type: "pointer-leave" }]);
    expect(left.suppressed).toBe(false);
    expect(run(enterRail, left).openedBy).toBe("hover");
  });

  it("closes a rail click the same way, even with the panel closed and the pointer inside", () => {
    const m = run([{ type: "pointer-enter" }, { type: "page-chosen" }, { type: "hover-rail" }]);
    expect(m.openedBy).toBeNull();
  });

  it("does not hold back the hover after a page chosen with the pointer elsewhere (keyboard)", () => {
    const m = run([{ type: "focus-rail" }, { type: "page-chosen" }]);
    expect(m.openedBy).toBeNull();
    expect(m.suppressed).toBe(false);
    expect(run(enterRail, m).openedBy).toBe("hover");
  });

  it("leaves a pinned panel docked", () => {
    const docked = run([{ type: "pointer-enter" }, { type: "pin", pinned: true }]);
    const m = run([{ type: "page-chosen" }], docked);
    expect(m).toBe(docked);
    expect(m.pinned).toBe(true);
    expect(isShown(m)).toBe(true);
  });

  it("does not suppress the hover after a pinned panel's page choice either", () => {
    const docked = run([{ type: "pointer-enter" }, { type: "pin", pinned: true }, { type: "page-chosen" }]);
    expect(docked.suppressed).toBe(false);
  });
});

describe("the menu button and a docked panel", () => {
  const docked = run([{ type: "pointer-enter" }, { type: "pin", pinned: true }]);

  it("unpins and closes it, sliding the pane back out, with the mouse or the keyboard", () => {
    for (const keyboard of [true, false]) {
      const m = run([{ type: "menu-click", keyboard }], docked);
      expect(m).toMatchObject({ pinned: false, openedBy: null, shift: "out", focusTick: 0 });
    }
  });

  it("is held open", () => {
    expect(isHeldOpen(docked)).toBe(true);
    expect(isShown(docked)).toBe(true);
  });

  it("is not changed by the pointer leaving", () => {
    expect(run(leave, docked).pinned).toBe(true);
    expect(isShown(run(leave, docked))).toBe(true);
  });
});

describe("pin open", () => {
  it("pinning keeps the panel showing and slides the pane in", () => {
    const m = run([...enterRail, { type: "pin", pinned: true }]);
    expect(m).toMatchObject({ pinned: true, openedBy: null, shift: "in" });
    expect(isShown(m)).toBe(true);
  });

  it("unpinning leaves the panel floating (as a hover panel) and slides the pane out", () => {
    const m = run([{ type: "pin", pinned: true }, { type: "pin", pinned: false }]);
    expect(m).toMatchObject({ pinned: false, openedBy: "hover", shift: "out" });
    expect(isShown(m)).toBe(true);
  });

  it("unpinning with Open on hover off leaves the panel held, as nothing would close it", () => {
    const m = run([
      { type: "prefs", pinned: true, hoverReveal: false },
      { type: "pin", pinned: false },
    ]);
    expect(m.openedBy).toBe("click");
  });

  it("starts docked when the saved prefs say so", () => {
    const m = run([{ type: "prefs", pinned: true, hoverReveal: true }]);
    expect(isShown(m)).toBe(true);
    expect(m.shift).toBeNull();
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
