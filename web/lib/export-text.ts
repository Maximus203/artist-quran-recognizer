import type { ItemType } from "./decisions";
import type {
  CandidateView,
  DecisionSummary,
  Impact,
  ReadinessItem,
} from "./export-types";
import { presetLabel } from "./review-presets";

/**
 * Les phrases de l'écran d'export, en un seul endroit : aucun jargon (« interval », « status »,
 * « INFERRED ») n'arrive à l'écran, chaque passage dit POURQUOI il est à vérifier. Fonctions pures.
 */

export const TYPE_LABEL: Record<ItemType, string> = {
  inferred: "Supposé, non entendu",
  uncertain: "Incertain",
  cut: "Coupure",
  report: "Signalement",
  approx: "Traduction approximative",
};
export const TYPE_FILTER_LABEL: Record<ItemType, string> = {
  inferred: "Supposés",
  uncertain: "Incertains",
  cut: "Coupures",
  report: "Signalements",
  approx: "Traduction",
};
/** L'ordre des filtres de la liste (celui de la conception). */
export const FILTER_ORDER: readonly ItemType[] = [
  "inferred",
  "uncertain",
  "cut",
  "report",
  "approx",
];

export const IMPACT_LABEL: Record<Impact, string> = {
  arabic: "Arabe",
  arabic_sign: "Arabe · 1 signe",
  translation: "Traduction",
  reference: "Référence",
};

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n > 1 ? many : one}`;
}

/** `00:48.2` : minutes, secondes et dixième (le dixième suffit à se repérer dans un audio). */
export function clock(seconds: number): string {
  const tenths = Math.max(0, Math.round(seconds * 10));
  const m = Math.floor(tenths / 600);
  const s = Math.floor((tenths % 600) / 10);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${tenths % 10}`;
}

/** `48,2 s` (virgule décimale française). */
export function secondsFr(value: number): string {
  return `${value.toFixed(1).replace(".", ",")} s`;
}

export function wordsLabel(words: readonly [number, number] | null): string {
  if (!words) return "";
  return words[0] === words[1]
    ? `mot ${words[0]}`
    : `mots ${words[0]}–${words[1]}`;
}

/** Plages de positions consécutives : `[3, 4, 5, 9]` → `[[3,5],[9,9]]`. */
export function ranges(positions: readonly number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const p of positions) {
    const last = out.at(-1);
    if (last && p === last[1] + 1) last[1] = p;
    else out.push([p, p]);
  }
  return out;
}

/** Où diffèrent les candidats : numéros de mots (dans le verset) du premier candidat. */
export function differingWords(candidates: readonly CandidateView[]): number[] {
  const first = candidates[0];
  if (!first) return [];
  const start = first.words?.[0] ?? 1;
  return first.tokens.flatMap((t, i) => (t.diff ? [start + i] : []));
}

function rangeText(list: readonly [number, number][]): string {
  return list.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(", ");
}

/** Le titre d'un passage incertain : « 11:61 ou 7:73 ». */
export function candidateTitle(candidates: readonly { ref: string }[]): string {
  return candidates.map((c) => c.ref).join(" ou ");
}

/** La phrase qui dit pourquoi le passage est à vérifier (une ligne, sans jargon). */
export function why(item: ReadinessItem): string {
  switch (item.type) {
    case "uncertain": {
      const c = item.candidates ?? [];
      const head = `${c.length} candidats : ${c.map((x) => x.ref).join(" ou ")}.`;
      const diff = differingWords(c);
      if (item.impact === "arabic_sign")
        return `${head} Mêmes lettres ; un seul signe de pause diffère${diff.length ? ` au mot ${diff[0]}` : ""}.`;
      if (item.impact === "arabic")
        return `${head} L'arabe diffère${diff.length ? ` aux ${wordsLabel([diff[0], diff.at(-1)!])}` : ""}.`;
      if (item.impact === "translation")
        return `${head} Même arabe ; seule la traduction diffère.`;
      return `${head} Même arabe, même traduction : seule la référence diffère.`;
    }
    case "inferred":
      return `Verset supposé entre deux versets reconnus, jamais entendu. Il n'apparaîtra pas dans l'export tant que tu ne l'as pas confirmé à l'oreille.`;
    case "cut": {
      const total = item.words_total ?? 0;
      const [a, b] = item.words ?? [1, 1];
      const parts: string[] = [];
      if (item.sides?.includes("start") && a > 1)
        parts.push(`le début (${wordsLabel([1, a - 1])})`);
      if (item.sides?.includes("end") && b < total)
        parts.push(`la fin (${wordsLabel([b + 1, total])})`);
      return `Verset coupé dans une suite : il manque ${parts.join(" et ") || "des mots"}. Étends la plage de mots, ou confirme que le lecteur s'arrête là.`;
    }
    case "approx": {
      const fragment = item.translation?.fragment_words;
      return `La traduction affichée ne colle qu'à peu près à l'arabe${fragment ? ` (${wordsLabel(fragment)})` : ""}. Choisis la traduction du verset entier, garde le fragment, ou n'en mets pas.`;
    }
    case "report": {
      const note = item.notes?.[0];
      if (!note) return "Un testeur a signalé une erreur ici.";
      const tags = note.tags.map(presetLabel).join(" · ");
      const more =
        (item.notes?.length ?? 0) > 1
          ? ` (+${(item.notes?.length ?? 1) - 1})`
          : "";
      return `Signalement confirmé par ${note.tester} : ${tags || "autre"}${more}. ${note.description ? `« ${note.description} »` : ""}`.trim();
    }
  }
}

/** Le titre court d'une ligne : la référence, ou « 11:61 ou 7:73 », ou « Verset manquant ». */
export function itemTitle(item: ReadinessItem): string {
  if (item.type === "uncertain" && item.candidates?.length)
    return candidateTitle(item.candidates);
  if (item.ref) return item.ref;
  if (item.type === "report") return "Verset à poser";
  return "Passage";
}

/** Ce que dit la décision d'un passage résolu : « 11:61 · mots 1–10 », « exclu », « ignoré »… */
export function decisionLabel(decision: DecisionSummary): string {
  const v = decision.value;
  switch (decision.kind) {
    case "choose":
    case "set_ref":
      return `${v.ref}${v.words ? ` · ${wordsLabel(v.words)}` : ""}`;
    case "confirm_inferred":
      return "entendu, gardé dans l'export";
    case "confirm_partial":
      return "le lecteur s'arrête là";
    case "exclude":
      return v.reason === "not_quran"
        ? "pas du Coran, exclu"
        : v.reason === "not_heard"
          ? "non entendu, exclu"
          : "exclu de l'export";
    case "adjust_time":
      return v.t
        ? `temps ajustés (${clock(v.t[0])} → ${clock(v.t[1])})`
        : "temps ajustés";
    case "translation_scope":
      return v.scope === "verse"
        ? "traduction du verset entier"
        : v.scope === "fragment"
          ? "fragment gardé"
          : "sans traduction";
    case "dismiss_report":
      return "le signalement est faux";
    case "ignore":
      return "ignoré : exporté selon la règle par défaut";
  }
}

/** Ce que dit le moteur d'un passage (figé), pour la ligne « Moteur : … » d'une décision. */
export function engineLabel(item: ReadinessItem): string {
  switch (item.type) {
    case "uncertain":
      return `incertain · ${plural(item.candidates?.length ?? 0, "candidat", "candidats")} (inchangé)`;
    case "inferred":
      return "supposé, jamais entendu (inchangé)";
    case "cut":
      return "reconnu en partie (inchangé)";
    case "approx":
      return "reconnu, traduction approximative (inchangé)";
    case "report":
      return "reconnu ou non reconnu, signalé par un testeur (inchangé)";
  }
}

export function verdictSentence(v: { arabic: number; other: number }): string {
  const parts: string[] = [];
  if (v.arabic > 0)
    parts.push(`${v.arabic} ${v.arabic > 1 ? "touchent" : "touche"} l'arabe`);
  if (v.other > 0)
    parts.push(
      `${v.other} ${v.other > 1 ? "concernent" : "concerne"} seulement la traduction ou la référence`,
    );
  return parts.length ? `${parts.join(" ; ")}.` : "";
}

export function nonQuranSentence(n: {
  abstentions: number;
  formulas: number;
}): {
  total: number;
  detail: string;
} {
  const total = n.abstentions + n.formulas;
  const detail: string[] = [];
  if (n.abstentions)
    detail.push(
      `${plural(n.abstentions, "abstention", "abstentions")} : tafsir, wolof, français`,
    );
  if (n.formulas) detail.push(plural(n.formulas, "formule", "formules"));
  return { total, detail: detail.join(" · ") };
}

/** Taille lisible d'un fichier (« 6,2 Ko »). */
export function bytesFr(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toFixed(1).replace(".", ",")} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`;
}

/** La règle appliquée à un passage omis, en une phrase de l'aperçu et du dialogue. */
export function omissionText(o: {
  reason: string;
  ref: string | null;
  detail: string | null;
}): string {
  switch (o.reason) {
    case "uncertain":
      return `${o.detail ? o.detail.replace(/ \| /g, " ou ") : "Ce passage"} est incertain.`;
    case "inferred":
      return `${o.ref ?? "Ce verset"} est un verset supposé, jamais entendu.`;
    case "excluded":
      return `${o.ref ?? "Ce passage"} est exclu par ta décision.`;
    default:
      return `${o.ref ?? "Ce passage"} n'a pas de texte à écrire.`;
  }
}

/**
 * Ce qui arrive à un passage non résolu quand on force l'export, selon la politique choisie : la règle
 * de la conception §6, écrite une seule fois. Doit rester celle du moteur (`aqr.export.view`).
 */
export function forcedRule(
  item: ReadinessItem,
  policy: "omit" | "marker" | "first",
): string {
  switch (item.type) {
    case "uncertain": {
      if (policy === "omit") return "Omis";
      if (policy === "marker")
        return `Marqueur : [incertain : ${(item.candidates ?? []).map((c) => c.ref).join(" | ")}]`;
      return `Premier candidat : ${item.candidates?.[0]?.ref ?? "aucun"}`;
    }
    case "inferred":
      return policy === "omit" ? "Omis" : "Gardé avec le marqueur [déduit]";
    case "cut": {
      const sides = item.sides ?? [];
      const missing =
        sides.length === 2
          ? "début et fin manquants"
          : sides[0] === "start"
            ? "début manquant"
            : "fin manquante";
      return `Exporté tel quel : ${missing}`;
    }
    case "approx":
      return "Exporté tel quel : fragment approximatif";
    case "report":
      return item.index === null
        ? "Rien (le moteur n'a rien reconnu)"
        : "Exporté tel quel (le signalement reste sans effet)";
  }
}
