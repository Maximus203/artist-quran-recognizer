/**
 * Polices du texte arabe. Le TEXTE vient toujours du corpus (invariant I1) : seule la police change.
 *
 * - `bundled` : police libre (SIL OFL), embarquée dans `public/fonts/` avec son texte de licence.
 * - `local`   : police sous licence « tous droits réservés » (KFGQPC Uthmanic Hafs V30). Elle n'est
 *               JAMAIS dans Git ni dans `public/` : le serveur la sert depuis `AQR_FONTS_DIR`, à la
 *               boucle locale seulement (voir `font-files.ts`). Absente = option grisée.
 */
export type QuranFontId =
  | "kfgqpc-hafs"
  | "amiri-quran"
  | "scheherazade"
  | "noto-naskh";

export type QuranFont = {
  id: QuranFontId;
  name: string;
  note: string;
  licence: string;
  source: "bundled" | "local";
};

export const QURAN_FONTS: readonly QuranFont[] = [
  {
    id: "kfgqpc-hafs",
    name: "KFGQPC Uthmanic Hafs V30",
    note: "écriture du Mushaf de Médine",
    licence:
      "Tous droits réservés au Complexe du Roi Fahd · usage local uniquement, jamais redistribuée",
    source: "local",
  },
  {
    id: "amiri-quran",
    name: "Amiri Quran",
    note: "naskh classique, signes coraniques complets",
    licence: "SIL OFL · 1 graisse · ≈ 137 Ko",
    source: "bundled",
  },
  {
    id: "scheherazade",
    name: "Scheherazade New",
    note: "naskh ouvert, lisible en petit",
    licence: "SIL OFL · 1 graisse · ≈ 332 Ko",
    source: "bundled",
  },
  {
    id: "noto-naskh",
    name: "Noto Naskh Arabic",
    note: "police historique de l’atelier",
    licence: "SIL OFL · variable 400–700 · ≈ 308 Ko",
    source: "bundled",
  },
];

export const DEFAULT_QURAN_FONT: QuranFontId = "amiri-quran";
export const PREFERRED_QURAN_FONT: QuranFontId = "kfgqpc-hafs";

export const isQuranFontId = (value: unknown): value is QuranFontId =>
  QURAN_FONTS.some((font) => font.id === value);

/**
 * Police réellement appliquée. `availability` ne parle que des polices locales (absent = inconnu =
 * indisponible). Sans choix mémorisé, Hafs V30 est préférée quand elle est installée.
 */
export function resolveQuranFont(
  chosen: QuranFontId | null,
  availability: Partial<Record<QuranFontId, boolean>>,
): QuranFontId {
  const wanted = chosen ?? PREFERRED_QURAN_FONT;
  const font = QURAN_FONTS.find((f) => f.id === wanted);
  if (font && (font.source === "bundled" || availability[font.id] === true))
    return font.id;
  return DEFAULT_QURAN_FONT;
}
