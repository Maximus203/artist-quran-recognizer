import { NextResponse } from "next/server";
import {
  ReviewWorkError,
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
    const force = new URL(request.url).searchParams.get("force") === "1";
    await deleteSession((await params).id, { force });
    return new Response(null, { status: 204 });
  } catch (e) {
    if (e instanceof ReviewWorkError)
      return NextResponse.json({ error: e.message }, { status: 409 });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Suppression impossible" },
      { status: 400 },
    );
  }
}
