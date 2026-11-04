import { eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { invites } from "../../db/schema";
import { emailSchema } from "../../shared/types";

export interface InviteRow {
  email: string;
  invitedBy: string;
  createdAt: number;
  usedAt: number | null;
}

/** Normalise exactly as `POST /v1/auth/code` does (`emailSchema`: trim, lowercase, valid address). Throws on a bad one. */
export function normaliseInviteEmail(raw: string): string {
  const parsed = emailSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Not a valid email address");
  return parsed.data;
}

/** The invite list behind `npm run invite` (#186). Not reachable over HTTP. */
export class InviteService {
  constructor(
    private readonly db: Db,
    private readonly now: () => number = () => Date.now()
  ) {}

  /** Add an invite, or re-arm a used one (clearing `used_at`). Returns the normalised email. */
  async add(rawEmail: string, invitedBy: string): Promise<string> {
    const email = normaliseInviteEmail(rawEmail);
    const createdAt = this.now();
    await this.db
      .insert(invites)
      .values({ email, invitedBy, createdAt, usedAt: null })
      .onConflictDoUpdate({ target: invites.email, set: { invitedBy, createdAt, usedAt: null } });
    return email;
  }

  async list(): Promise<InviteRow[]> {
    return this.db.select().from(invites).orderBy(invites.createdAt);
  }

  /** Returns whether an invite existed. */
  async remove(rawEmail: string): Promise<boolean> {
    const email = normaliseInviteEmail(rawEmail);
    const removed = await this.db.delete(invites).where(eq(invites.email, email)).returning({ email: invites.email });
    return removed.length > 0;
  }
}
