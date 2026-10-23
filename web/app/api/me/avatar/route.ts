import { publicUser } from "@/lib/auth-response";
import { AVATAR } from "@/lib/avatar-config";
import { prepareAvatar } from "@/lib/avatar-image";
import { clearAvatar, storeAvatar } from "@/lib/avatar-store";
import { readLimitedBody } from "@/lib/avatar-upload";
import { apiError, json, safe } from "@/lib/http";
import { requireUser } from "@/lib/route-guard";
import { getUser } from "@/lib/users";
export const runtime = "nodejs";

/**
 * Photo de profil du compte CONNECTÉ (on n'écrit jamais pour un autre : pas d'identifiant dans
 * l'adresse). `PUT` : le corps est l'image brute (JPEG, PNG ou WebP reconnu par son contenu, 2 Mo
 * au plus) ; elle est réencodée en JPEG carré sans métadonnées. Réponse : `{ user }` avec la
 * nouvelle `avatar_version`. `DELETE` : retire la photo (retour à l'initiale), `{ user }`.
 */
async function handlePUT(request: Request) {
  const auth = await requireUser(request, { mutation: true });
  if (!auth.ok) return auth.response;
  const bytes = await readLimitedBody(request, AVATAR.maxBytes);
  if (bytes === null)
    return apiError(
      413,
      `Image trop lourde : ${AVATAR.maxBytes / (1024 * 1024)} Mo au maximum.`,
      { code: "too_large" },
    );
  const result = await prepareAvatar(bytes);
  if (!result.ok)
    return apiError(result.status, result.message, { code: result.code });
  await storeAvatar(auth.db, auth.user.id, result.jpeg);
  return json({ user: publicUser(getUser(auth.db, auth.user.id)!) });
}

async function handleDELETE(request: Request) {
  const auth = await requireUser(request, { mutation: true });
  if (!auth.ok) return auth.response;
  await clearAvatar(auth.db, auth.user.id);
  return json({ user: publicUser(getUser(auth.db, auth.user.id)!) });
}

export const PUT = safe(handlePUT);
export const DELETE = safe(handleDELETE);
