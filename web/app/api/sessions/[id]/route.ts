import { NextResponse } from "next/server";
import {
  deleteSession,
  readResult,
  readReview,
  readSession,
} from "@/lib/store";
import { isLocalRequest } from "@/lib/local-request";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isLocalRequest(request))
    return NextResponse.json({ error: "Accès local requis" }, { status: 403 });
  try {
    const { id } = await params;
    const session = await readSession(id);
    const result = await readResult(id);
    const review = await readReview(id);
    return NextResponse.json({
      session,
      result: result?.parsed ?? null,
      review,
    });
  } catch {
    return NextResponse.json({ error: "Session introuvable" }, { status: 404 });
  }
}
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isLocalRequest(request, true))
    return NextResponse.json({ error: "Accès local requis" }, { status: 403 });
  try {
    await deleteSession((await params).id);
    return new Response(null, { status: 204 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Suppression impossible" },
      { status: 400 },
    );
  }
}
