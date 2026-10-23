import { describe, expect, it } from "vitest";
import {
  NOT_ON_LOCALLY,
  addEmails,
  addGroup,
  deleteSharedLine,
  emailTokens,
  expiryLabel,
  fromLabel,
  sentShareState,
  sharedHeading,
  sharedWithLabel,
  showLinkOption,
} from "../../src/lib/share-copy";
import { parseShareGroups } from "../../src/shared/shares";

describe("share copy", () => {
  it("says people in the plural and person for one", () => {
    expect(sharedWithLabel(3)).toBe("Shared with 3 people");
    expect(sharedWithLabel(1)).toBe("Shared with 1 person");
    expect(sharedHeading({ share: { recipients: [1, 2, 3] } })).toBe("Shared with 3 people");
    expect(sharedHeading({ share: { recipients: [1] } })).toBe("Shared with 1 person");
    expect(sharedHeading({ share: null })).toBe("Nothing shared yet");
  });

  it("uses the exact not-on-Locally words", () => {
    expect(NOT_ON_LOCALLY).toBe("Not on Locally yet");
  });

  it("shows the Link option only when the service says public links are on", () => {
    expect(showLinkOption(true)).toBe(true);
    expect(showLinkOption(false)).toBe(false);
    expect(showLinkOption(undefined)).toBe(false);
  });

  it("adds the shared-people line to the delete confirm", () => {
    expect(deleteSharedLine(3, false)).toBe("It's shared with 3 people. They'll lose access.");
    expect(deleteSharedLine(1, false)).toBe("It's shared with 1 person. They'll lose access.");
    expect(deleteSharedLine(0, false)).toBeNull();
  });

  it("labels a sent share's expiry and state", () => {
    const now = Date.parse("2026-10-23T12:00:00Z");
    expect(expiryLabel({ revokedAt: null, expiresAt: null }, now)).toBe("Never expires");
    expect(expiryLabel({ revokedAt: null, expiresAt: "2026-10-30T12:00:00Z" }, now)).toBe("Expires 30 Oct");
    expect(expiryLabel({ revokedAt: null, expiresAt: "2026-10-22T12:00:00Z" }, now)).toBe("Expired");
    expect(expiryLabel({ revokedAt: "2026-10-22T12:00:00Z", expiresAt: null }, now)).toBe("Revoked");
    expect(sentShareState({ revokedAt: null, expiresAt: null }, now)).toBe("live");
  });

  it("words the tray's origin line", () => {
    expect(fromLabel("sam@example.com")).toBe("from sam@example.com");
  });

  it("turns typed text into de-duplicated emails and stops at a bad one", () => {
    expect(emailTokens(" A@b.co, c@d.io;e@f.org ")).toEqual(["a@b.co", "c@d.io", "e@f.org"]);
    expect(addEmails(["a@b.co"], "A@b.co c@d.io").emails).toEqual(["a@b.co", "c@d.io"]);
    expect(addEmails([], "nope").invalid).toBe("nope");
    expect(addGroup(["a@b.co"], ["a@b.co", "z@y.xx"])).toEqual(["a@b.co", "z@y.xx"]);
  });

  it("keeps only well-formed saved groups", () => {
    const groups = parseShareGroups([
      { id: "1", name: " Band ", emails: ["A@b.co", "bad", "a@b.co"] },
      { id: "2", name: "", emails: ["x@y.zz"] },
      { id: "3", name: "Empty", emails: [] },
      "junk",
    ]);
    expect(groups).toEqual([{ id: "1", name: "Band", emails: ["a@b.co"] }]);
  });
});
