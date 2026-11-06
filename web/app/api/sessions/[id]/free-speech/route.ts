import { z } from "zod";
import { apiError, json, notFound, readJson, safe } from "@/lib/http";
import { FREE_SPEECH_REVIEWS } from "@/lib/free-speech";
import { setFreeSpeechReview } from "@/lib/free-speech-store";
import { sessionAccess } from "@/lib/route-guard";
export const runtime = "nodejs";

const bodySchema = z
  .object({
    index: z.number().int().min(0),
    review: z.enum(FREE_SPEECH_REVIEWS),
  })
  .strict();

/** Valide ou rejette la parole libre d'un passage : `{ index, review }`. Propriétaire ou administrateur. */
async function handlePATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await sessionAccess(request, params, "edit", {
    mutation: true,
  });
  if (!access.ok) return access.response;
  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success)
    return apiError(
      400,
      "Corps attendu : { index: entier, review: pending | approved | rejected }.",
      { code: "invalid" },
    );
  const outcome = await setFreeSpeechReview(
    access.id,
    parsed.data.index,
    parsed.data.review,
  );
  if (outcome === "missing") return notFound();
  if (outcome === "not_translated")
    return apiError(409, "Ce passage est retenu : il n'a rien à relire.", {
      code: "invalid",
    });
  return json({ ok: true });
}

export const PATCH = safe(handlePATCH);
