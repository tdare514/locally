"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import AmbientBackdrop from "../../AmbientBackdrop";
import Sidebar from "../../Sidebar";
import { NEUTRAL_PALETTE, type AmbientPalette } from "../../../lib/artwork-palette";
import { useArtworkPalette } from "../../../lib/use-artwork-palette";
import Invitation from "./Invitation";
import MakeRecord from "./MakeRecord";
import { SAMPLE_COVERS } from "./sampleCovers";

/** Design prototype for #159, dev only (see app/dev/import/page.tsx). Three cover beats, one
 * shared invitation (with the #122 accent wash) and one shared empty record. */
export type Variant = 1 | 2 | 3;
export type Stage = "invite" | "empty" | "beat" | "done";

interface ImportPrototypeProps {
  variant: Variant;
  /** Where the prototype opens. The dev bar moves between stages without a reload. */
  stage: Stage;
  /** Freeze every animation at this many ms into its run, for frame capture. Null runs live. */
  t: number | null;
  /** Which sample cover the first beat uses. */
  coverIndex: number;
  bar: boolean;
}

const VARIANTS: { value: Variant; label: string }[] = [
  { value: 1, label: "Slide in" },
  { value: 2, label: "Press" },
  { value: 3, label: "Develop" },
];

/** The colour wash starts this far into the beat and then uses the backdrop's own 900ms fade,
 * so every beat is over by about a second. */
const WASH_AT = 100;
const WASH_MS = 900;
/** When the disc's centre label takes the cover: about when the cover lands. */
const LABEL_AT: Record<Variant, number> = { 1: 240, 2: 260, 3: 420 };

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

export default function ImportPrototype({ variant, stage, t, coverIndex, bar }: ImportPrototypeProps) {
  const frozen = t !== null;
  const [screen, setScreen] = useState<"invite" | "record">(stage === "invite" ? "invite" : "record");
  const [cover, setCover] = useState<number | null>(
    stage === "beat" || stage === "done" ? coverIndex : null,
  );
  // A cover that is simply there, with no beat (the "done" stage).
  const [still, setStill] = useState(stage === "done");
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
  const beat = sample !== null && !still;

  // Colour wash: from the cover, starting a moment into the beat.
  const live = useArtworkPalette(sample?.src ?? null);
  const washOn = useAfter(WASH_AT, beat, t);
  let palette: AmbientPalette | null = null;
  if (sample && live) {
    if (still) palette = live;
    else if (frozen) palette = mixPalette(NEUTRAL_PALETTE, live, smooth(Math.min(1, Math.max(0, (t - WASH_AT) / WASH_MS))));
    else if (washOn) palette = live;
  }
  const labelOn = useAfter(LABEL_AT[variant], beat, t);
  const labelUrl = sample && (still || labelOn) ? sample.src : null;

  function clearTimer() {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }
  function chooseCover() {
    setStill(false);
    setCover((coverIndex + picks.current++) % SAMPLE_COVERS.length);
  }
  function pickCover() {
    if (cover === null) chooseCover();
  }
  function showInvitation() {
    clearTimer();
    setCover(null);
    setStill(false);
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
  }
  function showDone() {
    clearTimer();
    setEnter(screen === "invite");
    setScreen("record");
    setStill(true);
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
  const settled = frozen || still;

  return (
    <div style={style} className="relative isolate flex h-screen w-screen flex-col overflow-hidden md:flex-row">
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
          <AmbientBackdrop key={settled ? (palette ? "ready" : "wait") : undefined} palette={palette} />
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
              variant={variant}
              enter={enter}
              cover={sample}
              beat={beat}
              labelUrl={labelUrl}
              onPickCover={pickCover}
            />
          )}
        </main>
      </div>
      {bar && (
        <nav
          aria-label="Prototype"
          className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/75 p-1 text-xs text-white/70 shadow-[0_16px_40px_-12px_rgb(0_0_0/0.8)] ring-1 ring-white/10 backdrop-blur-xl"
        >
          {VARIANTS.map((v) => (
            <a
              key={v.value}
              href={`/dev/import?v=${v.value}&stage=${current}&c=${coverIndex}`}
              aria-current={v.value === variant ? "page" : undefined}
              className={`rounded-full px-3 py-1.5 transition-colors hover:text-white aria-[current=page]:bg-white/15 aria-[current=page]:text-white`}
            >
              {v.value} {v.label}
            </a>
          ))}
          <span aria-hidden className="mx-1 h-4 w-px bg-white/15" />
          <BarButton label="Invitation" on={current === "invite"} onClick={showInvitation} />
          <BarButton label="Empty record" on={current === "empty"} onClick={showEmpty} />
          <BarButton label="Replay beat" on={current === "beat"} onClick={replayBeat} />
          <BarButton label="Finished" on={current === "done"} onClick={showDone} />
        </nav>
      )}
    </div>
  );
}
