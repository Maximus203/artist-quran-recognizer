import { resetPasswordByAdmin } from "@/lib/auth";
import { apiError, json, notFound, safe } from "@/lib/http";
import { authDeps, requireAdmin } from "@/lib/route-guard";
import { getUser } from "@/lib/users";
export const runtime = "nodejs";

/**
 * Réinitialisation du mot de passe d'un compte par un administrateur : rend un mot de passe TEMPORAIRE, une seule
 * fois (`Cache-Control: no-store`). Toutes les connexions du compte sont révoquées. Pas pour soi-même : Compte >
 * Sécurité demande l'ancien mot de passe et garde la connexion en cours.
 */
async function handlePOST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin(request, { mutation: true });
  if (!auth.ok) return auth.response;
  const raw = (await params).id;
  const id = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isInteger(id) || id < 1)
    return notFound("Compte introuvable");
  const target = getUser(auth.db, id);
  if (!target) return notFound("Compte introuvable");
  if (target.id === auth.user.id)
    return apiError(400, "Pour ton propre compte, utilise Compte > Sécurité.", {
      code: "invalid",
    });
  const password = await resetPasswordByAdmin(
    await authDeps(),
    target,
    auth.user.id,
  );
  return json({ username: target.username, password }, 200, {
    "Cache-Control": "no-store",
  });
}

export const POST = safe(handlePOST);
