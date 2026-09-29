import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateLegacyConfig } from "../../../electron/lib/migrateConfig";

let legacy: string;
let target: string;

beforeEach(() => {
  legacy = fs.mkdtempSync(path.join(os.tmpdir(), "locally-"));
  target = fs.mkdtempSync(path.join(os.tmpdir(), "locally-"));
});

afterEach(() => {
  fs.rmSync(legacy, { recursive: true, force: true });
  fs.rmSync(target, { recursive: true, force: true });
});

describe("migrateLegacyConfig", () => {
  it("copies both files when the target is empty", () => {
    fs.writeFileSync(path.join(legacy, "settings.json"), '{"a":1}');
    fs.writeFileSync(path.join(legacy, "sync-state.json"), '{"b":2}');
    expect(migrateLegacyConfig(legacy, target).copied).toEqual(["settings.json", "sync-state.json"]);
    expect(fs.readFileSync(path.join(target, "settings.json"), "utf8")).toBe('{"a":1}');
    expect(fs.readFileSync(path.join(target, "sync-state.json"), "utf8")).toBe('{"b":2}');
  });

  it("locks the copies to the owner even when the source is world-readable", () => {
    fs.writeFileSync(path.join(legacy, "settings.json"), '{"deviceToken":"t"}', { mode: 0o644 });
    const nested = path.join(target, "nested");
    migrateLegacyConfig(legacy, nested);
    expect(fs.statSync(path.join(nested, "settings.json")).mode & 0o777).toBe(0o600);
    expect(fs.statSync(nested).mode & 0o777).toBe(0o700);
  });

  it("copies only settings.json when sync-state.json is missing", () => {
    fs.writeFileSync(path.join(legacy, "settings.json"), "{}");
    expect(migrateLegacyConfig(legacy, target).copied).toEqual(["settings.json"]);
    expect(fs.existsSync(path.join(target, "sync-state.json"))).toBe(false);
  });

  it("copies nothing when the target already has settings.json", () => {
    fs.writeFileSync(path.join(target, "settings.json"), "mine");
    fs.writeFileSync(path.join(legacy, "settings.json"), "old");
    fs.writeFileSync(path.join(legacy, "sync-state.json"), "old");
    expect(migrateLegacyConfig(legacy, target).copied).toEqual([]);
    expect(fs.readFileSync(path.join(target, "settings.json"), "utf8")).toBe("mine");
    expect(fs.existsSync(path.join(target, "sync-state.json"))).toBe(false);
  });

  it("leaves the legacy files unchanged", () => {
    fs.writeFileSync(path.join(legacy, "settings.json"), "keep");
    fs.writeFileSync(path.join(legacy, "sync-state.json"), "keep2");
    migrateLegacyConfig(legacy, target);
    expect(fs.readdirSync(legacy).sort()).toEqual(["settings.json", "sync-state.json"]);
    expect(fs.readFileSync(path.join(legacy, "settings.json"), "utf8")).toBe("keep");
    expect(fs.readFileSync(path.join(legacy, "sync-state.json"), "utf8")).toBe("keep2");
  });

  it("creates the target dir and copies nothing when the legacy dir is missing", () => {
    const missing = path.join(legacy, "nope");
    const nested = path.join(target, "nested", "cfg");
    expect(migrateLegacyConfig(missing, nested)).toEqual({ copied: [] });
    expect(fs.statSync(nested).isDirectory()).toBe(true);
  });
});
