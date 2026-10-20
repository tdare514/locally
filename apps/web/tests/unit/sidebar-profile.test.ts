import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/** Renders the sidebar to a string (effects do not run) with IS_DEMO set as asked. */
async function render(props: { signedIn?: boolean; email?: string | null; demo?: boolean; pinned?: boolean; stats?: boolean } = {}) {
  vi.resetModules();
  vi.doMock("../../src/lib/demo", () => ({ IS_DEMO: props.demo ?? false }));
  const mod = await import("../../src/components/sidebar/Sidebar");
  const html = renderToStaticMarkup(
    createElement(mod.default, {
      releases: [],
      loading: false,
      activePage: "library",
      onLibraryClick: () => {},
      onImportClick: () => {},
      onSettingsClick: () => {},
      onProfileClick: () => {},
      onStatsClick: props.stats ? () => {} : undefined,
      signedIn: props.signedIn ?? false,
      email: props.email ?? null,
      palette: null,
    }),
  );
  const rail = html.slice(html.indexOf("<nav"), html.indexOf("<aside"));
  const panel = html.slice(html.indexOf("<aside"));
  return { mod, html, rail, panel };
}

afterEach(() => {
  vi.doUnmock("../../src/lib/demo");
});

describe("sidebar rail foot", () => {
  it("puts Settings after the divider and the profile last, with no brand mark", async () => {
    const { rail } = await render({ signedIn: true, email: "owner@example.com" });
    expect(rail).not.toContain("listener-line");
    const labels = [...rail.matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1]);
    expect(labels).toEqual(["Main", "Open sidebar", "Library", "Import", "Settings", "Account: owner@example.com"]);
    expect(rail.indexOf("h-px w-6")).toBeLessThan(rail.indexOf('aria-label="Settings"'));
    expect(rail.indexOf('aria-label="Import"')).toBeLessThan(rail.indexOf('aria-label="Settings"'));
    expect(rail.indexOf("mt-auto")).toBeLessThan(rail.indexOf('aria-label="Settings"'));
  });

  it("names the profile by who is signed in", async () => {
    expect((await render()).rail).toContain('aria-label="Account: On this Mac"');
    expect((await render({ signedIn: true })).rail).toContain('aria-label="Account: Syncing with your phone"');
    expect((await render({ demo: true })).rail).toContain('aria-label="Account: Read-only sample"');
  });

  it("shows the email's first letter, uppercase, only when signed in with an email", async () => {
    const withEmail = (await render({ signedIn: true, email: "owner@example.com" })).rail;
    expect(withEmail).toContain('data-profile-circle="initial"');
    expect(withEmail).toMatch(/>O<\/span>/);
    for (const p of [{}, { signedIn: true }, { demo: true, signedIn: true, email: "a@b.c" }]) {
      const html = (await render(p)).rail;
      expect(html).toContain('data-profile-circle="glyph"');
      expect(html).toContain("<circle");
    }
  });
});

describe("sidebar panel", () => {
  it("has the panel controls at the top and says Pin down", async () => {
    const { panel } = await render();
    expect(panel).toContain("Pin down");
    expect(panel).not.toContain("Pin open");
    expect(panel.indexOf("Pin down")).toBeLessThan(panel.indexOf('aria-label="Pages"'));
    expect(panel).toContain("Open on hover");
  });

  it("keeps Settings out of the pages nav and ends with Settings then the profile row", async () => {
    const { panel } = await render({ signedIn: true, email: "owner@example.com" });
    const nav = panel.slice(panel.indexOf('aria-label="Pages"'), panel.indexOf("</nav>", panel.indexOf('aria-label="Pages"')));
    expect(nav).toContain("Library");
    expect(nav).toContain("Import");
    expect(nav).not.toContain("Settings");
    const tail = panel.slice(panel.lastIndexOf("h-px shrink-0"));
    expect(tail.indexOf("Settings")).toBeGreaterThan(-1);
    expect(tail.indexOf("Settings")).toBeLessThan(tail.indexOf("owner@example.com"));
    expect(tail).toContain(">O<");
  });

  it("labels the profile row for each state", async () => {
    const tail = async (p: Parameters<typeof render>[0]) => {
      const { panel } = await render(p);
      return panel.slice(panel.lastIndexOf("h-px shrink-0"));
    };
    expect(await tail({ signedIn: true, email: "me@x.io" })).toContain("me@x.io");
    expect(await tail({ signedIn: true })).toContain("Syncing with your phone");
    expect(await tail({})).toContain("On this Mac");
    const demo = await tail({ demo: true });
    expect(demo).toContain("Demo");
    expect(demo).toContain("Read-only sample");
  });
});

describe("profile click", () => {
  it("wires one profile button on the rail, and the handler is the page-choice path", async () => {
    const { mod, html } = await render({ signedIn: true, email: "a@b.c" });
    expect(html.match(/data-page="profile"/g)).toHaveLength(1);
    expect(mod.profileLabel(false, null)).toBe("On this Mac");
    expect(mod.profileInitial(true, "  zed@x.io")).toBe("Z");
  });
});

describe("sidebar reveal zone (#264)", () => {
  it("wraps the menu button and the top rail buttons, not Settings or the profile", async () => {
    const { rail } = await render({ signedIn: true, email: "owner@example.com", stats: true });
    const start = rail.indexOf("data-reveal-zone");
    expect(start).toBeGreaterThan(-1);
    const settings = rail.indexOf('data-page="settings"');
    const profile = rail.indexOf('data-page="profile"');
    // The zone is the first div in the rail; it closes before the mt-auto foot opens.
    const zone = rail.slice(start, rail.indexOf("mt-auto"));
    expect(zone).toContain('aria-label="Open sidebar"');
    expect(zone).toContain('data-page="library"');
    expect(zone).toContain('data-page="import"');
    expect(zone).toContain('data-page="stats"');
    expect(zone).not.toContain('data-page="settings"');
    expect(zone).not.toContain('data-page="profile"');
    expect(settings).toBeGreaterThan(start + zone.length - 1);
    expect(profile).toBeGreaterThan(settings);
  });
});
