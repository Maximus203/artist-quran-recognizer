import { z } from "zod";
import { completeUpload } from "@/lib/chunked-upload";
import { apiError, safe } from "@/lib/http";
import { respondCreated } from "@/lib/import-finish";
import { ImportError } from "@/lib/import-session";
import { userQuotaBytes } from "@/lib/quota";
import { readBoundedBody } from "@/lib/read-bounded";
import { requireUser } from "@/lib/route-guard";
import { usedBytes } from "@/lib/session-index";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z
  .object({
    sha256: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/)
      .optional(),
  })
  .strict();

/**
 * Fin d'un envoi : assemble les morceaux et crée la session, avec la même réponse `201` que l'envoi unique.
 * Corps facultatif `{ sha256 }` : empreinte du fichier entier, vérifiée avant l'import. `409` s'il manque
 * des morceaux (la réponse de `GET /api/uploads/<id>` dit lesquels).
 */
async function handlePOST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser(request, { mutation: true });
  if (!auth.ok) return auth.response;
  const raw = await readBoundedBody(request, 4096);
  if (raw === null)
    return apiError(413, "Corps trop gros.", { code: "too_large" });
  let options: z.infer<typeof schema> = {};
  if (raw.length > 0) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString("utf8"));
    } catch {
      return apiError(400, "JSON invalide.", { code: "invalid" });
    }
    const checked = schema.safeParse(parsed);
    if (!checked.success)
      return apiError(400, "Corps attendu : { sha256? }.", { code: "invalid" });
    options = checked.data;
  }
  const limit = userQuotaBytes();
  try {
    const { session, autorun } = await completeUpload(
      (await params).id,
      auth.user.id,
      undefined,
      {
        sha256: options.sha256 ?? null,
        quota: limit ? { limit, used: usedBytes(auth.db, auth.user.id) } : null,
      },
    );
    return respondCreated(auth, session, autorun);
  } catch (error) {
    if (error instanceof ImportError)
      return apiError(error.status, error.message, {
        code:
          error.status === 413
            ? "too_large"
            : error.status === 409
              ? "incomplete"
              : "invalid",
      });
    throw error;
  }
}

export const POST = safe(handlePOST);
