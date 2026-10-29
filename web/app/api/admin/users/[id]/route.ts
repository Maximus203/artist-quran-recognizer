import { z } from "zod";
import { publicUser } from "@/lib/auth-response";
import { apiError, json, notFound, readJson, safe } from "@/lib/http";
import { unlockAccount } from "@/lib/auth";
import { authDeps, requireAdmin } from "@/lib/route-guard";
import { LastAdminError, getUser, updateUser } from "@/lib/users";
export const runtime = "nodejs";

const patch = z
  .object({
    role: z.enum(["user", "admin"]),
    disabled: z.boolean(),
    /** Lève le verrou de connexion « par compte » (attaque répartie). */
    unlock: z.literal(true),
  })
  .partial()
  .strict();

/**
 * Promouvoir / rétrograder (`role`) ou désactiver / réactiver (`disabled`) un compte. Désactiver
 * révoque ses connexions ; ses sessions et revues restent. `409` si ce changement retirerait le
 * dernier administrateur actif. `unlock: true` lève le verrou de connexion du compte (un tiers qui
 * s'acharne sur un pseudonyme ne peut ainsi pas en exclure durablement le propriétaire).
 */
async function handlePATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin(request, { mutation: true });
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  const parsed = patch.safeParse(await readJson(request));
  if (!Number.isInteger(id) || id < 1) return notFound("Compte introuvable");
  if (!parsed.success)
    return apiError(
      400,
      'Corps attendu : { role?: "user"|"admin", disabled?: boolean, unlock?: true }.',
      {
        code: "invalid",
      },
    );
  const { unlock, ...changes } = parsed.data;
  if (unlock) {
    const target = getUser(auth.db, id);
    if (!target) return notFound("Compte introuvable");
    unlockAccount(await authDeps(), target.username);
    if (Object.keys(changes).length === 0) return json({ unlocked: true });
  }
  try {
    const user = updateUser(auth.db, id, changes);
    return user
      ? json({ user: publicUser(user), disabled: user.disabled_at !== null })
      : notFound("Compte introuvable");
  } catch (error) {
    if (error instanceof LastAdminError)
      return apiError(409, error.message, { code: "last_admin" });
    throw error;
  }
}

export const PATCH = safe(handlePATCH);
