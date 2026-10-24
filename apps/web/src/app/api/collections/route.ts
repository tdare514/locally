import os from "node:os";
import { NextRequest, NextResponse } from "next/server";
import { getServices } from "../../../server/container";
import { demoReadOnly, isDemo } from "../../../server/demo";
import { DEMO_COLLECTIONS } from "../../../server/demo/collections";
import { badRequest, errorResponse } from "../../../server/http/responses";
import { CreateCollectionSchema, cleanCollectionName, validateItems } from "../../../shared/collections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The live collections in their order, plus what the last sync pass could not do. */
export async function GET() {
  if (isDemo()) return NextResponse.json({ collections: DEMO_COLLECTIONS, problem: null });
  try {
    const { collections, syncEngine } = getServices();
    return NextResponse.json({ collections: await collections.list(), problem: syncEngine.collectionsSyncProblem() });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Makes a collection: a name and, optionally, its first items. */
export async function POST(request: NextRequest) {
  if (isDemo()) return demoReadOnly();
  try {
    const body = CreateCollectionSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return badRequest("name must be a string, items a list");
    const name = cleanCollectionName(body.data.name);
    if (!name) return badRequest("A collection's name is 1 to 100 characters");
    const items = validateItems(body.data.items ?? []);
    if (!items.ok) return badRequest(items.error);
    const record = await getServices().collections.create({ name, items: items.items, originDevice: os.hostname() });
    return NextResponse.json({ collection: record }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
