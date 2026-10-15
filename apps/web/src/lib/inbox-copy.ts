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
