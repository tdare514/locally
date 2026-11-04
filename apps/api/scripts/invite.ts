// Manage the invite list for invite-only sign-up (#186):
//   npm run invite -- add a@b.c      npm run invite -- list      npm run invite -- remove a@b.c
// Works on the database named by DATABASE_URL / TURSO_DATABASE_URL (default: the local dev file). Run by hand;
// the API has no route for this. Spawns no processes.
import { createDb, migrateDb } from "../src/db/client";
import { InviteService, normaliseInviteEmail } from "../src/server/invites/InviteService";

const url = process.env.DATABASE_URL || process.env.TURSO_DATABASE_URL || undefined;
const authToken = process.env.DATABASE_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN || undefined;

function usage(): never {
  console.error("usage: npm run invite -- add <email> | list | remove <email>");
  process.exit(2);
}

async function main(): Promise<void> {
  const [command, email] = process.argv.slice(2);
  if (command !== "add" && command !== "remove" && command !== "list") usage();
  if (command !== "list" && !email) usage();

  const db = createDb(url, authToken);
  // The local dev database migrates itself on first request; a remote one is migrated by the deploy.
  if (!url || url.startsWith("file:") || url === ":memory:") await migrateDb(db);
  const service = new InviteService(db);

  if (command === "add") {
    console.log(`invited ${await service.add(email!, process.env.USER || "owner")}`);
  } else if (command === "remove") {
    console.log((await service.remove(email!)) ? `removed ${normaliseInviteEmail(email!)}` : "no such invite");
  } else {
    const rows = await service.list();
    if (rows.length === 0) console.log("no invites");
    for (const row of rows) {
      const used = row.usedAt === null ? "unused" : `used ${new Date(row.usedAt).toISOString()}`;
      console.log(`${row.email}\t${used}\tinvited ${new Date(row.createdAt).toISOString()} by ${row.invitedBy}`);
    }
  }
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
);
