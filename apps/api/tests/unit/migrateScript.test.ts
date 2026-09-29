import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createDb } from "../../src/db/client";

const run = promisify(execFile);
const scriptPath = path.join(process.cwd(), "scripts", "migrate.mjs");
const journal = JSON.parse(fs.readFileSync(path.join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8")) as {
  entries: unknown[];
};

/** Start from a clean environment so a developer's own DATABASE_URL cannot leak in. */
function cleanEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  return { NODE_ENV: "test", PATH: process.env.PATH, HOME: process.env.HOME, ...extra };
}

async function runScript(extra: Record<string, string>): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await run(process.execPath, [scriptPath], { env: cleanEnv(extra) });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

describe("scripts/migrate.mjs", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "migrate-script-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("migrates a database file, then applies nothing the second time", async () => {
    const url = `file:${path.join(dir, "nested", "x.db")}`;
    const n = journal.entries.length;

    const first = await runScript({ DATABASE_URL: url });
    expect(first.code).toBe(0);
    expect(first.stdout).toContain(`applied ${n} migration(s)`);

    const second = await runScript({ DATABASE_URL: url });
    expect(second.code).toBe(0);
    expect(second.stdout).toContain("applied 0 migration(s)");

    const db = createDb(url);
    const rows = await db.all<{ n: number }>(sql`select count(*) as n from __drizzle_migrations`);
    expect(Number(rows[0]?.n)).toBe(n);
  });

  it("skips when no database is configured outside production", async () => {
    const result = await runScript({ VERCEL_ENV: "preview" });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("skipping");
  });

  it("fails a production build with no database configured", async () => {
    const result = await runScript({ VERCEL_ENV: "production" });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("no database configured");
  });
});
