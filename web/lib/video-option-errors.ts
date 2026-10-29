/**
 * Erreurs de validation des options d'export vidéo (API, MCP, route de suggestions), dites en
 * français clair : le champ (chemin JSON, `ranges[0].start`), puis ce qui est attendu. Jamais le
 * texte anglais brut du validateur (« Too small… », « Unrecognized key… »).
 */
type Issue = {
  code: string;
  path: readonly PropertyKey[];
  message: string;
  minimum?: number | bigint;
  maximum?: number | bigint;
  origin?: string;
  expected?: string;
  keys?: string[];
};

const fieldOf = (path: readonly PropertyKey[]): string =>
  path.length === 0
    ? "options"
    : path
        .map((p, i) =>
          typeof p === "number" ? `[${p}]` : `${i > 0 ? "." : ""}${String(p)}`,
        )
        .join("");

const TYPES: Record<string, string> = {
  boolean: "oui ou non attendu (true / false)",
  number: "un nombre attendu",
  string: "un texte attendu",
  array: "une liste attendue",
  object: "un objet attendu",
};

function one(issue: Issue): string {
  const field = fieldOf(issue.path);
  const unit =
    issue.origin === "string"
      ? (n: number | bigint) => `${n} caractère${Number(n) > 1 ? "s" : ""}`
      : issue.origin === "array"
        ? (n: number | bigint) => `${n} élément${Number(n) > 1 ? "s" : ""}`
        : (n: number | bigint) => String(n).replace(".", ",");
  switch (issue.code) {
    case "too_small":
      return `${field} : ${unit(issue.minimum ?? 0)} au moins`;
    case "too_big":
      return `${field} : ${unit(issue.maximum ?? 0)} au plus`;
    case "unrecognized_keys":
      return (issue.keys ?? [])
        .map(
          (k) =>
            `option inconnue « ${k} » (liste des options : GET /api/v1/export/options)`,
        )
        .join(" ; ");
    case "invalid_type":
      return `${field} : ${TYPES[issue.expected ?? ""] ?? "valeur de type inattendu"}`;
    case "invalid_value":
    case "invalid_enum_value":
      return `${field} : valeur non reconnue`;
    case "invalid_format":
    case "invalid_string":
      return `${field} : format non reconnu`;
    default:
      // Messages métier écrits en français dans le schéma (refine) : repris tels quels.
      return `${field} : ${issue.message}`;
  }
}

export function optionIssuesFr(issues: readonly Issue[]): string {
  return issues.map(one).join(" ; ");
}
