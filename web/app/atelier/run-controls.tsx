"use client";
import { useState } from "react";
import type { Session } from "@/lib/store";

type Props = {
  state: Session["state"];
  canEdit: boolean;
  busy: boolean;
  /** La session garde un résultat précédent : l'analyse en cours est une réanalyse. */
  rerun: boolean;
  /** Pourquoi la dernière réanalyse n'a pas remplacé le résultat (échec, annulation). */
  rerunError: string | null;
  onRun: () => void;
  onCancel: () => void;
};

/** Lancer, relancer, réanalyser ou arrêter : l'action qui s'impose selon l'état de la session. */
export function RunControls({
  state,
  canEdit,
  busy,
  rerun,
  rerunError,
  onRun,
  onCancel,
}: Props) {
  const [confirming, setConfirming] = useState(false);
  if (!canEdit) return null;
  if (state === "ready" || state === "failed" || state === "cancelled")
    return (
      <div>
        <button
          type="button"
          className="btn btn--primary"
          data-testid="run-engine"
          disabled={busy}
          onClick={onRun}
        >
          {state === "ready" ? "Lancer l’analyse" : "Relancer l’analyse"}
        </button>
      </div>
    );
  if (state === "running" || state === "queued")
    return (
      <div>
        <button
          type="button"
          className="btn btn--danger"
          data-testid="cancel-run"
          disabled={busy}
          onClick={onCancel}
        >
          {rerun
            ? "Annuler la réanalyse"
            : state === "queued"
              ? "Retirer de la file"
              : "Arrêter le traitement"}
        </button>
      </div>
    );
  if (state !== "done") return null;
  return (
    <div className="rerun">
      {rerunError ? (
        <p
          className="notice notice--error"
          role="alert"
          data-testid="rerun-error"
        >
          La réanalyse n’a pas abouti, l’ancien résultat est conservé.{" "}
          {rerunError}
        </p>
      ) : null}
      {confirming ? (
        <div role="group" aria-label="Confirmer la réanalyse">
          <p className="muted" data-testid="rerun-confirm-text">
            Le résultat actuel reste affiché jusqu’à ce que la nouvelle analyse
            ait abouti ; tes corrections sont ensuite rapprochées du nouveau
            résultat.
          </p>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            data-testid="rerun-confirm"
            disabled={busy}
            onClick={() => {
              setConfirming(false);
              onRun();
            }}
          >
            Réanalyser
          </button>{" "}
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setConfirming(false)}
          >
            Garder tel quel
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          data-testid="rerun"
          disabled={busy}
          title="Refait l’analyse de cet audio avec la version actuelle du moteur"
          onClick={() => setConfirming(true)}
        >
          Réanalyser avec la version actuelle
        </button>
      )}
    </div>
  );
}
