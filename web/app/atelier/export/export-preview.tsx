"use client";
import Link from "next/link";
import { useState } from "react";
import type { ExportOptions } from "@/lib/export-options";
import type { ExportSummary, OmittedPassage } from "@/lib/export-types";
import { clock, omissionText } from "@/lib/export-text";

type Tab = "rendu" | "fichier";

/** Ce que le fichier montrera : les trois premiers sous-titres, rendu vidéo ou texte brut, avec ce qui sera omis. */
export function ExportPreview({
  summary,
  loading,
  slow,
  error,
  options,
  correctHref,
}: {
  summary: ExportSummary | null;
  loading: boolean;
  slow: boolean;
  error: string | null;
  options: ExportOptions;
  /** Lien vers la correction d'un passage omis ; absent si l'on ne peut pas corriger. */
  correctHref: ((key: string) => string) | null;
}) {
  const [tab, setTab] = useState<Tab>("rendu");
  const preview = summary?.preview;
  const cues = preview?.cues ?? [];
  // Les passages omis qui tombent avant la fin du troisième sous-titre apparaissent dans l'aperçu.
  const horizon = cues.at(-1)?.end_s ?? 0;
  const omitted = (summary?.omitted ?? []).filter(
    (o) => o.reason !== "excluded" && (o.t[0] <= horizon || cues.length === 0),
  );
  const rows: (
    | { kind: "cue"; t: number; cue: (typeof cues)[number] }
    | { kind: "omit"; t: number; omission: OmittedPassage }
  )[] = [
    ...cues.map((cue) => ({ kind: "cue" as const, t: cue.start_s, cue })),
    ...omitted.slice(0, 3).map((omission) => ({
      kind: "omit" as const,
      t: omission.t[0],
      omission,
    })),
  ].sort((a, b) => a.t - b.t);
  return (
    <div className="ex-set-sec" data-testid="preview">
      <div className="ex-pv-head">
        <span className="lg">Aperçu · 3 premiers sous-titres</span>
        <div className="ex-mini-tabs" role="tablist" aria-label="Type d’aperçu">
          {(["rendu", "fichier"] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              data-testid={`pv-${id}`}
              onClick={() => setTab(id)}
            >
              {id === "rendu" ? "Rendu" : "Fichier"}
            </button>
          ))}
        </div>
      </div>
      <div className="ex-pv" aria-live="polite" aria-busy={loading}>
        {error ? (
          <p className="notice notice--error" role="alert">
            {error}
          </p>
        ) : slow && !summary ? (
          <div className="ex-skel" aria-hidden="true">
            <i />
            <i />
          </div>
        ) : tab === "fichier" ? (
          <pre className="ex-code" dir="ltr" data-testid="pv-file">
            {preview?.head ?? ""}
          </pre>
        ) : rows.length === 0 ? (
          <p className="ex-pv-note">
            Aucun sous-titre avec ces réglages : il n’y a rien à montrer.
          </p>
        ) : (
          rows.map((row, n) =>
            row.kind === "cue" ? (
              <div className="ex-cue" key={`c${n}`} data-testid="pv-cue">
                <span className="ex-cue-t">{clock(row.cue.start_s)}</span>
                <div className="ex-cue-box">
                  {row.cue.reference ? (
                    <div className="fr">{row.cue.reference}</div>
                  ) : null}
                  {row.cue.arabic ? (
                    <div className="ar" lang="ar" dir="rtl">
                      {row.cue.arabic}
                    </div>
                  ) : null}
                  {row.cue.translation.length ? (
                    <div className="fr">{row.cue.translation.join(" ")}</div>
                  ) : null}
                </div>
              </div>
            ) : (
              <div
                className="ex-cue ex-cue--flag"
                key={`o${n}`}
                data-testid="pv-omitted"
              >
                <span className="ex-cue-t">{clock(row.omission.t[0])}</span>
                <div className="ex-cue-box">
                  <span className="why">
                    <b>Omis dans cet export</b> · {omissionText(row.omission)}
                  </span>
                  {correctHref && row.omission.key ? (
                    <Link href={correctHref(row.omission.key)}>
                      Le corriger
                    </Link>
                  ) : null}
                </div>
              </div>
            ),
          )
        )}
      </div>
      <p className="ex-pv-note">
        Police arabe :{" "}
        {options.format === "ass" ? options.font : "celle de ton lecteur"}. Le
        texte vient du corpus Tanzil, le moteur ne l’écrit jamais.
        {summary?.warnings.length ? ` ${summary.warnings[0]}.` : ""}
      </p>
    </div>
  );
}
