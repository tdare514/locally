"use client";

import { useCallback, useEffect, useMemo, useRef, type CSSProperties } from "react";
import type { Release } from "../shared/types";
import { postLocallyPlay, putLocallyNowPlaying } from "../lib/api-client";
import { IS_DEMO } from "../lib/demo";
import {
  PlayCountSession,
  audioUrl,
  currentItem,
  describeItem,
  COULDNT_PLAY,
  formatClock,
  itemKey as keyOf,
  mediaMetadataFor,
  openContext,
  playerStore,
  previousAction,
  scrubberText,
  usePlayerState,
  type QueueItem,
} from "../lib/play-queue";
import { useArtworkPalette } from "../lib/use-artwork-palette";
import { NextTrackIcon, PauseIcon, PlayIcon } from "./Icons";
import NoCover from "./NoCover";

/** Fired on `window` when the player has counted a play, so a page showing play totals can read them again. */
export const PLAY_COUNTED_EVENT = "locally:play-counted";

/** How often the server is told that Locally is still playing; it forgets a track after 15 s of silence. */
const HEARTBEAT_MS = 5000;
const SKIP_SECONDS = 10;

interface PlayerProps {
  releases: readonly Release[];
  onOpenRelease: (id: string) => void;
  /** A queue made from a collection (#349): the mini player's tap opens that collection. */
  onOpenCollection?: (id: string) => void;
}

/**
 * Locally's own player (#338). One `<audio>` element, owned by AppShell through this component so playback
 * survives page changes, plus the mini player bar while a queue exists. Rows start it through `playerStore`.
 * Everything shown is resolved per queue item from that item's own release, `navigator.mediaSession` too.
 */
export default function Player({ releases, onOpenRelease, onOpenCollection }: PlayerProps) {
  const state = usePlayerState();
  const audioRef = useRef<HTMLAudioElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const item = currentItem(state.queue);
  const info = useMemo(() => (item ? describeItem(item, releases) : null), [item, releases]);
  const url = item ? audioUrl(item) : undefined;
  const palette = useArtworkPalette(info?.coverUrl ?? null);
  const itemKey = item ? `${item.releaseId}/${item.trackId}` : "";

  const session = useMemo(
    () =>
      new PlayCountSession(
        (counted: QueueItem, played) => {
          // The session's start and audible ms ride along (#398); the server keeps one event per session.
          postLocallyPlay(counted.releaseId, counted.trackId, played)
            .then(() => window.dispatchEvent(new CustomEvent(PLAY_COUNTED_EVENT, { detail: counted })))
            .catch(() => undefined);
        },
        // On pause, skip, finish and every 30 s of listening: the same session again, with more audible time.
        (counted: QueueItem, played) => {
          postLocallyPlay(counted.releaseId, counted.trackId, played).catch(() => undefined);
        },
      ),
    [],
  );

  const sample = useCallback(
    (playing: boolean) => {
      const audio = audioRef.current;
      const current = currentItem(playerStore.getState().queue);
      if (!audio) return;
      session.sample(current, {
        at: Date.now(),
        playing,
        positionSec: audio.currentTime,
        durationSec: audio.duration,
      });
    },
    [session],
  );

  const seek = useCallback((sec: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = sec;
    playerStore.report(sec, Number.isFinite(audio.duration) ? audio.duration : 0);
  }, []);

  useEffect(() => playerStore.registerSeek(seek), [seek]);

  const goPrevious = useCallback(() => {
    const { queue, positionSec } = playerStore.getState();
    if (!queue) return;
    if (previousAction(queue, positionSec) === "restart") seek(0);
    else playerStore.back();
  }, [seek]);

  // The audio element follows the store: load the item, play or pause.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !url) return;
    if (state.playing) {
      // An element whose file failed to load stays failed until it is loaded again: a retry starts with that.
      if (audio.error) audio.load();
      const key = keyOf(currentItem(playerStore.getState().queue));
      const attempt = playerStore.getState().attempt;
      audio.play().catch((err: unknown) => {
        if (!(err instanceof DOMException)) return;
        // Autoplay blocked: wait for a click. A track change interrupting a pending play is not a failure.
        if (err.name === "NotAllowedError") playerStore.setPlaying(false);
        else if (err.name !== "AbortError" && key) playerStore.fail(key, attempt);
      });
    } else {
      audio.pause();
    }
  }, [url, state.playing, state.attempt]);

  // A queued release that has since been deleted is skipped.
  useEffect(() => {
    if (item && !info && releases.length > 0) playerStore.next();
  }, [item, info, releases.length]);

  // Tell the server which track is playing, so the Spotify tracker never counts the same play too.
  useEffect(() => {
    if (IS_DEMO || !item || !state.playing) return;
    const send = () => void putLocallyNowPlaying(item.trackId).catch(() => undefined);
    send();
    const timer = setInterval(send, HEARTBEAT_MS);
    return () => {
      clearInterval(timer);
      void putLocallyNowPlaying(null).catch(() => undefined);
    };
    // The item's identity is its key; `item` itself changes whenever the position moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemKey, state.playing]);

  // Media keys and Now Playing.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = info ? new MediaMetadata(mediaMetadataFor(info, window.location.origin)) : null;
  }, [info]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = !state.queue ? "none" : state.playing ? "playing" : "paused";
  }, [state.queue, state.playing]);

  const wholeSecond = Math.floor(state.positionSec);
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    if (!state.queue || !(state.durationSec > 0)) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: state.durationSec,
        position: Math.min(wholeSecond, state.durationSec),
        playbackRate: 1,
      });
    } catch {
      // Some engines refuse a position past the duration; the display just stays as it was.
    }
  }, [state.queue, state.durationSec, wholeSecond]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const session_ = navigator.mediaSession;
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", () => playerStore.setPlaying(true)],
      ["pause", () => playerStore.setPlaying(false)],
      ["nexttrack", () => playerStore.next()],
      ["previoustrack", goPrevious],
      ["seekto", (d) => typeof d.seekTime === "number" && seek(d.seekTime)],
      ["seekbackward", () => seek(Math.max(0, playerStore.getState().positionSec - SKIP_SECONDS))],
      ["seekforward", () => seek(playerStore.getState().positionSec + SKIP_SECONDS)],
    ];
    for (const [action, handler] of handlers) {
      try {
        session_.setActionHandler(action, handler);
      } catch {
        // An action this engine does not support.
      }
    }
    return () => {
      for (const [action] of handlers) {
        try {
          session_.setActionHandler(action, null);
        } catch {
          // As above.
        }
      }
    };
  }, [goPrevious, seek]);

  // Publish the bar's measured height plus a 12 px gap for the pane's bottom room (`--bottom-bars-h`).
  const showing = Boolean(state.queue && info);
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const bar = barRef.current;
    const stage = overlayRef.current?.parentElement;
    if (!showing || !bar || !stage) return;
    const publish = () => stage.style.setProperty("--mini-player-h", `${Math.ceil(bar.getBoundingClientRect().height) + 12}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(bar);
    return () => {
      observer.disconnect();
      stage.style.removeProperty("--mini-player-h");
    };
  }, [showing]);

  const tint = palette?.primary;
  const failed = item !== null && state.unavailable.includes(keyOf(item) ?? "");
  const duration = state.durationSec;

  return (
    <>
      <audio
        ref={audioRef}
        src={url}
        preload="auto"
        onTimeUpdate={(e) => {
          const audio = e.currentTarget;
          playerStore.report(audio.currentTime, Number.isFinite(audio.duration) ? audio.duration : 0);
          sample(!audio.paused);
        }}
        onDurationChange={(e) => {
          const audio = e.currentTarget;
          playerStore.report(audio.currentTime, Number.isFinite(audio.duration) ? audio.duration : 0);
        }}
        onPlay={() => playerStore.setPlaying(true)}
        onPause={(e) => {
          // At the end of a track the engine pauses and then fires `ended`, which moves on.
          if (e.currentTarget.ended) return;
          sample(false);
          playerStore.setPlaying(false);
        }}
        onEnded={() => {
          // The tail since the last time update counts, then the session ends and its audible time is reported.
          sample(true);
          session.sample(null, { at: Date.now(), playing: false, positionSec: 0, durationSec: 0 });
          playerStore.next();
        }}
        // A file that will not load (gone, or a format this engine cannot play) is marked, then skipped past.
        onError={() => {
          const key = keyOf(currentItem(playerStore.getState().queue));
          if (key) playerStore.fail(key, playerStore.getState().attempt);
        }}
      />
      {state.queue && info && (
        // The overlay takes the pane's left padding (the rail, and the card while it is pinned), so the bar lines up
        // with the page. It sits above the release bar (its height is published on the pane as --release-bar-h),
        // else 24 px up.
        <div ref={overlayRef} className="sb-stage-overlay pointer-events-none absolute inset-0 z-20 flex flex-col justify-end">
        <div
          style={{ paddingBottom: "calc(24px + var(--release-bar-h, 0px))" }}
          className="px-8"
        >
          <div
            ref={barRef}
            role="region"
            aria-label="Player"
            style={tint ? ({ "--btn-tint": tint } as CSSProperties) : undefined}
            className="mini-player pointer-events-auto relative isolate flex min-h-[64px] items-center gap-3 rounded-2xl glass-fake glass-dock px-3 py-2"
          >
            <button
              type="button"
              onClick={() => openContext(state.queue!.context, onOpenRelease, onOpenCollection)}
              aria-label={state.queue.context.kind === "collection" ? "Open the collection" : `Open ${info.album}`}
              className="flex min-w-0 shrink items-center gap-3 rounded-xl p-1 pr-3 text-left outline-none hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-accent basis-56"
            >
              <span className="block size-12 shrink-0 overflow-hidden rounded-[8px] shadow-[0_6px_16px_-6px_rgb(0_0_0/0.7)]">
                {info.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={info.coverUrl} alt="" className="size-full object-cover" />
                ) : (
                  <NoCover className="size-full" />
                )}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-text">{info.title}</span>
                {failed ? (
                  <span role="status" className="block truncate text-[13px] text-text-muted">
                    {COULDNT_PLAY}
                  </span>
                ) : (
                  <span className="block truncate text-[13px] text-text-muted">{info.artist}</span>
                )}
              </span>
            </button>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => playerStore.toggle()}
                aria-label={state.playing ? `Pause ${info.title}` : `Play ${info.title}`}
                className="btn-icon [--text-soft:var(--text)]"
              >
                {state.playing ? <PauseIcon className="size-6" /> : <PlayIcon className="size-6" />}
              </button>
              <button
                type="button"
                onClick={() => playerStore.next()}
                disabled={state.queue.index + 1 >= state.queue.items.length}
                aria-label="Next track"
                className="btn-icon [--text-soft:var(--text)]"
              >
                <NextTrackIcon className="size-6" />
              </button>
            </div>
            <div className="flex min-w-[9rem] flex-1 items-center gap-2">
              <span className="w-10 shrink-0 text-right text-xs tabular-nums text-text-muted">{formatClock(state.positionSec)}</span>
              <input
                type="range"
                aria-label="Seek"
                aria-valuetext={scrubberText(state.positionSec, duration)}
                min={0}
                max={duration > 0 ? Math.floor(duration) : 0}
                step={1}
                value={Math.min(Math.floor(state.positionSec), duration > 0 ? Math.floor(duration) : 0)}
                disabled={!(duration > 0)}
                onChange={(e) => seek(Number(e.currentTarget.value))}
                style={
                  {
                    "--scrub": `${duration > 0 ? Math.min(100, (state.positionSec / duration) * 100) : 0}%`,
                    "--scrub-tint": tint ?? "var(--accent)",
                  } as CSSProperties
                }
                className="mini-player-scrub h-8 min-w-0 flex-1 cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
              <span className="w-10 shrink-0 text-xs tabular-nums text-text-muted">{formatClock(duration)}</span>
            </div>
          </div>
        </div>
        </div>
      )}
    </>
  );
}
