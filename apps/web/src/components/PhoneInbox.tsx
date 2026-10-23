"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { INBOX_TITLE, originLabel } from "../lib/inbox-copy";
import {
  Reservations,
  sinceLabel,
  focusAfterLeave,
  landedOnEmptySpace,
  otherSectionCopy,
  runOneAtATime,
  showAddAll,
  showTryAllAgain,
  traySections,
  visiblePending,
} from "../lib/tray-sections";
import type { PendingFromPhone } from "../shared/types";
import type { FriendShare } from "../shared/shares";
import { friendCoverUrl } from "../lib/api-client";
import { friendTitle, fromLabel } from "../lib/share-copy";
import { CloudDownIcon, EyeOffIcon, MusicNoteIcon, PlusIcon, XIcon } from "./Icons";

/** Matches the .phone-tray exit transition in globals.css. */
const EXIT_MS = 200;

/** How "Try all again" went: asked the other devices, couldn't yet (rate limit), or failed (a toast says why). */
export type ResyncOutcome = "asked" | "later" | "failed";

interface PhoneInboxProps {
  pending: PendingFromPhone[];
  /** Releases hidden on this Mac, by id and the version hidden (#295). */
  hidden?: Record<string, string>;
  /** Resolves true when the release was imported; false brings the row back. */
  onAccept: (id: string) => Promise<boolean>;
  /** Hides a waiting release from this tray; resolves true once it is hidden. */
  onHide: (id: string) => Promise<boolean>;
  /** Reconciles, then asks the other devices to upload again. */
  onResync: () => Promise<ResyncOutcome>;
  /** Shares from friends not claimed yet (#182): the "From your friends" section. */
  friends?: FriendShare[];
  /** Claims, downloads and imports a share; resolves true when it was added. */
  onAcceptFriend?: (id: string) => Promise<boolean>;
  /** Dismisses a share from the tray; resolves true once it is gone. */
  onDismissFriend?: (id: string) => Promise<boolean>;
}

function triggerLabel(count: number, open: boolean, friends: number): string {
  const base =
    count === 0
      ? "Nothing from your devices or friends"
      : friends === 0
        ? `${count} release${count === 1 ? "" : "s"} from your devices`
        : `${count} release${count === 1 ? "" : "s"} from your devices and friends`;
  return open ? `${base}, close` : base;
}

/** Round inbox button in the pane's top-right corner that opens a "From your devices" tray. */
export default function PhoneInbox({
  pending: allPending,
  hidden = {},
  onAccept,
  onHide,
  onResync,
  friends = [],
  onAcceptFriend,
  onDismissFriend,
}: PhoneInboxProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  // Rows held by a run or a single press: sending look, own controls off, until their turn ends.
  const [reserved, setReserved] = useState<Set<string>>(new Set());
  const [addingAll, setAddingAll] = useState(false);
  const [resyncing, setResyncing] = useState(false);
  // The request goes to the whole account, so one press answers every waiting row.
  const [outcome, setOutcome] = useState<"asked" | "later" | null>(null);
  const panelId = useId();
  const headingId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const reservations = useRef(new Reservations());
  const focusedRow = useRef<string | null>(null);
  // The newest render's values, for the turns of a run that started on an older one.
  const latest = useRef({ ready: [] as PendingFromPhone[], other: [] as PendingFromPhone[], leaving: new Set<string>(), addingAll: false, resyncing: false });

  const pending = useMemo(() => visiblePending(allPending, hidden), [allPending, hidden]);
  const count = pending.length + friends.length;
  const { ready, other } = traySections(pending);
  const copy = otherSectionCopy(other);
  useEffect(() => {
    latest.current = { ready, other, leaving, addingAll, resyncing };
  });

  // The panel renders while open or mounted: focus it on open; on close keep it mounted for its
  // exit, then unmount.
  useEffect(() => {
    if (open) {
      panelRef.current?.focus({ preventScroll: true });
      return;
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => setMounted(false), reduced ? 0 : EXIT_MS + 40);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    }
    // A press outside the tray closes it. The cloud button toggles on its own. Focus goes back to
    // the cloud only when the press landed on empty space; a control that was pressed takes focus
    // and acts as it would have.
    function onPointerDown(e: PointerEvent) {
      const target = e.target instanceof Node ? e.target : null;
      if (!target) return;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
      const el = target instanceof Element ? target : target.parentElement;
      // After the press has moved focus (to the body, for empty space).
      if (landedOnEmptySpace(el)) window.setTimeout(() => triggerRef.current?.focus(), 0);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [open]);

  function toggle() {
    if (open) triggerRef.current?.focus();
    else setMounted(true);
    setOpen(!open);
  }

  function markReserved(ids: string[]) {
    if (ids.length === 0) return;
    setReserved((prev) => new Set([...prev, ...ids]));
  }

  function markReleased(id: string) {
    setReserved((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function unleave(id: string) {
    setLeaving((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  /** The row starts to leave; if focus was on its own control it moves on first (next row, previous,
   * the section's header action, the tray heading). Focus anywhere else stays where it is. */
  function startLeaving(id: string) {
    const panel = panelRef.current;
    const rowEl = panel?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"]`);
    const active = document.activeElement;
    const hadFocus =
      !!rowEl && (rowEl.contains(active) || (active === document.body && focusedRow.current === id));
    setLeaving((prev) => new Set(prev).add(id));
    if (!panel || !hadFocus) return;
    const { ready, other, leaving: gone, addingAll, resyncing } = latest.current;
    const inReady = ready.some((p) => p.id === id);
    const rest = (inReady ? ready : other.filter((p) => p.filesState === "waiting")).filter((p) => p.id !== id);
    const headerAvailable = inReady ? showAddAll(rest) && !addingAll : showTryAllAgain(rest) && !resyncing;
    const target = focusAfterLeave(
      [...ready, ...other].map((p) => ({
        id: p.id,
        hasControl:
          p.id !== id &&
          p.filesState !== "arriving" &&
          !gone.has(p.id) &&
          !reservations.current.has(p.id),
      })),
      id,
      headerAvailable
    );
    let el: HTMLElement | null = null;
    if (target.kind === "row") el = panel.querySelector(`[data-row-id="${CSS.escape(target.id)}"] [data-row-control]`);
    else if (target.kind === "header") {
      el = panel.querySelector(`[data-section="${inReady ? "ready" : "other"}"] [data-header-action]`);
    }
    (el ?? document.getElementById(headingId))?.focus({ preventScroll: true });
  }

  /** One release's turn: it collapses out, and comes back if the send fails. */
  async function sendOne(id: string) {
    startLeaving(id);
    if (await onAccept(id)) return;
    unleave(id);
  }

  /** The sleeve: a send never starts for a release that is already being sent. */
  async function send(id: string) {
    const taken = reservations.current.reserve([id]);
    if (taken.length === 0) return;
    markReserved(taken);
    try {
      await sendOne(id);
    } finally {
      reservations.current.release(id);
      markReleased(id);
    }
  }

  /** Add all: the ready rows as they are now, one at a time. */
  async function addAll() {
    const snapshot = ready.map((p) => p.id);
    setAddingAll(true);
    try {
      await runOneAtATime(reservations.current, snapshot, sendOne, markReserved, markReleased);
    } finally {
      setAddingAll(false);
    }
  }

  async function hide(id: string) {
    const taken = reservations.current.reserve([id]);
    if (taken.length === 0) return;
    markReserved(taken);
    try {
      startLeaving(id);
      await onHide(id);
      // Hidden: the status was reloaded first, so the row is already gone. Failed: it comes back.
      // Either way it must not stay collapsed, as a newer version can bring it back later.
      unleave(id);
    } finally {
      reservations.current.release(id);
      markReleased(id);
    }
  }

  /** Try all again: the existing request, which asks every device on the account. */
  async function resync() {
    const snapshot = other.filter((p) => p.filesState === "waiting").map((p) => p.id);
    const taken = reservations.current.reserve(snapshot);
    markReserved(taken);
    setResyncing(true);
    setOutcome(null);
    try {
      const result = await onResync();
      if (result !== "failed") setOutcome(result);
    } finally {
      taken.forEach((id) => reservations.current.release(id));
      setReserved((prev) => new Set([...prev].filter((id) => !taken.includes(id))));
      setResyncing(false);
    }
  }

  /** Focus on a leaving friend row moves to the next friend row's control, else the previous, else the heading. */
  function startLeavingFriend(id: string) {
    const panel = panelRef.current;
    const rowEl = panel?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"]`);
    const hadFocus = !!rowEl && rowEl.contains(document.activeElement);
    setLeaving((prev) => new Set(prev).add(id));
    if (!panel || !hadFocus) return;
    const rows = friends.filter((f) => !leaving.has(f.id));
    const at = rows.findIndex((f) => f.id === id);
    const next = rows[at + 1] ?? rows[at - 1];
    const el = next ? panel.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(next.id)}"] [data-row-control]`) : null;
    (el ?? document.getElementById(headingId))?.focus({ preventScroll: true });
  }

  /** Send to Spotify on a friend's share: the row collapses out, and comes back if the add fails. */
  async function sendFriend(id: string) {
    if (!onAcceptFriend) return;
    const taken = reservations.current.reserve([id]);
    if (taken.length === 0) return;
    markReserved(taken);
    try {
      startLeavingFriend(id);
      if (!(await onAcceptFriend(id))) unleave(id);
    } finally {
      reservations.current.release(id);
      markReleased(id);
    }
  }

  async function dismissFriend(id: string) {
    if (!onDismissFriend) return;
    const taken = reservations.current.reserve([id]);
    if (taken.length === 0) return;
    markReserved(taken);
    try {
      startLeavingFriend(id);
      if (!(await onDismissFriend(id))) unleave(id);
    } finally {
      reservations.current.release(id);
      markReleased(id);
    }
  }

  const announcement = outcome === "asked" ? copy.asked : outcome === "later" ? copy.later : "";

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={triggerLabel(count, open, friends.length)}
        className={`relative isolate flex h-[var(--tray-size)] w-[var(--tray-size)] items-center justify-center rounded-full transition-[filter,background-color,box-shadow] active:scale-95 ${
          // Open: the glass drops away and the red X stands alone.
          open ? "bg-transparent" : "glass-fake hover:brightness-125"
        } ${
          count > 0 ? "text-text" : "text-text-dim"
        }`}
      >
        <span className="relative block h-5 w-5">
          <CloudDownIcon className="phone-tray-glyph absolute inset-0 h-5 w-5" data-open={open} />
          <XIcon
            className="phone-tray-glyph phone-tray-glyph-x absolute inset-0 h-5 w-5 text-danger"
            data-open={open}
          />
        </span>
        {count > 0 && !open && (
          <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-[11px] font-bold leading-none text-black">
            {count}
          </span>
        )}
      </button>

      {(open || mounted) && (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-labelledby={headingId}
          tabIndex={-1}
          data-state={open ? "open" : "closed"}
          className="phone-tray glass-fake glass-frost absolute right-full top-full z-30 isolate w-[300px] max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-6rem)] overflow-y-auto overscroll-contain rounded-[22px] p-2 outline-none"
        >
          <h2 id={headingId} tabIndex={-1} className="sr-only">
            {INBOX_TITLE}
          </h2>
          {/* One polite live region for the whole tray: the lines after Try all again. */}
          <div aria-live="polite" role="status" className="sr-only">
            {announcement}
          </div>
          {count === 0 && (
            <p className="px-3 py-3 text-sm text-text-muted">Nothing waiting from your devices.</p>
          )}
          {ready.length > 0 && (
            <section data-section="ready" aria-labelledby={`${panelId}-ready`}>
              <SectionHeader
                id={`${panelId}-ready`}
                name="Ready to add"
                count={ready.length}
                action={
                  showAddAll(ready)
                    ? { label: addingAll ? "Adding…" : "Add all", busy: addingAll, onClick: addAll }
                    : undefined
                }
              />
              {ready.map((p) => (
                <Row key={p.id} id={p.id} leaving={leaving.has(p.id)} onFocusRow={(on) => (focusedRow.current = on ? p.id : null)}>
                  <PendingRow item={p} busy={reserved.has(p.id)} leaving={leaving.has(p.id)} onSend={() => send(p.id)} />
                </Row>
              ))}
            </section>
          )}
          {ready.length > 0 && other.length > 0 && <hr className="mx-2 my-1.5 border-0 border-t border-white/10" />}
          {other.length > 0 && (
            <section data-section="other" aria-labelledby={`${panelId}-other`}>
              <SectionHeader
                id={`${panelId}-other`}
                name={copy.name}
                count={other.length}
                action={
                  showTryAllAgain(other)
                    ? { label: resyncing ? "Trying…" : "Try all again", busy: resyncing, onClick: resync }
                    : undefined
                }
              />
              <p className="px-3 pb-1 text-[12px] leading-snug text-text-muted">{outcome === "asked" ? copy.asked : copy.line}</p>
              {outcome === "later" && <p className="px-3 pb-1 text-[12px] leading-snug text-text-dim">{copy.later}</p>}
              {other.map((p) => (
                <Row key={p.id} id={p.id} leaving={leaving.has(p.id)} onFocusRow={(on) => (focusedRow.current = on ? p.id : null)}>
                  <PendingRow
                    item={p}
                    compact
                    busy={reserved.has(p.id)}
                    leaving={leaving.has(p.id)}
                    onSend={() => {}}
                    onHide={() => hide(p.id)}
                  />
                </Row>
              ))}
            </section>
          )}
          {friends.length > 0 && pending.length > 0 && <hr className="mx-2 my-1.5 border-0 border-t border-white/10" />}
          {friends.length > 0 && (
            <section data-section="friends" aria-labelledby={`${panelId}-friends`}>
              <SectionHeader id={`${panelId}-friends`} name="From your friends" count={friends.length} />
              {friends.map((f) => (
                <Row key={f.id} id={f.id} leaving={leaving.has(f.id)} onFocusRow={(on) => (focusedRow.current = on ? f.id : null)}>
                  <FriendRow
                    item={f}
                    busy={reserved.has(f.id)}
                    leaving={leaving.has(f.id)}
                    onSend={() => sendFriend(f.id)}
                    onDismiss={() => dismissFriend(f.id)}
                  />
                </Row>
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  );
}

/** The collapse wrapper and the hook for finding a row's own control. */
function Row({
  id,
  leaving,
  onFocusRow,
  children,
}: {
  id: string;
  leaving: boolean;
  onFocusRow: (on: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="phone-tray-row"
      data-leaving={leaving}
      data-row-id={id}
      onFocus={() => onFocusRow(true)}
      onBlur={(e) => {
        if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node)) onFocusRow(false);
      }}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

/** A section's header line: the name (13 semibold) with its count, and its one action at the right.
 * Both actions are the same control and size. The count is part of the heading's name. */
export function SectionHeader({
  id,
  name,
  count,
  action,
}: {
  id: string;
  name: string;
  count: number;
  action?: { label: string; busy: boolean; onClick: () => void };
}) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 pb-1 pt-1.5">
      <h3 id={id} className="min-w-0 whitespace-nowrap text-[13px] font-semibold leading-snug text-text">
        {name}
        <span className="sr-only">,</span> <span className="font-normal text-text-dim">{count}</span>
      </h3>
      {action && (
        <button type="button" data-header-action disabled={action.busy} onClick={action.onClick} className="btn-save btn-save-compact">
          {action.label}
        </button>
      )}
    </div>
  );
}

/** One pending release as a small record sleeve, echoing the release page. The sleeve is the
 * Send to Spotify button: on hover the cover turns accent with a plus (Spotify's own "add" mark)
 * and the disc rolls out; the title and artist sit beside it. In the second section the row is
 * compact and has no Send, only Hide at its end. With no cover (always, here) the cover is the
 * card square with the double note, and the disc's label is black. */
export function PendingRow({
  item,
  leaving,
  busy = false,
  compact = false,
  onSend,
  onHide,
}: {
  item: PendingFromPhone;
  leaving: boolean;
  /** Reserved by a run or a press: the sending look, its own controls off. */
  busy?: boolean;
  compact?: boolean;
  onSend: () => void;
  onHide?: () => void;
}) {
  const title = item.title || item.artist;
  const waiting = item.filesState === "waiting";
  const arriving = item.filesState === "arriving";
  const cover = compact ? "h-10 w-10" : "h-12 w-12";
  const frame = compact ? "h-10 w-14" : "h-12 w-[4.25rem]";
  const disc = compact ? "h-9 w-9" : "h-11 w-11";
  // The group/send hover and focus effects only fire under the Send button, so the same sleeve
  // sits still when it is not one.
  const sleeve = (
    <>
      <span className={`absolute right-0 top-1/2 ${disc} -translate-y-1/2 rounded-full bg-[radial-gradient(circle,#3a3a40_0_12%,#0c0c0e_13%_17%,#26262b_18%_40%,#1a1a1e_41%_62%,#2a2a30_63%_100%)] shadow-[0_4px_12px_-4px_rgb(0_0_0/0.8)] ring-1 ring-white/15 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover/send:translate-x-1.5 group-hover/send:rotate-45 group-focus-visible/send:translate-x-1.5`}>
        {/* No cover, so the label is black, never the accent. */}
        <span className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#050505] ring-1 ring-[#1E1E1E]" />
      </span>
      <span className={`absolute left-0 top-0 flex ${cover} items-center justify-center rounded-[10px] bg-card text-text-dim shadow-[0_6px_16px_-6px_rgb(0_0_0/0.8)] ring-1 ring-white/10 transition-colors group-hover/send:bg-accent group-focus-visible/send:bg-accent group-focus-visible/send:ring-2 group-focus-visible/send:ring-white`}>
        {!arriving && !busy && (
          <>
            <MusicNoteIcon className="h-4 w-4 transition-opacity group-hover/send:opacity-0 group-focus-visible/send:opacity-0" />
            <PlusIcon
              className="absolute h-5 w-5 text-black opacity-0 transition-opacity group-hover/send:opacity-100 group-focus-visible/send:opacity-100"
              strokeWidth={2.5}
            />
          </>
        )}
      </span>
    </>
  );
  // Small square dots sitting low, on the cover's lower third, like a typed "..." on a line of text.
  const dots = (
    <span
      aria-hidden="true"
      className={`sending-dots absolute left-0 top-0 flex ${cover} items-start justify-center gap-[3px] ${compact ? "pt-6" : "pt-[30px]"}`}
    >
      <span className="h-1 w-1 bg-white" />
      <span className="h-1 w-1 bg-white" />
      <span className="h-1 w-1 bg-white" />
    </span>
  );
  return (
    <div className="group/row" aria-busy={busy || undefined}>
      <div className={`flex items-center rounded-2xl px-2.5 ${compact ? "gap-3 py-1.5" : "gap-3.5 py-2.5"}`}>
        {arriving ? (
          // Still being sent: greyed out and not a button. The dots are decorative; the words follow.
          <div className={`relative ${frame} shrink-0`}>
            <div aria-hidden="true" className="absolute inset-0 opacity-50 grayscale">
              {sleeve}
            </div>
            {dots}
          </div>
        ) : waiting ? (
          // Waiting on the other device: nothing to send yet, so the sleeve is only a picture.
          <div aria-hidden="true" className={`relative ${frame} shrink-0 opacity-60`}>
            {sleeve}
            {busy && dots}
          </div>
        ) : (
          <button
            type="button"
            data-row-control
            disabled={leaving || busy}
            onClick={onSend}
            aria-label={`Send ${title} to Spotify`}
            title="Send to Spotify"
            className={`group/send relative ${frame} shrink-0 rounded-[10px] active:scale-95 disabled:opacity-60`}
          >
            {sleeve}
            {busy && dots}
          </button>
        )}
        <span className="min-w-0 flex-1">
          <span
            className={`block truncate font-semibold ${compact ? "text-[14px] text-text-muted" : "text-[15px] text-text"}`}
          >
            {title}
          </span>
          {/* A long artist name gives way first; the track count always shows. */}
          <span className="flex text-[13px] text-text-muted">
            <span className="truncate">{item.artist}</span>
            <span className="shrink-0 whitespace-pre">
              {" · "}
              {item.trackCount} track{item.trackCount === 1 ? "" : "s"}
            </span>
          </span>
          {compact ? (
            sinceLabel(item.sentAt) && <span className="block text-[12px] text-text-dim">since {sinceLabel(item.sentAt)}</span>
          ) : (
            <span className="block truncate text-[12px] text-text-dim">{originLabel(item.origin)}</span>
          )}
          {arriving && <span className="sr-only">Still being sent from your {item.origin === "ios" ? "phone" : "other device"}.</span>}
        </span>
        {waiting && onHide && (
          // Shown on hover and whenever focus is inside the row; always a real button.
          <button
            type="button"
            data-row-control
            disabled={leaving || busy}
            onClick={onHide}
            aria-label={`Hide ${title}`}
            title="Hide"
            className="btn-icon text-text-muted opacity-0 transition-opacity motion-reduce:transition-none group-hover/row:opacity-100 group-focus-within/row:opacity-100 disabled:cursor-not-allowed"
          >
            <EyeOffIcon className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

/** One share from a friend: the cover as a record sleeve that is itself the Send to Spotify button, the
 * title and artist cut short, and the sender's email as the quiet origin line. Dismiss shows on hover and
 * whenever focus is inside the row. */
export function FriendRow({
  item,
  leaving,
  busy = false,
  onSend,
  onDismiss,
}: {
  item: FriendShare;
  leaving: boolean;
  busy?: boolean;
  onSend: () => void;
  onDismiss: () => void;
}) {
  const [coverFailed, setCoverFailed] = useState(false);
  const title = friendTitle(item);
  const showCover = item.hasCover && !coverFailed;
  return (
    <div className="group/row" aria-busy={busy || undefined}>
      <div className="flex items-center gap-3.5 rounded-2xl px-2.5 py-2.5">
        <button
          type="button"
          data-row-control
          disabled={leaving || busy}
          onClick={onSend}
          aria-label={`Send ${title} to Spotify`}
          title="Send to Spotify"
          className="group/send relative h-12 w-[4.25rem] shrink-0 rounded-[10px] active:scale-95 disabled:opacity-60"
        >
          <span className="absolute right-0 top-1/2 h-11 w-11 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,#3a3a40_0_12%,#0c0c0e_13%_17%,#26262b_18%_40%,#1a1a1e_41%_62%,#2a2a30_63%_100%)] shadow-[0_4px_12px_-4px_rgb(0_0_0/0.8)] ring-1 ring-white/15 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none group-hover/send:translate-x-1.5 group-hover/send:rotate-45 group-focus-visible/send:translate-x-1.5">
            <span className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#050505] ring-1 ring-[#1E1E1E]" />
          </span>
          <span className="absolute left-0 top-0 flex h-12 w-12 items-center justify-center overflow-hidden rounded-[10px] bg-card text-text-dim shadow-[0_6px_16px_-6px_rgb(0_0_0/0.8)] ring-1 ring-white/10 transition-colors group-focus-visible/send:ring-2 group-focus-visible/send:ring-white">
            {showCover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={friendCoverUrl(item.id)}
                alt=""
                onError={() => setCoverFailed(true)}
                className="h-full w-full object-cover"
              />
            ) : (
              <MusicNoteIcon className="h-4 w-4" />
            )}
            {!busy && (
              <span className="absolute inset-0 flex items-center justify-center bg-accent opacity-0 transition-opacity motion-reduce:transition-none group-hover/send:opacity-100 group-focus-visible/send:opacity-100">
                <PlusIcon className="h-5 w-5 text-black" strokeWidth={2.5} />
              </span>
            )}
          </span>
          {busy && (
            <span
              aria-hidden="true"
              className="sending-dots absolute left-0 top-0 flex h-12 w-12 items-start justify-center gap-[3px] pt-[30px]"
            >
              <span className="h-1 w-1 bg-white" />
              <span className="h-1 w-1 bg-white" />
              <span className="h-1 w-1 bg-white" />
            </span>
          )}
        </button>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold text-text">{title}</span>
          <span className="flex text-[13px] text-text-muted">
            <span className="truncate">{item.artist}</span>
            <span className="shrink-0 whitespace-pre">
              {" · "}
              {item.trackCount} track{item.trackCount === 1 ? "" : "s"}
            </span>
          </span>
          <span className="block text-[12px] text-text-dim [overflow-wrap:anywhere]">{fromLabel(item.fromEmail)}</span>
        </span>
        <button
          type="button"
          data-row-control
          disabled={leaving || busy}
          onClick={onDismiss}
          aria-label={`Dismiss ${title}`}
          title="Dismiss"
          className="btn-icon text-text-muted opacity-0 transition-opacity motion-reduce:transition-none group-hover/row:opacity-100 group-focus-within/row:opacity-100 disabled:cursor-not-allowed"
        >
          <XIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
