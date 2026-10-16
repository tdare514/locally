// Putting a page's scroll back after Back (#258). A page like Stats remounts with a loading
// placeholder, so the scroll can only be set once its content is tall enough. Pure step plus a
// small DOM runner.

/** How long after the page says it is ready the content may take to grow tall enough. */
export const SCROLL_RESTORE_TIMEOUT_MS = 3000;
/** The longest a restore waits in all, ready or not. */
export const SCROLL_RESTORE_HARD_CAP_MS = 20000;

export interface ScrollRestore {
  target: number;
  startedAt: number;
  /** When the page first said it was ready; null while it has not. */
  readyAt: number | null;
  cancelled: boolean;
}

export interface ScrollStep {
  /** Set scrollTop to this, or leave it when undefined. */
  scrollTo?: number;
  done: boolean;
}

export function startRestore(target: number, now: number): ScrollRestore {
  return { target, startedAt: now, readyAt: null, cancelled: false };
}

/** The user scrolled or pressed a key: stop, and never move the page again. */
export function cancelRestore(state: ScrollRestore): void {
  state.cancelled = true;
}

/** One layout tick. While the page is not ready (Stats still loading) nothing moves. Once it is,
 * done when the content is tall enough (scroll there) or 3 s after readiness (as far as it
 * goes). Never later than the hard cap, and when cancelled it touches nothing. */
export function restoreStep(
  state: ScrollRestore,
  m: { scrollHeight: number; clientHeight: number; now: number; ready: boolean },
  timeoutMs: number = SCROLL_RESTORE_TIMEOUT_MS,
  hardCapMs: number = SCROLL_RESTORE_HARD_CAP_MS
): ScrollStep {
  if (state.cancelled) return { done: true };
  const max = Math.max(0, m.scrollHeight - m.clientHeight);
  if (m.ready && state.readyAt === null) state.readyAt = m.now;
  if (!m.ready) state.readyAt = null;
  if (m.ready && max >= state.target) return { scrollTo: state.target, done: true };
  if (m.now - state.startedAt >= hardCapMs) return m.ready ? { scrollTo: max, done: true } : { done: true };
  if (m.ready && state.readyAt !== null && m.now - state.readyAt >= timeoutMs) return { scrollTo: max, done: true };
  return { done: false };
}

/** Runs the restore on each frame for `el`; returns a stop function. */
export function runScrollRestore(el: HTMLElement, target: number, isReady: () => boolean): () => void {
  const state = startRestore(target, performance.now());
  let raf = 0;
  const stop = () => {
    cancelRestore(state);
    cancelAnimationFrame(raf);
    for (const type of EVENTS) el.removeEventListener(type, stop);
    window.removeEventListener("keydown", stop);
  };
  const EVENTS = ["wheel", "touchstart", "pointerdown"] as const;
  const tick = () => {
    const step = restoreStep(state, {
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      now: performance.now(),
      ready: isReady(),
    });
    if (step.scrollTo !== undefined) el.scrollTop = step.scrollTo;
    if (step.done) stop();
    else raf = requestAnimationFrame(tick);
  };
  for (const type of EVENTS) el.addEventListener(type, stop, { passive: true });
  window.addEventListener("keydown", stop);
  tick();
  return stop;
}
