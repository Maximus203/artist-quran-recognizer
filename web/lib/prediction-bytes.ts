/**
 * Le fichier `aqr.recognition/1` joint à un import, avant d'être lu : trois refus clairs pour des
 * fichiers qui n'ont rien de faux mais que le reste de la chaîne ne sait pas lire, au lieu d'un
 * « JSON invalide » (BOM, UTF-16) ou d'un « contrôle indisponible » (imbrication démesurée).
 *
 * - **BOM UTF-8** (outils Windows : `Out-File`, Bloc-notes) : retiré. C'est le seul octet changé ; tous
 *   les lecteurs (zod, le contrôle Python, l'export) lisent le même fichier, et l'empreinte
 *   (`prediction_sha256`) est celle du fichier conservé.
 * - **UTF-16 / UTF-32**, avec ou sans BOM (`>` de PowerShell 5) : refusé, il faut enregistrer en UTF-8.
 *   Le convertir serait réécrire le fichier ; on ne le fait que pour un BOM UTF-8.
 * - **Imbrication** au-delà de `MAX_JSON_DEPTH` niveaux : refusée en 422. Un vrai résultat en a une
 *   dizaine ; l'analyseur JSON de Python plante bien avant 20 000, et ce plantage ressemblait à une
 *   panne du moteur (503) alors que le fichier n'est tout simplement pas un résultat.
 */
import { ImportError } from "./import-error";

/** Un résultat réel : intervalles › intervalle › traduction › segments › segment › mots ≈ 7 niveaux. */
export const MAX_JSON_DEPTH = 32;

const BRACKET_OPEN = 0x5b; // [
const BRACKET_CLOSE = 0x5d; // ]
const BRACE_OPEN = 0x7b; // {
const BRACE_CLOSE = 0x7d; // }
const QUOTE = 0x22; // "
const BACKSLASH = 0x5c; // \

/** Plus profond que `max` ? Parcours d'octets, sans récursion : `[`, `{`, `"` et `\` sont de l'ASCII pur en UTF-8. */
function exceedsDepth(bytes: Buffer, max: number): boolean {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i];
    if (inString) {
      if (byte === BACKSLASH) i += 1;
      else if (byte === QUOTE) inString = false;
    } else if (byte === QUOTE) inString = true;
    else if (byte === BRACKET_OPEN || byte === BRACE_OPEN) {
      depth += 1;
      if (depth > max) return true;
    } else if (byte === BRACKET_CLOSE || byte === BRACE_CLOSE) depth -= 1;
  }
  return false;
}

const hasUtf16Bom = (b: Buffer): boolean =>
  b.length >= 2 &&
  ((b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff));
const hasUtf8Bom = (b: Buffer): boolean =>
  b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf;

/**
 * UTF-16 ou UTF-32 sans BOM (`Set-Content -Encoding Unicode`, certains outils) : le JSON commence par
 * `{` ou une espace, dont chaque caractère devient un octet nul. Un JSON UTF-8 n'a jamais d'octet nul
 * (un caractère de contrôle doit y être échappé) : un nul parmi les premiers octets désigne un codage
 * large, sans faux positif possible sur du texte arabe ou accentué.
 */
const WIDE_PROBE_BYTES = 8;
const looksWide = (b: Buffer): boolean =>
  b.subarray(0, WIDE_PROBE_BYTES).includes(0);

const ENCODING_REFUSAL =
  "Le résultat joint est encodé en UTF-16 (ou UTF-32) : enregistre-le en UTF-8 (sans BOM) puis recommence — " +
  "dans PowerShell, `Out-File -Encoding utf8` ou `Set-Content -Encoding utf8` au lieu de `>` ; " +
  "dans le Bloc-notes, Enregistrer sous, encodage UTF-8. Rien n'a été importé.";

/** Les octets à lire, conservés et contrôlés ; lève un `ImportError` explicite pour les trois cas ci-dessus. */
export function preparePrediction(bytes: Buffer): Buffer {
  const content = hasUtf8Bom(bytes) ? bytes.subarray(3) : bytes;
  if (hasUtf16Bom(bytes) || looksWide(content))
    throw new ImportError(400, ENCODING_REFUSAL, "result_encoding");
  if (exceedsDepth(content, MAX_JSON_DEPTH))
    throw new ImportError(
      422,
      `Le résultat joint est trop imbriqué pour être un résultat aqr.recognition/1 (plus de ${MAX_JSON_DEPTH} niveaux). Rien n'a été importé.`,
      "result_too_deep",
    );
  return content;
}
