"use client";

import { useEffect, useState } from "react";
import { getAdoptProposal, getSettings, putAdoptRoots } from "../lib/api-client";
import { folderName, lastCheckedLine } from "../lib/adopt-review";
import { IS_DEMO } from "../lib/demo";

/** Present only in the desktop app's window (electron/preload.ts); a browser has no picker. */
type DesktopBridge = { pickFolder?: () => Promise<string | null> };

interface SpotifyFoldersCardProps {
  onToast: (kind: "success" | "error", text: string) => void;
  /** Opens the review page and starts the check. */
  onCheck: () => void;
}

/** A path cut in the middle when it is long: the start shrinks, the last part always shows. */
function MiddleCut({ text }: { text: string }) {
  const keep = 28;
  const head = text.length > keep ? text.slice(0, -keep) : "";
  const tail = text.length > keep ? text.slice(-keep) : text;
  return (
    <span className="flex min-w-0 text-xs text-text-dim" title={text}>
      {head && <span className="truncate">{head}</span>}
      <span className="shrink-0 whitespace-pre">{tail}</span>
    </span>
  );
}

/** Settings > Your Spotify folders (#249): the folders Locally reads to add releases Spotify already plays. */
export default function SpotifyFoldersCard({ onToast, onCheck }: SpotifyFoldersCardProps) {
  const [roots, setRoots] = useState<string[]>([]);
  const [suggested, setSuggested] = useState<string | null>(null);
  const [scannedAt, setScannedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (IS_DEMO) return;
    let cancelled = false;
    getSettings()
      .then((s) => {
        if (cancelled) return;
        setRoots(s.adoptRoots);
        setSuggested(s.suggestedAdoptRoot);
      })
      .catch(() => undefined);
    getAdoptProposal()
      .then((p) => {
        if (!cancelled && p) setScannedAt(p.scannedAt);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(next: string[]): Promise<boolean> {
    setBusy(true);
    try {
      const res = await putAdoptRoots(next);
      setRoots(res.adoptRoots);
      setSuggested(res.suggestedAdoptRoot);
      return true;
    } catch (e) {
      onToast("error", e instanceof Error ? e.message : "Couldn't save the folders.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(path: string) {
    const clean = path.trim();
    if (clean === "") return;
    if (await save([...roots, clean])) {
      setTyping(false);
      setTyped("");
    }
  }

  async function remove(path: string) {
    if (await save(roots.filter((r) => r !== path))) {
      onToast("success", `Stopped checking ${folderName(path)}. Releases added from it stay in your library.`);
    }
  }

  async function handleAddFolder() {
    const pick = (window as Window & { locallyDesktop?: DesktopBridge }).locallyDesktop?.pickFolder;
    if (!pick) {
      setTyping(true);
      return;
    }
    try {
      const chosen = await pick();
      if (chosen) await add(chosen);
    } catch {
      onToast("error", "Couldn't open the folder picker.");
    }
  }

  const hasRoots = roots.length > 0;

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-6">
      <p className="text-sm font-bold text-text">Your Spotify folders</p>
      <p className="text-xs text-text-dim">
        Locally reads the music Spotify plays from these folders. It never changes, moves or deletes a file there.
      </p>
      <fieldset disabled={IS_DEMO} className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
        {(hasRoots || suggested) && (
          <ul className="flex flex-col gap-3">
            {suggested && (
              <li className="flex items-center justify-between gap-4">
                <span className="min-w-0 truncate text-[13px] text-text-muted" title={suggested}>
                  {suggested}
                </span>
                <button type="button" onClick={() => add(suggested)} disabled={busy} className="btn-ink">
                  Add
                </button>
              </li>
            )}
            {roots.map((root) => (
              <li key={root} className="flex items-center justify-between gap-4">
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm font-semibold text-text">{folderName(root)}</span>
                  <MiddleCut text={root} />
                </span>
                <button
                  type="button"
                  onClick={() => remove(root)}
                  disabled={busy}
                  aria-label={`Remove ${folderName(root)}`}
                  className="btn-ink"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        {!hasRoots && (
          <p className="text-[13px] text-text-muted">
            Add the folder Spotify plays your local files from (Spotify › Settings › Your Library).
          </p>
        )}
        {typing && (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void add(typed);
            }}
          >
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              aria-label="Folder path"
              placeholder="/Users/you/Documents/Spotify Music"
              autoFocus
              className="min-w-0 flex-1 rounded-md bg-elevated px-4 py-3 text-sm text-text outline-none placeholder:text-text-muted/60 focus:ring-2 focus:ring-accent"
            />
            <button type="submit" disabled={busy || typed.trim() === ""} className="btn-save">
              Add
            </button>
            <button
              type="button"
              onClick={() => {
                setTyping(false);
                setTyped("");
              }}
              className="btn-ink"
            >
              Cancel
            </button>
          </form>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={handleAddFolder} disabled={busy || typing} className={hasRoots ? "btn-ink" : "btn-save"}>
            Add folder…
          </button>
          {hasRoots && (
            <button type="button" onClick={onCheck} disabled={busy} className="btn-ink">
              Check for new files
            </button>
          )}
        </div>
        {scannedAt && lastCheckedLine(scannedAt) && (
          <p className="text-xs text-text-dim">{lastCheckedLine(scannedAt)}</p>
        )}
      </fieldset>
    </section>
  );
}
