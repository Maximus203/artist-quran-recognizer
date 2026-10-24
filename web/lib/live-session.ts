import { issueLiveToken, liveConfig, resolveLiveKey } from "./live-token";
import type { HitLimiter } from "./rate-limit";
import type { Role } from "./users";

/**
 * Émission d'un jeton de session du direct pour un utilisateur déjà authentifié par son cookie.
 * Fonction pure (l'environnement, le dossier de données, le limiteur et l'horloge sont passés) :
 * la route `POST /api/live/token` n'est qu'une enveloppe autour d'elle.
 */
export const LIVE_SCHEMA = "aqr.live/1";
/** Émissions de jeton par compte et par minute : un jeton ne sert qu'une fois. */
export const TOKENS_PER_MINUTE = 30;

export type LiveSessionBody = {
  schema: typeof LIVE_SCHEMA;
  token: string;
  expires_at: string;
  ttl_s: number;
  url: string;
  /** Vrai seulement si le compte y a droit ET l'a demandé : le service enverra alors `PARTIAL`. */
  technical: boolean;
};

export type LiveSessionResult =
  | { status: 200; body: LiveSessionBody }
  | {
      status: 400 | 429 | 503;
      error: string;
      code: string;
      retryAfterS?: number;
    };

export type LiveSessionArgs = {
  user: { id: number; role: Role };
  body: unknown;
  env: Record<string, string | undefined>;
  dataDir: string;
  limiter: HitLimiter;
  now?: number;
};

export function createLiveSession({
  user,
  body,
  env,
  dataDir,
  limiter,
  now = Date.now(),
}: LiveSessionArgs): LiveSessionResult {
  if (body === null || typeof body !== "object" || Array.isArray(body))
    return {
      status: 400,
      error: "Corps JSON attendu : { technical? }.",
      code: "invalid",
    };
  const asked = (body as { technical?: unknown }).technical;
  if (asked !== undefined && typeof asked !== "boolean")
    return {
      status: 400,
      error: "technical doit être un booléen.",
      code: "invalid",
    };
  const config = liveConfig(env);
  if (!config.ok)
    return { status: 503, error: config.message, code: "live_unavailable" };
  const verdict = limiter.hit(`live:${user.id}`, now);
  if (!verdict.allowed)
    return {
      status: 429,
      error:
        "Trop de demandes d'écoute en peu de temps : patientez un instant.",
      code: "rate_limited",
      retryAfterS: verdict.retryAfterS,
    };
  let key: string;
  try {
    key = resolveLiveKey(env, dataDir);
  } catch (error) {
    return {
      status: 503,
      error: `La clé de signature du direct est inutilisable : ${(error as Error).message}`,
      code: "live_unavailable",
    };
  }
  const technical = asked === true && user.role === "admin";
  const token = issueLiveToken({
    key,
    subject: String(user.id),
    ttlS: config.ttlS,
    now,
    technical,
  });
  return {
    status: 200,
    body: {
      schema: LIVE_SCHEMA,
      token,
      expires_at: new Date(now + config.ttlS * 1000).toISOString(),
      ttl_s: config.ttlS,
      url: config.url,
      technical,
    },
  };
}
