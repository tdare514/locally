import { describe, expect, it } from "vitest";
import { INBOX_TITLE, originLabel } from "../../src/lib/inbox-copy";

describe("incoming tray copy (#185)", () => {
  it("is titled 'From your devices'", () => {
    expect(INBOX_TITLE).toBe("From your devices");
  });

  it("labels a release by where it came from, matching the iPhone", () => {
    expect(originLabel("ios")).toBe("from your iPhone");
    expect(originLabel("web")).toBe("from the web");
  });

  it("says 'another device' for any origin it has no name for", () => {
    for (const origin of ["future-thing", "android", "mac", ""]) {
      expect(originLabel(origin), JSON.stringify(origin)).toBe("from another device");
    }
  });

  it("reads as a quiet caption: starts with 'from', no full stop, no uppercase styling", () => {
    for (const origin of ["ios", "web", "other"]) {
      const label = originLabel(origin);
      expect(label.startsWith("from ")).toBe(true);
      expect(label.endsWith(".")).toBe(false);
      expect(label).not.toBe(label.toUpperCase());
    }
  });
});
