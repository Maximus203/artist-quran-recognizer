import { apiError, json, readJson, safe } from "@/lib/http";
import { createLiveSession, TOKENS_PER_MINUTE } from "@/lib/live-session";
import { HitLimiter } from "@/lib/rate-limit";
import { requireUser } from "@/lib/route-guard";
import { reviewRoot } from "@/lib/store";
export const runtime = "nodejs";

const LIMITER = Symbol.for("aqr.live-token-limiter");
/** Un limiteur par processus : un jeton ne sert qu'une fois, donc une écoute = une émission. */
function limiter(): HitLimiter {
  const holder = globalThis as { [LIMITER]?: HitLimiter };
  return (holder[LIMITER] ??= new HitLimiter(TOKENS_PER_MINUTE, 60_000));
}

/**
 * Jeton de session du direct (ADR-0011, étape 3) : `POST { technical? }` → `200 { schema, token,
 * expires_at, ttl_s, url, technical }`. Le navigateur présente ce jeton, une seule fois, dans le
 * message `START` du WebSocket `aqr.live/1` (jamais dans l'adresse). Authentifié par le cookie de
 * session de l'atelier ; `401` sans connexion. `technical` n'est accordé qu'à un administrateur.
 */
async function handlePOST(request: Request) {
  const auth = await requireUser(request, { mutation: true });
  if (!auth.ok) return auth.response;
  const result = createLiveSession({
    user: auth.user,
    body: await readJson(request),
    env: process.env,
    dataDir: reviewRoot(),
    limiter: limiter(),
  });
  if (result.status === 200) return json(result.body);
  return apiError(result.status, result.error, {
    code: result.code,
    headers: result.retryAfterS
      ? { "Retry-After": String(result.retryAfterS) }
      : undefined,
  });
}

export const POST = safe(handlePOST);
