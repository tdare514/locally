import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { planSettingsUpdate } from "../../src/server/config/settingsUpdate";
import type { Settings, SyncSettings } from "../../src/shared/types";

// Fake home under the OS temp dir: the policy takes homeDir as a parameter, so the real
// home directory is never read.
const home = path.join(os.tmpdir(), "sli-fake-home");

const signedIn: SyncSettings = {
  baseUrl: "https://sync.example.com",
  deviceToken: "tok",
  email: "a@b.c",
  lastVersion: 3,
} as SyncSettings;

function current(overrides: Partial<Settings> = {}): Settings {
  return { libraryDir: path.join(home, "Music", "Lib"), sync: null, ...overrides };
}

function ok(result: ReturnType<typeof planSettingsUpdate>) {
  if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
  return result;
}

describe("planSettingsUpdate libraryDir", () => {
  it("expands a leading ~/ against the injected home dir", () => {
    const r = ok(planSettingsUpdate(current(), { libraryDir: "~/Music/New" }, home));
    expect(r.settings.libraryDir).toBe(path.join(home, "Music", "New"));
  });

  it("refuses a bare ~ (the home dir itself)", () => {
    const r = planSettingsUpdate(current(), { libraryDir: "~" }, home);
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toContain("dedicated folder");
  });

  it("refuses a relative path", () => {
    const r = planSettingsUpdate(current(), { libraryDir: "Music/Lib" }, home);
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toContain("absolute path");
  });

  it("refuses the home dir and the filesystem root", () => {
    expect(planSettingsUpdate(current(), { libraryDir: home }, home).ok).toBe(false);
    expect(planSettingsUpdate(current(), { libraryDir: path.parse(home).root }, home).ok).toBe(false);
  });

  it("normalises the path", () => {
    const r = ok(planSettingsUpdate(current(), { libraryDir: path.join(home, "a", "..", "Lib2") }, home));
    expect(r.settings.libraryDir).toBe(path.join(home, "Lib2"));
  });

  it("resets spotifySourceDismissed when the library changes", () => {
    const r = ok(
      planSettingsUpdate(current({ spotifySourceDismissed: true }), { libraryDir: path.join(home, "Other") }, home)
    );
    expect(r.settings.spotifySourceDismissed).toBe(false);
  });

  it("keeps spotifySourceDismissed when the library is unchanged", () => {
    const c = current({ spotifySourceDismissed: true });
    const r = ok(planSettingsUpdate(c, { libraryDir: c.libraryDir }, home));
    expect(r.settings.spotifySourceDismissed).toBe(true);
  });
});

describe("planSettingsUpdate sync.baseUrl", () => {
  it("resets sync state and signs out on a host change, keeping the dismissed flag", () => {
    const c = current({ sync: signedIn, spotifySourceDismissed: true });
    const r = ok(planSettingsUpdate(c, { sync: { baseUrl: "https://other.example.com" } }, home));
    expect(r.resetSyncState).toBe(true);
    expect(r.settings.sync?.baseUrl).toBe("https://other.example.com");
    expect(r.settings.sync?.deviceToken).toBeFalsy();
    expect(r.settings.spotifySourceDismissed).toBe(true);
    expect(r.settings.libraryDir).toBe(c.libraryDir);
  });

  it("does not reset sync state when the same base URL is re-sent", () => {
    const r = ok(planSettingsUpdate(current({ sync: signedIn }), { sync: { baseUrl: signedIn.baseUrl } }, home));
    expect(r.resetSyncState).toBe(false);
    expect(r.settings.sync).toEqual(signedIn);
  });

  it("does not reset sync state for a libraryDir-only change", () => {
    const r = ok(planSettingsUpdate(current({ sync: signedIn }), { libraryDir: path.join(home, "Other") }, home));
    expect(r.resetSyncState).toBe(false);
  });

  it("rejects an invalid base URL", () => {
    expect(planSettingsUpdate(current(), { sync: { baseUrl: "not a url" } }, home).ok).toBe(false);
  });
});

describe("planSettingsUpdate empty body", () => {
  it("refuses when neither field is given", () => {
    const r = planSettingsUpdate(current(), {}, home);
    expect(r).toMatchObject({ ok: false, error: "Nothing to update: pass libraryDir and/or sync.baseUrl" });
  });
});
