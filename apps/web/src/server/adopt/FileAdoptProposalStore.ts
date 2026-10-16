import fs from "node:fs/promises";
import path from "node:path";
import { adoptProposalFilePath, settingsDir } from "../config/paths";
import type { AdoptProposal } from "./types";

let tmpCounter = 0;

function isProposal(v: unknown): v is AdoptProposal {
  if (!v || typeof v !== "object") return false;
  const p = v as Partial<AdoptProposal>;
  return (
    typeof p.scannedAt === "string" &&
    Array.isArray(p.roots) &&
    Array.isArray(p.groups) &&
    !!p.skipped &&
    typeof p.skipped === "object"
  );
}

/** Keeps the last scan's proposal in Locally's app data (`adopt-proposal.json`), so a review survives a restart. */
export class FileAdoptProposalStore {
  async save(proposal: AdoptProposal): Promise<void> {
    const dir = settingsDir();
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const tmp = path.join(dir, `.adopt-proposal.json.tmp-${process.pid}-${Date.now()}-${tmpCounter++}`);
    await fs.writeFile(tmp, JSON.stringify(proposal, null, 2), { encoding: "utf-8", mode: 0o600 });
    await fs.rename(tmp, adoptProposalFilePath());
  }

  /** The saved proposal, or null when there is none or the file is unreadable. */
  async load(): Promise<AdoptProposal | null> {
    let raw: string;
    try {
      raw = await fs.readFile(adoptProposalFilePath(), "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return null;
      throw err;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      return isProposal(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}
