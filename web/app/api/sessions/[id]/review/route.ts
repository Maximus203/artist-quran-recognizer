import { NextResponse } from "next/server";
import { isLocalRequest } from "@/lib/local-request";
import { updateReview } from "@/lib/review-update";
import { readReview } from "@/lib/store";
export const runtime = "nodejs";

/** La revue d'une session (tous testeurs confondus) : sert au rafraîchissement du panneau. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isLocalRequest(request))
    return NextResponse.json({ error: "Accès local requis" }, { status: 403 });
  try {
    const { id } = await params;
    return NextResponse.json({ review: await readReview(id) });
  } catch {
    return NextResponse.json({ error: "Session introuvable" }, { status: 404 });
  }
}

/**
 * Enregistre les signalements d'un testeur : fusion par identifiant avec ceux des autres (jamais un
 * remplacement de la liste). Réponse : la revue fusionnée.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isLocalRequest(request, true))
    return NextResponse.json({ error: "Accès local requis" }, { status: 403 });
  try {
    const { id } = await params;
    const review = await updateReview(id, await request.json());
    return NextResponse.json({ saved: true, review });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Sauvegarde impossible" },
      { status: 400 },
    );
  }
}
