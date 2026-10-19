import { describe, expect, it } from "vitest";
import { cloudPlaysAnnouncement, cloudPlaysLines, relativeChecked } from "../../src/lib/cloud-plays-copy";
import type { CloudPlaysStatus } from "../../src/shared/types";

const NOW = Date.UTC(2026, 9, 19, 12, 0, 0);
const base: CloudPlaysStatus = { available: true, linked: false, lastSampleAt: null, problem: null, pending: false };

describe("cloudPlaysLines (#307)", () => {
  it("off", () => {
    expect(cloudPlaysLines(base, NOW)).toEqual({
      state: "off",
      on: false,
      line: "Counts your plays on any device, even while this Mac sleeps. Spotify asks once, separately from this Mac's connection.",
      quiet: null,
      reconnect: false,
    });
  });

  it("pending", () => {
    expect(cloudPlaysLines({ ...base, pending: true }, NOW)).toMatchObject({
      state: "pending",
      on: true,
      line: "Finish linking in your browser…",
    });
  });

  it("linked with no problem, with the quiet line", () => {
    const out = cloudPlaysLines({ ...base, linked: true, lastSampleAt: new Date(NOW - 60_000).toISOString() }, NOW);
    expect(out.line).toBe("Counted online, even when this Mac is off. Last checked 1 min ago.");
    expect(out.quiet).toBe("A track skipped in its first minute may not count.");
    expect(out.on).toBe(true);
    expect(out.reconnect).toBe(false);
  });

  it("linked but never sampled", () => {
    expect(cloudPlaysLines({ ...base, linked: true }, NOW).line).toBe("Counted online, even when this Mac is off. Not checked yet.");
  });

  it.each([
    ["reconnect", "Online counting needs you to reconnect Spotify.", true],
    ["notOnTesterList", "This Spotify account isn't on the app's tester list.", false],
    ["rateLimited", "Spotify is busy; counting resumes in a few minutes.", false],
  ] as const)("%s", (problem, line, reconnect) => {
    const out = cloudPlaysLines({ ...base, linked: true, problem }, NOW);
    expect(out).toMatchObject({ state: problem, line, reconnect, quiet: null, on: true });
  });

  it("pending wins over a standing problem (reconnecting)", () => {
    expect(cloudPlaysLines({ ...base, linked: true, problem: "reconnect", pending: true }, NOW).state).toBe("pending");
  });
});

describe("relativeChecked", () => {
  it.each([
    [0, "Last checked just now"],
    [90_000, "Last checked 1 min ago"],
    [59 * 60_000, "Last checked 59 min ago"],
    [60 * 60_000, "Last checked 1 hour ago"],
    [5 * 3_600_000, "Last checked 5 hours ago"],
    [49 * 3_600_000, "Last checked 2 days ago"],
  ])("%i ms ago", (ago, text) => {
    expect(relativeChecked(new Date(NOW - ago).toISOString(), NOW)).toBe(text);
  });
  it("null and junk read as not checked", () => {
    expect(relativeChecked(null, NOW)).toBe("Not checked yet");
    expect(relativeChecked("nope", NOW)).toBe("Not checked yet");
  });
});

describe("cloudPlaysAnnouncement", () => {
  it.each([
    ["pending", "Finish linking in your browser."],
    ["linked", "Online counting is on."],
    ["reconnect", "Online counting needs you to reconnect Spotify."],
    ["notOnTesterList", "This Spotify account isn't on the app's tester list."],
    ["rateLimited", "Spotify is busy; counting resumes in a few minutes."],
    ["off", "Online counting is off."],
  ] as const)("%s", (state, text) => {
    expect(cloudPlaysAnnouncement(state)).toBe(text);
  });

  it("never carries the ticking last-checked text", () => {
    for (const s of ["pending", "linked", "reconnect", "notOnTesterList", "rateLimited", "off"] as const) {
      expect(cloudPlaysAnnouncement(s)).not.toMatch(/checked|ago/i);
    }
  });
});
