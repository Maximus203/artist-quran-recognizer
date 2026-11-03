import { describe, expect, it } from "vitest";
import {
  canReview,
  canSeeSubtitles,
  landingFor,
  pageVisibleTo,
  sessionHref,
} from "./role-view";

/**
 * Ce que voit chaque rôle. Le récitateur enregistre, relit, range en playlists et exporte sa vidéo : pas de tests, de revue humaine, de performances ni de direct.
 * Les règles de SÉCURITÉ restent dans `access.ts` ; ici, seulement ce qui s'affiche et où l'on atterrit.
 */
describe("interface par rôle", () => {
  it("le récitateur a la lecture, ses récitations et ses playlists, rien d'autre", () => {
    for (const page of ["perf", "live", "docs"] as const)
      expect(pageVisibleTo("recitant", page)).toBe(false);
    for (const page of ["revue", "sessions", "playlists"] as const)
      expect(pageVisibleTo("recitant", page)).toBe(true);
  });

  it("testeur et administrateur gardent toute la navigation", () => {
    for (const role of ["user", "admin"] as const)
      for (const page of [
        "revue",
        "sessions",
        "perf",
        "live",
        "docs",
        "playlists",
      ] as const)
        expect(pageVisibleTo(role, page)).toBe(true);
  });

  it("tous les rôles atterrissent sur la lecture", () => {
    for (const role of ["recitant", "user", "admin"] as const)
      expect(landingFor(role)).toBe("/");
  });

  it("une récitation s'ouvre sur la lecture, quel que soit le rôle", () => {
    for (const role of ["recitant", "user", "admin"] as const)
      expect(sessionHref(role, "abc")).toBe("/?session=abc");
  });

  it("le récitateur ne relit ni ne corrige, et ne voit pas les sous-titres", () => {
    expect(canReview("recitant")).toBe(false);
    expect(canSeeSubtitles("recitant")).toBe(false);
    expect(canReview("user")).toBe(true);
    expect(canSeeSubtitles("admin")).toBe(true);
  });
});
