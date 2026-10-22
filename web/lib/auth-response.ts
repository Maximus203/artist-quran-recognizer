import { apiError, json } from "./http";
import {
  clearedCookie,
  loginCookie,
  type AuthConfig,
  type AuthResult,
} from "./auth";
import { isSecure } from "./route-guard";
import type { User } from "./users";

/** Ce que l'API dit d'un compte : jamais d'empreinte, jamais d'état interne. */
export type PublicUser = {
  id: number;
  username: string;
  role: "user" | "admin";
  created_at: string;
  last_login_at: string | null;
};

export const publicUser = (user: User): PublicUser => ({
  id: user.id,
  username: user.username,
  role: user.role,
  created_at: user.created_at,
  last_login_at: user.last_login_at,
});

/** Réponse d'une inscription ou connexion : `{ user }` + cookie, ou l'erreur (429 avec `Retry-After`). */
export function authResponse(
  request: Request,
  cfg: AuthConfig,
  result: AuthResult,
  successStatus: 200 | 201,
): Response {
  if (!result.ok)
    return apiError(result.status, result.message, {
      code:
        result.status === 429
          ? "rate_limited"
          : result.status === 401
            ? "bad_credentials"
            : "invalid",
      field: result.field,
      headers: result.retryAfterS
        ? { "Retry-After": String(result.retryAfterS) }
        : undefined,
    });
  return json({ user: publicUser(result.user) }, successStatus, {
    "Set-Cookie": loginCookie(result.token, cfg.maxS, isSecure(request, cfg)),
  });
}

export const clearCookieHeader = (request: Request, cfg: AuthConfig) =>
  clearedCookie(isSecure(request, cfg));
