import { describe, expect, it } from "vitest";
import { parseCoverSize, parseLibraryLayout } from "../../src/lib/library-view-prefs";

describe("parseLibraryLayout", () => {
  it("accepts the two layouts", () => {
    expect(parseLibraryLayout("list")).toBe("list");
    expect(parseLibraryLayout("covers")).toBe("covers");
  });
  it("defaults to list for null and garbage", () => {
    expect(parseLibraryLayout(null)).toBe("list");
    expect(parseLibraryLayout("")).toBe("list");
    expect(parseLibraryLayout("grid")).toBe("list");
    expect(parseLibraryLayout("COVERS")).toBe("list");
  });
});

describe("parseCoverSize", () => {
  it("accepts 0, 1 and 2", () => {
    expect(parseCoverSize("0")).toBe(0);
    expect(parseCoverSize("1")).toBe(1);
    expect(parseCoverSize("2")).toBe(2);
  });
  it("defaults to 1 for null and garbage", () => {
    expect(parseCoverSize(null)).toBe(1);
    expect(parseCoverSize("")).toBe(1);
    expect(parseCoverSize("big")).toBe(1);
  });
  it("defaults to 1 for out-of-range numbers", () => {
    expect(parseCoverSize("3")).toBe(1);
    expect(parseCoverSize("-1")).toBe(1);
    expect(parseCoverSize("1.5")).toBe(1);
    expect(parseCoverSize("99")).toBe(1);
  });
});
