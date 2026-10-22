import { describe, expect, it } from "vitest";
import { parseReleaseNotes, pullRequestUrl } from "./release-notes";

const SAMPLE = `# Notes de version

<!--
Format STRICT : ne s'affiche pas.
-->

## 2026-10-22 — Documentation vivante et notes de version
Étiquettes : technique, décision
PR : #69

**Ce qui change.** Une page « Le système en bref ».

**Pourquoi / décision.** Une documentation qui n'est pas à jour devient fausse.

## 2026-10-21 - Deux correctifs
Étiquettes : technique
PR : #67, #68

**Ce qui change.** L'atelier contrôle l'en-tête Host.

## 2026-10-20 — Sans pull request
Étiquettes : utilisateur
PR : -

Texte libre.
`;

describe("parseReleaseNotes", () => {
  const entries = parseReleaseNotes(SAMPLE);

  it("lit chaque entrée dans l'ordre du fichier (la plus récente d'abord)", () => {
    expect(entries.map((e) => e.date)).toEqual([
      "2026-10-22",
      "2026-10-21",
      "2026-10-20",
    ]);
  });

  it("extrait le titre, avec un tiret long ou un tiret simple", () => {
    expect(entries[0].title).toBe("Documentation vivante et notes de version");
    expect(entries[1].title).toBe("Deux correctifs");
  });

  it("extrait les étiquettes connues, sans accent ni casse imposés", () => {
    expect(entries[0].tags).toEqual(["technique", "decision"]);
    expect(entries[2].tags).toEqual(["utilisateur"]);
  });

  it("extrait une, plusieurs ou aucune pull request", () => {
    expect(entries[0].prs).toEqual([69]);
    expect(entries[1].prs).toEqual([67, 68]);
    expect(entries[2].prs).toEqual([]);
  });

  it("garde le corps en Markdown, sans les lignes d'en-tête ni le commentaire", () => {
    expect(entries[0].body).toContain("**Ce qui change.**");
    expect(entries[0].body).toContain("**Pourquoi / décision.**");
    expect(entries[0].body).not.toContain("Étiquettes");
    expect(entries[0].body).not.toContain("PR :");
    expect(entries[0].body).not.toContain("STRICT");
  });

  it("ignore une étiquette inconnue et ne plante pas sur un fichier vide", () => {
    const [entry] = parseReleaseNotes("## 2026-01-02 — T\nÉtiquettes : magie\nPR : -\n\nx");
    expect(entry.tags).toEqual([]);
    expect(parseReleaseNotes("")).toEqual([]);
    expect(parseReleaseNotes("# Notes de version\n\nrien")).toEqual([]);
  });

  it("n'accepte qu'un numéro de PR strictement positif", () => {
    const [entry] = parseReleaseNotes("## 2026-01-02 — T\nÉtiquettes : technique\nPR : #0, #x, #12\n\nx");
    expect(entry.prs).toEqual([12]);
  });
});

describe("pullRequestUrl", () => {
  it("compose le lien depuis l'adresse du dépôt, sans double barre", () => {
    expect(pullRequestUrl("https://github.com/o/r/", 42)).toBe(
      "https://github.com/o/r/pull/42",
    );
  });
});
