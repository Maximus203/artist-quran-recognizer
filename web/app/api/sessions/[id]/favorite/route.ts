import { json } from "@/lib/http";
import { sessionAccess } from "@/lib/route-guard";
import { setFavorite } from "@/lib/session-index";
export const runtime = "nodejs";

/** Ajoute aux favoris DE L'UTILISATEUR (idempotent) : `{ id, favorite: true }`. Il faut voir la session. */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await sessionAccess(request, params, "favorite", {
    mutation: true,
  });
  if (!access.ok) return access.response;
  setFavorite(
    access.db,
    access.user.id,
    access.id,
    true,
    new Date().toISOString(),
  );
  return json({ id: access.id, favorite: true });
}

/** Retire des favoris (idempotent) : `{ id, favorite: false }`. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await sessionAccess(request, params, "favorite", {
    mutation: true,
  });
  if (!access.ok) return access.response;
  setFavorite(
    access.db,
    access.user.id,
    access.id,
    false,
    new Date().toISOString(),
  );
  return json({ id: access.id, favorite: false });
}
