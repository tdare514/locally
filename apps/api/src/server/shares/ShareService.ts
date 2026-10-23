import crypto from "node:crypto";
import { and, count, desc, eq, gt, inArray, isNull, lt, or, sql, sum } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { Db } from "../../db/client";
import { files, releases, shareDownloads, shareLinks, shareRecipients, shares, users } from "../../db/schema";
import { ConflictError, ForbiddenError, NotFoundError, UploadTooLargeError, ValidationError } from "../../shared/errors";
import {
  MAX_SHARE_DEPTH,
  type CreateShareRequest,
  type CreateShareResponse,
  type DownloadTicket,
  type ReceivedShare,
  type ReleaseRecord,
  type ReshareRequest,
  type SentShare,
  type ShareSnapshot,
} from "../../shared/types";
import type { FileStore } from "../files/FileStore";
import { shareTreeIds } from "./tree";
import { createZipStream, ZIP_MAX_TOTAL_BYTES, type ZipEntry } from "./zip";

type ShareRow = typeof shares.$inferSelect;

const DAY_MS = 24 * 60 * 60 * 1000;
const NOT_FOUND = "Share not found";

export interface ShareServiceOptions {
  /** `PUBLIC_SHARES_ENABLED` (the kill switch): off means no public share can be made and every `/s/*` answers 404. */
  publicSharesEnabled: boolean;
  /** Fetches a signed download URL's bytes for the zip. Injected in tests; the default is the global `fetch`. */
  fetchFile?: (url: string) => Promise<Response>;
}

export interface EgressReport {
  windowHours: 24;
  totalBytes: number;
  totalDownloads: number;
  topByDownloads: Array<{ shareId: string; downloads: number; bytes: number }>;
  topByBytes: Array<{ shareId: string; downloads: number; bytes: number }>;
}

/** sha256 hex of a link token: the only form in which a token is stored or used as a key. */
export function hashLinkToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

const iso = (ms: number): string => new Date(ms).toISOString();

/** The release record's own fields at share time, `tracks` filtered to `trackIds` (null = all) in release order. */
export function snapshotOf(record: ReleaseRecord, trackIds: string[] | null): ShareSnapshot {
  const wanted = trackIds ? new Set(trackIds) : null;
  return {
    kind: record.kind,
    title: record.title,
    artist: record.artist,
    year: record.year,
    ...(record.releaseDate !== undefined ? { releaseDate: record.releaseDate } : {}),
    genre: record.genre,
    cover: record.cover,
    coverHash: record.coverHash ?? null,
    tracks: record.tracks
      .filter((t) => !wanted || wanted.has(t.id))
      .map((t) => ({
        id: t.id,
        title: t.title,
        trackNumber: t.trackNumber,
        ...(t.discNumber !== undefined ? { discNumber: t.discNumber } : {}),
        file: t.file,
        bytes: t.bytes,
        ...(t.durationSec !== null && t.durationSec !== undefined ? { durationSec: t.durationSec } : {}),
      })),
  };
}

function encodeCursor(createdAt: number, id: string): string {
  return Buffer.from(`${createdAt}.${id}`).toString("base64url");
}

function decodeCursor(raw: string): { createdAt: number; id: string } {
  const text = Buffer.from(raw, "base64url").toString("utf8");
  const dot = text.indexOf(".");
  const createdAt = Number(text.slice(0, dot));
  const id = text.slice(dot + 1);
  if (dot < 1 || !Number.isSafeInteger(createdAt) || id.length === 0) throw new ValidationError("cursor: Invalid cursor");
  return { createdAt, id };
}

/**
 * Sharing (#146, #181; `spec/sync.md` "Shares"). A share points at the root owner's stored files, never a copy.
 * Every recipient method checks the recipient row AND the share's state (revoked, expired, any revoked or
 * expired ancestor) and answers 404 otherwise; owner methods check `owner_user_id`. The public methods take a
 * link token, look it up by its sha256, and return null for every bad state so the routes can answer one
 * identical 404.
 */
export class ShareService {
  private readonly fetchFile: (url: string) => Promise<Response>;

  constructor(
    private readonly db: Db,
    private readonly fileStore: FileStore,
    private readonly options: ShareServiceOptions,
    private readonly now: () => number = () => Date.now()
  ) {
    this.fetchFile = options.fetchFile ?? ((url) => fetch(url));
  }

  get publicSharesEnabled(): boolean {
    return this.options.publicSharesEnabled;
  }

  // --- state ---

  /** Not revoked, not expired, and the same for every ancestor. A missing ancestor counts as dead. */
  private async isLive(share: ShareRow): Promise<boolean> {
    const now = this.now();
    let current: ShareRow | undefined = share;
    for (let hops = 0; current && hops <= MAX_SHARE_DEPTH + 1; hops++) {
      if (current.revokedAt !== null || (current.expiresAt !== null && current.expiresAt <= now)) return false;
      if (current.parentShareId === null) return true;
      [current] = await this.db.select().from(shares).where(eq(shares.id, current.parentShareId));
    }
    return false;
  }

  /** The share and the caller's recipient row, 404 unless the caller is a recipient and the share is live. */
  private async recipientShare(userId: string, shareId: string) {
    const [row] = await this.db
      .select({ share: shares, recipient: shareRecipients })
      .from(shareRecipients)
      .innerJoin(shares, eq(shares.id, shareRecipients.shareId))
      .where(and(eq(shareRecipients.shareId, shareId), eq(shareRecipients.userId, userId)));
    if (!row || !(await this.isLive(row.share))) throw new NotFoundError(NOT_FOUND);
    return row;
  }

  private assertPublicEnabled(): void {
    if (!this.options.publicSharesEnabled) throw new ForbiddenError("public_links_disabled");
  }

  // --- create and reshare ---

  async create(owner: { id: string; email: string }, input: CreateShareRequest, origin: string): Promise<CreateShareResponse> {
    if (input.visibility === "public") this.assertPublicEnabled();

    const [release] = await this.db.select().from(releases).where(eq(releases.id, input.releaseId));
    if (!release || release.userId !== owner.id || release.deleted) throw new NotFoundError("Release not found");
    if (release.record.source === "adopted") throw new ConflictError("adopted");

    let trackIds: string[] | null = null;
    if (input.trackIds) {
      trackIds = [...new Set(input.trackIds)];
      const known = new Set(release.record.tracks.map((t) => t.id));
      if (trackIds.some((id) => !known.has(id))) throw new ValidationError("trackIds: Must be tracks of this release");
    }

    return this.insertShare({
      owner,
      releaseId: release.id,
      fileOwnerUserId: owner.id,
      parentShareId: null,
      depth: 0,
      trackIds,
      snapshot: snapshotOf(release.record, trackIds),
      visibility: input.visibility,
      allowReshare: input.allowReshare,
      expiresAt: input.expiresInDays === null ? null : this.now() + input.expiresInDays * DAY_MS,
      recipients: input.recipients,
      origin,
    });
  }

  async reshare(owner: { id: string; email: string }, shareId: string, input: ReshareRequest, origin: string): Promise<CreateShareResponse> {
    const { share: parent } = await this.recipientShare(owner.id, shareId);
    if (!parent.allowReshare || parent.depth + 1 > MAX_SHARE_DEPTH) throw new ForbiddenError("reshare_not_allowed");
    if (input.visibility === "public") this.assertPublicEnabled();

    // A child never outlives its parent.
    const requested = input.expiresInDays === null ? null : this.now() + input.expiresInDays * DAY_MS;
    const expiresAt = requested === null ? parent.expiresAt : parent.expiresAt === null ? requested : Math.min(requested, parent.expiresAt);

    return this.insertShare({
      owner,
      releaseId: parent.releaseId,
      fileOwnerUserId: parent.fileOwnerUserId,
      parentShareId: parent.id,
      depth: parent.depth + 1,
      trackIds: parent.trackIdsJson ?? null,
      snapshot: parent.snapshotJson,
      visibility: input.visibility,
      allowReshare: input.allowReshare,
      expiresAt,
      recipients: input.recipients,
      origin,
    });
  }

  private async insertShare(p: {
    owner: { id: string; email: string };
    releaseId: string;
    fileOwnerUserId: string;
    parentShareId: string | null;
    depth: number;
    trackIds: string[] | null;
    snapshot: ShareSnapshot;
    visibility: "private" | "public";
    allowReshare: boolean;
    expiresAt: number | null;
    recipients: string[];
    origin: string;
  }): Promise<CreateShareResponse> {
    const wanted = [...new Set(p.recipients.filter((email) => email !== p.owner.email))];
    const found = wanted.length > 0 ? await this.db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.email, wanted)) : [];
    const known = new Set(found.map((u) => u.email));
    const notOnLocally = wanted.filter((email) => !known.has(email));
    const recipients = found.filter((u) => u.id !== p.owner.id);

    // A private share nobody can receive is not created.
    if (p.visibility === "private" && recipients.length === 0) return { share: null, notOnLocally, link: null };

    const id = crypto.randomUUID();
    const createdAt = this.now();
    const token = p.visibility === "public" ? crypto.randomBytes(32).toString("base64url") : null;

    const statements: BatchItem<"sqlite">[] = [
      this.db.insert(shares).values({
        id,
        ownerUserId: p.owner.id,
        releaseId: p.releaseId,
        fileOwnerUserId: p.fileOwnerUserId,
        parentShareId: p.parentShareId,
        depth: p.depth,
        trackIdsJson: p.trackIds,
        visibility: p.visibility,
        allowReshare: p.allowReshare,
        expiresAt: p.expiresAt,
        revokedAt: null,
        createdAt,
        snapshotJson: p.snapshot,
      }),
    ];
    if (recipients.length > 0) {
      statements.push(
        this.db.insert(shareRecipients).values(recipients.map((u) => ({ shareId: id, userId: u.id, claimedAt: null, hiddenAt: null, createdAt })))
      );
    }
    if (token) statements.push(this.db.insert(shareLinks).values({ shareId: id, tokenHash: hashLinkToken(token), createdAt }));
    await this.db.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);

    const share: SentShare = {
      id,
      releaseId: p.releaseId,
      trackIds: p.trackIds,
      visibility: p.visibility,
      allowReshare: p.allowReshare,
      expiresAt: p.expiresAt === null ? null : iso(p.expiresAt),
      revokedAt: null,
      createdAt: iso(createdAt),
      snapshot: p.snapshot,
      recipients: recipients.map((u) => ({ email: u.email, claimedAt: null })),
      hasLink: token !== null,
      parentShareId: p.parentShareId,
      downloads: 0,
    };
    return { share, notOnLocally, link: token ? `${p.origin}/s/${token}` : null };
  }

  // --- list ---

  async listSent(userId: string, cursor: string | undefined, limit: number): Promise<{ shares: SentShare[]; nextCursor: string | null }> {
    const after = cursor ? decodeCursor(cursor) : null;
    const rows = await this.db
      .select()
      .from(shares)
      .where(
        and(
          eq(shares.ownerUserId, userId),
          after ? or(lt(shares.createdAt, after.createdAt), and(eq(shares.createdAt, after.createdAt), lt(shares.id, after.id))) : undefined
        )
      )
      .orderBy(desc(shares.createdAt), desc(shares.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const ids = page.map((r) => r.id);

    const [recipientRows, linkRows, downloadRows] =
      ids.length === 0
        ? [[], [], []]
        : await Promise.all([
            this.db
              .select({ shareId: shareRecipients.shareId, email: users.email, claimedAt: shareRecipients.claimedAt })
              .from(shareRecipients)
              .innerJoin(users, eq(users.id, shareRecipients.userId))
              .where(inArray(shareRecipients.shareId, ids))
              .orderBy(shareRecipients.createdAt, users.email),
            this.db.select({ shareId: shareLinks.shareId }).from(shareLinks).where(inArray(shareLinks.shareId, ids)),
            this.db
              .select({ shareId: shareDownloads.shareId, n: count() })
              .from(shareDownloads)
              .where(inArray(shareDownloads.shareId, ids))
              .groupBy(shareDownloads.shareId),
          ]);
    const withLink = new Set(linkRows.map((l) => l.shareId));
    const downloads = new Map(downloadRows.map((d) => [d.shareId, d.n]));

    const result = page.map((row): SentShare => ({
      id: row.id,
      releaseId: row.releaseId,
      trackIds: row.trackIdsJson ?? null,
      visibility: row.visibility,
      allowReshare: row.allowReshare,
      expiresAt: row.expiresAt === null ? null : iso(row.expiresAt),
      revokedAt: row.revokedAt === null ? null : iso(row.revokedAt),
      createdAt: iso(row.createdAt),
      snapshot: row.snapshotJson,
      recipients: recipientRows
        .filter((r) => r.shareId === row.id)
        .map((r) => ({ email: r.email, claimedAt: r.claimedAt === null ? null : iso(r.claimedAt) })),
      hasLink: withLink.has(row.id),
      parentShareId: row.parentShareId,
      downloads: downloads.get(row.id) ?? 0,
    }));
    const last = page[page.length - 1];
    return { shares: result, nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null };
  }

  private toReceived(row: ShareRow, fromEmail: string, claimedAt: number | null): ReceivedShare {
    return {
      id: row.id,
      from: { email: fromEmail },
      trackIds: row.trackIdsJson ?? null,
      allowReshare: row.allowReshare,
      canReshare: row.allowReshare && row.depth < MAX_SHARE_DEPTH,
      expiresAt: row.expiresAt === null ? null : iso(row.expiresAt),
      createdAt: iso(row.createdAt),
      claimedAt: claimedAt === null ? null : iso(claimedAt),
      snapshot: row.snapshotJson,
    };
  }

  /** Live shares only: the share, the recipient row and every ancestor must be unrevoked and unexpired; hidden ones are left out. */
  async listReceived(userId: string, cursor: string | undefined, limit: number): Promise<{ shares: ReceivedShare[]; nextCursor: string | null }> {
    const after = cursor ? decodeCursor(cursor) : null;
    const now = this.now();
    const rows = await this.db
      .select({ share: shares, claimedAt: shareRecipients.claimedAt, fromEmail: users.email })
      .from(shareRecipients)
      .innerJoin(shares, eq(shares.id, shareRecipients.shareId))
      .innerJoin(users, eq(users.id, shares.ownerUserId))
      .where(
        and(
          eq(shareRecipients.userId, userId),
          isNull(shareRecipients.hiddenAt),
          isNull(shares.revokedAt),
          or(isNull(shares.expiresAt), gt(shares.expiresAt, now)),
          // Every ancestor must exist, be unrevoked and unexpired (a chain is at most MAX_SHARE_DEPTH long).
          sql`(shares.parent_share_id IS NULL OR EXISTS (SELECT 1 FROM shares pp WHERE pp.id = shares.parent_share_id))`,
          sql`NOT EXISTS (
            WITH RECURSIVE anc(id, parent_share_id, revoked_at, expires_at) AS (
              SELECT p.id, p.parent_share_id, p.revoked_at, p.expires_at FROM shares p WHERE p.id = shares.parent_share_id
              UNION ALL
              SELECT q.id, q.parent_share_id, q.revoked_at, q.expires_at FROM shares q JOIN anc ON q.id = anc.parent_share_id
            )
            SELECT 1 FROM anc WHERE revoked_at IS NOT NULL OR (expires_at IS NOT NULL AND expires_at <= ${now})
          )`,
          after ? or(lt(shares.createdAt, after.createdAt), and(eq(shares.createdAt, after.createdAt), lt(shares.id, after.id))) : undefined
        )
      )
      .orderBy(desc(shares.createdAt), desc(shares.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      shares: page.map((r) => this.toReceived(r.share, r.fromEmail, r.claimedAt)),
      nextCursor: rows.length > limit && last ? encodeCursor(last.share.createdAt, last.share.id) : null,
    };
  }

  // --- owner and recipient actions ---

  /** Revokes the share and every descendant. Idempotent. 404 unless the caller owns it. */
  async revoke(userId: string, shareId: string): Promise<void> {
    const [row] = await this.db.select({ id: shares.id }).from(shares).where(and(eq(shares.id, shareId), eq(shares.ownerUserId, userId)));
    if (!row) throw new NotFoundError(NOT_FOUND);
    const ids = await shareTreeIds(this.db, [shareId]);
    await this.db.update(shares).set({ revokedAt: this.now() }).where(and(inArray(shares.id, ids), isNull(shares.revokedAt)));
  }

  async claim(userId: string, shareId: string): Promise<{ claimedAt: string }> {
    const { recipient } = await this.recipientShare(userId, shareId);
    if (recipient.claimedAt !== null) return { claimedAt: iso(recipient.claimedAt) };
    await this.db
      .update(shareRecipients)
      .set({ claimedAt: this.now() })
      .where(and(eq(shareRecipients.shareId, shareId), eq(shareRecipients.userId, userId), isNull(shareRecipients.claimedAt)));
    const [fresh] = await this.db
      .select({ claimedAt: shareRecipients.claimedAt })
      .from(shareRecipients)
      .where(and(eq(shareRecipients.shareId, shareId), eq(shareRecipients.userId, userId)));
    return { claimedAt: iso(fresh?.claimedAt ?? this.now()) };
  }

  async hide(userId: string, shareId: string): Promise<void> {
    await this.recipientShare(userId, shareId);
    await this.db
      .update(shareRecipients)
      .set({ hiddenAt: this.now() })
      .where(and(eq(shareRecipients.shareId, shareId), eq(shareRecipients.userId, userId)));
  }

  /** The stored file behind a snapshot name (the cover or one of its tracks), or null. */
  private async storedFile(share: ShareRow, name: string): Promise<{ storageKey: string; bytes: number } | null> {
    const snapshot = share.snapshotJson;
    if (name !== snapshot.cover && !snapshot.tracks.some((t) => t.file === name)) return null;
    const [row] = await this.db
      .select({ storageKey: files.storageKey, bytes: files.bytes })
      .from(files)
      .where(and(eq(files.releaseId, share.releaseId), eq(files.userId, share.fileOwnerUserId), eq(files.name, name)));
    return row ?? null;
  }

  private async recordDownload(shareId: string, name: string, via: "recipient" | "link", bytes: number): Promise<void> {
    await this.db.insert(shareDownloads).values({ shareId, name, at: this.now(), via, bytes });
  }

  /** A 5-minute signed URL for one blob of a share the caller received. Records the download. */
  async recipientFile(userId: string, shareId: string, name: string): Promise<DownloadTicket> {
    const { share } = await this.recipientShare(userId, shareId);
    const file = await this.storedFile(share, name);
    if (!file) throw new NotFoundError("File not found");
    const ticket = await this.fileStore.createDownload(file.storageKey);
    await this.recordDownload(share.id, name, "recipient", file.bytes);
    return ticket;
  }

  /** Adds the caller as a recipient of the public share behind `token`. Every bad state is the same 404. */
  async claimLink(userId: string, token: string): Promise<ReceivedShare> {
    const share = await this.linkShare(token);
    // The sender (and the root owner of the files) already has it.
    if (!share || share.ownerUserId === userId || share.fileOwnerUserId === userId) throw new NotFoundError("Link not found");
    const at = this.now();
    await this.db
      .insert(shareRecipients)
      .values({ shareId: share.id, userId, claimedAt: null, hiddenAt: null, createdAt: at })
      .onConflictDoUpdate({ target: [shareRecipients.shareId, shareRecipients.userId], set: { hiddenAt: null } });
    const [row] = await this.db
      .select({ claimedAt: shareRecipients.claimedAt, fromEmail: users.email })
      .from(shareRecipients)
      .innerJoin(users, eq(users.id, share.ownerUserId))
      .where(and(eq(shareRecipients.shareId, share.id), eq(shareRecipients.userId, userId)));
    if (!row) throw new NotFoundError("Link not found");
    return this.toReceived(share, row.fromEmail, row.claimedAt);
  }

  // --- public links ---

  /** The live public share behind a token, or null for unknown, revoked, expired, not-public or disabled. */
  private async linkShare(token: string): Promise<ShareRow | null> {
    if (!this.options.publicSharesEnabled) return null;
    const [row] = await this.db
      .select({ share: shares })
      .from(shareLinks)
      .innerJoin(shares, eq(shares.id, shareLinks.shareId))
      .where(eq(shareLinks.tokenHash, hashLinkToken(token)));
    if (!row || row.share.visibility !== "public" || !(await this.isLive(row.share))) return null;
    return row.share;
  }

  /**
   * What the public page shows: the snapshot, and the origin its cover will be served from (for the page's
   * `img-src`), or null when there is no cover to serve.
   */
  async publicView(token: string): Promise<{ snapshot: ShareSnapshot; coverOrigin: string | null } | null> {
    const share = await this.linkShare(token);
    if (!share) return null;
    let coverOrigin: string | null = null;
    const cover = share.snapshotJson.cover;
    const file = cover ? await this.storedFile(share, cover) : null;
    if (file) coverOrigin = new URL((await this.fileStore.createDownload(file.storageKey)).url).origin;
    return { snapshot: share.snapshotJson, coverOrigin };
  }

  /** A 5-minute signed URL for one blob of a public share. Records the download. */
  async publicFile(token: string, name: string): Promise<DownloadTicket | null> {
    const share = await this.linkShare(token);
    if (!share) return null;
    const file = await this.storedFile(share, name);
    if (!file) return null;
    const ticket = await this.fileStore.createDownload(file.storageKey);
    await this.recordDownload(share.id, name, "link", file.bytes);
    return ticket;
  }

  /**
   * One store-only zip of the shared track files, streamed from the signed URLs and never stored. Download rows
   * are recorded when the archive starts (egress intent), one per file. Null for every bad state.
   */
  async publicZip(token: string): Promise<{ stream: ReadableStream<Uint8Array>; filename: string } | null> {
    const share = await this.linkShare(token);
    if (!share) return null;
    const tracks = share.snapshotJson.tracks;
    const rows = await this.db
      .select({ name: files.name, storageKey: files.storageKey, bytes: files.bytes })
      .from(files)
      .where(
        and(
          eq(files.releaseId, share.releaseId),
          eq(files.userId, share.fileOwnerUserId),
          inArray(files.name, tracks.map((t) => t.file))
        )
      );
    const byName = new Map(rows.map((r) => [r.name, r]));
    if (tracks.length === 0 || tracks.some((t) => !byName.has(t.file))) return null;
    if (rows.reduce((total, r) => total + r.bytes, 0) > ZIP_MAX_TOTAL_BYTES) {
      throw new UploadTooLargeError("This share is too large to download as one file");
    }

    const used = new Set<string>();
    const entries: ZipEntry[] = tracks.map((track) => {
      const row = byName.get(track.file)!;
      let name = track.file;
      for (let n = 2; used.has(name); n++) name = `${n} - ${track.file}`;
      used.add(name);
      return {
        name,
        open: async () => {
          const ticket = await this.fileStore.createDownload(row.storageKey);
          const response = await this.fetchFile(ticket.url);
          if (!response.ok || !response.body) throw new Error(`Stored file could not be read (${response.status})`);
          return response.body;
        },
      };
    });
    await this.db
      .insert(shareDownloads)
      .values(tracks.map((t) => ({ shareId: share.id, name: t.file, at: this.now(), via: "link" as const, bytes: byName.get(t.file)!.bytes })));
    return { stream: createZipStream(entries, new Date(this.now())), filename: `${share.snapshotJson.artist} - ${share.snapshotJson.title}.zip` };
  }

  // --- monitoring ---

  /** Share egress in the last 24 hours, for the daily cron (monitoring only, no caps). */
  async egressReport(): Promise<EgressReport> {
    const since = this.now() - DAY_MS;
    const recent = gt(shareDownloads.at, since - 1);
    const [[totals], byDownloads, byBytes] = await Promise.all([
      this.db.select({ bytes: sum(shareDownloads.bytes), n: count() }).from(shareDownloads).where(recent),
      this.topShares(recent, "downloads"),
      this.topShares(recent, "bytes"),
    ]);
    return {
      windowHours: 24,
      totalBytes: Number(totals?.bytes ?? 0),
      totalDownloads: totals?.n ?? 0,
      topByDownloads: byDownloads,
      topByBytes: byBytes,
    };
  }

  private async topShares(recent: ReturnType<typeof gt>, by: "downloads" | "bytes") {
    const bytes = sum(shareDownloads.bytes);
    const downloads = count();
    const rows = await this.db
      .select({ shareId: shareDownloads.shareId, downloads, bytes })
      .from(shareDownloads)
      .where(recent)
      .groupBy(shareDownloads.shareId)
      .orderBy(desc(by === "downloads" ? downloads : bytes), shareDownloads.shareId)
      .limit(10);
    return rows.map((r) => ({ shareId: r.shareId, downloads: r.downloads, bytes: Number(r.bytes ?? 0) }));
  }
}
