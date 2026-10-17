/**
 * Pure logic for the Mac's "From your devices" tray in sections (#295): which rows are ready and
 * which are waiting, the second section's words by origin mix, hidden rows by server version, the
 * run reservations, and where focus goes when a row leaves. The component holds only state.
 */
import type { PendingFromPhone } from "../shared/types";

/** The token that says which server version of a pending record was hidden. The record's server
 * version when it has one, else its `updatedAt` (a record saved before versions were kept). */
export function hideKeyFor(record: { version?: unknown; updatedAt: string }): string {
  return typeof record.version === "number" ? `v${record.version}` : `u${record.updatedAt}`;
}

/** Drops the rows hidden on this Mac at the version they have now; a newer version shows again. */
export function visiblePending(pending: PendingFromPhone[], hidden: Record<string, string>): PendingFromPhone[] {
  return pending.filter((p) => !(p.hideKey !== undefined && hidden[p.id] === p.hideKey));
}

/** On the Mac a row is ready only when its audio is on the server: no files state, or `ready`. */
export function isReady(p: PendingFromPhone): boolean {
  return p.filesState !== "arriving" && p.filesState !== "waiting";
}

export interface TraySections {
  ready: PendingFromPhone[];
  /** Waiting rows first, then the ones still sending, each in the order they came. */
  other: PendingFromPhone[];
}

/** The two groups never overlap: every row is in exactly one. */
export function traySections(pending: PendingFromPhone[]): TraySections {
  const ready = pending.filter(isReady);
  const waiting = pending.filter((p) => p.filesState === "waiting");
  const arriving = pending.filter((p) => p.filesState === "arriving");
  return { ready, other: [...waiting, ...arriving] };
}

/** Add all shows from two ready rows. */
export function showAddAll(ready: PendingFromPhone[]): boolean {
  return ready.length >= 2;
}

/** Try all again shows while any row is waiting. */
export function showTryAllAgain(other: PendingFromPhone[]): boolean {
  return other.some((p) => p.filesState === "waiting");
}

export interface OtherSectionCopy {
  name: string;
  line: string;
  asked: string;
  later: string;
}

/** The second section's name and lines by where its rows came from: only the iPhone, one other
 * device, or a mix. */
export function otherSectionCopy(rows: PendingFromPhone[]): OtherSectionCopy {
  const origins = new Set(rows.map((p) => p.origin));
  const later = "Try again in a few minutes.";
  if (origins.size <= 1 && origins.has("ios")) {
    return {
      name: "Waiting on your iPhone",
      line: "Their audio hasn't arrived yet. Open Locally on your iPhone to finish sending them.",
      asked: "Asked your iPhone to send them again.",
      later,
    };
  }
  if (origins.size === 1) {
    return {
      name: "Waiting on that device",
      line: "Their audio hasn't arrived yet. Open Locally on that device to finish sending them.",
      asked: "Asked that device to send them again.",
      later,
    };
  }
  return {
    name: "Waiting on your devices",
    line: "Their audio hasn't arrived yet. Open Locally on those devices to finish sending them.",
    asked: "Asked your devices to send them again.",
    later,
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "27 Sep" for the compact rows' "since" part; empty when the time is missing or unreadable. */
export function sinceLabel(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** "kwaylone, 1 track, since 27 Sep" for a compact row. */
export function compactSubline(p: PendingFromPhone): string {
  const parts = [p.artist, `${p.trackCount} track${p.trackCount === 1 ? "" : "s"}`].filter(Boolean);
  const since = sinceLabel(p.sentAt);
  return since ? `${parts.join(", ")}, since ${since}` : parts.join(", ");
}

/**
 * Which releases are being sent right now, so a send never starts twice for the same one,
 * whichever control asked. `reserve` returns the ids that were free and are now held.
 */
export class Reservations {
  private readonly held = new Set<string>();

  reserve(ids: string[]): string[] {
    const taken: string[] = [];
    for (const id of ids) {
      if (this.held.has(id)) continue;
      this.held.add(id);
      taken.push(id);
    }
    return taken;
  }

  release(id: string): void {
    this.held.delete(id);
  }

  has(id: string): boolean {
    return this.held.has(id);
  }
}

/**
 * Add all: reserves the ids as they are now, then sends them one at a time, releasing each when
 * its turn ends (sent or failed). Returns the ids reserved. A row already held by another send is
 * left to that send.
 */
export async function runOneAtATime(
  reservations: Reservations,
  ids: string[],
  send: (id: string) => Promise<unknown>,
  onReserved: (ids: string[]) => void,
  onReleased: (id: string) => void
): Promise<string[]> {
  const mine = reservations.reserve(ids);
  onReserved(mine);
  for (const id of mine) {
    try {
      await send(id);
    } catch {
      // The sender reports its own failure; the run goes on to the next row.
    } finally {
      reservations.release(id);
      onReleased(id);
    }
  }
  return mine;
}

export type FocusTarget = { kind: "row"; id: string } | { kind: "header" } | { kind: "tray" };

/**
 * Where focus goes when a row leaves with focus on its own control: the next row's control, else
 * the previous row's, else the section's header action, else the tray heading. `rows` is every row
 * in tray order; `hasControl` is false for rows that cannot take focus now (sending, leaving, or
 * with nothing to press).
 */
export function focusAfterLeave(
  rows: { id: string; hasControl: boolean }[],
  leavingId: string,
  headerActionAvailable: boolean
): FocusTarget {
  const at = rows.findIndex((r) => r.id === leavingId);
  const after = rows.slice(at + 1).find((r) => r.id !== leavingId && r.hasControl);
  if (at >= 0 && after) return { kind: "row", id: after.id };
  const before = [...rows.slice(0, Math.max(at, 0))].reverse().find((r) => r.hasControl);
  if (before) return { kind: "row", id: before.id };
  return headerActionAvailable ? { kind: "header" } : { kind: "tray" };
}

const INTERACTIVE =
  'a, button, input, select, textarea, summary, label, [role="button"], [role="link"], [role="menuitem"], [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

/** True when a press landed on empty space, not on a control that will take focus itself. */
export function landedOnEmptySpace(target: { closest(selector: string): unknown } | null): boolean {
  return target === null || target.closest(INTERACTIVE) === null;
}
