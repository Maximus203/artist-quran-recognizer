import { z } from "zod";
import { publicUser } from "@/lib/auth-response";
import { apiError, json, notFound, readJson } from "@/lib/http";
import { requireAdmin } from "@/lib/route-guard";
import { LastAdminError, updateUser } from "@/lib/users";
export const runtime = "nodejs";

const patch = z
  .object({ role: z.enum(["user", "admin"]), disabled: z.boolean() })
  .partial()
  .strict();

/**
 * Promouvoir / rétrograder (`role`) ou désactiver / réactiver (`disabled`) un compte. Désactiver
 * révoque ses connexions ; ses sessions et revues restent. `409` si ce changement retirerait le
 * dernier administrateur actif.
 */
export async function PATCH(
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
      'Corps attendu : { role?: "user"|"admin", disabled?: boolean }.',
      {
        code: "invalid",
      },
    );
  try {
    const user = updateUser(auth.db, id, parsed.data);
    return user
      ? json({ user: publicUser(user), disabled: user.disabled_at !== null })
      : notFound("Compte introuvable");
  } catch (error) {
    if (error instanceof LastAdminError)
      return apiError(409, error.message, { code: "last_admin" });
    throw error;
  }
}
