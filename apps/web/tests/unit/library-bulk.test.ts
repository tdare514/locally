import { describe, expect, it } from "vitest";
import {
  bulkDetailsPatch,
  bulkSummary,
  runBulk,
  type BulkOutcome,
} from "../../src/lib/library-bulk";
import type { Release, Track } from "../../src/shared/types";

function track(id: string, title: string): Track {
  return {
    id,
    title,
    trackNumber: 1,
    filePath: `/lib/${id}.mp3`,
    originalName: `${title}.mp3`,
    durationSec: 180,
  };
}

function release(id: string, title: string): Release {
  return {
    id,
    kind: "single",
    title,
    artist: "Artist",
    year: null,
    genre: null,
    coverPath: null,
    folderPath: `/lib/${id}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    tracks: [track(`${id}-t1`, title)],
  };
}

function outcome(done: number, failedTitles: string[]): BulkOutcome {
  return {
    done,
    failed: failedTitles.map((title, i) => ({
      id: `f${i}`,
      title,
      error: "boom",
    })),
  };
}

describe("bulkDetailsPatch", () => {
  it("trims fields and omits empty ones", () => {
    expect(
      bulkDetailsPatch({ artist: "  Björk ", year: "", genre: " Pop" }),
    ).toEqual({
      artist: "Björk",
      genre: "Pop",
    });
  });

  it("treats whitespace-only fields as empty", () => {
    expect(
      bulkDetailsPatch({ artist: "   ", year: "2024", genre: "\t" }),
    ).toEqual({
      year: "2024",
    });
  });

  it("returns null when nothing would change", () => {
    expect(bulkDetailsPatch({ artist: "", year: "  ", genre: "" })).toBeNull();
  });
});

describe("runBulk", () => {
  it("runs every release in order and counts successes", async () => {
    const seen: string[] = [];
    const result = await runBulk(
      [release("a", "A"), release("b", "B")],
      async (r) => {
        seen.push(r.id);
      },
    );
    expect(seen).toEqual(["a", "b"]);
    expect(result).toEqual({ done: 2, failed: [] });
  });

  it("continues after a rejected op and records the failure", async () => {
    const seen: string[] = [];
    const result = await runBulk(
      [release("a", "A"), release("b", "B"), release("c", "C")],
      async (r) => {
        seen.push(r.id);
        if (r.id === "b") throw new Error("disk full");
      },
    );
    expect(seen).toEqual(["a", "b", "c"]);
    expect(result.done).toBe(2);
    expect(result.failed).toEqual([
      { id: "b", title: "B", error: "disk full" },
    ]);
  });

  it("maps non-Error rejections to Unknown error", async () => {
    const result = await runBulk([release("a", "A")], () =>
      Promise.reject("nope"),
    );
    expect(result.failed).toEqual([
      { id: "a", title: "A", error: "Unknown error" },
    ]);
  });

  it("preserves failure order across several failures", async () => {
    const result = await runBulk(
      [release("a", "A"), release("b", "B"), release("c", "C")],
      async (r) => {
        if (r.id !== "b") throw new Error(`no ${r.id}`);
      },
    );
    expect(result.done).toBe(1);
    expect(result.failed.map((f) => f.id)).toEqual(["a", "c"]);
  });

  it("handles an empty list", async () => {
    expect(await runBulk([], async () => {})).toEqual({ done: 0, failed: [] });
  });
});

describe("bulkSummary", () => {
  it("uses the plural for several releases", () => {
    expect(bulkSummary("Deleted", outcome(3, []), 3)).toEqual({
      kind: "success",
      text: "Deleted 3 releases",
    });
  });

  it("uses the singular for one release", () => {
    expect(bulkSummary("Updated", outcome(1, []), 1)).toEqual({
      kind: "success",
      text: "Updated 1 release",
    });
  });

  it("reports a partial failure with titles", () => {
    expect(bulkSummary("Deleted", outcome(2, ["Title A"]), 3)).toEqual({
      kind: "error",
      text: "Deleted 2 of 3 releases; failed: Title A",
    });
  });

  it("joins up to three titles", () => {
    expect(bulkSummary("Updated", outcome(0, ["A", "B", "C"]), 3).text).toBe(
      "Updated 0 of 3 releases; failed: A, B, C",
    );
  });

  it("truncates beyond three titles with 'and N more'", () => {
    expect(
      bulkSummary("Deleted", outcome(1, ["A", "B", "C", "D", "E"]), 6).text,
    ).toBe("Deleted 1 of 6 releases; failed: A, B, C and 2 more");
  });
});
