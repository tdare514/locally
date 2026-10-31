"use client";

import { useEffect, useState } from "react";
import type { PlaysStatus } from "../shared/types";
import { answerPlaysPrompt, getPlaysStatus, getSettings } from "../lib/api-client";
import { BusyLabel, BusyStatus } from "./Spinner";

interface PlaysPromptCardProps {
  onToast: (kind: "success" | "error", message: string) => void;
  /** Extra classes for the card's outer box, e.g. a top margin where the parent has no gap. */
  className?: string;
}

/** After "Turn on", how long the status line says "Checking" before it settles on what it last read. */
const SETTLE_MS = 6_000;
const SETTLING_POLL_MS = 1_000;
const STEADY_POLL_MS = 10_000;

const STATUS_LINES: Record<PlaysStatus, string> = {
  off: "Play counting is off.",
  on: "Play counting is on.",
  "spotify-not-running": "Play counting is on. Spotify isn't running right now.",
  "permission-denied":
    "Locally isn't allowed to see what Spotify is playing. Allow it in System Settings ▸ Privacy & Security ▸ Automation.",
};

type Phase = "loading" | "hidden" | "ask" | "turning-on" | "answered";

/**
 * One-time "Count your Spotify plays?" card (#110), shown in the empty-library onboarding and at
 * the top of a populated library until it is answered. Both buttons save `playsPromptAnswered`;
 * "Turn on" also sets `trackPlays`, which runs the first check and so raises the macOS prompt.
 * After "Turn on" the card shrinks to a status line that stays until the next load: it carries the
 * permission instructions, so it doesn't collapse. "Not now" removes the card for good.
 */
export default function PlaysPromptCard({ onToast, className = "" }: PlaysPromptCardProps) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [status, setStatus] = useState<PlaysStatus>("on");
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getSettings()
      .then((s) => {
        if (!cancelled) setPhase(s.playsPromptAnswered ? "hidden" : "ask");
      })
      .catch(() => {
        // Nice-to-have card; stay hidden on error rather than toast.
        if (!cancelled) setPhase("hidden");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // After "Turn on": the server's first check runs in the background (and waits on the macOS
  // prompt), so read the status every second for a few seconds, then every 10 s like Settings.
  useEffect(() => {
    if (phase !== "answered") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    const tick = async () => {
      try {
        const r = await getPlaysStatus();
        if (cancelled) return;
        setStatus(r.status);
        if (r.status !== "on") setChecking(false);
      } catch {
        // Status line is a nice-to-have; keep the last known value.
      }
      if (cancelled) return;
      const settled = Date.now() - startedAt >= SETTLE_MS;
      if (settled) setChecking(false);
      timer = setTimeout(tick, settled ? STEADY_POLL_MS : SETTLING_POLL_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [phase]);

  async function answer(turnOn: boolean) {
    setPhase("turning-on");
    try {
      await answerPlaysPrompt(turnOn);
      if (turnOn) {
        setChecking(true);
        setStatus("on");
        setPhase("answered");
      } else {
        setPhase("hidden");
      }
    } catch (e) {
      onToast("error", e instanceof Error ? e.message : "Failed to save setting");
      setPhase("ask");
    }
  }

  if (phase === "loading" || phase === "hidden") return null;

  const cardClass = `glass-fake relative isolate w-full rounded-xl text-left ${className}`;

  if (phase === "answered") {
    return (
      <div className={`${cardClass} px-5 py-3`}>
        <p
          role="status"
          className={`text-sm ${status === "permission-denied" ? "text-danger" : "text-text-soft"}`}
        >
          {checking ? "Checking with Spotify…" : STATUS_LINES[status]}
        </p>
      </div>
    );
  }

  const saving = phase === "turning-on";

  return (
    <section aria-labelledby="plays-prompt-title" className={`${cardClass} p-5`}>
      <h2 id="plays-prompt-title" className="text-lg font-bold tracking-[-0.02em] text-text">
        Count your Spotify plays?
      </h2>
      <p className="mt-1 text-sm leading-relaxed text-text-soft">
        Locally counts plays of your tracks while it runs. macOS will ask to let Locally see what
        Spotify is playing.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void answer(true)}
          disabled={saving}
          aria-busy={saving || undefined}
          className="btn-save w-fit"
        >
          <BusyLabel busy={saving}>Turn on</BusyLabel>
        </button>
        <BusyStatus busy={saving} text="Turning on" />
        <button
          type="button"
          onClick={() => void answer(false)}
          disabled={saving}
          className="btn-ink w-fit"
        >
          Not now
        </button>
      </div>
    </section>
  );
}
