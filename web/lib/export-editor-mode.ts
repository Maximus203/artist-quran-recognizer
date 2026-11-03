import type { Role } from "./users";

/**
 * Le format de l'éditeur de la vidéo d'export sur téléphone, et QUI en décide. Fonctions pures, sans accès
 * aux données ni au navigateur : la règle vit ici, une seule fois, et les écrans ne font que la demander.
 *
 *  - `plateau` : l'aperçu est l'éditeur ; on touche un élément, sa barre d'outils apparaît.
 *  - `table`   : la table de montage (aperçu, chronologie, rail d'outils).
 *  - `pas`     : le pas à pas en trois étapes.
 *
 * Au bureau (1024 px et plus) la vue est unique : le format ne s'y applique pas.
 */
export const EDITOR_MODES = ["plateau", "table", "pas"] as const;
export type EditorMode = (typeof EDITOR_MODES)[number];

/** Le repli sûr : l'éditeur montré quand rien ne dit mieux (valeur inconnue, rôle inconnu, « plus tard »). */
export const DEFAULT_EDITOR_MODE: EditorMode = "plateau";

export const isEditorMode = (value: unknown): value is EditorMode =>
  typeof value === "string" &&
  (EDITOR_MODES as readonly string[]).includes(value);

/**
 * La politique de chaque rôle, dans UNE table (jamais de `if (role === …)` ailleurs) :
 *  - `fallback` : l'éditeur quand la personne n'a rien choisi ;
 *  - `asks`     : lui demande-t-on son format la première fois ? (le récitateur, jamais : interface réduite) ;
 *  - `canChoose`: la section « Éditeur d'export » de ses paramètres lui est-elle montrée ?
 */
type RolePolicy = {
  fallback: EditorMode;
  asks: boolean;
  canChoose: boolean;
};

const ROLE_POLICY: Record<Role, RolePolicy> = {
  user: { fallback: "plateau", asks: true, canChoose: true },
  admin: { fallback: "plateau", asks: true, canChoose: true },
  // La page des paramètres du récitateur montre déjà des préférences : il peut y changer, sans question.
  recitant: { fallback: "pas", asks: false, canChoose: true },
};

/** Un rôle que ce code ne connaît pas (créé plus tard) : ni question ni section, le repli sûr. */
const UNKNOWN_ROLE: RolePolicy = {
  fallback: DEFAULT_EDITOR_MODE,
  asks: false,
  canChoose: false,
};

const policyOf = (role: Role): RolePolicy => ROLE_POLICY[role] ?? UNKNOWN_ROLE;

/** L'éditeur d'un compte qui n'a rien choisi : le pas à pas pour le récitateur, le plateau sinon. */
export const defaultEditorModeFor = (role: Role): EditorMode =>
  policyOf(role).fallback;

/**
 * Faut-il demander le format ? Seulement sur téléphone, à un compte qui n'a jamais choisi, et dont le rôle est
 * interrogé. Une valeur enregistrée illisible compte comme « jamais choisi ».
 */
export function shouldAskEditorMode({
  role,
  saved,
  wide,
}: {
  role: Role;
  saved: EditorMode | null | undefined;
  wide: boolean;
}): boolean {
  if (wide) return false;
  if (isEditorMode(saved)) return false;
  return policyOf(role).asks;
}

/** L'éditeur à monter : le choix enregistré s'il est valide, sinon le défaut du rôle. */
export const effectiveEditorMode = ({
  role,
  saved,
}: {
  role: Role;
  saved: EditorMode | null | undefined;
}): EditorMode => (isEditorMode(saved) ? saved : defaultEditorModeFor(role));

/**
 * La décision de l'écran, en une fois : faut-il d'abord poser la question, et sinon quel éditeur monter.
 * `postponed` = « Choisir plus tard » déjà dit pendant cette séance du navigateur.
 */
export function editorChoiceFor({
  role,
  saved,
  wide,
  postponed,
}: {
  role: Role;
  saved: EditorMode | null | undefined;
  wide: boolean;
  postponed: boolean;
}): { ask: boolean; mode: EditorMode } {
  return {
    ask: !postponed && shouldAskEditorMode({ role, saved, wide }),
    mode: effectiveEditorMode({ role, saved }),
  };
}

/** La section « Éditeur d'export (téléphone) » des paramètres est-elle montrée à ce rôle ? */
export const canChooseEditorMode = (role: Role): boolean =>
  policyOf(role).canChoose;

/**
 * « Choisir plus tard » : on montre le plateau pour cette séance du navigateur et on redemandera à la
 * prochaine (un autre onglet, un autre jour). C'est un état de séance, jamais une préférence du compte : la
 * personne n'est pas harcelée à chaque export d'une même séance, et n'est pas oubliée non plus.
 */
export const POSTPONE_KEY = "aqr.export-editor.later";

type SessionStore = Pick<Storage, "getItem" | "setItem">;

export function isPostponed(storage: SessionStore | null | undefined): boolean {
  try {
    return storage?.getItem(POSTPONE_KEY) === "1";
  } catch {
    return false; // stockage bloqué : on redemandera, ce qui vaut mieux que de ne jamais demander
  }
}

export function postpone(storage: SessionStore | null | undefined): void {
  try {
    storage?.setItem(POSTPONE_KEY, "1");
  } catch {
    /* stockage bloqué : la question reviendra à l'export suivant */
  }
}
