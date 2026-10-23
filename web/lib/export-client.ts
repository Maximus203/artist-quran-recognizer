import { api } from "./api-client";
import type { ExportOptions } from "./export-options";
import type {
  DecisionsView,
  ExportFile,
  ExportSummary,
  ReadinessPayload,
  VerseLookup,
} from "./export-types";

/**
 * Appels de l'API d'export depuis le navigateur. Une seule place pour les adresses et les corps : les
 * composants ne fabriquent jamais une URL. Les erreurs sont celles d'`api()` (message lisible, 401 →
 * connexion).
 */
export type ReadinessQuery = {
  page?: number;
  size?: number;
  type?: string | null;
  state?: string | null;
};

/** Adresse du contrôle ; seuls les réglages qui changent le décompte y figurent. */
export function readinessUrl(
  sessionId: string,
  options: Pick<ExportOptions, "content" | "show_ref" | "strip_notes">,
  query: ReadinessQuery = {},
): string {
  const params = new URLSearchParams({ content: options.content });
  if (options.show_ref) params.set("ref", "1");
  if (options.strip_notes) params.set("strip", "1");
  if (query.type) params.set("type", query.type);
  if (query.state) params.set("state", query.state);
  if (query.page) params.set("page", String(query.page));
  if (query.size !== undefined) params.set("size", String(query.size));
  return `/api/sessions/${sessionId}/export/readiness?${params}`;
}

export const fetchReadiness = (
  sessionId: string,
  options: Pick<ExportOptions, "content" | "show_ref" | "strip_notes">,
  query: ReadinessQuery = {},
  signal?: AbortSignal,
) => api<ReadinessPayload>(readinessUrl(sessionId, options, query), { signal });

export const previewExport = (
  sessionId: string,
  options: ExportOptions,
  signal?: AbortSignal,
) =>
  api<{ summary: ExportSummary }>(
    `/api/sessions/${sessionId}/export/subtitles`,
    {
      method: "POST",
      json: { options, preview: true, cues: 3 },
      signal,
    },
  ).then((r) => r.summary);

export const runExport = (
  sessionId: string,
  options: ExportOptions,
  name?: string,
) =>
  api<ExportFile>(`/api/sessions/${sessionId}/export/subtitles`, {
    method: "POST",
    json: { options, ...(name ? { name } : {}) },
  });

export const fetchDecisions = (sessionId: string) =>
  api<{ decisions: DecisionsView }>(
    `/api/sessions/${sessionId}/decisions`,
  ).then((r) => r.decisions);

export type DecisionOp =
  | {
      op: "decide";
      item: string;
      index?: number | null;
      review_ids?: string[];
      kind: string;
      value: Record<string, unknown>;
      evidence?: { listened: boolean; listened_s: number; device: string };
    }
  | { op: "withdraw"; id: string }
  | { op: "consent"; training: boolean }
  | { op: "training"; id: string; use: boolean }
  | { op: "reattach"; id: string; index: number };

export const saveDecisions = (sessionId: string, ops: DecisionOp[]) =>
  api<{ decisions: DecisionsView }>(`/api/sessions/${sessionId}/decisions`, {
    method: "PUT",
    json: { ops },
  }).then((r) => r.decisions);

export function lookupVerse(
  ref: string,
  words?: [number, number],
  signal?: AbortSignal,
): Promise<VerseLookup> {
  const params = new URLSearchParams({ ref });
  if (words) params.set("words", `${words[0]}-${words[1]}`);
  return api<VerseLookup>(`/api/corpus/verse?${params}`, { signal }).catch(
    (error: unknown) => {
      if ((error as { status?: number }).status === 404)
        return {
          ok: false as const,
          error: "Ce verset n'existe pas dans le corpus.",
        };
      throw error;
    },
  );
}

/** Fait télécharger `content` par le navigateur (BOM éventuel conservé : c'est le premier caractère). */
export function downloadText(
  name: string,
  mime: string,
  content: string,
): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
