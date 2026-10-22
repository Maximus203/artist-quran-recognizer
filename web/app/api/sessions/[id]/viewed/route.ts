import { NextResponse } from "next/server";
import { isLocalRequest } from "@/lib/local-request";
import { isUnread } from "@/lib/session-meta";
import { markViewed } from "@/lib/store";
export const runtime = "nodejs";
/**
 * « J'ai ouvert le résultat » : pose `viewed_at` (première fois seulement, l'appel est idempotent).
 * Un `GET` ne marque jamais comme vu : le sondage de la liste ne doit pas effacer le point « non lu ».
 * Sans effet tant que la session n'est pas terminée (`viewed_at` reste null, `unread` false).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isLocalRequest(request, true))
    return NextResponse.json({ error: "Accès local requis" }, { status: 403 });
  try {
    const session = await markViewed((await params).id);
    return NextResponse.json({
      id: session.id,
      state: session.state,
      viewed_at: session.viewed_at ?? null,
      unread: isUnread(session),
    });
  } catch {
    return NextResponse.json({ error: "Session introuvable" }, { status: 404 });
  }
}
