/**
 * Les trois étapes de l'éditeur « Pas à pas » : Le cadre, Les textes, Exporter. Fonctions PURES : l'ordre
 * des étapes, la progression (celle où l'on est, celles qu'on a passées), sa mémoire de navigateur (par
 * récitation) et l'élément réglé à l'étape des textes. Aucun DOM ici : le composant ne fait que brancher.
 *
 * Aucun texte coranique (I1) : ce ne sont que des noms d'étapes.
 */

export const STEP_IDS = ["cadre", "textes", "exporter"] as const;
export type StepId = (typeof STEP_IDS)[number];

/** Le nom d'une étape, sur sa pastille et dans les annonces. */
export const STEP_LABEL: Record<StepId, string> = {
  cadre: "Le cadre",
  textes: "Les textes",
  exporter: "Exporter",
};

export const isStepId = (value: unknown): value is StepId =>
  typeof value === "string" && (STEP_IDS as readonly string[]).includes(value);

/** 1, 2 ou 3. */
export const stepNumber = (step: StepId): number => STEP_IDS.indexOf(step) + 1;

/** L'étape suivante ; `null` à la dernière. */
export const nextStep = (step: StepId): StepId | null =>
  STEP_IDS[STEP_IDS.indexOf(step) + 1] ?? null;

/** L'étape précédente ; `null` à la première. */
export const previousStep = (step: StepId): StepId | null =>
  STEP_IDS[STEP_IDS.indexOf(step) - 1] ?? null;

/** La phrase annoncée aux lecteurs d'écran quand on change d'étape. */
export const describeStep = (step: StepId): string =>
  `Étape ${stepNumber(step)} sur ${STEP_IDS.length} : ${STEP_LABEL[step]}.`;

// ── progression ─────────────────────────────────────────────────────────────

/** Où l'on est, et les étapes qu'on a quittées vers l'avant (celles qui portent une coche). */
export type StepsProgress = {
  step: StepId;
  done: readonly StepId[];
};

export const START_PROGRESS: StepsProgress = { step: "cadre", done: [] };

/**
 * Aller à une étape. LA GARDE de navigation : une étape inconnue, ou celle où l'on est déjà, ne change rien
 * (le même objet revient, donc rien ne se redessine). Quitter une étape vers une étape plus loin la marque
 * comme faite ; revenir en arrière ne défait rien. N'importe quelle étape reste atteignable à tout moment :
 * rien n'est verrouillé, la coche dit seulement « déjà passée ».
 */
export function moveTo(progress: StepsProgress, target: StepId): StepsProgress {
  if (!isStepId(target) || target === progress.step) return progress;
  const forward = STEP_IDS.indexOf(target) > STEP_IDS.indexOf(progress.step);
  const done =
    forward && !progress.done.includes(progress.step)
      ? [...progress.done, progress.step]
      : progress.done;
  return { step: target, done };
}

/** Une étape porte sa coche si on l'a quittée vers l'avant ET qu'on n'y est pas en ce moment. */
export const isDone = (progress: StepsProgress, id: StepId): boolean =>
  id !== progress.step && progress.done.includes(id);

// ── mémoire de navigateur ───────────────────────────────────────────────────

/** Ce qu'il faut de `sessionStorage` : de quoi lire et écrire une valeur. */
export type StepsStorage = Pick<Storage, "getItem" | "setItem">;

/** Une clé par récitation : revenir sur une autre repart du début. */
export const stepsKey = (sessionId: string): string =>
  `aqr.export-steps.v1:${sessionId}`;

/** Lit une progression mémorisée ; tout ce qui n'est pas reconnu redonne le début (jamais d'erreur). */
export function parseProgress(raw: string | null): StepsProgress {
  if (!raw) return START_PROGRESS;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return START_PROGRESS;
    const { step, done } = value as { step?: unknown; done?: unknown };
    if (!isStepId(step)) return START_PROGRESS;
    const passed = Array.isArray(done)
      ? done.filter(
          (id, index): id is StepId =>
            isStepId(id) && done.indexOf(id) === index,
        )
      : [];
    return { step, done: passed };
  } catch {
    return START_PROGRESS;
  }
}

/** Revient là où l'on était sur cette récitation ; sans mémoire ou si elle refuse, le début. */
export function loadProgress(
  storage: StepsStorage | null,
  sessionId: string,
): StepsProgress {
  if (!storage) return START_PROGRESS;
  try {
    return parseProgress(storage.getItem(stepsKey(sessionId)));
  } catch {
    return START_PROGRESS;
  }
}

/** Mémorise la progression ; une mémoire absente, pleine ou bloquée n'arrête jamais l'éditeur. */
export function saveProgress(
  storage: StepsStorage | null,
  sessionId: string,
  progress: StepsProgress,
): void {
  if (!storage) return;
  try {
    storage.setItem(
      stepsKey(sessionId),
      JSON.stringify({ step: progress.step, done: progress.done }),
    );
  } catch {
    // Mémoire indisponible : on perd seulement le retour à l'étape.
  }
}

// ── les textes ──────────────────────────────────────────────────────────────

/**
 * Les éléments qu'on règle à l'étape des textes, dans l'ordre des onglets : l'arabe, la traduction, l'onde,
 * la sourate et le verset.
 */
export const TEXT_TABS = ["arabic", "translation", "wave", "ref"] as const;
export type TextTab = (typeof TEXT_TABS)[number];

/**
 * L'onglet à montrer quand l'aperçu change de choix : l'élément touché, ou — si l'on touche à côté et que
 * plus rien n'est choisi — celui qui était ouvert. À cette étape, un réglage est toujours ouvert.
 */
export const resolveTextTab = (
  current: TextTab,
  picked: TextTab | null,
): TextTab => picked ?? current;
