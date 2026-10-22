import { apiError, json, readJson } from "@/lib/http";
import {
  isPreferenceKey,
  patchPreferences,
  preferencesPatchSchema,
  readPreferences,
  resetPreferences,
} from "@/lib/preferences";
import { requireUser } from "@/lib/route-guard";
export const runtime = "nodejs";

/**
 * Préférences du compte, côté serveur. `GET` → `{ preferences, updated_at, defaults }`.
 * `PUT` et `PATCH` (identiques) : fusion PARTIELLE d'un objet à clés connues ; une clé inconnue ou
 * une valeur invalide refuse tout le corps (`400`, rien n'est écrit). `DELETE` remet toutes les
 * clés par défaut, ou une seule avec `?key=theme`.
 */
export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;
  return json(readPreferences(auth.db, auth.user.id));
}

async function merge(request: Request) {
  const auth = await requireUser(request, { mutation: true });
  if (!auth.ok) return auth.response;
  const body = await readJson(request);
  const parsed = preferencesPatchSchema.safeParse(body);
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
  return json(patchPreferences(auth.db, auth.user.id, parsed.data));
}
export const PUT = merge;
export const PATCH = merge;

export async function DELETE(request: Request) {
  const auth = await requireUser(request, { mutation: true });
  if (!auth.ok) return auth.response;
  const key = new URL(request.url).searchParams.get("key");
  if (key !== null && !isPreferenceKey(key))
    return apiError(400, "Préférence inconnue.", { code: "invalid" });
  return json(resetPreferences(auth.db, auth.user.id, key ?? undefined));
}
