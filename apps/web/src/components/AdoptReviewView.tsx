"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { AdoptProposal } from "../server/adopt/types";
import type { Release } from "../shared/types";
import { UNKNOWN_ARTIST } from "../shared/adopt";
import { adoptGroups, getAdoptProposal, getLibrary, getSettings, scanAdopt } from "../lib/api-client";
import {
  addedAllToast,
  addingLabel,
  addLabel,
  displayArtist,
  foundLine,
  foundTitle,
  groupForReview,
  groupTickState,
  hideAdded,
  kindLabel,
  partialLine,
  plural,
  runAdoption,
  selectedLine,
  shortDate,
  skippedLines,
  skippedTitle,
  skippedTotal,
  toggleGroupTicks,
  unreadableLine,
} from "../lib/adopt-review";
import { libraryWidthClass, loadLibraryWidth, type LibraryWidth } from "../lib/library-view-prefs";
import HouseSleeve from "./HouseSleeve";
import Tick from "./Tick";

interface AdoptReviewViewProps {
  /** True when opened from "Check for new files": read the folders first. False: show the stored findings. */
  scan: boolean;
  /** Cancel and Back to Settings. */
  onBack: () => void;
  /** Everything ticked is now in the library: the library opens with the toast. */
  onAllAdded: (toast: string) => void;
  /** Some releases were added (or the server's library changed): reload it. */
  onLibraryChanged: () => void;
}

type Phase = "reading" | "failed" | "ready" | "no-folders";

/** Every request on opening gives up after its own limit, so Reading can never hang. */
const SCAN_TIMEOUT_MS = 30_000;
const READ_TIMEOUT_MS = 10_000;

/** Runs `run` with a signal that aborts after `ms`, or when `parent` (the page going away) aborts. */
async function bounded<T>(ms: number, parent: AbortSignal, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const own = new AbortController();
  const timer = setTimeout(() => own.abort(), ms);
  const onParent = () => own.abort();
  parent.addEventListener("abort", onParent);
  try {
    return await run(own.signal);
  } finally {
    clearTimeout(timer);
    parent.removeEventListener("abort", onParent);
  }
}

const DOCK_FALLBACK_PX = 64;

export default function AdoptReviewView({ scan, onBack, onAllAdded, onLibraryChanged }: AdoptReviewViewProps) {
  const [phase, setPhase] = useState<Phase>("reading");
  const [proposal, setProposal] = useState<AdoptProposal | null>(null);
  const [earlier, setEarlier] = useState<AdoptProposal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [releases, setReleases] = useState<Release[]>([]);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [addedKeys, setAddedKeys] = useState<Set<string>>(new Set());
  const [rowErrors, setRowErrors] = useState<Map<string, string>>(new Map());
  const [adding, setAdding] = useState<{ done: number; total: number } | null>(null);
  const [summary, setSummary] = useState<{ added: number; total: number; failed: number } | null>(null);
  const [datedFrom, setDatedFrom] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("Reading your Spotify folders");
  const [width, setWidth] = useState<LibraryWidth>("full");
  const [retry, setRetry] = useState(0);

  // A response that lands after the page has gone must change nothing: no state, no focus, no navigation.
  const alive = useRef(true);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const lineRef = useRef<HTMLParagraphElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const idBase = useId();

  const onLibraryChangedRef = useRef(onLibraryChanged);
  useEffect(() => {
    onLibraryChangedRef.current = onLibraryChanged;
  });

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    // Saved width loads after mount so the server and first client render agree.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWidth(loadLibraryWidth());
    titleRef.current?.focus({ preventScroll: true });
  }, []);

  /** Shows `p`: every group not already in the library, all ticked. */
  const showFindings = useCallback((p: AdoptProposal, library: Release[], from: string | null) => {
    const visible = hideAdded(p.groups, library);
    setProposal(p);
    setReleases(library);
    setTicked(new Set(visible.map((g) => g.key)));
    setAddedKeys(new Set());
    setRowErrors(new Map());
    setSummary(null);
    setDatedFrom(from);
    setError(null);
    setPhase("ready");
    const unreadable = p.unreadable.length > 0;
    setAnnouncement(
      visible.length > 0
        ? foundTitle(visible.length)
        : unreadable
          ? "Couldn't read all of your Spotify folders"
          : "Nothing new in your Spotify folders"
    );
  }, []);

  // Opening the page always reads the findings fresh (and the library, to hide what is already in it).
  useEffect(() => {
    const abort = new AbortController();
    let ended = false;
    const gone = () => !alive.current || ended;
    async function open() {
      setPhase("reading");
      setAnnouncement("Reading your Spotify folders");
      const [settings, library] = await Promise.all([
        bounded(READ_TIMEOUT_MS, abort.signal, (s) => getSettings(s)).catch(() => null),
        bounded(READ_TIMEOUT_MS, abort.signal, (s) => getLibrary(s)).catch(() => null),
      ]);
      if (gone()) return;
      if (settings && settings.adoptRoots.length === 0) {
        setPhase("no-folders");
        setAnnouncement("Add a folder in Settings first.");
        return;
      }
      const inLibrary = library?.releases ?? [];
      try {
        let found: AdoptProposal | null = null;
        // A retry always re-reads; the first open reads only when asked to, or when nothing is stored.
        if (!scan && retry === 0) found = await bounded(READ_TIMEOUT_MS, abort.signal, (s) => getAdoptProposal(s));
        if (!found) found = await bounded(SCAN_TIMEOUT_MS, abort.signal, (s) => scanAdopt(s));
        if (gone()) return;
        showFindings(found, inLibrary, null);
      } catch (e) {
        if (gone()) return;
        // The failure shows first; the earlier findings are an optional extra that arrives later or never.
        setReleases(inLibrary);
        setEarlier(null);
        setError(e instanceof Error && e.name !== "AbortError" ? e.message : "Locally didn't answer.");
        setPhase("failed");
        setAnnouncement("Couldn't check your Spotify folders");
        bounded(READ_TIMEOUT_MS, abort.signal, (s) => getAdoptProposal(s))
          .then((stored) => {
            if (!gone()) setEarlier(stored);
          })
          .catch(() => undefined);
      }
    }
    void open();
    return () => {
      ended = true;
      abort.abort();
    };
  }, [scan, retry, showFindings]);

  const groups = useMemo(
    () => (proposal ? hideAdded(proposal.groups, releases).filter((g) => !addedKeys.has(g.key)) : []),
    [proposal, releases, addedKeys]
  );
  const reviewGroups = useMemo(() => groupForReview(proposal?.roots ?? [], groups), [proposal, groups]);
  const orderedKeys = useMemo(() => reviewGroups.flatMap((g) => g.rows.map((r) => r.group.key)), [reviewGroups]);
  const tickedKeys = orderedKeys.filter((k) => ticked.has(k));

  // The dock's height sets the list's bottom padding (height plus 24) and a focused row's clearance.
  useEffect(() => {
    const dock = dockRef.current;
    const root = rootRef.current;
    if (!dock || !root) return;
    const apply = () => root.style.setProperty("--adopt-dock", `${dock.offsetHeight}px`);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(dock);
    return () => observer.disconnect();
  }, [phase, groups.length]);

  function toggleRow(key: string) {
    if (adding) return;
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleGroup(keys: string[]) {
    if (adding) return;
    setTicked((prev) => toggleGroupTicks(keys, prev));
  }

  function moveFocus(from: HTMLElement, step: 1 | -1) {
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-adopt-row]") ?? [])];
    rows[rows.indexOf(from) + step]?.focus();
  }

  async function handleAdd() {
    if (adding || tickedKeys.length === 0) return;
    const keys = tickedKeys;
    setSummary(null);
    setAdding({ done: 0, total: keys.length });
    const run = await runAdoption({
      keys,
      send: adoptGroups,
      shouldContinue: () => alive.current,
      onProgress: (done, total) => {
        if (!alive.current) return;
        setAdding({ done, total });
        if (done > 0 && done < total) setAnnouncement(`Adding ${done} of ${total}`);
      },
    });
    if (run.added.size > 0) onLibraryChangedRef.current();
    if (!alive.current) return;
    setAdding(null);
    if (run.failed.size === 0 && !run.stopped) {
      onAllAdded(addedAllToast(run.added.size));
      return;
    }
    setAddedKeys((prev) => new Set([...prev, ...run.added]));
    setTicked((prev) => new Set([...prev].filter((k) => !run.added.has(k))));
    setRowErrors(run.failed);
    const line = { added: run.added.size, total: keys.length, failed: run.failed.size };
    setSummary(line);
    setAnnouncement(partialLine(line.added, line.total, line.failed));
    // Focus goes to the header line once it shows the result.
    requestAnimationFrame(() => {
      if (alive.current) lineRef.current?.focus({ preventScroll: false });
    });
  }

  // --- header text ---
  const remaining = groups.length;
  const unreadable = proposal?.unreadable ?? [];
  const nothingNew = phase === "ready" && remaining === 0;
  let title = "";
  let line: string | null = null;
  if (phase === "reading") {
    title = "Reading your Spotify folders";
    line = "This can take a minute.";
  } else if (phase === "failed") {
    title = "Couldn't check your Spotify folders";
    line = error ?? "Locally didn't answer.";
  } else if (phase === "no-folders") {
    title = "Nothing new in your Spotify folders";
    line = "Add a folder in Settings first.";
  } else if (nothingNew) {
    title = unreadable.length > 0 ? "Couldn't read all of your Spotify folders" : "Nothing new in your Spotify folders";
    line = unreadable.length > 0 ? null : "Everything Locally can add from there is already in your library.";
  } else {
    title = foundTitle(remaining);
    line = summary
      ? partialLine(summary.added, summary.total, summary.failed)
      : `${datedFrom ? `Found on ${shortDate(datedFrom)}. ` : ""}${foundLine(groups, reviewGroups.length)}`;
  }
  const skipped = proposal?.skipped ?? {};
  const showSkipped = phase === "ready" && skippedTotal(skipped) > 0;
  const retrying = rowErrors.size > 0;

  return (
    <div ref={rootRef} className={`flex min-h-full flex-col gap-8 ${libraryWidthClass(width)}`}>
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>

      <header className="flex flex-col gap-1 pr-[calc(var(--tray-size)+0.75rem)] lg:pr-0">
        <p className="text-sm font-semibold text-accent">Your Spotify folders</p>
        <h1
          ref={titleRef}
          tabIndex={-1}
          className="mt-1 text-4xl font-bold tracking-[-0.02em] text-text outline-none"
        >
          {title}
        </h1>
        {line !== null && (
          <p ref={lineRef} tabIndex={-1} className="mt-1 text-sm text-text-muted outline-none">
            {line}
          </p>
        )}
        {showSkipped && (
          <details className="mt-1 text-sm text-text-muted">
            <summary className="w-fit cursor-pointer text-text-muted hover:text-text">{skippedTitle(skipped)}</summary>
            <ul className="mt-2 flex flex-col gap-0.5 text-xs">
              {skippedLines(skipped).map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-text-dim">Locally can&apos;t add these yet.</p>
          </details>
        )}
        {phase === "reading" && (
          <div aria-hidden="true" className="mt-4 h-0.5 w-full">
            <div className="adopt-reading-line h-0.5 w-full bg-accent" />
          </div>
        )}
      </header>

      {phase === "reading" && (
        <ul aria-hidden="true" className="flex flex-col gap-3">
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i} className="flex items-center gap-3 px-3">
              <span className="size-5 shrink-0 rounded-full ring-[1.5px] ring-inset ring-white/[0.06]" />
              <span className="size-12 shrink-0 rounded bg-white/[0.06]" />
              <span className="flex flex-1 flex-col gap-2">
                <span className="h-3 w-1/3 rounded bg-white/[0.06]" />
                <span className="h-3 w-1/5 rounded bg-white/[0.06]" />
              </span>
            </li>
          ))}
        </ul>
      )}

      {phase === "failed" && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setRetry((n) => n + 1)} className="btn-save">
              Try again
            </button>
            <button type="button" onClick={onBack} className="btn-ink">
              <span className="btn-ink-label">Back to Settings</span>
            </button>
          </div>
          {earlier && (
            <div>
              <button type="button" onClick={() => showFindings(earlier, releases, earlier.scannedAt)} className="btn-ink">
                <span className="btn-ink-label">Review what Locally found on {shortDate(earlier.scannedAt)} instead</span>
              </button>
            </div>
          )}
        </div>
      )}

      {phase === "no-folders" && (
        <div>
          <button type="button" onClick={onBack} className="btn-ink">
            <span className="btn-ink-label">Back to Settings</span>
          </button>
        </div>
      )}

      {phase === "ready" && unreadable.length > 0 && (
        <div className="flex flex-col gap-1">
          {unreadable.map((folder) => (
            <p key={folder} className="text-[13px] text-danger">
              {unreadableLine(folder)}
            </p>
          ))}
        </div>
      )}

      {nothingNew && (
        <div>
          <button type="button" onClick={onBack} className="btn-ink">
            <span className="btn-ink-label">Back to Settings</span>
          </button>
        </div>
      )}

      {phase === "ready" && remaining > 0 && (
        <>
          <div
            ref={listRef}
            className="flex flex-1 flex-col gap-8"
            style={{ paddingBottom: `calc(var(--adopt-dock, ${DOCK_FALLBACK_PX}px) + 24px)` }}
          >
            {reviewGroups.map((group) => {
              const keys = group.rows.map((r) => r.group.key);
              const state = groupTickState(keys, ticked);
              return (
                <section key={group.id} aria-label={group.name} className="flex flex-col gap-2">
                  <div className="flex items-center gap-3 px-3">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={state === "mixed" ? "mixed" : state === "all"}
                      aria-label={`All of ${group.name}`}
                      aria-disabled={adding ? true : undefined}
                      onClick={() => toggleGroup(keys)}
                      className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                    >
                      <Tick state={state} />
                    </button>
                    <h2 className="flex-1 truncate text-sm font-bold text-text">{group.name}</h2>
                    <span className="text-[13px] tabular-nums text-text-muted">{plural(keys.length, "release")}</span>
                  </div>
                  <ul className="overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.04]">
                    {group.rows.map(({ group: g, subfolder }, index) => {
                      const on = ticked.has(g.key);
                      const message = rowErrors.get(g.key);
                      const artist = displayArtist(g.artist, UNKNOWN_ARTIST);
                      const folderId = `${idBase}-f-${g.key}`;
                      const errorId = `${idBase}-e-${g.key}`;
                      const describedBy = [subfolder ? folderId : null, message ? errorId : null].filter(Boolean).join(" ");
                      return (
                        <li key={g.key}>
                          {index > 0 && <div className="h-px bg-white/[0.06]" aria-hidden="true" />}
                          <div
                            role="checkbox"
                            aria-checked={on}
                            aria-disabled={adding ? true : undefined}
                            aria-label={`${g.title}, ${artist}, ${kindLabel(g)}`}
                            aria-describedby={describedBy || undefined}
                            tabIndex={0}
                            data-adopt-row=""
                            onClick={() => toggleRow(g.key)}
                            onKeyDown={(e) => {
                              if (e.key === " ") {
                                e.preventDefault();
                                toggleRow(g.key);
                              } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                                e.preventDefault();
                                moveFocus(e.currentTarget, e.key === "ArrowDown" ? 1 : -1);
                              }
                            }}
                            className="flex min-h-[64px] scroll-mb-[calc(var(--adopt-dock,64px)+24px)] cursor-pointer items-center gap-3 px-3 py-2 outline-none hover:bg-white/[0.06] focus-visible:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                          >
                            <Tick state={on ? "all" : "none"} />
                            <HouseSleeve className={`size-12 shrink-0 rounded-[4px] ${on ? "" : "opacity-40"}`} />
                            <span className="min-w-0 flex-1">
                              <span className={`block truncate text-[15px] font-semibold ${on ? "text-text" : "text-text-muted"}`}>
                                {g.title}
                              </span>
                              <span className="block truncate text-[13px] text-text-muted">{artist}</span>
                              {subfolder && (
                                <span id={folderId} dir="rtl" className="block truncate text-left text-xs text-text-dim">
                                  <bdi dir="ltr">{subfolder}</bdi>
                                </span>
                              )}
                              {message && (
                                <span id={errorId} className="block text-xs text-danger">
                                  {message}
                                </span>
                              )}
                            </span>
                            <span className="shrink-0 text-[13px] text-text-muted">{kindLabel(g)}</span>
                            <span className="w-10 shrink-0 text-right text-[13px] tabular-nums text-text-muted">
                              {g.year ?? ""}
                            </span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>

          <div
            ref={dockRef}
            className="sticky bottom-6 z-10 mx-auto flex w-fit max-w-full flex-wrap items-center justify-center gap-2 rounded-full bg-black/70 py-1.5 pl-5 pr-2 ring-1 ring-white/10"
            style={{ marginTop: `calc(-1 * var(--adopt-dock, ${DOCK_FALLBACK_PX}px))` }}
          >
            <span className="text-[13px] tabular-nums text-text-muted">{selectedLine(tickedKeys.length, remaining)}</span>
            {!adding && (
              <>
                <button
                  type="button"
                  onClick={() => setTicked(new Set(tickedKeys.length < remaining ? orderedKeys : []))}
                  className="btn-ink"
                >
                  <span className="btn-ink-label">{tickedKeys.length < remaining ? "Select all" : "Select none"}</span>
                </button>
                <button type="button" onClick={onBack} className="btn-ink">
                  <span className="btn-ink-label">Cancel</span>
                </button>
              </>
            )}
            <button
              type="button"
              onClick={handleAdd}
              disabled={adding !== null}
              aria-disabled={tickedKeys.length === 0 ? true : undefined}
              className={`btn-save ${tickedKeys.length === 0 && !adding ? "opacity-40" : ""}`}
            >
              {adding
                ? addingLabel(adding.done, adding.total)
                : retrying
                  ? "Try again"
                  : addLabel(tickedKeys.length)}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
