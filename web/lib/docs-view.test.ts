import { describe, expect, it } from "vitest";
import {
  buildLinkMap,
  groupDocs,
  headingId,
  readingMinutes,
  resolveDocLink,
  siblings,
  type DocLink,
} from "./docs-view";

const entries = [
  {
    slug: "systeme-en-bref",
    title: "Le système en bref",
    section: "Vue d'ensemble",
    file: "docs/SYSTEME-EN-BREF.md",
  },
  {
    slug: "release-notes",
    title: "Notes de version",
    section: "Vue d'ensemble",
    file: "docs/RELEASE-NOTES.md",
  },
  {
    slug: "architecture-moteur",
    title: "Architecture du moteur",
    section: "Architecture",
    file: "docs/ARCHITECTURE.md",
  },
  {
    slug: "adr-0001",
    title: "ADR 1",
    section: "Décisions",
    file: "docs/adr/0001-pas-de-llm.md",
  },
];
const docs: DocLink[] = entries.map(({ file: _file, ...doc }) => doc);
const links = buildLinkMap(entries);

describe("headingId", () => {
  it("transforme un titre en ancre stable, sans accent", () => {
    expect(headingId("1. Invariants")).toBe("1-invariants");
    expect(headingId("Vue d’ensemble : le pipeline")).toBe(
      "vue-d-ensemble-le-pipeline",
    );
    expect(headingId("Où sont les données ?")).toBe("ou-sont-les-donnees");
  });
  it("garde un identifiant même pour un titre sans lettres latines", () => {
    expect(headingId("بسم")).toBe("section");
    expect(headingId("")).toBe("section");
  });
});

describe("resolveDocLink", () => {
  it("une ancre reste une ancre", () => {
    expect(resolveDocLink("#pipeline", links)).toEqual({
      kind: "anchor",
      href: "#pipeline",
    });
  });
  it("un lien externe s'ouvre dehors, sans fuite du referrer", () => {
    expect(resolveDocLink("https://tanzil.net/", links)).toEqual({
      kind: "external",
      href: "https://tanzil.net/",
    });
  });
  it("un lien .md relatif est réécrit vers la page de documentation, ancre comprise", () => {
    expect(resolveDocLink("SYSTEME-EN-BREF.md#regles", links)).toEqual({
      kind: "doc",
      href: "/docs/systeme-en-bref#regles",
    });
    expect(resolveDocLink("./adr/0001-pas-de-llm.md", links)).toEqual({
      kind: "doc",
      href: "/docs/adr-0001",
    });
  });
  it("un .md hors de l'index n'est pas un lien (jamais une adresse inventée)", () => {
    expect(resolveDocLink("prompts/secret.md", links)).toEqual({
      kind: "none",
    });
  });
  it("refuse les schémas dangereux", () => {
    expect(resolveDocLink("javascript:alert(1)", links)).toEqual({
      kind: "none",
    });
    expect(resolveDocLink("data:text/html,x", links)).toEqual({ kind: "none" });
    expect(resolveDocLink("//evil.example/x", links)).toEqual({ kind: "none" });
  });
  it("un lien vers autre chose qu'un document (fichier de code) n'est pas cliquable", () => {
    expect(resolveDocLink("../src/aqr/domain/ports.py", links)).toEqual({
      kind: "none",
    });
  });
});

describe("groupDocs / siblings", () => {
  it("regroupe par section dans l'ordre d'apparition de l'index", () => {
    const groups = groupDocs(docs);
    expect(groups.map((g) => g.section)).toEqual([
      "Vue d'ensemble",
      "Architecture",
      "Décisions",
    ]);
    expect(groups[0].docs.map((d) => d.slug)).toEqual([
      "systeme-en-bref",
      "release-notes",
    ]);
  });
  it("précédent / suivant suivent l'ordre de l'index", () => {
    expect(siblings(docs, "release-notes")).toEqual({
      prev: docs[0],
      next: docs[2],
    });
    expect(siblings(docs, "systeme-en-bref").prev).toBeNull();
    expect(siblings(docs, "adr-0001").next).toBeNull();
    expect(siblings(docs, "inconnu")).toEqual({ prev: null, next: null });
  });
  it("filtre sans tenir compte des accents ni de la casse", () => {
    const hits = groupDocs(docs, "SYSTEME").flatMap((g) =>
      g.docs.map((d) => d.slug),
    );
    expect(hits).toEqual(["systeme-en-bref"]);
    expect(groupDocs(docs, "zzz")).toEqual([]);
  });
});

describe("readingMinutes", () => {
  it("environ 200 mots par minute, au moins une minute", () => {
    expect(readingMinutes("mot ".repeat(1000))).toBe(5);
    expect(readingMinutes("court")).toBe(1);
  });
  it("ignore les blocs de code", () => {
    expect(readingMinutes("a\n```\n" + "x ".repeat(5000) + "\n```\nb")).toBe(1);
  });
});
