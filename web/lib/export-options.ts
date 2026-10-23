import { z } from "zod";

/**
 * Options d'un export de sous-titres : les défauts de `docs/design/export-sous-titres.md` §7, une seule
 * définition pour le serveur (validation) et le navigateur (réglages, aperçu). Le moteur Python
 * (`src/aqr/export/options.py`) valide une seconde fois : une valeur que ce schéma laisse passer et que
 * Python refuse revient en erreur claire, jamais en export silencieusement faux.
 */
export const EXPORT_FORMATS = ["srt", "vtt", "ass", "json"] as const;
export const EXPORT_CONTENTS = ["ar_fr", "ar", "fr"] as const;
export const EXPORT_FORMULAS = [
  "istiadha",
  "basmala",
  "takbir",
  "amin",
] as const;
export const EXPORT_POLICIES = ["omit", "marker", "first"] as const;
export const EXPORT_REPETITIONS = ["keep", "merge"] as const;
/** Polices arabes de l'ASS : toutes sous licence OFL. KFGQPC (Hafs) n'y est pas : pas de redistribution. */
export const EXPORT_FONTS = [
  "Amiri Quran",
  "Scheherazade New",
  "Noto Naskh Arabic",
] as const;

export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export type ExportContent = (typeof EXPORT_CONTENTS)[number];
export type ExportPolicy = (typeof EXPORT_POLICIES)[number];

export type ExportOptions = {
  format: ExportFormat;
  content: ExportContent;
  formulas: (typeof EXPORT_FORMULAS)[number][];
  repetitions: (typeof EXPORT_REPETITIONS)[number];
  min_s: number;
  max_s: number;
  line_chars: number;
  offset_ms: number;
  rtl: boolean;
  strip_notes: boolean;
  show_ref: boolean;
  bom: boolean;
  karaoke: boolean;
  font: (typeof EXPORT_FONTS)[number];
  policy: ExportPolicy;
  allow_unresolved: boolean;
};

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  format: "srt",
  content: "ar_fr",
  formulas: ["basmala"],
  repetitions: "keep",
  min_s: 1,
  max_s: 7,
  line_chars: 42,
  offset_ms: 0,
  rtl: true,
  strip_notes: false,
  show_ref: false,
  bom: false,
  karaoke: true,
  font: "Amiri Quran",
  policy: "omit",
  allow_unresolved: false,
};

export const exportOptionsSchema = z
  .object({
    format: z.enum(EXPORT_FORMATS),
    content: z.enum(EXPORT_CONTENTS),
    formulas: z.array(z.enum(EXPORT_FORMULAS)).max(4),
    repetitions: z.enum(EXPORT_REPETITIONS),
    min_s: z.number().min(0).max(30),
    max_s: z.number().min(0.5).max(60),
    line_chars: z.number().int().min(10).max(200),
    offset_ms: z.number().int().min(-5000).max(5000),
    rtl: z.boolean(),
    strip_notes: z.boolean(),
    show_ref: z.boolean(),
    bom: z.boolean(),
    karaoke: z.boolean(),
    font: z.enum(EXPORT_FONTS),
    policy: z.enum(EXPORT_POLICIES),
    allow_unresolved: z.boolean(),
  })
  .partial()
  .strict();

/** Options reçues (partielles) complétées par les défauts ; lève une erreur de validation sinon. */
export function resolveExportOptions(input: unknown): ExportOptions {
  const parsed = exportOptionsSchema.parse(input ?? {});
  const options = { ...DEFAULT_EXPORT_OPTIONS, ...parsed };
  if (options.max_s < options.min_s)
    throw new Error("La durée maximale doit être au moins la durée minimale.");
  return options;
}

const FILE_EXTENSION: Record<ExportFormat, string> = {
  srt: "srt",
  vtt: "vtt",
  ass: "ass",
  json: "json",
};
const CONTENT_TAG: Record<ExportContent, string> = {
  ar: "ar",
  fr: "fr",
  ar_fr: "ar-fr",
};
const MAX_NAME = 120;

/**
 * Nom du fichier : `<nom de la session>.<ar|fr|ar-fr>.<format>`, assaini côté serveur (jamais de
 * séparateur de chemin, de `..` ni de caractère de contrôle ; 120 caractères au plus).
 */
export function exportFileName(
  sessionName: string,
  options: Pick<ExportOptions, "format" | "content">,
  custom?: string,
): string {
  const clean = (value: string): string =>
    value
      .normalize("NFC")
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, " ")
      .replace(/\.{2,}/g, ".")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^[. ]+|[. ]+$/g, "");
  const tail = `.${CONTENT_TAG[options.content]}.${FILE_EXTENSION[options.format]}`;
  const raw = custom?.trim()
    ? custom
    : sessionName.replace(/\.[A-Za-z0-9]{1,5}$/, "");
  const stem =
    clean(raw.replace(/\.(srt|vtt|ass|json)$/i, "")) || "sous-titres";
  return (
    Array.from(stem)
      .slice(0, MAX_NAME - tail.length)
      .join("") + tail
  );
}
