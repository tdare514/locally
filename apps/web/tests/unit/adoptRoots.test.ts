import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ValidationError } from "../../src/shared/errors";
import { parseSettingsPutBody } from "../../src/server/http/validation";
import { checkAdoptRoots, makeRootProbe, suggestedAdoptRoot } from "../../src/server/config/adoptRoots";
import { toSettingsResponse } from "../../src/server/config/settingsView";

describe("parseSettingsPutBody adoptRoots", () => {
  it("normalises with path.resolve and drops duplicates", () => {
    const body = parseSettingsPutBody({ adoptRoots: ["/a/b/", "/a/b", "/a/x/../b", "/c"] });
    expect(body.adoptRoots).toEqual(["/a/b", "/c"]);
  });

  it("accepts an empty list", () => {
    expect(parseSettingsPutBody({ adoptRoots: [] }).adoptRoots).toEqual([]);
  });

  it("refuses a relative path, an empty string, a non-string and a non-array", () => {
    for (const bad of [["music"], [""], [3], "/a", { 0: "/a" }]) {
      expect(() => parseSettingsPutBody({ adoptRoots: bad })).toThrow(ValidationError);
    }
  });

  it("refuses more than 20 folders", () => {
    const many = Array.from({ length: 21 }, (_, i) => `/f${i}`);
    expect(() => parseSettingsPutBody({ adoptRoots: many })).toThrow(/at most 20/);
    expect(parseSettingsPutBody({ adoptRoots: many.slice(0, 20) }).adoptRoots).toHaveLength(20);
  });

  it("counts the list as sent", () => {
    const dup = Array.from({ length: 25 }, () => "/same");
    expect(() => parseSettingsPutBody({ adoptRoots: dup })).toThrow(/at most 20/);
  });
});

describe("suggestedAdoptRoot", () => {
  let home: string;
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "suggest-"));
  });
  afterEach(() => fs.rmSync(home, { recursive: true, force: true }));
  const probe = () => makeRootProbe();

  it("is null when ~/Documents/Spotify Music does not exist", () => {
    expect(suggestedAdoptRoot(home, [], probe())).toBeNull();
  });

  it("is null when it is a file, not a folder", () => {
    fs.mkdirSync(path.join(home, "Documents"));
    fs.writeFileSync(path.join(home, "Documents", "Spotify Music"), "x");
    expect(suggestedAdoptRoot(home, [], probe())).toBeNull();
  });

  it("is the absolute path when the folder exists and is not yet a root", () => {
    const dir = path.join(home, "Documents", "Spotify Music");
    fs.mkdirSync(dir, { recursive: true });
    expect(suggestedAdoptRoot(home, [], probe())).toBe(dir);
    expect(suggestedAdoptRoot(home, [dir + "/"], probe())).toBeNull();
  });

  it("is carried in the settings response next to the roots", () => {
    const res = toSettingsResponse({ libraryDir: "/l", sync: null, adoptRoots: ["/r"] }, "/s");
    expect(res.adoptRoots).toEqual(["/r"]);
    expect(res.suggestedAdoptRoot).toBe("/s");
    expect(toSettingsResponse({ libraryDir: "/l", sync: null }).adoptRoots).toEqual([]);
  });
});

describe("checkAdoptRoots on real symlinks", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "roots-")));
    fs.mkdirSync(path.join(dir, "lib"));
    fs.mkdirSync(path.join(dir, "music"));
    fs.symlinkSync(path.join(dir, "lib"), path.join(dir, "lib-alias"));
    fs.symlinkSync(path.join(dir, "music"), path.join(dir, "music-alias"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("refuses an alias of the library", () => {
    const r = checkAdoptRoots([path.join(dir, "lib-alias")], [], path.join(dir, "lib"), makeRootProbe());
    expect(r.ok).toBe(false);
  });

  it("refuses a library that does not exist yet under a symlink to a root", () => {
    const alias = path.join(dir, "music-alias");
    const r = checkAdoptRoots([path.join(dir, "music")], [], path.join(alias, "NewLibrary"), makeRootProbe());
    expect(r.ok).toBe(false);
  });

  it("stores a symlinked root as its real path", () => {
    const r = checkAdoptRoots([path.join(dir, "music-alias")], [], path.join(dir, "lib"), makeRootProbe());
    expect(r).toEqual({ ok: true, roots: [path.join(dir, "music")] });
  });
});

describe("settings change to the library only", () => {
  it("refuses libraryDir at <alias>/NewLibrary when the alias points to a saved root", async () => {
    const { planSettingsUpdate } = await import("../../src/server/config/settingsUpdate");
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "alias-")));
    try {
      fs.mkdirSync(path.join(dir, "Music"));
      fs.symlinkSync(path.join(dir, "Music"), path.join(dir, "Alias"));
      const current = { libraryDir: path.join(dir, "lib"), sync: null, adoptRoots: [path.join(dir, "Music")] };
      const r = planSettingsUpdate(current, { libraryDir: path.join(dir, "Alias", "NewLibrary") }, dir + "-home", makeRootProbe());
      expect(r).toMatchObject({ ok: false });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
