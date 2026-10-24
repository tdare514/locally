import { ValidationError } from "../../shared/errors";
import { getMoveProblem } from "./LibraryMoveJournal";

/** Raised by a move that cannot start because a write is running (answered 409). */
export class LibraryBusyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LibraryBusyError";
  }
}

interface Activity {
  active: number;
  moving: boolean;
}

// On globalThis: Next can load this module twice (once per route bundle), and the count must be shared.
const KEY = Symbol.for("locally.libraryWriteActivity");
function state(): Activity {
  const g = globalThis as unknown as Record<symbol, Activity | undefined>;
  return (g[KEY] ??= { active: 0, moving: false });
}

const GATE_KEY = Symbol.for("locally.libraryRecoveryGate");

/** The start-up recovery of an unfinished move (#335); every library write waits for it. Unset means settled. */
export function setRecoveryGate(gate: Promise<unknown> | null): void {
  (globalThis as unknown as Record<symbol, Promise<unknown> | null>)[GATE_KEY] = gate;
}

/** Runs one library write (import, edit, cover, delete, a sync write) and counts it while it runs. Refused during a move. */
export async function trackLibraryWrite<T>(fn: () => Promise<T>): Promise<T> {
  // Wait for recovery first, so a write at start-up can't pass the checks below before it has reported.
  await ((globalThis as unknown as Record<symbol, Promise<unknown> | null | undefined>)[GATE_KEY] ?? undefined);
  const s = state();
  if (s.moving) throw new ValidationError("Locally is moving your library. Try again in a moment.");
  // A move that did not finish and could not be sorted out: nothing may write until it is (#335).
  if (getMoveProblem() !== null) throw new ValidationError("Locally is finishing a library move. Try again in a moment.");
  s.active++;
  try {
    return await fn();
  } finally {
    s.active--;
  }
}

/** True while an import or sync write is running. */
export function libraryWriteBusy(): boolean {
  return state().active > 0;
}

/** Runs the move with every other library write held off; refuses to start while one is running. */
export async function runLibraryMove<T>(fn: () => Promise<T>): Promise<T> {
  const s = state();
  if (s.moving) throw new LibraryBusyError("Your library is already being moved.");
  if (s.active > 0) throw new LibraryBusyError("An import or a sync is writing to your library. Try again when it has finished.");
  s.moving = true;
  try {
    return await fn();
  } finally {
    s.moving = false;
  }
}
