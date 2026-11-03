/**
 * Les réponses des routes d'export, vues du navigateur (types seulement : rien du serveur n'est importé).
 * Miroir de `src/aqr/export/service.py` (`aqr.export-readiness/1`, `aqr.export-result/1`) et de
 * `lib/decisions-store.ts`.
 */
import type { DecisionKind, DecisionValue, ItemType } from "./decisions";

export type ItemState = "open" | "resolved" | "ignored";
export type Impact = "arabic" | "arabic_sign" | "translation" | "reference";

export type DecisionSummary = {
  id: string;
  kind: DecisionKind;
  value: DecisionValue;
  evidence: { listened: boolean; listened_s: number; device: string };
  use_for_training: boolean;
  decided_by: string;
  decided_at: string;
  revision: number;
  target: {
    fingerprint: string | null;
    item: ItemType;
    index: number | null;
    snapshot: Record<string, unknown>;
    review_ids: string[];
  };
};

export type CandidateView = {
  ref: string;
  words: [number, number] | null;
  words_total: number;
  tokens: { text: string; diff: boolean }[];
  translation: string | null;
  translation_scope: "verse" | "fragment" | null;
};

export type ReviewNoteView = {
  id: string;
  tester: string;
  tags: string[];
  description: string;
  expected_ref: string | null;
  t: [number, number];
};

export type ReadinessItem = {
  key: string;
  type: ItemType;
  index: number | null;
  fingerprint: string | null;
  t: [number, number];
  ref: string | null;
  words: [number, number] | null;
  impact: Impact;
  effective: boolean;
  state: ItemState;
  decision: DecisionSummary | null;
  review_ids: string[];
  related_reports: string[];
  candidates?: CandidateView[];
  sides?: ("start" | "end")[];
  words_total?: number;
  tokens?: string[];
  verse_tokens?: string[];
  notes?: ReviewNoteView[];
  translation?: {
    verse: string | null;
    fragment: string | null;
    fragment_words: [number, number] | null;
  };
};

export type OrphanView = DecisionSummary & { reason: string };

export type ReadinessPayload = {
  schema: "aqr.export-readiness/1";
  prediction_sha256: string;
  decisions_sha256: string;
  options: { content: string; show_ref: boolean };
  verdict: {
    total: number;
    resolved: number;
    unresolved: number;
    ready: boolean;
    arabic: number;
    other: number;
  };
  counts: Partial<Record<ItemType, { total: number; open: number }>>;
  /** Nombre d'intervalles de versets dans la prédiction (0 : rien à exporter). */
  verses: number;
  non_quran: {
    abstentions: number;
    formulas: number;
    items: {
      kind: "abstention" | "formula";
      label: string | null;
      t: [number, number];
    }[];
  };
  page: { index: number; size: number; total: number; pages: number };
  items: ReadinessItem[];
  first_open: string | null;
  /** Page (à partir de 0) qui contient le premier passage ouvert du filtre courant. */
  first_open_page: number | null;
  ineffective: { total: number; items: ReadinessItem[] };
  orphans: OrphanView[];
  warnings: string[];
  /** Ajouté par la route : ce que la page affiche de la session (nom, droits, durées). */
  session?: {
    id: string;
    name: string;
    state: string;
    can_edit: boolean;
    mine: boolean;
    visibility: "global" | "private";
    audio_duration_s: number | null;
    /** Source importée : vidéo ou audio seul. */
    media?: "video" | "audio";
    duration_s: number | null;
    owner: { id: number; username: string } | null;
  };
};

export type OmittedPassage = {
  index: number | null;
  type: string;
  t: [number, number];
  ref: string | null;
  reason: "uncertain" | "inferred" | "excluded" | "no_text";
  detail: string | null;
  /** Clé du passage à vérifier (lien « Le corriger »), si c'en est un. */
  key: string | null;
};

export type PreviewCue = {
  start_s: number;
  end_s: number;
  arabic: string | null;
  translation: string[];
  reference: string | null;
};

export type ExportSummary = {
  schema: "aqr.export-result/1";
  format: string;
  cues: number;
  split: number;
  omitted: OmittedPassage[];
  omitted_total: number;
  applied: number;
  unresolved: number;
  ignored: number;
  orphans: number;
  forced: boolean;
  policy: string;
  bytes: number;
  attribution: string[];
  warnings: string[];
  would_block?: boolean;
  preview?: { cues: PreviewCue[]; words_timed: boolean[]; head: string };
};

export type ExportFile = {
  summary: ExportSummary;
  name: string;
  mime: string;
  content: string;
};

export type DecisionState =
  | "applied"
  | "report"
  | "orphan"
  | "withdrawn"
  | "superseded";
export type DecisionsView = {
  consent: { training: boolean; by: string; at: string };
  revision: number;
  prediction_sha256: string | null;
  stale: boolean;
  is_owner: boolean;
  decisions: (DecisionSummary & {
    state: DecisionState;
    withdrawn_at: string | null;
    superseded_by: string | null;
    decided_at: string;
  })[];
  orphans: {
    decision: DecisionSummary;
    suggestion: {
      index: number;
      ref: string | null;
      t: [number, number];
    } | null;
  }[];
};

export type VerseLookup =
  | {
      ok: true;
      ref: string;
      words: [number, number];
      words_total: number;
      tokens: string[];
      verse_tokens: string[];
      translation: string | null;
      translation_scope: string | null;
    }
  | { ok: false; error: string };
