import { after } from "next/server";

export type AfterResponseRunner = (task: () => Promise<void>) => void;

let overrideRunner: AfterResponseRunner | undefined;

/**
 * Test-only: replace how `runAfterResponse` schedules work. Pass `undefined`
 * to restore the default (Next `after()`, with a fire-and-forget fallback
 * outside a request scope). Used by route tests that assert the response
 * returns before deferred email / prune work finishes.
 */
export function setAfterResponseRunner(runner: AfterResponseRunner | undefined): void {
  overrideRunner = runner;
}

/**
 * Schedule work to run after the HTTP response is sent (#31).
 *
 * Uses Next's `after()` inside a request scope (keeps the function alive on
 * Vercel until the task settles). Outside one — unit tests that call route
 * handlers directly — falls back to a microtask so the handler can still
 * return first; FakeMailer's sync bookkeeping still lands before the next
 * `await` in typical tests. Install `setAfterResponseRunner` when a test
 * needs an explicit gate between the response and the deferred work.
 *
 * Callers must catch and log inside `task`; this helper never surfaces
 * deferred failures as a request 500.
 */
export function runAfterResponse(task: () => Promise<void>): void {
  if (overrideRunner) {
    overrideRunner(task);
    return;
  }

  try {
    after(task);
  } catch {
    void Promise.resolve()
      .then(task)
      .catch((err: unknown) => {
        console.error(
          JSON.stringify({
            level: "error",
            event: "after_response_fallback_failed",
            error: err instanceof Error ? err.message : String(err),
          })
        );
      });
  }
}
