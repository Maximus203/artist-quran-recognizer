import { z } from "zod";
import { parseBody } from "@/lib/body";
import { apiError, json, safe } from "@/lib/http";
import {
  InvitationLimitError,
  cleanInvitationLabel,
  createInvitation,
  listInvitations,
} from "@/lib/invitations";
import { log } from "@/lib/log";
import { requireAdmin } from "@/lib/route-guard";
export const runtime = "nodejs";

const schema = z
  .object({
    label: z.string().min(1).max(200),
    expires_in_days: z.number().int().min(1).max(90).optional(),
    max_uses: z.number().int().min(1).max(20).optional(),
  })
  .strict();

/** Invitations de testeurs (administrateur) : la liste, sans jamais un jeton. */
async function handleGET(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  return json({ items: listInvitations(auth.db) });
}

/**
 * Crée une invitation `{ label, expires_in_days?, max_uses? }` (14 jours et 1 inscription par défaut). Le jeton
 * clair n'est rendu qu'ici, une seule fois : le lien à remettre est `<adresse>/access?invitation=<jeton>`.
 */
async function handlePOST(request: Request) {
  const auth = await requireAdmin(request, { mutation: true });
  if (!auth.ok) return auth.response;
  const body = await parseBody(
    request,
    schema,
    "{ label, expires_in_days?, max_uses? }",
  );
  if (!body.ok) return body.response;
  const label = cleanInvitationLabel(body.data.label);
  if (!label)
    return apiError(400, "Le nom fait 1 à 60 caractères.", {
      code: "invalid",
      field: "label",
    });
  try {
    const { token, row } = createInvitation(auth.db, {
      label,
      createdBy: auth.user.id,
      expiresInDays: body.data.expires_in_days,
      maxUses: body.data.max_uses,
    });
    log.event(
      "security",
      "invitation.created",
      { invitation: row.id, by: auth.user.id, max_uses: row.max_uses },
      "info",
    );
    return json({ token, invitation: row }, 201, {
      "Cache-Control": "no-store",
    });
  } catch (error) {
    if (error instanceof InvitationLimitError)
      return apiError(409, error.message, { code: "limit" });
    throw error;
  }
}

export const GET = safe(handleGET);
export const POST = safe(handlePOST);
