/**
 * Politique de mot de passe (pure : serveur ET interface). 12 à 128 caractères, pas de règle de
 * symboles (une phrase de passe est recommandée), et refus de ce qui est prévisible : le pseudonyme,
 * les mots de passe courants ou liés au service, les suites et les répétitions.
 *
 * La liste de mots de passe courants est volontairement courte et locale : la vérification contre
 * une base de fuites complète (Have I Been Pwned) demanderait un appel réseau sortant ou un fichier de
 * plusieurs centaines de Mo, hors du périmètre fixé par `AGENTS.md` (seuls Tanzil et QuranEnc sont
 * appelés). Elle reste une décision à prendre (voir `docs/SECURITE-PRE-DEPLOIEMENT.md`, § 4).
 */
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

export type PolicyResult = { ok: true } | { ok: false; message: string };

/** Mots (sans chiffres ni signes) dont un mot de passe n'est que le décor : base courante ou service. */
const COMMON_BASES = [
  "password",
  "passw0rd",
  "motdepasse",
  "azerty",
  "azertyuiop",
  "qwerty",
  "qwertyuiop",
  "iloveyou",
  "jetaime",
  "bonjour",
  "soleil",
  "doudou",
  "chocolat",
  "football",
  "admin",
  "administrateur",
  "letmein",
  "welcome",
  "bienvenue",
  "dragon",
  "monkey",
  "master",
  "superman",
  // religieux et locaux, très fréquents dans l'usage réel de l'atelier
  "bismillah",
  "allahuakbar",
  "allah",
  "alhamdulillah",
  "inchallah",
  "muhammad",
  "mohammed",
  "mohamed",
  "ahmadou",
  "senegal",
  "dakar",
  "touba",
  "islam",
  "moslem",
  // le service lui-même
  "quran",
  "coran",
  "quranTR",
  "atelier",
  "aqr",
  "artist",
  "recognizer",
  "recitation",
].map((word) => word.toLowerCase());

const normalize = (value: string): string =>
  value.normalize("NFKC").toLowerCase();

/** Lettres seules : « Password-2026!! » → « password ». */
const lettersOnly = (value: string): string => value.replace(/[^\p{L}]/gu, "");

/** Vrai si `letters` est un ou plusieurs mots de `COMMON_BASES` bout à bout (ex. « motdepasseazerty »). */
function onlyCommonWords(letters: string): boolean {
  if (letters.length === 0) return false;
  const reachable: boolean[] = new Array(letters.length + 1).fill(false);
  reachable[0] = true;
  for (let i = 0; i < letters.length; i++) {
    if (!reachable[i]) continue;
    for (const word of COMMON_BASES)
      if (letters.startsWith(word, i)) reachable[i + word.length] = true;
  }
  return reachable[letters.length];
}

// Doublés : « 1234567890123 » repasse par 0.
const DIGIT_RUNS = ["01234567890123456789", "98765432109876543210"];
const KEYBOARD_RUNS = [
  "azertyuiopqsdfghjklmwxcvbn",
  "qwertyuiopasdfghjklzxcvbnm",
];
const ALPHABET = "abcdefghijklmnopqrstuvwxyz";

/** Suite continue (alphabet, chiffres, rangée du clavier), dans un sens ou dans l'autre. */
function isRun(value: string): boolean {
  const reversed = [...value].reverse().join("");
  return [
    ...DIGIT_RUNS,
    ...KEYBOARD_RUNS,
    ALPHABET,
    [...ALPHABET].reverse().join(""),
  ].some((run) => run.includes(value) || run.includes(reversed));
}

/** Texte fait d'une unité courte (1 à 4 caractères) répétée. */
function isRepeated(value: string): boolean {
  for (let size = 1; size <= 4; size++) {
    const unit = value.slice(0, size);
    if (
      value.length >= size * 3 &&
      unit.repeat(Math.ceil(value.length / size)).startsWith(value)
    )
      return true;
  }
  return false;
}

export function checkPassword(
  password: string,
  username: string,
): PolicyResult {
  if (password.length < PASSWORD_MIN)
    return {
      ok: false,
      message: `Le mot de passe fait au moins ${PASSWORD_MIN} caractères.`,
    };
  if (password.length > PASSWORD_MAX)
    return {
      ok: false,
      message: `Le mot de passe fait au plus ${PASSWORD_MAX} caractères.`,
    };
  const plain = normalize(password);
  const name = normalize(username.trim());
  if (plain === name || (name.length >= 4 && plain.includes(name)))
    return {
      ok: false,
      message: "Le mot de passe ne peut pas contenir le pseudonyme.",
    };
  const squashed = plain.replace(/\s+/g, "");
  if (isRun(squashed) || isRepeated(squashed) || new Set(squashed).size < 5)
    return {
      ok: false,
      message:
        "Mot de passe trop prévisible (suite ou répétition) : choisis une phrase.",
    };
  // Un mot courant noyé dans une vraie phrase passe ; seul le décor (chiffres, signes, majuscules)
  // autour de mots courants est refusé.
  if (onlyCommonWords(lettersOnly(plain)))
    return {
      ok: false,
      message:
        "Mot de passe trop courant ou prévisible : choisis une phrase de passe.",
    };
  return { ok: true };
}
