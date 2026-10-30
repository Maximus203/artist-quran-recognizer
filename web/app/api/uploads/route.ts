import { z } from "zod";
import { parseBody } from "@/lib/body";
import { createUpload } from "@/lib/chunked-upload";
import { apiError, json, safe } from "@/lib/http";
import { ImportError } from "@/lib/import-session";
import { userQuotaBytes } from "@/lib/quota";
import { requireUser } from "@/lib/route-guard";
import { usedBytes } from "@/lib/session-index";
import { cleanUserName } from "@/lib/session-name";
export const runtime = "nodejs";

const schema = z
  .object({
    filename: z.string().min(1).max(500),
    size: z.number().int().positive(),
    source_kind: z.enum(["file", "microphone"]).optional(),
    visibility: z.enum(["global", "private"]).optional(),
    name: z.string().max(500).optional(),
    autorun: z.boolean().optional(),
  })
  .strict();

/**
 * Début d'un envoi par morceaux : `{ filename, size, source_kind?, visibility?, name?, autorun? }`
 * -> `201 { id, chunk_size, chunks, size, expires_in_s }`. Les contrôles (type, plafond, quota) sont ceux de
 * l'envoi unique et se font ICI, avant le premier octet. Ensuite : `PUT /api/uploads/<id>/chunks/<n>` pour chaque
 * morceau (reprenable), puis `POST /api/uploads/<id>/complete`.
 */
async function handlePOST(request: Request) {
  const auth = await requireUser(request, { mutation: true });
  if (!auth.ok) return auth.response;
  const body = await parseBody(
    request,
    schema,
    "{ filename, size, source_kind?, visibility?, name?, autorun? }",
  );
  if (!body.ok) return body.response;
  let name: string | null = null;
  if (body.data.name !== undefined && body.data.name.trim() !== "") {
    name = cleanUserName(body.data.name);
    if (name === null)
      return apiError(400, "Le nom fait 1 à 120 caractères.", {
        code: "invalid",
        field: "name",
      });
  }
  const limit = userQuotaBytes();
  try {
    const created = await createUpload({
      ownerId: auth.user.id,
      filename: body.data.filename,
      size: body.data.size,
      sourceKind: body.data.source_kind ?? null,
      visibility: body.data.visibility ?? "private",
      name,
      autorun: body.data.autorun ?? false,
      quota: limit ? { limit, used: usedBytes(auth.db, auth.user.id) } : null,
    });
    return json(
      {
        id: created.id,
        chunk_size: created.chunkSize,
        chunks: created.chunks,
        size: created.size,
        expires_in_s: created.expiresInS,
      },
      201,
    );
  } catch (error) {
    if (error instanceof ImportError)
      return apiError(error.status, error.message, {
        code: error.status === 413 ? "too_large" : "invalid",
      });
    throw error;
  }
}

export const POST = safe(handlePOST);
