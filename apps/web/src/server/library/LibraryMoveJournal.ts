import fs from "node:fs/promises";
import path from "node:path";

/** How far a move got. Written before the step it names starts or after it finishes, as the comments say. */
export type MovePhase = "moving" | "moved" | "indexed" | "switched";

/** The durable record of a library move in progress (#335), so a crash can be put right at the next start. */
export interface MoveJournal {
  from: string;
  to: string;
  mode: "rename" | "copy";
  /** moving: written before anything moves. moved: files are at `to`. indexed: paths rewritten. switched: settings point at `to`. */
  phase: MovePhase;
  /** True when this move made the `to` folder; only then may a rollback remove it. */
  toCreated: boolean;
}

export const JOURNAL_FILE = "library-move.json";

function file(dataDir: string): string {
  return path.join(dataDir, JOURNAL_FILE);
}

/** The journal, null when none, or "corrupt" when the file is there but unreadable. */
export async function readJournal(dataDir: string): Promise<MoveJournal | null | "corrupt"> {
  let raw: string;
  try {
    raw = await fs.readFile(file(dataDir), "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    return "corrupt";
  }
  try {
    const j = JSON.parse(raw) as Partial<MoveJournal>;
    const phases: MovePhase[] = ["moving", "moved", "indexed", "switched"];
    if (
      typeof j.from === "string" && path.isAbsolute(j.from) &&
      typeof j.to === "string" && path.isAbsolute(j.to) &&
      (j.mode === "rename" || j.mode === "copy") &&
      phases.includes(j.phase as MovePhase) &&
      typeof j.toCreated === "boolean"
    ) {
      return { from: j.from, to: j.to, mode: j.mode, phase: j.phase as MovePhase, toCreated: j.toCreated };
    }
  } catch {
    // falls through
  }
  return "corrupt";
}

/** Atomic and flushed to disk: tmp file, fsync, rename. Throws on failure, so a move never starts without one. */
export async function writeJournal(dataDir: string, journal: MoveJournal): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true });
  const tmp = `${file(dataDir)}.tmp-${process.pid}-${Date.now()}`;
  const handle = await fs.open(tmp, "w", 0o600);
  try {
    await handle.writeFile(JSON.stringify(journal, null, 2), "utf-8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(tmp, file(dataDir));
}

export async function clearJournal(dataDir: string): Promise<void> {
  await fs.rm(file(dataDir), { force: true });
}

// On globalThis: Next can load a module twice, and Settings must see what start-up recovery found.
const PROBLEM_KEY = Symbol.for("locally.libraryMoveProblem");

export const MOVE_PROBLEM_MESSAGE =
  "Locally found a library move that didn't finish and can't tell where your music should be. Nothing was deleted. Please contact support.";

export function setMoveProblem(message: string | null): void {
  (globalThis as unknown as Record<symbol, string | null>)[PROBLEM_KEY] = message;
}

export function getMoveProblem(): string | null {
  return (globalThis as unknown as Record<symbol, string | null | undefined>)[PROBLEM_KEY] ?? null;
}
