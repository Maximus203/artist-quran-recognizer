import { describe, expect, it } from "vitest";
import { layoutArabicWords } from "./live-highlight";
import { layoutCard, wrapArabic, wrapTranslation } from "./export-video-layout";

// Mesure factice : largeur proportionnelle au nombre de caractères.
const measure = (text: string, size: number) => text.length * size * 0.5;

const LONG_AR = Array.from({ length: 40 }, () => "كلمةطويلة").join(" ");
const LONG_FR = Array.from({ length: 60 }, () => "miséricordieux").join(" ");

function layout(width: number, height: number, arabic = LONG_AR, fr = LONG_FR) {
  return layoutCard({
    width,
    height,
    parts: layoutArabicWords(arabic).parts,
    translation: fr,
    arabicSize: 72,
    translationSize: 30,
    measureArabic: measure,
    measureTranslation: measure,
  });
}

describe("mise en page des cartes vidéo", () => {
  it("coupe la traduction sans dépasser la largeur", () => {
    const lines = wrapTranslation("a bb ccc dddd eeeee", 40, 10, measure);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(measure(line, 10)).toBeLessThanOrEqual(40);
    expect(lines.join(" ")).toBe("a bb ccc dddd eeeee");
  });

  it("coupe l'arabe en conservant tous les mots dans l'ordre", () => {
    const parts = layoutArabicWords("بسم الله الرحمن الرحيم").parts;
    const lines = wrapArabic(parts, 120, 20, measure);
    expect(lines.length).toBeGreaterThan(1);
    const words = lines.flatMap((l) =>
      l.parts.filter((p) => p.word !== null).map((p) => p.text),
    );
    expect(words).toEqual(["بسم", "الله", "الرحمن", "الرحيم"]);
    for (const line of lines)
      expect(line.parts[line.parts.length - 1].word).not.toBeNull();
  });

  for (const [name, w, h] of [
    ["paysage", 1920, 1080],
    ["portrait", 1080, 1920],
    ["carré", 1080, 1080],
  ] as const) {
    it(`tient dans la zone libre, sans toucher l'onde (${name})`, () => {
      const l = layout(w, h);
      const waveTop = h * (1 - (h > w ? 0.16 : 0.22));
      const last = l.translationLines.at(-1)!;
      expect(last.y + l.translationSize * 0.7).toBeLessThanOrEqual(waveTop);
      expect(l.panel.y).toBeGreaterThanOrEqual(0);
      expect(l.panel.y + l.panel.height).toBeLessThanOrEqual(waveTop + 1);
      expect(l.panel.x).toBeGreaterThanOrEqual(0);
      expect(l.panel.x + l.panel.width).toBeLessThanOrEqual(w);
    });

    it(`enchaîne référence, arabe et traduction sans chevauchement (${name})`, () => {
      const l = layout(w, h);
      const ys = [
        l.refY,
        ...l.arabicLines.map((x) => x.y),
        ...l.translationLines.map((x) => x.y),
      ];
      for (let i = 1; i < ys.length; i++)
        expect(ys[i]).toBeGreaterThan(ys[i - 1]);
      const firstArabic = l.arabicLines[0].y - (l.arabicSize * 1.75) / 2;
      expect(firstArabic).toBeGreaterThanOrEqual(
        l.refY + l.refSize * 0.7 - 0.5,
      );
    });

    it(`ne sort jamais des bords latéraux (${name})`, () => {
      const l = layout(w, h);
      for (const line of l.arabicLines)
        for (const part of line.parts) {
          expect(part.x).toBeGreaterThanOrEqual(0);
          expect(part.x + part.width).toBeLessThanOrEqual(w);
        }
    });
  }

  it("garde les tailles choisies quand tout tient", () => {
    const l = layout(1920, 1080, "بسم الله", "Au nom de Dieu");
    expect(l.fit).toBe(1);
    expect(l.arabicSize).toBe(72);
    expect(l.arabicLines).toHaveLength(1);
  });

  it("réduit les tailles quand le verset est trop long pour la zone", () => {
    const l = layout(1920, 1080);
    expect(l.fit).toBeLessThan(1);
  });

  it("n'affiche aucune traduction quand elle est absente", () => {
    const l = layout(1920, 1080, "بسم الله", null as unknown as string);
    expect(l.translationLines).toHaveLength(0);
  });

  it("agrandit les écritures en portrait (échelle sur le côté court)", () => {
    const portrait = layout(1080, 1920, "بسم", "Au nom");
    const landscape = layout(1920, 1080, "بسم", "Au nom");
    expect(portrait.arabicSize).toBe(landscape.arabicSize);
  });
});

describe("remplir, hauteur du texte et onde", () => {
  const base = (over: Record<string, unknown>) =>
    layoutCard({
      width: 1080,
      height: 1920,
      parts: layoutArabicWords("بسم الله الرحمن الرحيم").parts,
      translation: "Au nom d'Allah",
      arabicSize: 72,
      translationSize: 30,
      measureArabic: measure,
      measureTranslation: measure,
      ...over,
    });

  it("agrandit les écritures en mode remplir, sans déborder la zone", () => {
    const normal = base({});
    const fill = base({ fill: true });
    expect(fill.arabicSize).toBeGreaterThan(normal.arabicSize * 1.5);
    const last = fill.translationLines.at(-1)!;
    expect(last.y + fill.translationSize * 0.7).toBeLessThanOrEqual(
      fill.textBottom + 1,
    );
    expect(fill.panel.y).toBeGreaterThanOrEqual(0);
  });

  it("place le bloc plus haut ou plus bas selon la position", () => {
    const top = base({ position: 0 });
    const bottom = base({ position: 1 });
    expect(top.refY).toBeLessThan(bottom.refY);
    expect(top.translationLines[0].y).toBeLessThan(
      bottom.translationLines[0].y,
    );
  });

  it("libère la hauteur de l'onde quand elle est masquée", () => {
    const withWave = base({ fill: true });
    const noWave = base({ fill: true, showWave: false });
    expect(noWave.textBottom).toBeGreaterThan(withWave.textBottom);
    expect(noWave.arabicSize).toBeGreaterThanOrEqual(withWave.arabicSize);
  });
});
