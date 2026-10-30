import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isTrapPath } from "./honeypot";

/**
 * Une page de l'atelier ne doit JAMAIS porter un nom de route piège (`/admin`, `/wp-admin`, `/.env`…) : le
 * visiteur qui l'ouvrirait serait pris pour un robot et bloqué une heure (`honeypot.ts`). Constaté sur une page
 * « /admin » en cours de construction. Le test parcourt les pages réelles du dossier `app/`.
 */
const APP = path.resolve(__dirname, "..", "app");

function pageRoutes(dir: string, segments: string[] = []): string[] {
  const routes: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "api") continue; // les routes d'API ont leur propre famille
      // Les groupes « (app) » ne comptent pas dans l'adresse.
      const isGroup = /^\(.+\)$/.test(entry);
      routes.push(
        ...pageRoutes(full, isGroup ? segments : [...segments, entry]),
      );
    } else if (/^page\.(tsx|ts|jsx|js)$/.test(entry)) {
      routes.push("/" + segments.join("/"));
    }
  }
  return routes;
}

describe("noms des pages et routes pièges", () => {
  const routes = pageRoutes(APP);

  it("le parcours trouve bien les pages connues", () => {
    expect(routes).toEqual(expect.arrayContaining(["/login", "/compte"]));
  });

  it("aucune page n'a une adresse piégée", () => {
    const trapped = routes.filter((route) => isTrapPath(route));
    expect(trapped).toEqual([]);
  });

  it("le détecteur reconnaît bien les noms qu'il doit piéger (garde-fou du test lui-même)", () => {
    for (const bad of ["/admin", "/admin/moteur", "/wp-admin", "/phpmyadmin"])
      expect(isTrapPath(bad)).toBe(true);
  });
});
