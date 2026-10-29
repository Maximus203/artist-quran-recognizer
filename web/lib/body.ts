import type { z } from "zod";
import { apiError, readJson } from "./http";

/**
 * Corps JSON d'une route, validé par un schéma `zod` STRICT : un champ inconnu, un mauvais type ou un
 * dépassement de borne donne `400 { error, code: "invalid", field? }`. La réponse ne renvoie jamais
 * la valeur reçue (un mot de passe mal formé ne doit pas se retrouver dans une réponse ni un journal) ni
 * le nom d'un champ inconnu ; elle nomme seulement le champ attendu qui pose problème.
 */
export async function parseBody<S extends z.ZodTypeAny>(
  request: Request,
  schema: S,
  expected: string,
): Promise<{ ok: true; data: z.infer<S> } | { ok: false; response: Response }> {
  const raw = await readJson(request);
  const parsed =
    raw !== null && typeof raw === "object" && !Array.isArray(raw)
      ? schema.safeParse(raw)
      : null;
  if (parsed?.success) return { ok: true, data: parsed.data };
  const issue = parsed && !parsed.success ? parsed.error.issues[0] : undefined;
  const field =
    issue &&
    issue.code !== "unrecognized_keys" &&
    typeof issue.path[0] === "string"
      ? issue.path[0]
      : undefined;
  return {
    ok: false,
    response: apiError(400, `Corps invalide : ${expected} attendu.`, {
      code: "invalid",
      field,
    }),
  };
}
