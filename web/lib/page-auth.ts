import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authConfig, resolveLogin, sessionToken, SESSION_COOKIE } from "./auth";
import { ready } from "./server-init";
import type { User } from "./users";

/**
 * Aide pour les PAGES (composants serveur) : l'utilisateur connecté, ou la redirection vers
 * `/login`. Les routes d'API, elles, répondent 401 JSON (voir `route-guard.ts`).
 *
 *   const user = await requirePageUser("/");        // page protégée : redirige si anonyme
 *   await redirectIfSignedIn("/");                   // /login et /register : déjà connecté → accueil
 */
export async function pageUser(): Promise<User | null> {
  const db = await ready();
  const jar = await cookies();
  const token = sessionToken(
    `${SESSION_COOKIE}=${jar.get(SESSION_COOKIE)?.value ?? ""}`,
  );
  return token ? resolveLogin(db, token, authConfig()) : null;
}

/** Chemin de retour sûr : relatif au site, jamais une adresse extérieure ni `//hôte`. */
export function safeNext(
  value: string | null | undefined,
  fallback = "/",
): string {
  return typeof value === "string" && /^\/(?![/\\])[^\r\n]*$/.test(value)
    ? value
    : fallback;
}

export async function requirePageUser(next = "/"): Promise<User> {
  const user = await pageUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(safeNext(next))}`);
  return user;
}

export async function redirectIfSignedIn(to = "/"): Promise<void> {
  if (await pageUser()) redirect(safeNext(to));
}
