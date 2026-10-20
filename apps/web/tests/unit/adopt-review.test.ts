import { describe, expect, it, vi } from "vitest";
import type { ProposedGroup } from "../../src/server/adopt/types";
import type { Release } from "../../src/shared/types";
import {
  addLabel,
  addingLabel,
  chunk,
  folderAfterRoot,
  formatLength,
  foundLine,
  foundTitle,
  groupForReview,
  groupTickState,
  hideAdded,
  kindLabel,
  lastCheckedLine,
  NO_ANSWER_MESSAGE,
  partialLine,
  runAdoption,
  skippedLines,
  skippedTitle,
  tildePath,
  toggleGroupTicks,
  unreadableLine,
  type AdoptBatchResponse,
} from "../../src/lib/adopt-review";

const ROOT = "/Users/me/Spotify Music";

function group(key: string, folder: string, extra: Partial<ProposedGroup> = {}): ProposedGroup {
  return {
    key, folder, kind: "album", title: `T ${key}`, artist: "A", year: null, genre: null, coverFrom: null,
    tracks: [{ path: `${folder}/1.mp3`, title: "x", trackNumber: 1, durationSec: 10, localId: "l" }],
    ...extra,
  };
}

describe("groupForReview", () => {
  it("groups by the first folder under each root and keeps the rest as the subfolder", () => {
    const groups = [
      group("a", `${ROOT}/Masters/Summer EP`),
      group("b", `${ROOT}/Masters/Winter/CD1`),
      group("c", `${ROOT}/Unmastered/Demo`),
      group("d", `${ROOT}/Masters`),
    ];
    const out = groupForReview([ROOT], groups);
    expect(out.map((g) => g.name)).toEqual(["Masters", "Unmastered"]);
    const masters = out[0].rows.map((r) => [r.group.key, r.subfolder]);
    expect(masters).toEqual([["d", ""], ["a", "Summer EP"], ["b", "Winter/CD1"]]);
  });

  it("puts files straight in a root under the root's own name", () => {
    const out = groupForReview([ROOT], [group("a", ROOT), group("b", `${ROOT}/Masters/X`)]);
    expect(out.map((g) => g.name)).toEqual(["Masters", "Spotify Music"]);
    expect(out[1].rows[0].subfolder).toBe("");
  });

  it("orders groups by root order, then name, and keeps two roots with the same first folder apart", () => {
    const other = "/Volumes/Old";
    const out = groupForReview([other, ROOT], [
      group("a", `${ROOT}/Masters/X`),
      group("b", `${other}/Masters/Y`),
      group("c", `${other}/Archive/Z`),
    ]);
    expect(out.map((g) => g.name)).toEqual(["Archive", "Masters", "Masters"]);
    expect(out[1].rows[0].group.key).toBe("b");
    expect(out[2].rows[0].group.key).toBe("a");
  });

  it("uses the longest root when roots are nested", () => {
    const inner = `${ROOT}/Masters`;
    const out = groupForReview([ROOT, inner], [group("a", `${inner}/Summer EP`)]);
    expect(out[0].name).toBe("Summer EP");
    expect(out[0].rows[0].subfolder).toBe("");
  });

  it("does not treat a sibling with the same prefix as inside a root", () => {
    const out = groupForReview([ROOT], [group("a", `${ROOT} 2/Masters/X`)]);
    expect(out[0].name).toBe("X");
    expect(out[0].rows[0].subfolder).toBe("");
  });
});

describe("hideAdded", () => {
  it("drops the groups whose key matches a library release's adoptKey", () => {
    const releases = [{ adoptKey: "a" }, {}] as Release[];
    expect(hideAdded([group("a", ROOT), group("b", ROOT)], releases).map((g) => g.key)).toEqual(["b"]);
  });
});

describe("ticks", () => {
  const keys = ["a", "b", "c"];
  it("reads all, none and mixed", () => {
    expect(groupTickState(keys, new Set(keys))).toBe("all");
    expect(groupTickState(keys, new Set())).toBe("none");
    expect(groupTickState(keys, new Set(["b"]))).toBe("mixed");
  });
  it("ticks all from mixed or none and unticks all from all, leaving other groups alone", () => {
    expect([...toggleGroupTicks(keys, new Set(["a", "z"]))].sort()).toEqual(["a", "b", "c", "z"]);
    expect([...toggleGroupTicks(keys, new Set())].sort()).toEqual(keys);
    expect([...toggleGroupTicks(keys, new Set([...keys, "z"]))]).toEqual(["z"]);
  });
});

describe("chunk", () => {
  it("splits into batches of the size, the last one shorter", () => {
    const parts = chunk(Array.from({ length: 45 }, (_, i) => i), 20);
    expect(parts.map((p) => p.length)).toEqual([20, 20, 5]);
    expect(chunk([], 20)).toEqual([]);
  });
});

describe("runAdoption", () => {
  const keys = Array.from({ length: 45 }, (_, i) => `k${i}`);
  const ok = (batch: string[]): AdoptBatchResponse => ({
    releases: batch.map((adoptKey) => ({ adoptKey })), alreadyAdopted: [], unknown: [], failed: [],
  });

  it("sends 20 at a time, one after another, and reports progress", async () => {
    const sizes: number[] = [];
    let inFlight = 0;
    const progress: number[] = [];
    const run = await runAdoption({
      keys,
      send: async (batch) => {
        inFlight++;
        expect(inFlight).toBe(1);
        sizes.push(batch.length);
        await Promise.resolve();
        inFlight--;
        return ok(batch);
      },
      onProgress: (done) => progress.push(done),
    });
    expect(sizes).toEqual([20, 20, 5]);
    expect(progress).toEqual([0, 20, 40, 45]);
    expect(run.added.size).toBe(45);
    expect(run.failed.size).toBe(0);
    expect(run.stopped).toBe(false);
  });

  it("counts alreadyAdopted as added and keeps failed ones with their message", async () => {
    const run = await runAdoption({
      keys: ["a", "b", "c", "d"],
      send: async () => ({
        releases: [{ adoptKey: "a" }], alreadyAdopted: ["b"], unknown: [], failed: [{ key: "c", message: "Disk is full" }],
      }),
    });
    expect([...run.added].sort()).toEqual(["a", "b"]);
    expect(run.failed.get("c")).toBe("Disk is full");
    // "d" was not mentioned in the answer: not claimed as added.
    expect(run.failed.get("d")).toBe(NO_ANSWER_MESSAGE);
  });

  it("fails a batch with no answer, goes on with the next, and a retry of just those succeeds", async () => {
    let call = 0;
    const run = await runAdoption({
      keys,
      send: async (batch) => {
        call++;
        if (call === 2) throw new Error("network");
        return ok(batch);
      },
    });
    expect(run.added.size).toBe(25);
    expect(run.failed.size).toBe(20);
    expect([...run.failed.values()].every((m) => m === NO_ANSWER_MESSAGE)).toBe(true);
    const retry = await runAdoption({ keys: [...run.failed.keys()], send: async (b) => ({ ...ok([]), alreadyAdopted: b }) });
    expect(retry.added.size).toBe(20);
    expect(retry.failed.size).toBe(0);
  });

  it("sends no more batches once shouldContinue says no", async () => {
    const send = vi.fn(async (b: string[]) => ok(b));
    let allowed = true;
    const run = await runAdoption({
      keys,
      send: async (b) => {
        const res = await send(b);
        allowed = false;
        return res;
      },
      shouldContinue: () => allowed,
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(run.stopped).toBe(true);
    expect(run.added.size).toBe(20);
  });
});

describe("copy", () => {
  it("counts and pluralises", () => {
    expect(foundTitle(214)).toBe("Found 214 releases");
    expect(foundTitle(1)).toBe("Found 1 release");
    expect(foundLine([group("a", ROOT)], 1)).toBe("1 track in 1 folder. Locally adds their details and leaves the files where they are.");
    expect(addLabel(212)).toBe("Add 212 to your library");
    expect(addLabel(1)).toBe("Add 1 to your library");
    expect(addingLabel(40, 212)).toBe("Adding 40 of 212…");
    expect(partialLine(210, 212, 2)).toBe("Added 210 of 212. 2 couldn't be added.");
    expect(kindLabel({ kind: "single", tracks: [] })).toBe("Single");
    expect(kindLabel(group("a", ROOT))).toBe("Album, 1 track");
  });

  it("lists skipped files by type", () => {
    expect(skippedTitle({ ".flac": 2, ".wav": 1 })).toBe("3 files skipped");
    expect(skippedTitle({ ".wav": 1 })).toBe("1 file skipped");
    expect(skippedLines({ ".wav": 1, ".flac": 2 })).toEqual(["2 .flac files", "1 .wav file"]);
  });

  it("writes the home folder as ~ in an unreadable folder line", () => {
    expect(tildePath("/Users/me/Music/Old")).toBe("~/Music/Old");
    expect(unreadableLine("/Users/me/Music/Old")).toBe(
      "Couldn't read ~/Music/Old. Check it's still there and that Locally may open it."
    );
    expect(tildePath("/Volumes/Old")).toBe("/Volumes/Old");
  });

  it("says today, yesterday or the date for the last check", () => {
    const now = new Date(2026, 9, 16, 15, 0);
    const at = (d: number, h: number, m: number) => new Date(2026, 9, d, h, m).toISOString();
    expect(lastCheckedLine(at(16, 14, 2), now, "en-GB")).toBe("Last checked today at 14:02");
    expect(lastCheckedLine(at(15, 9, 5), now, "en-GB")).toBe("Last checked yesterday at 09:05");
    expect(lastCheckedLine(at(10, 9, 5), now, "en-GB")).toBe("Last checked on 10 Oct at 09:05");
    expect(lastCheckedLine("nonsense", now)).toBe("");
  });

  it("gives the folder after the Spotify folder for the release page", () => {
    expect(folderAfterRoot([ROOT], `${ROOT}/Masters/Summer EP`)).toBe("Masters/Summer EP");
    expect(folderAfterRoot([ROOT], ROOT)).toBe("Spotify Music");
    expect(folderAfterRoot([ROOT], "/elsewhere/x")).toBeNull();
  });
});

describe("formatLength", () => {
  it("writes minutes and seconds, and hours when needed", () => {
    expect(formatLength(187)).toBe("3:07");
    expect(formatLength(59.6)).toBe("1:00");
    expect(formatLength(3729)).toBe("1:02:09");
    expect(formatLength(0)).toBe("0:00");
  });
});
