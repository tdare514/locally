import { describe, expect, it } from "vitest";
import { arrivingLine, INBOX_TITLE, originLabel, waitingCopy } from "../../src/lib/inbox-copy";

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

describe("files missing copy (#172)", () => {
  it("says a phone release is still arriving, in the owner's words", () => {
    expect(arrivingLine("ios")).toBe("Still arriving from your phone…");
  });

  it("uses the phone wording for the iPhone", () => {
    expect(waitingCopy("ios")).toEqual({
      title: "Waiting on your phone",
      body: "This song's files never reached the server.",
      action: "Resync Mac and phone",
      asked: "Asked your phone to send it again. Open Locally on your iPhone to finish.",
      later: "Try again in a few minutes.",
    });
  });

  it("is generic for the web and any origin it has no name for", () => {
    for (const origin of ["web", "future-thing", ""]) {
      const copy = waitingCopy(origin);
      expect(copy.title, origin).toBe("Waiting on that device");
      expect(copy.action, origin).toBe("Resync");
      expect(copy.asked, origin).toBe("Asked that device to send it again. Open Locally there to finish.");
      expect(arrivingLine(origin), origin).toBe("Still arriving from that device…");
      expect(copy.body, origin).toBe("This song's files never reached the server.");
    }
  });

  it("is sentence case, with no all-capitals labels", () => {
    for (const origin of ["ios", "web"]) {
      const lines = [arrivingLine(origin), ...Object.values(waitingCopy(origin))];
      for (const line of lines) {
        expect(line, line).not.toBe(line.toUpperCase());
      }
    }
  });
});
