import fs2 from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NodeFileSystem } from "../../src/server/fs/NodeFileSystem";

// `isInside` is pure path arithmetic (no disk access), so these paths need not exist.
const fs = new NodeFileSystem();
const lib = path.resolve("/lib");
const inside = (target: string) => fs.isInside(lib, target);

describe("NodeFileSystem.isInside", () => {
  it("accepts a direct child", () => {
    expect(inside("/lib/a")).toBe(true);
  });

  it("accepts a nested child", () => {
    expect(inside("/lib/a/b/03 - Track.mp3")).toBe(true);
  });

  it("rejects a sibling that merely shares the prefix", () => {
    expect(inside("/lib2")).toBe(false);
    expect(inside("/lib2/a")).toBe(false);
    expect(inside("/library/a")).toBe(false);
  });

  it('accepts a child literally named "..foo"', () => {
    expect(inside("/lib/..foo")).toBe(true);
    expect(inside("/lib/..foo/x.mp3")).toBe(true);
    expect(inside("/lib/a/...")).toBe(true);
  });

  it("rejects the parent and other ancestors", () => {
    expect(inside("/")).toBe(false);
    expect(fs.isInside("/lib/a/b", "/lib")).toBe(false);
  });

  it("treats the base itself as inside (delete and reveal handle that case themselves)", () => {
    expect(inside("/lib")).toBe(true);
    expect(inside("/lib/")).toBe(true);
    expect(inside("/lib/a/..")).toBe(true);
  });

  it("rejects traversal out of the base", () => {
    expect(inside("/lib/../etc/passwd")).toBe(false);
    expect(inside("/lib/a/../../etc")).toBe(false);
    expect(inside("/lib/a/../../lib2/x")).toBe(false);
  });

  it("rejects an unrelated absolute path", () => {
    expect(inside("/etc/passwd")).toBe(false);
    expect(inside("/tmp/x")).toBe(false);
  });
});

// These need real paths on disk (symlinks, real ancestors), unlike the pure lexical
// cases above, so they run against an actual temp dir.
describe("NodeFileSystem.isInside (real paths / symlinks)", () => {
  let libraryDir: string;
  let outsideDir: string;

  beforeEach(async () => {
    libraryDir = await fs2.mkdtemp(path.join(os.tmpdir(), "sli-isinside-lib-"));
    outsideDir = await fs2.mkdtemp(path.join(os.tmpdir(), "sli-isinside-outside-"));
  });

  afterEach(async () => {
    await fs2.rm(libraryDir, { recursive: true, force: true });
    await fs2.rm(outsideDir, { recursive: true, force: true });
  });

  it("rejects a symlinked subdir that points outside the library", async () => {
    const linkPath = path.join(libraryDir, "link");
    await fs2.symlink(outsideDir, linkPath, "dir");

    expect(fs.isInside(libraryDir, linkPath)).toBe(false);
    expect(fs.isInside(libraryDir, path.join(linkPath, "escaped.mp3"))).toBe(false);
  });

  it("accepts a normal nested path that doesn't exist yet", async () => {
    const notYetWritten = path.join(libraryDir, "New Artist", "New Album", "01 - Track.mp3");
    expect(fs.isInside(libraryDir, notYetWritten)).toBe(true);
  });

  it('accepts a real child literally named "..foo"', async () => {
    const dotDotFoo = path.join(libraryDir, "..foo");
    await fs2.mkdir(dotDotFoo);
    expect(fs.isInside(libraryDir, dotDotFoo)).toBe(true);
    expect(fs.isInside(libraryDir, path.join(dotDotFoo, "child.mp3"))).toBe(true);
  });
});
