import { NextResponse } from "next/server";
import { readResult, readReview, readSession } from "@/lib/store";
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
