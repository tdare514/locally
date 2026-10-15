import { describe, expect, it } from "vitest";
import { INBOX_TITLE, originLabel, sendingFooter, waitingCopy } from "../../src/lib/inbox-copy";

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
  it("says a phone release is still being sent, in the owner's words", () => {
    expect(sendingFooter(["ios"])).toBe("Still sending this one from your phone…");
    expect(sendingFooter(["ios", "ios"])).toBe("Still sending these from your phone…");
  });

  it("names no phone when any arriving row came from another device", () => {
    expect(sendingFooter(["web"])).toBe("Still sending this one from that device…");
    expect(sendingFooter(["ios", "web"])).toBe("Still sending these…");
    expect(sendingFooter(["web", "future-thing"])).toBe("Still sending these…");
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

  it("names an album's files for an album and a song's for a single", () => {
    expect(waitingCopy("ios", "album").body).toBe("This album's files never reached the server.");
    expect(waitingCopy("web", "album").body).toBe("This album's files never reached the server.");
    expect(waitingCopy("ios", "single").body).toBe("This song's files never reached the server.");
  });

  it("is generic for the web and any origin it has no name for", () => {
    for (const origin of ["web", "future-thing", ""]) {
      const copy = waitingCopy(origin);
      expect(copy.title, origin).toBe("Waiting on that device");
      expect(copy.action, origin).toBe("Resync");
      expect(copy.asked, origin).toBe("Asked that device to send it again. Open Locally there to finish.");
      expect(sendingFooter([origin]), origin).toBe("Still sending this one from that device…");
      expect(copy.body, origin).toBe("This song's files never reached the server.");
    }
  });

  it("is sentence case, with no all-capitals labels", () => {
    for (const origin of ["ios", "web"]) {
      const lines = [sendingFooter([origin]), sendingFooter([origin, origin]), ...Object.values(waitingCopy(origin))];
      for (const line of lines) {
        expect(line, line).not.toBe(line.toUpperCase());
      }
    }
  });
});
