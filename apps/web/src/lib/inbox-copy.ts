/**
 * The exact strings for the incoming tray (#185). It lists releases from any of the owner's
 * devices, so each row carries a small, quiet origin label; the iPhone says the same in
 * `Copy.swift`. Sentence case, no capitals beyond the first letter.
 */

/** The tray's title, also its accessible name. */
export const INBOX_TITLE = "From your devices";

/** The label under a pending release: where it came from. Anything not known by name, such as a
 * client newer than this build, is "another device". */
export function originLabel(origin: string): string {
  if (origin === "ios") return "from your iPhone";
  if (origin === "web") return "from the web";
  return "from another device";
}

/** The iPhone is the one device that can answer a resync request today, so only it is named; any
 * other origin gets the generic wording (#172). */
function isPhone(origin: string): boolean {
  return origin === "ios";
}

/** The one quiet line at the bottom of the tray while some releases are still being sent (not an
 * error). The phone is named only when every arriving row came from it. */
export function sendingFooter(origins: string[]): string {
  const several = origins.length > 1;
  if (!origins.every(isPhone)) return several ? "Still sending these…" : "Still sending this one from that device…";
  return several ? "Still sending these from your phone…" : "Still sending this one from your phone…";
}

/** The words for a release whose files never reached the server (#172). */
export interface WaitingCopy {
  /** The headline state, under the origin label. */
  title: string;
  body: string;
  /** The button. */
  action: string;
  /** Shown in place of the button once the request went through. */
  asked: string;
  /** Shown when the request could not go through yet (the rate limit). */
  later: string;
}

/** The body names what is missing: an album's files, or a single's (a song). */
export function waitingCopy(origin: string, kind: "single" | "album" = "single"): WaitingCopy {
  const body = kind === "album" ? "This album's files never reached the server." : "This song's files never reached the server.";
  const later = "Try again in a few minutes.";
  if (isPhone(origin)) {
    return {
      title: "Waiting on your phone",
      body,
      action: "Resync Mac and phone",
      asked: "Asked your phone to send it again. Open Locally on your iPhone to finish.",
      later,
    };
  }
  return {
    title: "Waiting on that device",
    body,
    action: "Resync",
    asked: "Asked that device to send it again. Open Locally there to finish.",
    later,
  };
}
