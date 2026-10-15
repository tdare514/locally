"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import AmbientBackdrop from "../../AmbientBackdrop";
import AmbientSpace from "../../AmbientSpace";
import Sidebar from "../../Sidebar";
import type { AmbientPalette } from "../../../lib/artwork-palette";
import { useArtworkPalette } from "../../../lib/use-artwork-palette";
import Invitation from "./Invitation";
import MakeRecord from "./MakeRecord";
import { SAMPLE_COVERS } from "./sampleCovers";

/** Design prototype for #159, dev only (see app/dev/import/page.tsx). One cover beat (slide in,
 * the disc settles, the cover develops, the disc tucks away), an invitation (with the #122 accent
 * wash) and an empty record, both over the library's drifting colour sky. */
export type Stage = "invite" | "empty" | "beat" | "done";

interface ImportPrototypeProps {
  /** Where the prototype opens. The dev bar moves between stages without a reload. */
  stage: Stage;
  /** Freeze every animation at this many ms into its run, for frame capture. Null runs live. */
  t: number | null;
  /** Which sample cover the first beat uses. */
  coverIndex: number;
  bar: boolean;
}

/** Calm accent tones for the colour sky while there is no cover yet: the Import accent (#1E7DF0)
 * toned down the way artwork-palette.ts tones a cover (dark enough for white text), with a second
 * cloud leaning toward indigo. */
const INVITE_PALETTE: AmbientPalette = {
  primary: "#1f5bb5",
  secondary: "#3547a3",
  deep: "#0a1a3a",
};

/* The beat's clock, in ms from the moment the cover is chosen. The keyframes in globals.css
 * (.imp-cover, .imp-flash, .record-face, .record-disc under .imp-beat) hold the rest of it: slide
 * 0 for 420, flash 420 for 1000, disc tucks in and turns 800 for 600. */
/** The colour wash starts with the flash and then uses the backdrop's own 900ms fade. */
const WASH_AT = 420;
const WASH_MS = 900;

const noop = () => {};

/** True once `delay` ms have passed since `active` turned on. When frozen at `frozenAt` ms it is
 * a pure function of that time, so a captured frame is deterministic. */
function useAfter(delay: number, active: boolean, frozenAt: number | null): boolean {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    if (!active || frozenAt !== null) return;
    const id = window.setTimeout(() => setElapsed(true), delay);
    return () => {
      window.clearTimeout(id);
      setElapsed(false);
    };
  }, [delay, active, frozenAt]);
  if (!active) return false;
  return frozenAt !== null ? frozenAt >= delay : elapsed;
}

/** The backdrop palette part-way between two, as CSS colour mixes, for a frozen frame. */
function mixPalette(from: AmbientPalette, to: AmbientPalette, p: number): AmbientPalette {
  const mix = (a: string, b: string) => `color-mix(in srgb, ${a} ${Math.round((1 - p) * 100)}%, ${b})`;
  return {
    primary: mix(from.primary, to.primary),
    secondary: mix(from.secondary, to.secondary),
    deep: mix(from.deep, to.deep),
  };
}

const smooth = (p: number) => p * p * (3 - 2 * p);

function BarButton({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 transition-colors hover:text-white ${on ? "text-white" : ""}`}
    >
      {label}
    </button>
  );
}

export default function ImportPrototype({ stage, t, coverIndex, bar }: ImportPrototypeProps) {
  const frozen = t !== null;
  const [screen, setScreen] = useState<"invite" | "record">(stage === "invite" ? "invite" : "record");
  const [cover, setCover] = useState<number | null>(
    stage === "beat" || stage === "done" ? coverIndex : null,
  );
  // A cover that is simply there, with no beat (the "done" stage).
  const [still, setStill] = useState(stage === "done");
  // A click or key press mid-beat jumps the beat to its end state.
  const [skipped, setSkipped] = useState(false);
  // Bumped to replay the entrance.
  const [run, setRun] = useState(0);
  // The record fades in only when it arrives from the invitation, never when opened directly.
  const [enter, setEnter] = useState(false);
  const timer = useRef<number | null>(null);
  const picks = useRef(0);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const sample = cover === null ? null : SAMPLE_COVERS[cover];
  const finished = still || skipped;
  const beat = sample !== null && !finished;

  // Input never waits for the beat: a click or key press anywhere jumps it to the end state. The
  // event itself carries on (typing still types, a button still clicks).
  useEffect(() => {
    if (!beat || frozen) return;
    const skip = () => setSkipped(true);
    const skipOnKey = (e: KeyboardEvent) => {
      if (!e.repeat) skip();
    };
    window.addEventListener("pointerdown", skip, true);
    window.addEventListener("keydown", skipOnKey, true);
    return () => {
      window.removeEventListener("pointerdown", skip, true);
      window.removeEventListener("keydown", skipOnKey, true);
    };
  }, [beat, frozen]);

  // Colour wash: from the cover, starting with the flash. It leaves the calm invite colours.
  const live = useArtworkPalette(sample?.src ?? null);
  const washOn = useAfter(WASH_AT, beat, t);
  let palette: AmbientPalette | null = null;
  if (sample && live) {
    if (finished) palette = live;
    else if (frozen) palette = mixPalette(INVITE_PALETTE, live, smooth(Math.min(1, Math.max(0, (t - WASH_AT) / WASH_MS))));
    else if (washOn) palette = live;
  }
  const labelUrl = sample ? sample.src : null;

  function clearTimer() {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }
  function chooseCover() {
    setStill(false);
    setSkipped(false);
    setCover((coverIndex + picks.current++) % SAMPLE_COVERS.length);
  }
  function pickCover() {
    if (cover === null) chooseCover();
  }
  function showInvitation() {
    clearTimer();
    setCover(null);
    setStill(false);
    setSkipped(false);
    setScreen("invite");
    setRun((r) => r + 1);
  }
  function addTrack() {
    setEnter(true);
    setScreen("record");
  }
  function showEmpty() {
    clearTimer();
    setEnter(screen === "invite");
    setScreen("record");
    setCover(null);
    setStill(false);
    setSkipped(false);
  }
  function showDone() {
    clearTimer();
    setEnter(screen === "invite");
    setScreen("record");
    setStill(true);
    setSkipped(false);
    setCover((coverIndex + picks.current++) % SAMPLE_COVERS.length);
  }
  function replayBeat() {
    showEmpty();
    // Let the empty record show for a moment, then choose the cover.
    timer.current = window.setTimeout(chooseCover, 450);
  }

  const current: Stage = screen === "invite" ? "invite" : cover === null ? "empty" : still ? "done" : "beat";
  const style = frozen ? ({ "--imp-t": `${t}ms`, "--imp-run": "paused" } as CSSProperties) : undefined;
  // A frozen or finished page puts its final colours on the first paint; no 900ms fade to wait for.
  const settled = frozen || finished;

  return (
    <div style={style} className="relative isolate flex h-screen w-screen flex-col overflow-hidden md:flex-row">
      {/* The library's drifting colour sky, in calm accent tones, until the first cover. It fills
          the window, under the see-through sidebar and the pane, as in the library. */}
      <div aria-hidden className="imp-sky" data-sky={sample === null ? "on" : beat ? "out" : "off"}>
        <AmbientSpace palette={INVITE_PALETTE} />
      </div>
      <Sidebar
        releases={[]}
        loading={false}
        view={{ type: "import" }}
        query=""
        sort="newest"
        onClearQuery={noop}
        onSelectRelease={noop}
        onLibraryClick={noop}
        onImportClick={showInvitation}
        onSettingsClick={noop}
        signedIn={false}
        email={null}
      />
      <div className="relative isolate min-h-0 min-w-0 flex-1">
        <main className="relative isolate h-full overflow-y-auto p-6 md:p-10 lg:p-16">
          {sample && (
            <div aria-hidden className="imp-backdrop-in" data-beat={beat}>
              <AmbientBackdrop key={settled ? (palette ? "ready" : "wait") : undefined} palette={palette ?? INVITE_PALETTE} />
            </div>
          )}
          {screen === "invite" ? (
            <>
              <Invitation key={run} onAdd={addTrack} />
              {/* #122: the Import pill's accent, swept left to right across the pane. */}
              <div key={`wash${run}`} aria-hidden className="imp-wash">
                <div className="imp-wash-band" />
              </div>
            </>
          ) : (
            <MakeRecord
              enter={enter}
              cover={sample}
              beat={beat}
              finished={finished}
              labelUrl={labelUrl}
              onPickCover={pickCover}
            />
          )}
        </main>
      </div>
      {bar && (
        <nav
          aria-label="Prototype"
          className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/75 p-1 text-xs text-white/70 shadow-[0_16px_40px_-12px_rgb(0_0_0/0.8)] ring-1 ring-white/10"
        >
          <BarButton label="Invitation" on={current === "invite"} onClick={showInvitation} />
          <BarButton label="Empty record" on={current === "empty"} onClick={showEmpty} />
          <BarButton label="Replay beat" on={current === "beat"} onClick={replayBeat} />
          <BarButton label="Finished" on={current === "done"} onClick={showDone} />
        </nav>
      )}
    </div>
  );
}
