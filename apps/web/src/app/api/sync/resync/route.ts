import { NextResponse } from "next/server";
import { getServices } from "../../../../server/container";
import { errorResponse } from "../../../../server/http/responses";
import { demoReadOnly, isDemo } from "../../../../server/demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** "Resync Mac and phone" (#172): reconcile now, then ask the other devices to upload their files again. */
export async function POST() {
  if (isDemo()) return demoReadOnly();
  try {
    const { asked } = await getServices().syncEngine.resync();
    return NextResponse.json({ ok: true, asked });
  } catch (err) {
    return errorResponse(err);
  }
}
