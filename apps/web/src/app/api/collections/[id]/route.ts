import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServices } from "../../../../server/container";
import { demoReadOnly, isDemo } from "../../../../server/demo";
import { badRequest, errorResponse } from "../../../../server/http/responses";
import { UpdateCollectionSchema, cleanCollectionName, validateItems, type CollectionItem } from "../../../../shared/collections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

/** Replaces a collection's name and/or its whole item list (reorder, add and remove all arrive this way). */
export async function PUT(request: NextRequest, { params }: Params) {
  if (isDemo()) return demoReadOnly();
  try {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return badRequest("id must be a UUID");
    const body = UpdateCollectionSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return badRequest("name must be a string, items a list");
    const patch: { name?: string; items?: CollectionItem[] } = {};
    if (body.data.name !== undefined) {
      const name = cleanCollectionName(body.data.name);
      if (!name) return badRequest("A collection's name is 1 to 100 characters");
      patch.name = name;
    }
    if (body.data.items !== undefined) {
      const items = validateItems(body.data.items);
      if (!items.ok) return badRequest(items.error);
      patch.items = items.items;
    }
    const record = await getServices().collections.update(id, patch);
    if (!record) return NextResponse.json({ error: "Collection not found" }, { status: 404 });
    return NextResponse.json({ collection: record });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Deletes it (a tombstone, pushed on the next sync). */
export async function DELETE(_request: NextRequest, { params }: Params) {
  if (isDemo()) return demoReadOnly();
  try {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return badRequest("id must be a UUID");
    const removed = await getServices().collections.remove(id);
    if (!removed) return NextResponse.json({ error: "Collection not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
