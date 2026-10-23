import { NextRequest, NextResponse } from "next/server";
import { getServices } from "../../../server/container";
import { badRequest, errorResponse } from "../../../server/http/responses";
import { demoReadOnly, isDemo } from "../../../server/demo";
import { CreateShareBodySchema, isPlausibleEmail, normalizeEmail } from "../../../shared/shares";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The shares this account sent (#182), one page; `?cursor=` continues. */
export async function GET(request: NextRequest) {
  if (isDemo()) return demoReadOnly();
  try {
    const cursor = request.nextUrl.searchParams.get("cursor");
    return NextResponse.json(await getServices().syncEngine.sentShares(cursor && cursor.length <= 200 ? cursor : null));
  } catch (err) {
    return errorResponse(err);
  }
}

/** Shares a release, or some of its tracks, with the emails given and/or a link. */
export async function POST(request: NextRequest) {
  if (isDemo()) return demoReadOnly();
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return badRequest("Send the share as JSON");
  }
  const parsed = CreateShareBodySchema.safeParse(raw);
  if (!parsed.success) return badRequest("That share isn't valid");
  const recipients = [...new Set(parsed.data.recipients.map(normalizeEmail))];
  const bad = recipients.find((e) => !isPlausibleEmail(e));
  if (bad) return badRequest(`${bad} doesn't look like an email address`);
  try {
    const result = await getServices().syncEngine.createShare({ ...parsed.data, recipients });
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
