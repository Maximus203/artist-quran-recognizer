import { cache } from "react";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { authConfig, resolveLogin, sessionToken, SESSION_COOKIE } from "./auth";
import { hasAccessCredential } from "./local-request";
import { ready } from "./server-init";
import type { User } from "./users";

/**
 * Aide pour les PAGES (composants serveur) : l'utilisateur connecté, ou la redirection vers
 * `/login`. Les routes d'API, elles, répondent 401 JSON (voir `route-guard.ts`).
 *
 *   const user = await requirePageUser("/");        // page protégée : redirige si anonyme
 *   await redirectIfSignedIn("/");                   // /login et /register : déjà connecté → accueil
 *
 * `pageUser` est mémorisé le temps d'une requête : la mise en page et la page le demandent tous
 * deux sans doubler l'accès à la base.
 */
export const pageUser = cache(async (): Promise<User | null> => {
  const db = await ready();
  const jar = await cookies();
  const token = sessionToken(
    `${SESSION_COOKIE}=${jar.get(SESSION_COOKIE)?.value ?? ""}`,
  );
  return token ? resolveLogin(db, token, authConfig()) : null;
});

/** Mode test distant : sans jeton d'accès valide, toute page mène au formulaire d'accès. */
export async function requirePageAccess(): Promise<void> {
  const request = new Request("http://localhost/", {
    headers: await headers(),
  });
  if (!hasAccessCredential(request)) redirect("/access");
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

/** Pages réservées aux administrateurs : un autre compte reçoit un 404 (la zone n'existe pas pour lui). */
export async function requirePageAdmin(next = "/"): Promise<User> {
  const user = await requirePageUser(next);
  if (user.role !== "admin") notFound();
  return user;
}

export async function requirePageUser(next = "/"): Promise<User> {
  await requirePageAccess();
  const user = await pageUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(safeNext(next))}`);
  return user;
}

export async function redirectIfSignedIn(to = "/"): Promise<void> {
  await requirePageAccess();
  if (await pageUser()) redirect(safeNext(to));
}
