import { NextRequest, NextResponse } from "next/server";
import { getServices } from "../../../../server/container";
import { badRequest, errorResponse } from "../../../../server/http/responses";
import { demoReadOnly, isDemo } from "../../../../server/demo";
import { parseShareGroups } from "../../../../shared/shares";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The saved groups of recipient emails: kept in this Mac's settings only, never sent to the service. */
export async function GET() {
  if (isDemo()) return NextResponse.json({ groups: [] });
  try {
    const settings = await getServices().settings.get();
    return NextResponse.json({ groups: parseShareGroups(settings.shareGroups) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Replaces the whole list of groups. */
export async function PUT(request: NextRequest) {
  if (isDemo()) return demoReadOnly();
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return badRequest("Send the groups as JSON");
  }
  const groups = parseShareGroups((raw as { groups?: unknown } | null)?.groups);
  try {
    await getServices().settings.update((current) => {
      const { shareGroups: _old, ...rest } = current;
      void _old;
      return groups.length > 0 ? { ...rest, shareGroups: groups } : rest;
    });
    return NextResponse.json({ groups });
  } catch (err) {
    return errorResponse(err);
  }
}
