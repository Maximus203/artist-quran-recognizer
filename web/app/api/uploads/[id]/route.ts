import { abortUpload, uploadStatus } from "@/lib/chunked-upload";
import { apiError, json, safe } from "@/lib/http";
import { ImportError } from "@/lib/import-session";
import { requireUser } from "@/lib/route-guard";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const failure = (error: unknown) => {
  if (error instanceof ImportError)
    return apiError(error.status, error.message, { code: "invalid" });
  throw error;
};

/** État d'un envoi : les morceaux déjà reçus, pour reprendre après une coupure. */
async function handleGET(request: Request, { params }: Params) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;
  try {
    const s = await uploadStatus((await params).id, auth.user.id);
    return json({
      id: s.id,
      size: s.size,
      chunk_size: s.chunkSize,
      chunks: s.chunks,
      received: s.received,
    });
  } catch (error) {
    return failure(error);
  }
}

/** Abandon : tout ce qui a été reçu est supprimé. */
async function handleDELETE(request: Request, { params }: Params) {
  const auth = await requireUser(request, { mutation: true });
  if (!auth.ok) return auth.response;
  try {
    await abortUpload((await params).id, auth.user.id);
    return json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}

export const GET = safe(handleGET);
export const DELETE = safe(handleDELETE);
