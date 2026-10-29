import { launch, cancel, ensureQueueRecovered } from "@/lib/jobs";
import { httpError } from "@/lib/errors";
import { apiError, json, safe } from "@/lib/http";
import { sessionAccess } from "@/lib/route-guard";
import { z } from "zod";
import { parseAsrChoice } from "@/lib/asr-choice";
import { parseBody } from "@/lib/body";
export const runtime = "nodejs";

const runBody = z.object({ asr: z.string().max(40).optional() }).strict();

/** Met l'analyse en file : `{ state: "running" | "queued", queue_position }`. Propriétaire ou administrateur. */
async function handlePOST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await sessionAccess(request, params, "run", {
    mutation: true,
  });
  if (!access.ok) return access.response;
  try {
    const body = await parseBody(request, runBody, "{ asr? }");
    if (!body.ok) return body.response;
    // Sans moteur demandé, `launch` applique celui de l'atelier (`AQR_ASR`, cascade par défaut) :
    // le même que l'import avec `autorun`.
    const asr =
      body.data.asr === undefined ? undefined : parseAsrChoice(body.data.asr);
    await ensureQueueRecovered().catch(() => []);
    return json(await launch(access.id, asr, access.user.id));
  } catch (e) {
    const { status, message } = httpError(e, "Démarrage impossible");
    return apiError(status, message);
  }
}
/** Annule l'analyse : retirée de la file si elle attend, processus tué si elle tourne. Propriétaire ou administrateur. */
async function handleDELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await sessionAccess(request, params, "run", {
    mutation: true,
  });
  if (!access.ok) return access.response;
  try {
    await cancel(access.id);
    return json({ state: "cancelled" });
  } catch (e) {
    const { status, message } = httpError(e, "Annulation impossible");
    return apiError(status, message);
  }
}

export const POST = safe(handlePOST);
export const DELETE = safe(handleDELETE);
