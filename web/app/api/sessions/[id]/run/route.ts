import { launch, cancel, ensureQueueRecovered } from "@/lib/jobs";
import { httpError } from "@/lib/errors";
import { apiError, json, safe } from "@/lib/http";
import { sessionAccess } from "@/lib/route-guard";
import { parseAsrChoice } from "@/lib/asr-choice";
export const runtime = "nodejs";

/** Corps facultatif `{ "asr": "…" }` ; vide = moteur de l'atelier. Un corps illisible est refusé. */
async function requestedAsr(request: Request) {
  const text = await request.text();
  if (text.trim() === "") return undefined;
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error("Corps de requête illisible : du JSON est attendu.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new Error('Corps de requête invalide : { "asr": "…" } est attendu.');
  // Sans moteur demandé, `launch` applique celui de l'atelier (`AQR_ASR`, cascade par défaut) :
  // le même que l'import avec `autorun`.
  return "asr" in body ? parseAsrChoice(body.asr) : undefined;
}

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
    const asr = await requestedAsr(request);
    await ensureQueueRecovered().catch(() => []);
    return json(await launch(access.id, asr));
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
