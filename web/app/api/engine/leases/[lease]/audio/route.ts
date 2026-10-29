import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { engineBroker } from "@/lib/engine-broker";
import { notFound, safe } from "@/lib/http";
import { requireAgent } from "@/lib/route-guard";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** L'audio de l'analyse prêtée à cet agent (et à nul autre) : un seul fichier, choisi par le serveur. */
async function handleGET(
  request: Request,
  { params }: { params: Promise<{ lease: string }> },
) {
  const auth = await requireAgent(request);
  if (!auth.ok) return auth.response;
  const lease = engineBroker().lease((await params).lease, auth.agent.id);
  if (!lease || lease.cancelled) return notFound("Bail inconnu ou expiré");
  const stream = createReadStream(lease.ticket.audioFile);
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(lease.ticket.audioSize),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const GET = safe(handleGET);
