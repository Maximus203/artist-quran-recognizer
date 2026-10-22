import { safe } from "@/lib/http";
import { revokeLogin } from "@/lib/auth";
import { clearCookieHeader } from "@/lib/auth-response";
import { authenticate } from "@/lib/route-guard";
export const runtime = "nodejs";

/** Déconnexion : révoque le jeton côté serveur et efface le cookie. Idempotente (`204` même sans connexion). */
async function handlePOST(request: Request) {
  const guard = await authenticate(request, {
    mutation: true,
    anonymous: true,
  });
  if (!guard.ok) return guard.response;
  if (guard.token) revokeLogin(guard.db, guard.token);
  return new Response(null, {
    status: 204,
    headers: {
      "Set-Cookie": clearCookieHeader(request, guard.cfg),
      "Cache-Control": "private, no-store",
    },
  });
}

export const POST = safe(handlePOST);
