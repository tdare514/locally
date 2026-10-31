"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { coverUrl, getSentShares, revokeShare } from "../lib/api-client";
import { COPIES_STAY, expiryLabel, sentShareState, sharedWithLabel } from "../lib/share-copy";
import type { SentShare } from "../shared/shares";
import { MusicNoteIcon } from "./Icons";
import { SettingsBlock, SettingsSection } from "./SettingsGroup";

interface SharedByYouProps {
  onToast: (kind: "success" | "error", text: string) => void;
}

/** "Shared by you" (#182) in Settings' sync area: the shares this account sent, each with its cover, who it
 * reached and whether they added it, the link and expiry, and Revoke with an inline confirm. Revoked and
 * expired shares stay listed, greyed, without Revoke. */
export default function SharedByYou({ onToast }: SharedByYouProps) {
  const [shares, setShares] = useState<SentShare[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  // Where focus goes once the row it was on has changed: back to Revoke after Cancel, to the status after a revoke.
  const [focusNext, setFocusNext] = useState<{ id: string; to: "revoke" | "status" } | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!focusNext) return;
    const row = listRef.current?.querySelector(`[data-share-id="${CSS.escape(focusNext.id)}"]`);
    row?.querySelector<HTMLElement>(`[data-focus-${focusNext.to}]`)?.focus();
    // Focus is a side effect of the row changing; once it is placed there is nothing left to ask for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFocusNext(null);
  }, [focusNext, confirming, shares]);

  const load = useCallback(async (after: string | null) => {
    try {
      const page = await getSentShares(after);
      setShares((prev) => (after ? [...prev, ...page.shares] : page.shares));
      setCursor(page.nextCursor);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoaded(true);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    // Fetch on mount: the list lives on the sync service.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(null);
  }, [load]);

  async function revoke(id: string) {
    setRevoking(id);
    try {
      await revokeShare(id);
      const revokedAt = new Date().toISOString();
      setShares((prev) => prev.map((s) => (s.id === id ? { ...s, revokedAt } : s)));
      setConfirming(null);
      setFocusNext({ id, to: "status" });
      onToast("success", "Share revoked");
    } catch (e) {
      onToast("error", e instanceof Error ? e.message : "Couldn't revoke it");
    } finally {
      setRevoking(null);
    }
  }

  return (
    <SettingsSection id="shared-by-you" title="Shared by you" titleId="shared-by-you-heading">
      <SettingsBlock className="flex flex-col gap-3">
      {!loaded && <p className="text-sm text-text-muted">Loading…</p>}
      {loaded && failed && shares.length === 0 && (
        <p role="status" className="text-sm text-text-muted">
          Couldn&apos;t load your shares right now.
        </p>
      )}
      {loaded && !failed && shares.length === 0 && (
        <p className="text-sm text-text-muted">Nothing shared yet. Use Share on a release or a track.</p>
      )}
      {shares.length > 0 && (
        <ul ref={listRef} className="flex flex-col gap-4">
          {shares.map((share) => {
            const state = sentShareState(share, now);
            const live = state === "live";
            const title = share.snapshot.title || share.snapshot.artist;
            return (
              <li key={share.id} data-share-id={share.id} className="flex gap-3.5">
                <ShareCover releaseId={share.releaseId} dim={!live} />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <p className={`truncate text-[15px] font-semibold ${live ? "text-text" : "text-text-muted"}`}>{title}</p>
                  <p className="text-[13px] text-text-muted">
                    {share.recipients.length > 0 ? sharedWithLabel(share.recipients.length) : "Shared by link"}
                    {share.trackIds ? ` · ${share.trackIds.length} ${share.trackIds.length === 1 ? "track" : "tracks"}` : ""}
                  </p>
                  {share.recipients.length > 0 && (
                    <ul className="flex flex-col gap-0.5">
                      {share.recipients.map((r) => (
                        <li key={r.email} className="flex items-baseline justify-between gap-3 text-[13px]">
                          <span className={`min-w-0 truncate ${live ? "text-text" : "text-text-muted"}`}>{r.email}</span>
                          <span className="shrink-0 text-text-muted">{r.claimedAt ? "Added" : "Not yet"}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p tabIndex={-1} data-focus-status className="text-[13px] text-text-muted outline-none">
                    {share.hasLink && live ? "Link on · " : ""}
                    {expiryLabel(share, now)}
                  </p>
                  {live &&
                    (confirming === share.id ? (
                      <div role="group" aria-label={`Revoke ${title}?`} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                        <span className="text-text-muted">They&apos;ll lose access. {COPIES_STAY}</span>
                        <button
                          type="button"
                          onClick={() => revoke(share.id)}
                          disabled={revoking === share.id}
                          className="btn-danger"
                        >
                          {revoking === share.id ? "Revoking…" : "Confirm revoke"}
                        </button>
                        <button
                          type="button"
                          autoFocus
                          onClick={() => {
                            setConfirming(null);
                            setFocusNext({ id: share.id, to: "revoke" });
                          }}
                          className="btn-ink"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirming(share.id)}
                        aria-label={`Revoke ${title}`}
                        data-focus-revoke
                        className="btn-ink-danger self-start"
                      >
                        Revoke
                      </button>
                    ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {cursor && (
        <button
          type="button"
          disabled={loadingMore}
          onClick={() => {
            setLoadingMore(true);
            void load(cursor);
          }}
          className="btn-ink self-start"
        >
          {loadingMore ? "Loading…" : "Show older shares"}
        </button>
      )}
      </SettingsBlock>
    </SettingsSection>
  );
}

/** The release's cover from this Mac's library, or the note square when it is gone. */
function ShareCover({ releaseId, dim }: { releaseId: string; dim: boolean }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={`flex ${dim ? "opacity-60 " : ""} h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-[4px] bg-elevated text-text-muted ring-1 ring-white/10`}>
      {failed ? (
        <MusicNoteIcon className="h-4 w-4" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={coverUrl(releaseId)} alt="" onError={() => setFailed(true)} className="h-full w-full object-cover" />
      )}
    </span>
  );
}
