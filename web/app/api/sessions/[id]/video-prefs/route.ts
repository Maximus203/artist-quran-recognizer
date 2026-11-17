import { apiError, json, readJson, safe } from "@/lib/http";
import { videoPrefsSchema } from "@/lib/export-video-prefs";
import { sessionAccess } from "@/lib/route-guard";
import {
  deleteSessionVideoPrefs,
  readSessionVideoPrefs,
  writeSessionVideoPrefs,
} from "@/lib/session-video-prefs";
export const runtime = "nodejs";

/**
 * Réglages de l'éditeur d'export de CETTE vidéo, pour LE COMPTE qui appelle (jamais ceux d'un autre, même sur
 * une session globale). Il faut voir la session (`view` : 404 si elle est invisible, y compris pour les
 * sessions privées d'autrui ; un administrateur voit tout, mais garde ses propres réglages).
 *  - `GET` → `{ id, prefs, updated_at }` ; `prefs: null` = vidéo jamais personnalisée (le client part alors du
 *    réglage global du compte) ;
 *  - `PUT` : le jeu COMPLET de réglages (schéma `videoPrefs`), validé ; invalide → 400, rien n'est écrit ;
 *  - `DELETE` : remet cette vidéo à son point de départ.
 */
async function handleGET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await sessionAccess(request, params, "view");
  if (!access.ok) return access.response;
  const row = readSessionVideoPrefs(access.db, access.user.id, access.id);
  return json({
    id: access.id,
    prefs: row?.prefs ?? null,
    updated_at: row?.updated_at ?? null,
  });
}

async function handlePUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await sessionAccess(request, params, "view", {
    mutation: true,
  });
  if (!access.ok) return access.response;
  const body = await readJson(request);
  const parsed = videoPrefsSchema.safeParse(body);
  if (!parsed.success)
    return apiError(
      400,
      body === undefined
        ? "Corps JSON illisible."
        : parsed.error.issues
            .map(
              (issue) =>
                `${issue.path.join(".") || "corps"} : ${issue.message}`,
            )
            .join(" · "),
      { code: "invalid" },
    );
  const row = writeSessionVideoPrefs(
    access.db,
    access.user.id,
    access.id,
    parsed.data,
  );
  return json({ id: access.id, prefs: row.prefs, updated_at: row.updated_at });
}

async function handleDELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await sessionAccess(request, params, "view", {
    mutation: true,
  });
  if (!access.ok) return access.response;
  deleteSessionVideoPrefs(access.db, access.user.id, access.id);
  return json({ id: access.id, prefs: null, updated_at: null });
}

export const GET = safe(handleGET);
export const PUT = safe(handlePUT);
export const DELETE = safe(handleDELETE);
