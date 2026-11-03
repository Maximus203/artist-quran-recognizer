import { describe, expect, it } from "vitest";
import { describeFailure, httpError, isMissingSession } from "./errors";

const errno = (
  code: string,
  path = "C:\\Users\\moi\\sessions\\x\\session.json",
) =>
  Object.assign(
    new Error(`${code}: no such file or directory, open '${path}'`),
    {
      code,
      path,
    },
  );

describe("isMissingSession", () => {
  it("fichier absent ou identifiant invalide : la session n'existe pas", () => {
    expect(isMissingSession(errno("ENOENT"))).toBe(true);
    expect(isMissingSession(new Error("Identifiant invalide"))).toBe(true);
    expect(isMissingSession(errno("EPERM"))).toBe(false);
    expect(isMissingSession(new Error("autre chose"))).toBe(false);
    expect(isMissingSession("texte")).toBe(false);
  });
});

describe("describeFailure — jamais un chemin local ni un code brut dans une session", () => {
  it("fichier absent : message en français sans chemin", () => {
    const text = describeFailure(errno("ENOENT"));
    expect(text).toMatch(/introuvable/);
    expect(text).not.toMatch(/Users|ENOENT|session\.json/);
  });
  it("autre erreur disque : le code seul", () => {
    const text = describeFailure(errno("EACCES"));
    expect(text).toContain("EACCES");
    expect(text).not.toMatch(/Users|session\.json/);
  });
  it("erreur applicative : son message tel quel", () => {
    expect(describeFailure(new Error("Hash audio de sortie incohérent"))).toBe(
      "Hash audio de sortie incohérent",
    );
  });
  it("valeur inconnue : repli", () => {
    expect(describeFailure(undefined, "Lancement impossible")).toBe(
      "Lancement impossible",
    );
  });
});

describe("httpError — code et message d'une réponse d'erreur", () => {
  it("session inconnue : 404 propre, sans chemin", () => {
    expect(httpError(errno("ENOENT"), "x")).toEqual({
      status: 404,
      message: "Session introuvable",
    });
    expect(httpError(new Error("Identifiant invalide"), "x")).toEqual({
      status: 404,
      message: "Session introuvable",
    });
  });
  it("erreur disque inattendue : 500 sans chemin", () => {
    const { status, message } = httpError(errno("EBUSY"), "x");
    expect(status).toBe(500);
    expect(message).not.toMatch(/Users|session\.json/);
  });
  it("erreur applicative : 400 avec son message", () => {
    expect(httpError(new Error("Traitement déjà en cours"), "x")).toEqual({
      status: 400,
      message: "Traitement déjà en cours",
    });
    expect(httpError(null, "Démarrage impossible")).toEqual({
      status: 400,
      message: "Démarrage impossible",
    });
  });
});
