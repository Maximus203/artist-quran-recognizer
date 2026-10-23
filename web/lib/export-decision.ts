import type { DecisionKind, DecisionValue } from "./decisions";
import type { ReadinessItem } from "./export-types";
import { candidateTitle } from "./export-text";

/**
 * Ce que l'écran de correction propose pour un passage, et la décision qui en découle. Une seule table :
 * l'écran ne décide rien, il affiche ces choix et envoie cette décision. Fonctions pures.
 *
 * Identifiants de choix : `cand:<n>` (le n-ième candidat), `other` (un autre verset), `setref` (corriger
 * la référence d'un passage signalé), `add` (poser un verset là où le moteur n'a rien reconnu),
 * `extend` (étendre la plage de mots), `confirm`, `exclude`, `scope:verse|fragment|none`, `dismiss`,
 * `retime`.
 */
export type Choice = { id: string; label: string; hint?: string; key?: string };

export function choicesFor(item: ReadinessItem): Choice[] {
  switch (item.type) {
    case "uncertain":
      return [
        ...(item.candidates ?? []).map((c, n) => ({
          id: `cand:${n}`,
          label: `C’est ${c.ref}`,
          key: String(n + 1),
        })),
        {
          id: "other",
          label: "Un autre verset",
          hint: "Saisis la référence et la plage de mots.",
        },
        {
          id: "exclude",
          label: "Ce n’est pas du Coran",
          hint: "À exclure du sous-titre.",
          key: "X",
        },
      ];
    case "inferred":
      return [
        {
          id: "confirm",
          label: "Je l’entends : confirmer",
          hint: "Le verset est écrit dans le fichier, sans marqueur.",
        },
        {
          id: "exclude",
          label: "Je ne l’entends pas : exclure",
          hint: "Le verset n’apparaît pas dans le fichier.",
          key: "X",
        },
      ];
    case "cut":
      return [
        {
          id: "extend",
          label: "Étendre à la plage de mots…",
          hint: "Choisis les mots réellement récités.",
        },
        {
          id: "confirm",
          label: "Le lecteur s’arrête ici : confirmer",
          hint: "La coupure est voulue, le passage est exporté tel quel.",
        },
        { id: "exclude", label: "Exclure ce passage", key: "X" },
      ];
    case "approx":
      return [
        {
          id: "scope:verse",
          label: "Traduction du verset entier",
          hint: "QuranEnc, sans modification.",
        },
        {
          id: "scope:fragment",
          label: "Garder le fragment",
          hint: "Le morceau qui colle à peu près à l’arabe affiché.",
        },
        {
          id: "scope:none",
          label: "Sans traduction pour ce passage",
        },
      ];
    case "report":
      return [
        {
          id: "dismiss",
          label: "Le signalement est faux",
          hint: "Le moteur avait raison : rien à changer.",
        },
        item.index === null
          ? {
              id: "add",
              label: "Il y a un verset ici",
              hint: "Saisis la référence et la plage de mots.",
            }
          : {
              id: "setref",
              label: "Corriger la référence",
              hint: "Saisis le bon verset et la plage de mots.",
            },
        ...(item.index === null
          ? []
          : [
              {
                id: "retime",
                label: "Ajuster les temps seulement",
                hint: "Le verset est bon, pas ses bornes.",
              },
              { id: "exclude", label: "Ce n’est pas du Coran", key: "X" },
            ]),
      ];
  }
}

const REASON: Record<string, "not_quran" | "not_heard" | "unwanted"> = {
  uncertain: "not_quran",
  inferred: "not_heard",
  cut: "unwanted",
  report: "not_quran",
  approx: "unwanted",
};

export type DecisionDraft = {
  /** Le verset saisi (« un autre verset », « corriger », « poser »). */
  custom: { ref: string; range: [number, number]; valid: boolean };
  /** Plage de mots choisie pour étendre une coupure. */
  extend: [number, number];
  /** Début et fin de la décision ; `null` tant qu'ils n'ont pas bougé. */
  t: [number, number] | null;
};

export type Built =
  | { ok: true; kind: DecisionKind; value: DecisionValue }
  | { ok: false; reason: string };

const sameTime = (a: readonly number[], b: readonly number[]) =>
  Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;

/** La décision à envoyer pour ce choix, ou la raison pour laquelle elle n'est pas encore possible. */
export function buildDecision(
  item: ReadinessItem,
  pick: string,
  draft: DecisionDraft,
): Built {
  const moved = draft.t && !sameTime(draft.t, item.t) ? draft.t : null;
  const withTime = (value: DecisionValue): DecisionValue =>
    moved ? { ...value, t: [moved[0], moved[1]] } : value;
  if (pick.startsWith("cand:")) {
    const candidate = item.candidates?.[Number(pick.slice(5))];
    if (!candidate) return { ok: false, reason: "Ce candidat n’existe pas." };
    return {
      ok: true,
      kind: "choose",
      value: withTime({
        ref: candidate.ref,
        words: candidate.words ?? [1, candidate.words_total],
      }),
    };
  }
  if (pick === "other" || pick === "setref" || pick === "add") {
    if (!draft.custom.valid)
      return {
        ok: false,
        reason: "Saisis un verset qui existe dans le corpus.",
      };
    const value: DecisionValue = {
      ref: draft.custom.ref,
      words: draft.custom.range,
    };
    if (pick === "add") {
      const t = draft.t ?? item.t;
      if (!(t[1] > t[0]))
        return { ok: false, reason: "Le passage n’a pas de durée." };
      return {
        ok: true,
        kind: "set_ref",
        value: { ...value, t: [t[0], t[1]] },
      };
    }
    return { ok: true, kind: "set_ref", value: withTime(value) };
  }
  if (pick === "extend") {
    if (!item.ref)
      return { ok: false, reason: "Ce passage n’a pas de verset." };
    return {
      ok: true,
      kind: "set_ref",
      value: withTime({ ref: item.ref, words: draft.extend }),
    };
  }
  if (pick === "confirm")
    return item.type === "inferred"
      ? { ok: true, kind: "confirm_inferred", value: withTime({}) }
      : { ok: true, kind: "confirm_partial", value: {} };
  if (pick === "exclude")
    return { ok: true, kind: "exclude", value: { reason: REASON[item.type] } };
  if (pick.startsWith("scope:"))
    return {
      ok: true,
      kind: "translation_scope",
      value: { scope: pick.slice(6) as "verse" | "fragment" | "none" },
    };
  if (pick === "dismiss")
    return { ok: true, kind: "dismiss_report", value: {} };
  if (pick === "retime") {
    if (!moved)
      return {
        ok: false,
        reason: "Déplace le début ou la fin avant de valider.",
      };
    return {
      ok: true,
      kind: "adjust_time",
      value: { t: [moved[0], moved[1]] },
    };
  }
  return { ok: false, reason: "Choisis une réponse." };
}

/** Le choix qui correspond à une décision déjà prise (pour rouvrir un passage résolu). */
export function pickOf(item: ReadinessItem): string | null {
  const d = item.decision;
  if (!d) return null;
  switch (d.kind) {
    case "choose": {
      const n = item.candidates?.findIndex((c) => c.ref === d.value.ref) ?? -1;
      return n >= 0 ? `cand:${n}` : "other";
    }
    case "set_ref":
      return item.type === "cut"
        ? "extend"
        : item.index === null
          ? "add"
          : item.type === "report"
            ? "setref"
            : "other";
    case "confirm_inferred":
    case "confirm_partial":
      return "confirm";
    case "exclude":
      return "exclude";
    case "translation_scope":
      return `scope:${d.value.scope}`;
    case "dismiss_report":
      return "dismiss";
    case "adjust_time":
      return "retime";
    default:
      return null;
  }
}

/** Le titre du passage tel que l'écran de correction l'écrit en grand. */
export function correctionTitle(item: ReadinessItem): string {
  return item.type === "uncertain" && item.candidates?.length
    ? candidateTitle(item.candidates)
    : (item.ref ?? "Passage");
}
