import { z } from "zod";
import { engineBroker } from "@/lib/engine-broker";
import { parseBody } from "@/lib/body";
import { json, notFound, safe } from "@/lib/http";
import { requireAgent } from "@/lib/route-guard";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ message: z.string().min(1).max(2000) }).strict();

/** L'agent signale qu'il n'a pas pu analyser : son message (borné, sur une ligne) devient la raison affichée. */
async function handlePOST(
  request: Request,
  { params }: { params: Promise<{ lease: string }> },
) {
  const auth = await requireAgent(request);
  if (!auth.ok) return auth.response;
  const body = await parseBody(request, schema, "{ message }");
  if (!body.ok) return body.response;
  if (
    !engineBroker().fail((await params).lease, auth.agent.id, body.data.message)
  )
    return notFound("Bail inconnu ou expiré");
  return json({ ok: true });
}

export const POST = safe(handlePOST);
