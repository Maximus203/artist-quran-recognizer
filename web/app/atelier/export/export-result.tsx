"use client";
import { useEffect, useRef, useState } from "react";
import { downloadText } from "@/lib/export-client";
import type { DecisionsView, ExportFile } from "@/lib/export-types";
import { bytesFr, plural } from "@/lib/export-text";
import { XIcon } from "./export-icons";

/** « Ton fichier est prêt » : le fichier, trois chiffres, l'attribution à mettre avec la vidéo, l'accord d'entraînement. */
export function ExportResult({
  file,
  decisions,
  onAgain,
  onTraining,
  announce,
}: {
  file: ExportFile;
  decisions: DecisionsView | null;
  onAgain: () => void;
  onTraining: (use: boolean) => void;
  announce: (message: string) => void;
}) {
  const { summary } = file;
  const heading = useRef<HTMLHeadingElement>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    heading.current?.focus();
    announce(
      `Export terminé : ${plural(summary.cues, "sous-titre écrit", "sous-titres écrits")}${summary.omitted_total ? `, ${plural(summary.omitted_total, "passage omis", "passages omis")}` : ""}.`,
    );
    // une seule annonce par fichier
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);
  const attribution = summary.attribution.join(" ");
  const carriesIt = ["vtt", "ass", "json"].includes(summary.format);
  const mine = decisions?.is_owner ?? false;
  const training =
    (decisions?.consent.training ?? false) && summary.applied > 0;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(attribution);
      setCopied(true);
      announce("Attribution copiée.");
      setTimeout(() => setCopied(false), 3000);
    } catch {
      announce("Copie impossible : sélectionne le texte et copie-le.");
    }
  };
  return (
    <div className="ex-result-wrap" data-testid="export-result">
      <section className="ex-res" aria-labelledby="ex-res-h">
        <div className="ex-res-top">
          <div className="ex-res-ic" aria-hidden="true">
            <XIcon name="check" />
          </div>
          <div>
            <h2 id="ex-res-h" ref={heading} tabIndex={-1}>
              Ton fichier est prêt
            </h2>
            {summary.forced ? (
              <p
                data-testid="forced-note"
                style={{
                  fontSize: "var(--fs-sm)",
                  marginTop: 4,
                  color: "var(--text-2)",
                }}
              >
                <b style={{ color: "var(--warn)" }}>Export forcé.</b>{" "}
                {summary.policy === "omit"
                  ? "Les passages non corrigés ont été omis"
                  : "Les passages non corrigés ont été traités selon la règle choisie"}
                {file.summary.format === "json"
                  ? " ; le fichier le mentionne."
                  : " ; le JSON le mentionne."}
              </p>
            ) : (
              <p
                className="muted"
                style={{ fontSize: "var(--fs-sm)", marginTop: 4 }}
              >
                Export propre : tous les passages ambigus ont été traités.
              </p>
            )}
          </div>
        </div>
        <div className="ex-filebox">
          <XIcon name="file" />
          <div style={{ minWidth: 0 }}>
            <div className="nm" data-testid="file-name-out">
              {file.name}
            </div>
            <div className="mt">
              <span className="mono">{summary.cues}</span> sous-titres ·{" "}
              <span className="mono">{bytesFr(summary.bytes)}</span> · UTF-8
            </div>
          </div>
        </div>
        <div className="ex-summary-grid">
          <div>
            <b>{summary.cues}</b>
            <span>sous-titres écrits</span>
          </div>
          <div>
            <b data-testid="omitted-count">{summary.omitted_total}</b>
            <span>
              {summary.omitted_total > 1 ? "passages omis" : "passage omis"}
            </span>
          </div>
          <div>
            <b>{summary.applied}</b>
            <span>
              {summary.applied > 1
                ? "décisions humaines appliquées"
                : "décision humaine appliquée"}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", gap: "var(--sp-2)", flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn btn--primary btn--lg"
            data-testid="download"
            onClick={() => downloadText(file.name, file.mime, file.content)}
          >
            <XIcon name="download" />
            Télécharger
          </button>
          <button
            type="button"
            className="btn btn--secondary btn--lg"
            data-testid="again"
            onClick={onAgain}
          >
            <XIcon name="refresh" />
            Refaire l’export
          </button>
        </div>
      </section>

      <section className="ex-attrib" aria-labelledby="ex-att-h">
        <h4 id="ex-att-h">Attribution à inclure avec la vidéo</h4>
        <blockquote data-testid="attribution">{attribution}</blockquote>
        <div
          style={{
            display: "flex",
            gap: "var(--sp-2)",
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            data-testid="copy-attribution"
            onClick={() => void copy()}
          >
            <XIcon name="copy" size={16} />
            {copied ? "Copié" : "Copier le texte"}
          </button>
          <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>
            {carriesIt
              ? `Le fichier ${summary.format.toUpperCase()} la porte déjà (en commentaire).`
              : "Les formats SRT et WebVTT n’ont pas de champ d’attribution : mets-la dans la description de la vidéo."}
          </span>
        </div>
      </section>

      {summary.applied > 0 && mine ? (
        <section
          className="ex-train"
          aria-labelledby="ex-tr-h"
          data-testid="training-note"
        >
          <h4 id="ex-tr-h">
            <XIcon name="info" />
            Ta correction aide à entraîner le moteur
          </h4>
          <p>
            {training
              ? "Tes décisions écoutées sont conservées sur ce serveur comme propositions de vérité terrain, relues ensuite par le relecteur. Ton audio n’est envoyé nulle part."
              : "Ton accord est retiré : tes décisions ne servent qu’à cet export."}{" "}
            <button
              type="button"
              className="ex-link"
              data-testid="toggle-training"
              onClick={() => onTraining(!training)}
            >
              {training ? "Voir ou retirer mon accord" : "Redonner mon accord"}
            </button>
            .
          </p>
        </section>
      ) : null}
    </div>
  );
}
