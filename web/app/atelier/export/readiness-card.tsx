"use client";
import Link from "next/link";
import { useState } from "react";
import type { ReadinessPayload } from "@/lib/export-types";
import {
  clock,
  nonQuranSentence,
  plural,
  verdictSentence,
} from "@/lib/export-text";
import { XIcon } from "./export-icons";

const ABSTENTION_LABEL: Record<string, string> = {
  silence: "silence",
  empty_transcript: "rien de reconnu",
  no_candidate: "aucun verset trouvé",
  below_threshold: "trop peu sûr pour nommer un verset",
};
const FORMULA_LABEL: Record<string, string> = {
  istiadha: "isti’adha",
  basmala: "basmala",
  takbir: "takbîr",
  amin: "âmîn",
};

/** « 9 passages non coraniques ignorés » : une ligne neutre (cadre pointillé, jamais d'ambre) et sa liste. */
export function NonQuranLine({
  nonQuran,
}: {
  nonQuran: ReadinessPayload["non_quran"];
}) {
  const [open, setOpen] = useState(false);
  const { total, detail } = nonQuranSentence(nonQuran);
  if (total === 0) return null;
  return (
    <div className="ex-neutral-line" data-testid="non-quran-line">
      <XIcon name="info" />
      <div>
        <p>
          <b style={{ fontWeight: 600, color: "var(--text)" }}>
            {plural(
              total,
              "passage non coranique ignoré",
              "passages non coraniques ignorés",
            )}
          </b>
          {detail ? ` (${detail})` : ""}. Ils ne demandent rien et ne bloquent
          jamais l’export.{" "}
          <button
            type="button"
            aria-expanded={open}
            aria-controls="ex-non-quran-list"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Masquer la liste" : "Voir la liste"}
          </button>
        </p>
        {open ? (
          <ul id="ex-non-quran-list" className="ex-plain-list">
            {nonQuran.items.map((item, n) => (
              <li key={n}>
                <span className="mono">{clock(item.t[0])}</span>
                {" · "}
                {item.kind === "formula"
                  ? `formule : ${FORMULA_LABEL[item.label ?? ""] ?? item.label}`
                  : `abstention : ${ABSTENTION_LABEL[item.label ?? ""] ?? "non reconnu"}`}
              </li>
            ))}
            {total > nonQuran.items.length ? (
              <li className="muted">
                … et {total - nonQuran.items.length} autres.
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

/** Le verdict : combien de passages de la partie coranique restent ambigus, et l'unique geste qui s'impose. */
export function VerdictCard({
  payload,
  canEdit,
  correctHref,
  onForce,
}: {
  payload: ReadinessPayload;
  canEdit: boolean;
  correctHref: string | null;
  onForce: () => void;
}) {
  const { verdict } = payload;
  const percent = verdict.total
    ? Math.round((verdict.resolved / verdict.total) * 100)
    : 100;
  const empty = payload.verses === 0;
  return (
    <section
      className={`ex-verdict${verdict.ready ? " ex-verdict--ready" : ""}`}
      aria-labelledby="ex-verdict-h"
      data-testid="verdict"
      data-ready={verdict.ready}
    >
      <div className="ex-verdict-top">
        <div className="ex-bigN" aria-hidden="true" data-testid="verdict-n">
          {verdict.ready ? <XIcon name="check" /> : verdict.unresolved}
        </div>
        <div>
          <h2 id="ex-verdict-h">
            {empty ? (
              "Aucun verset reconnu dans cet audio"
            ) : verdict.ready ? (
              "Tout est vérifié : prêt à exporter"
            ) : (
              <>
                <span className="sr">{verdict.unresolved} </span>
                {verdict.unresolved > 1
                  ? "passages à vérifier avant d’exporter"
                  : "passage à vérifier avant d’exporter"}
              </>
            )}
          </h2>
          <p>
            {empty
              ? "Il n’y a rien à écrire dans un fichier de sous-titres. Relance l’analyse, ou ouvre la session pour vérifier ce que le moteur a entendu."
              : verdict.ready
                ? "Rien d’ambigu ne reste dans la partie coranique. Choisis le format à droite."
                : `${verdictSentence(verdict)} ${canEdit ? "Corrige-les à l’oreille, ou force l’export : les passages ambigus seront alors traités selon la règle que tu choisis." : "Seul le propriétaire corrige ; tu peux forcer l’export : les passages ambigus seront traités selon la règle que tu choisis."}`}
          </p>
        </div>
      </div>
      {!empty ? (
        <div>
          <div className="ex-meter-l">
            <span id="ex-prog-l">Progression</span>
            <b>
              {verdict.resolved} sur {verdict.total} résolus
            </b>
          </div>
          <div
            className="ex-meter"
            role="progressbar"
            aria-labelledby="ex-prog-l"
            aria-valuemin={0}
            aria-valuemax={verdict.total}
            aria-valuenow={verdict.resolved}
            aria-valuetext={`${verdict.resolved} sur ${verdict.total} résolus`}
            style={{ "--p": `${percent}%` } as React.CSSProperties}
          >
            <i />
          </div>
        </div>
      ) : null}
      {!verdict.ready && !empty ? (
        <div className="ex-verdict-act">
          {canEdit && correctHref ? (
            <Link
              className="btn btn--primary"
              href={correctHref}
              data-testid="correct-first"
            >
              Corriger le premier passage ({verdict.unresolved} restant
              {verdict.unresolved > 1 ? "s" : ""})
            </Link>
          ) : null}
          <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>
            {canEdit ? "ou " : ""}
            <button
              type="button"
              className="ex-link"
              data-testid="force-link"
              onClick={onForce}
            >
              forcer l’export
            </button>{" "}
            sans corriger
          </span>
        </div>
      ) : null}
    </section>
  );
}
