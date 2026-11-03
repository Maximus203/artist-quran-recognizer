import { describe, expect, it } from "vitest";
import {
  canReview,
  canSeeSubtitles,
  landingFor,
  pageVisibleTo,
  sessionHref,
} from "./role-view";

/**
 * Ce que voit chaque rôle. Le récitateur enregistre et exporte sa vidéo : rien d'autre dans l'interface.
 * Les règles de SÉCURITÉ restent dans `access.ts` ; ici, seulement ce qui s'affiche et où l'on atterrit.
 */
describe("interface par rôle", () => {
  it("le récitateur n'a que la page Sessions dans la navigation", () => {
    for (const page of ["revue", "perf", "live", "docs", "playlists"] as const)
      expect(pageVisibleTo("recitant", page)).toBe(false);
    expect(pageVisibleTo("recitant", "sessions")).toBe(true);
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

  it("le récitateur atterrit sur ses sessions, les autres sur la revue", () => {
    expect(landingFor("recitant")).toBe("/sessions");
    expect(landingFor("user")).toBe("/");
    expect(landingFor("admin")).toBe("/");
  });

  it("une session s'ouvre sur l'export vidéo pour le récitateur, sur la revue pour les autres", () => {
    expect(sessionHref("recitant", "abc")).toBe("/s/abc/exporter");
    expect(sessionHref("user", "abc")).toBe("/?session=abc");
  });

  it("le récitateur ne relit ni ne corrige, et ne voit pas les sous-titres", () => {
    expect(canReview("recitant")).toBe(false);
    expect(canSeeSubtitles("recitant")).toBe(false);
    expect(canReview("user")).toBe(true);
    expect(canSeeSubtitles("admin")).toBe(true);
  });
});
