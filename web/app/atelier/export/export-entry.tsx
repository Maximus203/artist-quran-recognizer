"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchReadiness } from "@/lib/export-client";
import { loadExportOptions } from "@/lib/export-prefs";
import { Icon } from "../icons";

/**
 * « Exporter » dans l'en-tête d'une session : le geste vers la page d'export, avec l'état en une
 * pastille — « 5 à vérifier » (le nombre est écrit, l'ambre ne parle jamais seul) ou « ✓ Prêt ». Le
 * décompte est léger (aucun passage n'est renvoyé). Sans résultat, le bouton est grisé et dit pourquoi.
 */
export function ExportEntry({
  sessionId,
  state,
  decisionsVersion = 0,
}: {
  sessionId: string;
  state: string;
  /** Change quand les décisions ou le résultat changent : le décompte se recalcule. */
  decisionsVersion?: number;
}) {
  const done = state === "done";
  const [verdict, setVerdict] = useState<{
    unresolved: number;
    ready: boolean;
  } | null>(null);
  useEffect(() => {
    if (!done) return;
    const controller = new AbortController();
    void fetchReadiness(
      sessionId,
      loadExportOptions(),
      { size: 0 },
      controller.signal,
    ).then(
      (payload) => setVerdict(payload.verdict),
      () => undefined,
    );
    return () => controller.abort();
  }, [done, sessionId, decisionsVersion]);
  if (!done)
    return (
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        data-testid="export-entry"
        disabled
        title="L’analyse n’est pas terminée"
      >
        <Icon name="download" />
        <span>Exporter</span>
      </button>
    );
  return (
    <Link
      className="btn btn--secondary btn--sm"
      href={`/s/${sessionId}/exporter`}
      data-testid="export-entry"
    >
      <Icon name="download" />
      <span>Exporter</span>
      {verdict ? (
        verdict.ready ? (
          <span className="ex-pill" data-testid="export-pill" data-ready="true">
            <Icon name="check" size={14} />
            Prêt
          </span>
        ) : (
          <span className="ex-pill ex-pill--warn" data-testid="export-pill">
            {verdict.unresolved} à vérifier
          </span>
        )
      ) : null}
    </Link>
  );
}
