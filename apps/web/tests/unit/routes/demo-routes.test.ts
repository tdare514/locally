import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("../../../src/server/container", () => ({
  getServices: () => {
    throw new Error("getServices must not be called in demo mode");
  },
}));

import { GET as getLibrary } from "../../../src/app/api/library/route";
import { GET as getRelease, PATCH as patchRelease, DELETE as deleteRelease } from "../../../src/app/api/releases/[id]/route";
import { GET as getCover, PUT as putCover } from "../../../src/app/api/releases/[id]/cover/route";
import { GET as getSettings, PUT as putSettings } from "../../../src/app/api/settings/route";
import { GET as getSyncStatus } from "../../../src/app/api/sync/status/route";
import { GET as getSpotifySource } from "../../../src/app/api/spotify/source/route";
import { POST as postImport } from "../../../src/app/api/import/route";
import { POST as postInspect } from "../../../src/app/api/inspect/route";
import { POST as postReveal } from "../../../src/app/api/reveal/route";
import { POST as postSpotifyOpen } from "../../../src/app/api/spotify/open/route";
import { POST as postDismiss } from "../../../src/app/api/spotify/source/dismiss/route";
import { POST as postReconcile } from "../../../src/app/api/sync/reconcile/route";
import { POST as postVerify } from "../../../src/app/api/sync/verify/route";
import { POST as postCode } from "../../../src/app/api/sync/code/route";
import { POST as postSignout } from "../../../src/app/api/sync/signout/route";
import { DELETE as deleteAccount } from "../../../src/app/api/sync/account/route";
import { POST as postAccept } from "../../../src/app/api/sync/accept/[id]/route";
import { DEMO_RELEASES } from "../../../src/server/demo/library";
import { getDemoCover } from "../../../src/server/demo/covers";

const req = (method = "GET") => new NextRequest("http://localhost/api/x", { method });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => vi.stubEnv("LOCALLY_DEMO", "1"));
afterEach(() => vi.unstubAllEnvs());

describe("demo GET routes", () => {
  it("library lists the sample releases", async () => {
    const res = await getLibrary();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.version).toBe(1);
    expect(body.releases).toHaveLength(6);
    expect(body.releases.map((r: { id: string }) => r.id)).toEqual(DEMO_RELEASES.map((r) => r.id));
  });

  it("has three singles and three albums with fake paths", () => {
    expect(DEMO_RELEASES.filter((r) => r.kind === "single")).toHaveLength(3);
    const albums = DEMO_RELEASES.filter((r) => r.kind === "album");
    expect(albums).toHaveLength(3);
    for (const a of albums) expect(a.tracks.length).toBeGreaterThanOrEqual(4);
    for (const r of DEMO_RELEASES) expect(r.folderPath.startsWith("/Users/demo/")).toBe(true);
  });

  it("release by id returns it, 404 for unknown", async () => {
    const id = DEMO_RELEASES[0].id;
    const ok = await getRelease(req(), ctx(id));
    expect(ok.status).toBe(200);
    expect((await ok.json()).id).toBe(id);
    expect((await getRelease(req(), ctx("nope"))).status).toBe(404);
  });

  it("settings, sync status and spotify source answer from samples", async () => {
    const settings = await (await getSettings()).json();
    expect(settings.sync.signedIn).toBe(false);
    const sync = await (await getSyncStatus()).json();
    expect(sync).toMatchObject({ signedIn: false, pendingFromPhone: [] });
    const source = await (await getSpotifySource()).json();
    expect(source.watching).toBe(true);
  });

  it("cover is a locked-down SVG for a known id and 404 for an unknown one", async () => {
    const res = await getCover(req(), ctx(DEMO_RELEASES[0].id));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Content-Security-Policy")).toBe("default-src 'none'; style-src 'unsafe-inline'");
    expect(await res.text()).toContain("<svg");
    expect((await getCover(req(), ctx("nope"))).status).toBe(404);
    expect((await getCover(req(), ctx("constructor"))).status).toBe(404);
  });

  it("every release has a clean cover", () => {
    for (const r of DEMO_RELEASES) {
      const svg = getDemoCover(r.id);
      expect(svg, r.id).toBeDefined();
      expect(svg).toContain('viewBox="0 0 600 600"');
      expect(svg).not.toContain("<script");
      expect(svg).not.toContain("foreignObject");
      expect(svg).not.toContain('href="http');
      expect(svg).not.toContain("<text");
    }
  });
});

describe("demo mutating routes", () => {
  it("each answers 403 Demo: read-only", async () => {
    const calls: [string, () => Promise<Response>][] = [
      ["import", () => postImport(req("POST"))],
      ["inspect", () => postInspect(req("POST"))],
      ["reveal", () => postReveal(req("POST"))],
      ["settings PUT", () => putSettings(req("PUT"))],
      ["spotify open", () => postSpotifyOpen()],
      ["spotify dismiss", () => postDismiss()],
      ["release PATCH", () => patchRelease(req("PATCH"), ctx("demo-x"))],
      ["release DELETE", () => deleteRelease(req("DELETE"), ctx("demo-x"))],
      ["cover PUT", () => putCover(req("PUT"), ctx("demo-x"))],
      ["sync reconcile", () => postReconcile()],
      ["sync verify", () => postVerify(req("POST"))],
      ["sync code", () => postCode(req("POST"))],
      ["sync signout", () => postSignout()],
      ["sync account", () => deleteAccount()],
      ["sync accept", () => postAccept(req("POST"), ctx("x"))],
    ];
    for (const [name, call] of calls) {
      const res = await call();
      expect(res.status, name).toBe(403);
      expect(await res.json(), name).toEqual({ error: "Demo: read-only" });
    }
  });
});

describe("getServices in demo mode", () => {
  it("throws", async () => {
    vi.doUnmock("../../../src/server/container");
    vi.resetModules();
    const { getServices } = await import("../../../src/server/container");
    expect(() => getServices()).toThrow();
  });
});
