import { NextResponse } from "next/server";
import { ReviewWorkError, readResult, readReview } from "@/lib/store";
import { httpError } from "@/lib/errors";
import { ensureQueueRecovered, removeSession } from "@/lib/jobs";
import { isLocalRequest } from "@/lib/local-request";
import { readSessionView } from "@/lib/session-view";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isLocalRequest(request))
    return NextResponse.json({ error: "Accès local requis" }, { status: 403 });
  try {
    const { id } = await params;
    await ensureQueueRecovered().catch(() => []);
    const session = await readSessionView(id);
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
    await removeSession((await params).id, { force });
    return new Response(null, { status: 204 });
  } catch (e) {
    if (e instanceof ReviewWorkError)
      return NextResponse.json({ error: e.message }, { status: 409 });
    const { status, message } = httpError(e, "Suppression impossible");
    return NextResponse.json({ error: message }, { status });
  }
}
