import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invites } from "../../src/db/schema";
import { InviteService } from "../../src/server/invites/InviteService";
import { createTestServices, inviteForTest, type TestServices } from "../support/testServices";
import { makeReleaseRecord } from "../support/fixtures";

let testServices: TestServices;

vi.mock("../../src/server/container", () => ({
  getServices: async () => testServices,
}));

import * as authCodeRoute from "../../src/app/v1/auth/code/route";
import * as authVerifyRoute from "../../src/app/v1/auth/verify/route";
import * as meRoute from "../../src/app/v1/me/route";
import * as releaseRoute from "../../src/app/v1/releases/[id]/route";

function post(url: string, body: unknown): Request {
  return new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

async function requestCode(email: string): Promise<{ status: number; body: string }> {
  const res = await authCodeRoute.POST(post("http://localhost/v1/auth/code", { email }));
  await new Promise<void>((r) => queueMicrotask(() => r()));
  return { status: res.status, body: await res.text() };
}

async function codeRows(email: string): Promise<number> {
  const rows = await testServices.db.all<{ n: number }>(sql`select count(*) as n from auth_codes where email = ${email}`);
  return Number(rows[0]!.n);
}

async function verify(email: string, platform: "mac" | "web" = "mac") {
  return authVerifyRoute.POST(
    post("http://localhost/v1/auth/verify", { email, code: testServices.mailer.codeFor(email), deviceName: "Chrome", platform })
  );
}

describe("invite-only POST /v1/auth/code (#186)", () => {
  beforeEach(async () => {
    testServices = await createTestServices();
  });

  it("answers an uninvited email exactly as an invited one, stores no code and sends no mail", async () => {
    await inviteForTest(testServices, "invited@example.com");
    const invited = await requestCode("invited@example.com");
    const uninvited = await requestCode("stranger@example.com");

    expect(uninvited).toEqual(invited);
    expect(uninvited.status).toBe(200);
    expect(JSON.parse(uninvited.body)).toEqual({ ok: true });

    expect(await codeRows("invited@example.com")).toBe(1);
    expect(await codeRows("stranger@example.com")).toBe(0);
    expect(testServices.mailer.codeFor("invited@example.com")).toMatch(/^\d{6}$/);
    expect(() => testServices.mailer.codeFor("stranger@example.com")).toThrow();
  });

  it("runs the same number of database statements for an uninvited email, an invited one and an account holder", async () => {
    await inviteForTest(testServices, "invited@example.com");
    await inviteForTest(testServices, "holder@example.com");
    await requestCode("holder@example.com");
    await verify("holder@example.com");

    const client = (testServices.db as unknown as { $client: { execute: (...args: unknown[]) => unknown } }).$client;
    const spy = vi.spyOn(client, "execute");
    const counts: number[] = [];
    for (const email of ["invited@example.com", "holder@example.com", "stranger@example.com"]) {
      spy.mockClear();
      await requestCode(email);
      counts.push(spy.mock.calls.length);
    }
    expect(counts[2]).toBeGreaterThan(0);
    expect(new Set(counts).size).toBe(1);
  });

  it("normalises the email the way the route does: a differently cased invite works", async () => {
    await inviteForTest(testServices, "Mixed.Case@Example.com");
    await requestCode("  MIXED.case@example.COM ");
    expect(await codeRows("mixed.case@example.com")).toBe(1);
  });

  it("signs an invited email in and marks the invite used", async () => {
    await inviteForTest(testServices, "invited@example.com");
    await requestCode("invited@example.com");
    const res = await verify("invited@example.com");
    expect(res.status).toBe(200);
    const [row] = await testServices.db.select().from(invites);
    expect(row?.usedAt).not.toBeNull();
  });

  it("lets an email that already has an account sign in again without an invite", async () => {
    await inviteForTest(testServices, "owner@example.com");
    await requestCode("owner@example.com");
    expect((await verify("owner@example.com")).status).toBe(200);
    await testServices.db.delete(invites);

    await requestCode("owner@example.com");
    expect(await codeRows("owner@example.com")).toBe(2);
    expect((await verify("owner@example.com")).status).toBe(200);
  });

  it("does not treat a used invite as a way to make a new account", async () => {
    await inviteForTest(testServices, "once@example.com");
    await requestCode("once@example.com");
    await verify("once@example.com");
    await testServices.db.run(sql`delete from users where email = 'once@example.com'`);
    await requestCode("once@example.com");
    expect(await codeRows("once@example.com")).toBe(1);
  });

  it("accepts platform web on verify and origin web on a record, and lists the device as web", async () => {
    await inviteForTest(testServices, "web@example.com");
    await requestCode("web@example.com");
    const res = await verify("web@example.com", "web");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string };

    const me = await meRoute.GET(new Request("http://localhost/v1/me", { headers: { authorization: `Bearer ${body.token}` } }));
    const meBody = (await me.json()) as { devices: Array<{ platform: string }> };
    expect(meBody.devices[0]?.platform).toBe("web");

    const record = { ...makeReleaseRecord(), origin: "web" as const };
    const put = await releaseRoute.PUT(
      new Request(`http://localhost/v1/releases/${record.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json", authorization: `Bearer ${body.token}` },
        body: JSON.stringify(record),
      }),
      { params: Promise.resolve({ id: record.id }) }
    );
    expect(put.status).toBe(200);
  });

  it("still rejects an unknown platform with 400", async () => {
    const res = await authVerifyRoute.POST(
      post("http://localhost/v1/auth/verify", { email: "a@example.com", code: "123456", deviceName: "X", platform: "future" })
    );
    expect(res.status).toBe(400);
  });

  it("logs no email on the code route", async () => {
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")];
    await requestCode("secret-person@example.com");
    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain("secret-person");
      spy.mockRestore();
    }
  });
});

describe("InviteService (the invite CLI's logic)", () => {
  it("adds, lists, re-arms and removes, normalising the email", async () => {
    const services = await createTestServices();
    let clock = 1000;
    const svc = new InviteService(services.db, () => clock++);
    expect(await svc.add(" A@B.co ", "owner")).toBe("a@b.co");
    await svc.add("c@d.co", "owner");
    expect((await svc.list()).map((r) => r.email)).toEqual(["a@b.co", "c@d.co"]);

    await services.db.run(sql`update invites set used_at = 5 where email = 'a@b.co'`);
    await svc.add("a@b.co", "owner");
    expect((await svc.list()).find((r) => r.email === "a@b.co")?.usedAt).toBeNull();

    expect(await svc.remove("A@B.co")).toBe(true);
    expect(await svc.remove("a@b.co")).toBe(false);
    await expect(svc.add("not an email", "owner")).rejects.toThrow();
  });
});
