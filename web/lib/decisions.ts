/**
 * Le calque de décisions humaines `aqr.decisions/1` (ADR-0014) côté atelier : lecture stricte,
 * décisions actives, réconciliation avec la prédiction. Le miroir TypeScript de `src/aqr/decisions/` :
 * ce que Python refuse, ce module le refuse aussi (mêmes cas de test, `tests/fixtures/decisions/`).
 *
 * Aucun accès au disque ni à `node:crypto` ici : ce module sert aussi le navigateur. L'empreinte d'un
 * intervalle, qui exige SHA-256, vit dans `decisions-fingerprint.ts` (serveur seulement).
 */

export const DECISIONS_SCHEMA = "aqr.decisions/1";

export const KINDS = [
  "choose",
  "set_ref",
  "confirm_inferred",
  "confirm_partial",
  "exclude",
  "adjust_time",
  "translation_scope",
  "dismiss_report",
  "ignore",
] as const;
export type DecisionKind = (typeof KINDS)[number];

/** La question à laquelle une décision répond (un intervalle peut en porter plusieurs). */
export const ITEMS = [
  "uncertain",
  "inferred",
  "cut",
  "approx",
  "report",
] as const;
export type ItemType = (typeof ITEMS)[number];

export const ITEM_KINDS: Record<ItemType, readonly DecisionKind[]> = {
  uncertain: ["choose", "set_ref", "exclude", "ignore"],
  inferred: ["confirm_inferred", "exclude", "ignore"],
  cut: ["set_ref", "confirm_partial", "exclude", "ignore"],
  approx: ["translation_scope", "ignore"],
  report: ["set_ref", "adjust_time", "exclude", "dismiss_report", "ignore"],
};
const REPORT_KINDS: readonly DecisionKind[] = [
  "set_ref",
  "dismiss_report",
  "ignore",
];

/** Genres factuels : seuls eux peuvent devenir une proposition de vérité terrain. */
export const FACTUAL_KINDS: readonly DecisionKind[] = [
  "choose",
  "set_ref",
  "confirm_inferred",
  "confirm_partial",
  "exclude",
  "adjust_time",
];
export const EXCLUDE_REASONS = ["not_quran", "not_heard", "unwanted"] as const;
export const TRANSLATION_SCOPES = ["verse", "fragment", "none"] as const;

export type DecisionValue = {
  ref?: string;
  words?: [number, number];
  t?: [number, number];
  reason?: (typeof EXCLUDE_REASONS)[number];
  scope?: (typeof TRANSLATION_SCOPES)[number];
};
export type DecisionTarget = {
  fingerprint: string | null;
  item: ItemType;
  index: number | null;
  snapshot: Record<string, unknown>;
  review_ids: string[];
};
export type DecisionEvidence = {
  listened: boolean;
  listened_s: number;
  device: string;
};
export type Decision = {
  id: string;
  kind: DecisionKind;
  target: DecisionTarget;
  value: DecisionValue;
  evidence: DecisionEvidence;
  use_for_training: boolean;
  decided_by: string;
  decided_at: string;
  revision: number;
  superseded_by: string | null;
  withdrawn_at: string | null;
};
export type DecisionsDocument = {
  schema: typeof DECISIONS_SCHEMA;
  session_id: string;
  prediction_sha256: string | null;
  consent: { training: boolean; by: string; at: string };
  revision: number;
  updated_at: string;
  decisions: Decision[];
};

export class DecisionsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecisionsError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const REF = /^\d{1,3}:\d{1,3}$/;
/** Même ensemble que le pseudonyme de l'atelier (`tester.ts`) : lettres, chiffres, espace, `-` `_` `.`. */
const USER = /^[\p{L}\p{N} _.-]{1,64}$/u;

function fail(where: string, message: string): never {
  throw new DecisionsError(`${where} : ${message}`);
}
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function str(
  raw: Record<string, unknown>,
  key: string,
  where: string,
  pattern?: RegExp,
): string {
  const value = raw[key];
  if (typeof value !== "string" || !value || (pattern && !pattern.test(value)))
    fail(`${where}.${key}`, "valeur invalide");
  return value as string;
}
function iso(raw: Record<string, unknown>, key: string, where: string): string {
  const value = str(raw, key, where);
  if (Number.isNaN(Date.parse(value)))
    fail(`${where}.${key}`, "date ISO 8601 attendue");
  return value;
}
function int(
  raw: Record<string, unknown>,
  key: string,
  where: string,
  minimum: number,
): number {
  const value = raw[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum)
    fail(`${where}.${key}`, `entier ≥ ${minimum} attendu`);
  return value as number;
}
function words(raw: unknown, where: string): [number, number] {
  if (
    !Array.isArray(raw) ||
    raw.length !== 2 ||
    raw.some((n) => typeof n !== "number" || !Number.isInteger(n) || n < 1) ||
    raw[0] > raw[1]
  )
    fail(
      where,
      "plage de mots [début, fin] attendue (entiers ≥ 1, début ≤ fin)",
    );
  return [raw[0] as number, raw[1] as number];
}
function span(raw: unknown, where: string): [number, number] {
  if (
    !Array.isArray(raw) ||
    raw.length !== 2 ||
    raw.some((n) => typeof n !== "number" || !Number.isFinite(n))
  )
    fail(where, "temps [début, fin] attendu");
  const [start, end] = raw as [number, number];
  if (start < 0 || end <= start)
    fail(where, "temps [début, fin] attendu (0 ≤ début < fin)");
  return [start, end];
}
/** `sourate:verset` existant : 1 ≤ sourate ≤ 114 ; le nombre de versets est vérifié par le moteur. */
function ref(raw: unknown, where: string): string {
  if (typeof raw !== "string" || !REF.test(raw))
    fail(where, "référence « sourate:verset » attendue");
  const [surah, ayah] = (raw as string).split(":").map(Number);
  if (surah < 1 || surah > 114 || ayah < 1)
    fail(where, "ce verset n'existe pas");
  return raw as string;
}

const ALLOWED_VALUE_KEYS: Record<DecisionKind, readonly string[]> = {
  choose: ["ref", "words", "t"],
  set_ref: ["ref", "words", "t"],
  confirm_inferred: ["t"],
  confirm_partial: [],
  exclude: ["reason"],
  adjust_time: ["t"],
  translation_scope: ["scope"],
  dismiss_report: [],
  ignore: [],
};

/** Valeur d'une décision d'après son genre ; tout champ superflu ou manquant est refusé. */
export function parseValue(
  kind: DecisionKind,
  raw: unknown,
  where: string,
): DecisionValue {
  if (!isRecord(raw)) return fail(where, "objet attendu");
  const extra = Object.keys(raw).filter(
    (k) => !ALLOWED_VALUE_KEYS[kind].includes(k),
  );
  if (extra.length)
    fail(where, `champ(s) inattendu(s) pour « ${kind} » : ${extra.join(", ")}`);
  const value: DecisionValue = {};
  if (kind === "choose" || kind === "set_ref") {
    if (!("ref" in raw)) fail(`${where}.ref`, "requis");
    if (!("words" in raw)) fail(`${where}.words`, "requis");
    value.ref = ref(raw.ref, `${where}.ref`);
    value.words = words(raw.words, `${where}.words`);
  }
  if (kind === "adjust_time" && !("t" in raw)) fail(`${where}.t`, "requis");
  if (raw.t !== undefined && raw.t !== null)
    value.t = span(raw.t, `${where}.t`);
  if (kind === "exclude") {
    if (!EXCLUDE_REASONS.includes(raw.reason as never))
      fail(
        `${where}.reason`,
        `raison attendue parmi ${EXCLUDE_REASONS.join(", ")}`,
      );
    value.reason = raw.reason as DecisionValue["reason"];
  }
  if (kind === "translation_scope") {
    if (!TRANSLATION_SCOPES.includes(raw.scope as never))
      fail(
        `${where}.scope`,
        `portée attendue parmi ${TRANSLATION_SCOPES.join(", ")}`,
      );
    value.scope = raw.scope as DecisionValue["scope"];
  }
  return value;
}

function parseTarget(
  raw: unknown,
  kind: DecisionKind,
  value: DecisionValue,
  where: string,
): DecisionTarget {
  if (!isRecord(raw)) return fail(where, "objet attendu");
  const fingerprint = raw.fingerprint ?? null;
  if (
    fingerprint !== null &&
    (typeof fingerprint !== "string" || !HEX64.test(fingerprint))
  )
    fail(
      `${where}.fingerprint`,
      "empreinte SHA-256 (64 caractères hexadécimaux) attendue",
    );
  const ids = raw.review_ids ?? [];
  if (
    !Array.isArray(ids) ||
    ids.some((i) => typeof i !== "string" || !UUID.test(i))
  )
    fail(`${where}.review_ids`, "liste d'identifiants de signalement attendue");
  const item = raw.item;
  if (!ITEMS.includes(item as never))
    fail(
      `${where}.item`,
      `sorte de passage attendue parmi ${ITEMS.join(", ")}`,
    );
  if (!ITEM_KINDS[item as ItemType].includes(kind))
    fail(where, `« ${kind} » ne répond pas à un passage « ${item} »`);
  const index = raw.index ?? null;
  if (
    index !== null &&
    (typeof index !== "number" || !Number.isInteger(index) || index < 0)
  )
    fail(`${where}.index`, "entier ≥ 0 attendu");
  const snapshot = raw.snapshot ?? {};
  if (!isRecord(snapshot)) fail(`${where}.snapshot`, "objet attendu");
  if (fingerprint === null) {
    if (!ids.length) fail(where, "cible sans empreinte ni signalement");
    if (item !== "report")
      fail(
        `${where}.item`,
        "un signalement sans intervalle est de sorte « report »",
      );
    if (!REPORT_KINDS.includes(kind))
      fail(
        where,
        `« ${kind} » ne s'applique pas à un signalement sans intervalle`,
      );
    if (kind === "set_ref" && !value.t)
      fail(
        where,
        "une référence posée sur un signalement exige ses temps (value.t)",
      );
  }
  return {
    fingerprint: fingerprint as string | null,
    item: item as ItemType,
    index: index as number | null,
    snapshot: snapshot as Record<string, unknown>,
    review_ids: ids as string[],
  };
}

function parseEvidence(raw: unknown, where: string): DecisionEvidence {
  const data = raw ?? {};
  if (!isRecord(data)) return fail(where, "objet attendu");
  const listened = data.listened ?? false;
  if (typeof listened !== "boolean")
    fail(`${where}.listened`, "booléen attendu");
  const seconds = data.listened_s ?? 0;
  if (typeof seconds !== "number" || !Number.isFinite(seconds))
    fail(`${where}.listened_s`, "nombre attendu");
  if ((seconds as number) < 0)
    fail(`${where}.listened_s`, "durée ≥ 0 attendue");
  const device = data.device ?? "unknown";
  if (typeof device !== "string" || device.length > 32)
    fail(`${where}.device`, "texte court attendu");
  return {
    listened: listened as boolean,
    listened_s: seconds as number,
    device: device as string,
  };
}

function parseDecision(raw: unknown, where: string): Decision {
  if (!isRecord(raw)) return fail(where, "objet attendu");
  const kind = raw.kind;
  if (!KINDS.includes(kind as never))
    fail(`${where}.kind`, `genre attendu parmi ${KINDS.join(", ")}`);
  const value = parseValue(
    kind as DecisionKind,
    raw.value ?? {},
    `${where}.value`,
  );
  const use = raw.use_for_training ?? false;
  if (typeof use !== "boolean")
    fail(`${where}.use_for_training`, "booléen attendu");
  const superseded = raw.superseded_by ?? null;
  const withdrawn = raw.withdrawn_at ?? null;
  return {
    id: str(raw, "id", where, UUID),
    kind: kind as DecisionKind,
    target: parseTarget(
      raw.target,
      kind as DecisionKind,
      value,
      `${where}.target`,
    ),
    value,
    evidence: parseEvidence(raw.evidence, `${where}.evidence`),
    use_for_training: use as boolean,
    decided_by: str(raw, "decided_by", where, USER),
    decided_at: iso(raw, "decided_at", where),
    revision: int(raw, "revision", where, 1),
    superseded_by:
      superseded === null
        ? null
        : str({ superseded_by: superseded }, "superseded_by", where),
    withdrawn_at:
      withdrawn === null
        ? null
        : iso({ withdrawn_at: withdrawn }, "withdrawn_at", where),
  };
}

/** Lit un document `aqr.decisions/1` ; lève `DecisionsError` au premier champ incohérent. */
export function parseDecisions(input: unknown): DecisionsDocument {
  if (!isRecord(input)) return fail("document", "objet attendu");
  if (input.schema !== DECISIONS_SCHEMA)
    fail("schema", `schéma attendu : ${DECISIONS_SCHEMA}`);
  const sha = input.prediction_sha256 ?? null;
  if (
    sha !== null &&
    (typeof sha !== "string" || !HEX64.test(sha.toLowerCase()))
  )
    fail("prediction_sha256", "empreinte SHA-256 attendue");
  const consent = input.consent;
  if (!isRecord(consent)) return fail("consent", "objet attendu");
  if (typeof consent.training !== "boolean")
    fail("consent.training", "booléen attendu");
  const items = input.decisions;
  if (!Array.isArray(items)) return fail("decisions", "liste attendue");
  const decisions = items.map((d, n) => parseDecision(d, `decisions[${n}]`));
  if (new Set(decisions.map((d) => d.id)).size !== decisions.length)
    fail("decisions", "identifiant en double");
  return {
    schema: DECISIONS_SCHEMA,
    session_id: str(input, "session_id", "document", UUID),
    prediction_sha256: sha === null ? null : (sha as string).toLowerCase(),
    consent: {
      training: consent.training as boolean,
      by: str(consent, "by", "consent", USER),
      at: iso(consent, "at", "consent"),
    },
    revision: int(input, "revision", "document", 0),
    updated_at: iso(input, "updated_at", "document"),
    decisions,
  };
}

// --- décisions actives et réconciliation ----------------------------------------------------

/** Clé de ce que la décision vise : l'intervalle (ou ses signalements) et la sorte de passage. */
export function targetKey(decision: Decision): string {
  const where =
    decision.target.fingerprint ??
    `report:${[...decision.target.review_ids].sort().join(",")}`;
  return `${where}#${decision.target.item}`;
}

const isActive = (d: Decision) =>
  d.withdrawn_at === null && d.superseded_by === null;
const rank = (d: Decision) =>
  `${d.decided_at}\u0000${String(d.revision).padStart(9, "0")}\u0000${d.id}`;

/** Une seule décision par cible : ni annulée ni remplacée, et la plus récente si plusieurs restent actives. */
export function activeDecisions(document: DecisionsDocument): Decision[] {
  const latest = new Map<string, Decision>();
  for (const d of document.decisions) {
    if (!isActive(d)) continue;
    const key = targetKey(d);
    const current = latest.get(key);
    if (!current || rank(d) > rank(current)) latest.set(key, d);
  }
  return [...latest.values()].sort((a, b) =>
    `${a.decided_at}${a.id}`.localeCompare(`${b.decided_at}${b.id}`),
  );
}

export type Reconciliation = {
  /** Index de l'intervalle du moteur -> décisions actives qui s'y appliquent. */
  applied: Map<number, Decision[]>;
  /** Décisions dont la cible est un signalement sans intervalle. */
  reports: Decision[];
  /** Décisions dont l'intervalle n'existe plus tel quel dans cette prédiction. */
  orphans: Decision[];
};

/**
 * Accroche chaque décision active à l'intervalle de même empreinte (jamais à une position).
 * `fingerprintOf` calcule l'empreinte d'un intervalle `verse` (voir `decisions-fingerprint.ts`).
 */
export function reconcile(
  intervals: readonly { kind: string }[],
  decisions: readonly Decision[],
  fingerprintOf: (interval: never) => string,
): Reconciliation {
  const byFingerprint = new Map<string, number[]>();
  intervals.forEach((interval, index) => {
    if (interval.kind !== "verse") return;
    const key = fingerprintOf(interval as never);
    byFingerprint.set(key, [...(byFingerprint.get(key) ?? []), index]);
  });
  const out: Reconciliation = { applied: new Map(), reports: [], orphans: [] };
  for (const decision of decisions) {
    if (!isActive(decision)) continue;
    const fingerprint = decision.target.fingerprint;
    if (fingerprint === null) {
      out.reports.push(decision);
      continue;
    }
    const found = byFingerprint.get(fingerprint) ?? [];
    if (!found.length) {
      out.orphans.push(decision);
      continue;
    }
    const hint = decision.target.index;
    const index = hint !== null && found.includes(hint) ? hint : found[0];
    out.applied.set(index, [...(out.applied.get(index) ?? []), decision]);
  }
  return out;
}

/**
 * Le passage du moteur le plus proche dans le temps d'une décision orpheline (recouvrement ≥ 50 %
 * de la durée du plus court des deux). Une SUGGESTION pour l'écran de réconciliation : jamais
 * appliquée toute seule (ADR-0014).
 */
export function suggestTarget(
  decision: Decision,
  intervals: readonly {
    kind: string;
    t?: [number, number] | null;
    ref?: string | null;
  }[],
  taken: ReadonlySet<number>,
): { index: number; ref: string | null; t: [number, number] } | null {
  const snap = decision.target.snapshot.t;
  if (!Array.isArray(snap) || snap.length !== 2) return null;
  const [a, b] = snap as [number, number];
  let best: {
    index: number;
    ref: string | null;
    t: [number, number];
    score: number;
  } | null = null;
  intervals.forEach((interval, index) => {
    if (interval.kind !== "verse" || !interval.t || taken.has(index)) return;
    const [c, d] = interval.t;
    const overlap = Math.min(b, d) - Math.max(a, c);
    const score = overlap / Math.min(b - a, d - c);
    if (score >= 0.5 && (!best || score > best.score))
      best = { index, ref: interval.ref ?? null, t: [c, d], score };
  });
  const found = best as {
    index: number;
    ref: string | null;
    t: [number, number];
  } | null;
  return found ? { index: found.index, ref: found.ref, t: found.t } : null;
}
