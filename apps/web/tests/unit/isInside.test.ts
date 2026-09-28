import path from "node:path";
import { describe, expect, it } from "vitest";
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
