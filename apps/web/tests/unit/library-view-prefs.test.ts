import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isSectionOpen,
  loadLibraryWidth,
  loadSectionFolds,
  parseSectionFolded,
  saveSectionFolded,
  parseCoverSize,
  parseLibraryLayout,
  libraryWidthClass,
  parseLibraryWidth,
  saveLibraryWidth,
} from "../../src/lib/library-view-prefs";

describe("parseLibraryLayout", () => {
  it("accepts the three layouts", () => {
    expect(parseLibraryLayout("list")).toBe("list");
    expect(parseLibraryLayout("covers")).toBe("covers");
    expect(parseLibraryLayout("artists")).toBe("artists");
  });
  it("defaults to list for null and garbage", () => {
    expect(parseLibraryLayout(null)).toBe("list");
    expect(parseLibraryLayout("")).toBe("list");
    expect(parseLibraryLayout("grid")).toBe("list");
    expect(parseLibraryLayout("COVERS")).toBe("list");
    expect(parseLibraryLayout("ARTISTS")).toBe("list");
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

describe("parseLibraryWidth", () => {
  it("accepts the two widths", () => {
    expect(parseLibraryWidth("comfortable")).toBe("comfortable");
    expect(parseLibraryWidth("full")).toBe("full");
  });
  it("defaults to comfortable for null and garbage", () => {
    expect(parseLibraryWidth(null)).toBe("full");
    expect(parseLibraryWidth("")).toBe("full");
    expect(parseLibraryWidth("wide")).toBe("full");
    expect(parseLibraryWidth("FULL")).toBe("full");
  });
});

describe("libraryWidthClass", () => {
  it("has no max width when full and 920px when comfortable", () => {
    expect(libraryWidthClass("full")).not.toContain("max-w");
    expect(libraryWidthClass("full")).toContain("lg:-mx-8");
    expect(libraryWidthClass("comfortable")).toContain("max-w-[920px]");
  });
});

describe("library width storage", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubStorage() {
    const data = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => void data.set(k, v),
      },
    });
  }

  it("defaults to full when nothing is saved", () => {
    stubStorage();
    expect(loadLibraryWidth()).toBe("full");
  });
  it("keeps a saved comfortable width", () => {
    stubStorage();
    saveLibraryWidth("comfortable");
    expect(loadLibraryWidth()).toBe("comfortable");
  });
  it("round-trips a saved width", () => {
    stubStorage();
    saveLibraryWidth("full");
    expect(loadLibraryWidth()).toBe("full");
    saveLibraryWidth("comfortable");
    expect(loadLibraryWidth()).toBe("comfortable");
  });
  it("falls back to full when storage throws", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
      },
    });
    expect(loadLibraryWidth()).toBe("full");
    expect(() => saveLibraryWidth("full")).not.toThrow();
  });
});

describe("section folds (#260)", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubStorage(store: Record<string, string>) {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => {
          store[k] = v;
        },
      },
    });
  }
  const throwing = {
    localStorage: {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    },
  };

  it("defaults both sections to open", () => {
    stubStorage({});
    expect(loadSectionFolds()).toEqual({ collections: false, singles: false, albums: false });
  });
  it("saves and reloads each section on its own", () => {
    const store: Record<string, string> = {};
    stubStorage(store);
    saveSectionFolded("singles", true);
    expect(loadSectionFolds()).toEqual({ collections: false, singles: true, albums: false });
    saveSectionFolded("singles", false);
    saveSectionFolded("albums", true);
    expect(loadSectionFolds()).toEqual({ collections: false, singles: false, albums: true });
  });
  it("treats garbage as open", () => {
    expect(parseSectionFolded("yes")).toBe(false);
    expect(parseSectionFolded(null)).toBe(false);
    expect(parseSectionFolded("1")).toBe(true);
  });
  it("survives localStorage throwing", () => {
    vi.stubGlobal("window", throwing);
    expect(loadSectionFolds()).toEqual({ collections: false, singles: false, albums: false });
    expect(() => saveSectionFolded("albums", true)).not.toThrow();
  });
  it("a typed search opens a folded section, whitespace does not", () => {
    expect(isSectionOpen(true, "")).toBe(false);
    expect(isSectionOpen(true, "   ")).toBe(false);
    expect(isSectionOpen(true, "night")).toBe(true);
    expect(isSectionOpen(false, "")).toBe(true);
  });
});
