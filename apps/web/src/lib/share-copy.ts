/**
 * The exact strings and small pure rules for sharing (#146, #182): the Share popover, the tray's
 * "From your friends" rows, Settings' "Shared by you" and the delete confirm. Sentence case. The
 * iPhone (#183) says the same. Nothing here promises more than Locally does: "can't share it on"
 * only covers Locally's own sharing (the plan's honest limits).
 */
import { isPlausibleEmail, MAX_SHARE_RECIPIENTS, normalizeEmail, type SentShare } from "../shared/shares";

export const NOT_ON_LOCALLY = "Not on Locally yet";
export const LINK_ON_COPY = "Anyone with the link can download this";
export const LINK_SHOWN_ONCE = "Copy it now. Locally can't show this link again.";
export const RESHARE_OFF_COPY = "They can't share it on from Locally";
/** Revoking or deleting cannot take back what a person already added to their library. */
export const COPIES_STAY = "Copies already added stay.";
export const SIGN_IN_TO_SHARE = "Sign in to share";

/** "Shared with 3 people", "Shared with 1 person". */
export function sharedWithLabel(people: number): string {
  return `Shared with ${people} ${people === 1 ? "person" : "people"}`;
}

/** The sentence the delete confirm adds when a release is still shared (`people` > 0). */
export function deleteSharedLine(people: number, link: boolean): string | null {
  if (people > 0) return `It's shared with ${people} ${people === 1 ? "person" : "people"}. They'll lose access. ${COPIES_STAY}`;
  if (link) return `It has a share link. The link will stop working. ${COPIES_STAY}`;
  return null;
}

/** "from sam@example.com", the quiet origin line under a share from a friend. */
export function fromLabel(email: string): string {
  return `from ${email}`;
}

/** "30 Oct" in en-GB, from an ISO time. */
function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export type SentShareState = "live" | "revoked" | "expired";

export function sentShareState(share: Pick<SentShare, "revokedAt" | "expiresAt">, nowMs: number): SentShareState {
  if (share.revokedAt !== null) return "revoked";
  if (share.expiresAt !== null && Date.parse(share.expiresAt) <= nowMs) return "expired";
  return "live";
}

/** The expiry line in Settings: "Expires 30 Oct", "Never expires", "Revoked" or "Expired". */
export function expiryLabel(share: Pick<SentShare, "revokedAt" | "expiresAt">, nowMs: number): string {
  const state = sentShareState(share, nowMs);
  if (state === "revoked") return "Revoked";
  if (state === "expired") return "Expired";
  return share.expiresAt === null ? "Never expires" : `Expires ${shortDate(share.expiresAt)}`;
}

/** What the tray's trigger and rows call a share: the release's own title, or the artist when it has none. */
export function friendTitle(share: { title: string; artist: string }): string {
  return share.title || share.artist;
}

/** Splits typed or pasted text into emails at commas, spaces, semicolons and new lines. */
export function emailTokens(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map(normalizeEmail)
    .filter((t) => t.length > 0);
}

export interface AddResult {
  emails: string[];
  /** The first token that is not an email, or null. */
  invalid: string | null;
  /** More than the service takes per share. */
  full: boolean;
}

/** Adds the tokens in `text` to `current` (de-duplicated, in order). Stops at the first bad token. */
export function addEmails(current: string[], text: string): AddResult {
  const emails = [...current];
  for (const token of emailTokens(text)) {
    if (!isPlausibleEmail(token)) return { emails, invalid: token, full: false };
    if (emails.includes(token)) continue;
    if (emails.length >= MAX_SHARE_RECIPIENTS) return { emails, invalid: null, full: true };
    emails.push(token);
  }
  return { emails, invalid: null, full: false };
}

/** Adds a saved group's members to `current`, keeping order and skipping ones already there. */
export function addGroup(current: string[], members: string[]): string[] {
  return [...new Set([...current, ...members])].slice(0, MAX_SHARE_RECIPIENTS);
}

/** The service's own words for a refusal, in ours. */
export function shareErrorCopy(message: string): string {
  if (message === "public_links_disabled") return "Share links are switched off right now.";
  return message;
}

/** The popover's heading after a reply: who it reached. */
export function sharedHeading(result: { share: { recipients: unknown[] } | null }): string {
  if (!result.share) return "Nothing shared yet";
  return result.share.recipients.length > 0 ? sharedWithLabel(result.share.recipients.length) : "Link ready";
}

/** The Link option shows only when `GET /v1/me` says public links are on (the plan's kill switch). */
export function showLinkOption(publicSharesEnabled: boolean | undefined): boolean {
  return publicSharesEnabled === true;
}
