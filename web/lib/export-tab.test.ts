import { describe, expect, it } from "vitest";
import {
  EXPORT_TAB_PARAM,
  EXPORT_TABS,
  exportReturnPath,
  resolveExportTab,
  withExportTab,
} from "./export-tab";

/**
 * L'onglet de la page « Exporter » vit dans l'adresse (`?onglet=video`) : recharger la page ramène sur le même
 * onglet (recette QA, m2), alors qu'arriver par le bouton « Exporter » (sans paramètre) ouvre toujours sur la porte
 * « Vérifier ». Le récitant n'a que la vidéo.
 */
describe("l'onglet demandé par l'adresse", () => {
  it("sans paramètre : la porte « Vérifier »", () => {
    expect(resolveExportTab(undefined, false)).toBe("verifier");
    expect(resolveExportTab(null, false)).toBe("verifier");
    expect(resolveExportTab("", false)).toBe("verifier");
  });

  it("les trois onglets connus sont repris tels quels", () => {
    for (const tab of EXPORT_TABS)
      expect(resolveExportTab(tab, false)).toBe(tab);
  });

  it("une valeur inconnue, ou plusieurs valeurs, retombent sur la porte", () => {
    expect(resolveExportTab("admin", false)).toBe("verifier");
    expect(resolveExportTab("VIDEO", false)).toBe("verifier");
    expect(resolveExportTab(["video", "soustitres"], false)).toBe("verifier");
    expect(resolveExportTab("__proto__", false)).toBe("verifier");
  });

  it("le récitant n'a que la vidéo, quoi que dise l'adresse", () => {
    for (const raw of [undefined, "verifier", "soustitres", "video", "x"])
      expect(resolveExportTab(raw, true)).toBe("video");
  });
});

describe("l'adresse qui garde l'onglet", () => {
  it("ajoute le paramètre, garde le chemin et les autres paramètres", () => {
    expect(withExportTab("/s/abc/exporter", "", "video")).toBe(
      `/s/abc/exporter?${EXPORT_TAB_PARAM}=video`,
    );
    expect(withExportTab("/s/abc/exporter", "?x=1", "soustitres")).toBe(
      `/s/abc/exporter?x=1&${EXPORT_TAB_PARAM}=soustitres`,
    );
  });

  it("remplace un paramètre déjà là au lieu de l'empiler", () => {
    expect(
      withExportTab(
        "/s/abc/exporter",
        `?${EXPORT_TAB_PARAM}=video`,
        "verifier",
      ),
    ).toBe(`/s/abc/exporter`);
  });

  it("la porte « Vérifier » est l'adresse nue (c'est le défaut)", () => {
    expect(withExportTab("/s/abc/exporter", "", "verifier")).toBe(
      "/s/abc/exporter",
    );
  });
});

/** Recette QA 2, N9 : un lien direct vers `?onglet=video`, ouvert déconnecté, perdait l'onglet à la connexion. */
describe("l'adresse où revenir après la connexion", () => {
  const id = "0b1f6f0e-9c52-4c0e-9d51-2a3b4c5d6e7f";

  it("garde l'onglet demandé", () => {
    expect(exportReturnPath(id, "video")).toBe(
      `/s/${id}/exporter?onglet=video`,
    );
    expect(exportReturnPath(id, "soustitres")).toBe(
      `/s/${id}/exporter?onglet=soustitres`,
    );
  });

  it("la porte « Vérifier » est l'adresse nue", () => {
    expect(exportReturnPath(id, "verifier")).toBe(`/s/${id}/exporter`);
    expect(exportReturnPath(id, undefined)).toBe(`/s/${id}/exporter`);
  });

  it("une valeur inconnue ou multiple n'entre jamais dans l'adresse de retour", () => {
    for (const raw of ["VIDEO", "x&y=1", "//evil.example", ["video", "x"], ""])
      expect(exportReturnPath(id, raw)).toBe(`/s/${id}/exporter`);
  });
});
