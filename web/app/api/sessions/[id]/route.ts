import { z } from "zod";
import { httpError } from "@/lib/errors";
import { apiError, json, notFound, readJson, safe } from "@/lib/http";
import { ensureQueueRecovered, removeSession } from "@/lib/jobs";
import { sessionAccess } from "@/lib/route-guard";
import { audit } from "@/lib/audit";
import { deleteMeta, updateMeta } from "@/lib/session-index";
import { cleanUserName, defaultSessionName } from "@/lib/session-name";
import { viewForUser } from "@/lib/session-service";
import { ReviewWorkError, readResult, readReview } from "@/lib/store";
export const runtime = "nodejs";

/** `{ session, result, review }` : la session (avec son propriétaire, sa portée, ses droits), son résultat et sa revue. */
async function handleGET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await sessionAccess(request, params, "view");
  if (!access.ok) return access.response;
  try {
    await ensureQueueRecovered().catch(() => []);
    const session = await viewForUser(access.db, access.user, access.meta);
    if (!session) return notFound();
    const [result, review] = await Promise.all([
      readResult(access.id),
      readReview(access.id),
    ]);
    return json({ session, result: result?.parsed ?? null, review });
  } catch {
    return notFound();
  }
}

const patchSchema = z
  .object({
    name: z.union([z.string(), z.null()]),
    visibility: z.enum(["global", "private"]),
    archived: z.boolean(),
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Rien à modifier.");

/**
 * Renomme (`name` ; `null` = nom par défaut dérivé du fichier), change la portée
 * (`visibility`) ou archive (`archived`). Propriétaire ou administrateur.
 */
async function handlePATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await sessionAccess(request, params, "edit", {
    mutation: true,
  });
  if (!access.ok) return access.response;
  const parsed = patchSchema.safeParse(await readJson(request));
  if (!parsed.success)
    return apiError(
      400,
      'Corps attendu : { name?: string | null, visibility?: "global"|"private", archived?: boolean }.',
      { code: "invalid" },
    );
  const { name, visibility, archived } = parsed.data;
  const now = new Date().toISOString();
  const patch: Parameters<typeof updateMeta>[2] = {};
  if (name !== undefined) {
    if (name === null) {
      patch.name = defaultSessionName(
        access.meta.original_name,
        access.meta.created_at,
        access.meta.source_kind,
        process.env.AQR_TIMEZONE || undefined,
      );
      patch.nameSource = "auto";
    } else {
      const clean = cleanUserName(name);
      if (clean === null)
        return apiError(400, "Le nom fait 1 à 120 caractères.", {
          code: "invalid",
          field: "name",
        });
      patch.name = clean;
      patch.nameSource = "user";
    }
  }
  if (visibility !== undefined) patch.visibility = visibility;
  if (archived !== undefined) patch.archivedAt = archived ? now : null;
  const updated = updateMeta(access.db, access.id, patch, now);
  if (!updated) return notFound();
  if (visibility !== undefined && visibility !== access.meta.visibility)
    audit("visibility.change", {
      userId: access.user.id,
      session: access.id,
      reason: `${access.meta.visibility} → ${visibility}`,
    });
  const session = await viewForUser(access.db, access.user, updated);
  return session ? json({ session }) : notFound();
}

async function handleDELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await sessionAccess(request, params, "delete", {
    mutation: true,
  });
  if (!access.ok) return access.response;
  try {
    const force = new URL(request.url).searchParams.get("force") === "1";
    await removeSession(access.id, { force });
    deleteMeta(access.db, access.id);
    return new Response(null, { status: 204 });
  } catch (e) {
    if (e instanceof ReviewWorkError)
      return apiError(409, e.message, { code: "review_work" });
    const { status, message } = httpError(e, "Suppression impossible");
    // Dossier déjà disparu : la ligne d'index n'a plus de raison d'être.
    if (status === 404) deleteMeta(access.db, access.id);
    return apiError(status, message);
  }
}

export const GET = safe(handleGET);
export const PATCH = safe(handlePATCH);
export const DELETE = safe(handleDELETE);
