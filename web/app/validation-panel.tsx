"use client";
import { useCallback, useEffect, useState } from "react";
import { formatTime } from "@/lib/recognition";
import {
  EVIDENCE_HINT,
  FORMULA_LABELS,
  type Passage,
  type Validation,
} from "@/lib/validation";
import { Icon } from "./atelier/icons";

/**
 * Vérité terrain semi-automatique (étape A, ADR-0006) : tu dis ce qui est récité, l'alignement
 * forcé pose les temps, tu écoutes chaque verset puis tu valides ou exclus le passage. Seuls les
 * passages validés sont écrits dans le manifeste. Onglet réservé aux administrateurs (le relecteur est le compte connecté) :
 * il écrit dans le manifeste de test, les testeurs n'y touchent pas.
 */
const statusLabel: Record<Passage["status"], string> = {
  proposed: "À aligner",
  aligned: "Aligné · à écouter",
  validated: "Validé à l’oreille",
  excluded: "Exclu",
};

type Props = {
  sessionId: string;
  ready: boolean;
  duration: number;
  /** Écoute exactement [début, fin] puis s'arrête (le lecteur de l'atelier). */
  playRange: (start: number, end: number) => void;
  getPosition: () => number;
};

export default function ValidationPanel({
  sessionId,
  ready,
  duration,
  playRange,
  getPosition,
}: Props) {
  const [validation, setValidation] = useState<Validation | null>(null),
    [working, setWorking] = useState(""),
    [error, setError] = useState(""),
    [report, setReport] = useState(""),
    [drafts, setDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    setValidation(null);
    setDrafts({});
    setReport("");
    setError("");
    fetch(`/api/sessions/${sessionId}/validation`, { cache: "no-store" })
      .then(async (r) =>
        r.ok ? setValidation((await r.json()).validation) : null,
      )
      .catch(() => setError("Validation illisible pour cette session."));
  }, [sessionId]);

  const act = useCallback(
    async (body: Record<string, unknown>, label: string) => {
      setWorking(label);
      setError("");
      try {
        const r = await fetch(`/api/sessions/${sessionId}/validation`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const value = await r.json();
        if (!r.ok) throw new Error(value.error);
        setValidation(value.validation);
        if (value.report) setReport(value.report);
        return value.validation as Validation;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Action impossible");
        return null;
      } finally {
        setWorking("");
      }
    },
    [sessionId],
  );

  function verses(p: Passage) {
    return drafts[p.id] ?? p.verses;
  }
  async function saveVerses(p: Passage) {
    const value = verses(p).trim();
    if (value === p.verses) return;
    await act(
      { action: "edit", passage: p.id, patch: { verses: value } },
      "Enregistrement…",
    );
    setDrafts(({ [p.id]: _dropped, ...rest }) => rest);
  }

  const passages = validation?.passages ?? [];
  const pending = passages.filter((p) => p.status === "proposed");
  const validated = passages.filter((p) => p.status === "validated");
  const busy = Boolean(working);
  const setStatus = (p: Passage, status: Passage["status"], label: string) =>
    act({ action: "edit", passage: p.id, patch: { status } }, label);

  return (
    <div
      className="panel-sec truth"
      data-testid="truth-panel"
      style={{ borderTop: 0 }}
    >
      <p className="banner">
        <small>
          <b className="name">Réservé aux administrateurs.</b> Cette section
          sert à valider des passages complets pour la vérité terrain. Pour
          signaler une erreur, reste dans l’onglet « Signaler ».
        </small>
      </p>
      <p className="hint">
        Dis ce qui est récité, l’outil pose les temps, écoute chaque verset puis
        valide. Seul un passage validé à l’oreille devient une vérité terrain.
      </p>
      {!ready ? (
        <p className="muted">
          Lance d’abord la reconnaissance : les passages en partent.
        </p>
      ) : (
        <>
          {!passages.length && (
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy}
              onClick={() =>
                act({ action: "propose" }, "Préparation des passages…")
              }
            >
              Proposer les passages du moteur
            </button>
          )}
          {pending.length > 0 && (
            <button
              type="button"
              className="btn btn--primary btn--block"
              disabled={busy}
              onClick={() =>
                act(
                  { action: "align", ids: pending.map((p) => p.id) },
                  `Alignement de ${pending.length} passage(s)… (chargement du modèle, ≈ 30 s)`,
                )
              }
            >
              Aligner {pending.length} passage(s)
            </button>
          )}
          {working && (
            <p className="savebar" role="status">
              {working}
            </p>
          )}
          {error && (
            <p className="notice notice--error" role="alert">
              {error}
            </p>
          )}
          {passages.map((p) => {
            const a = p.alignment;
            const evidence = a?.evidence?.llr_per_frame;
            const weak = evidence !== undefined && evidence < EVIDENCE_HINT;
            return (
              <article
                key={p.id}
                className="passage-v"
                data-testid="truth-passage"
                data-status={p.status}
              >
                <header>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    style={{ paddingLeft: 6 }}
                    onClick={() => playRange(p.t[0], p.t[1])}
                  >
                    <Icon name="play" fill size={14} />
                    <span className="mono">
                      {formatTime(p.t[0])} – {formatTime(p.t[1])}
                    </span>
                  </button>
                  <span
                    className={`badge ${p.status === "validated" ? "badge--ok" : "badge--plain"}`}
                  >
                    {p.status === "validated" ? (
                      <Icon name="check" size={14} />
                    ) : null}
                    {statusLabel[p.status]}
                  </span>
                </header>
                <label className="field">
                  Versets récités, dans l’ordre
                  <input
                    className="input mono"
                    value={verses(p)}
                    disabled={busy || p.status === "validated"}
                    placeholder="ex. 1:1-1:7, amin, 21:51-21:56, 21:56[5-8]"
                    onChange={(e) =>
                      setDrafts({ ...drafts, [p.id]: e.target.value })
                    }
                    onBlur={() => saveVerses(p)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void saveVerses(p);
                    }}
                  />
                </label>
                <div className="row">
                  {(["Début", "Fin"] as const).map((name, i) => (
                    <label className="field" key={`${name}-${p.t[i]}`}>
                      {name} (s)
                      <input
                        className="input mono"
                        type="number"
                        step="0.1"
                        min="0"
                        defaultValue={p.t[i]}
                        disabled={busy || p.status === "validated"}
                        onBlur={(e) => {
                          const value = Number(e.target.value);
                          if (value === p.t[i]) return;
                          const t: [number, number] =
                            i === 0 ? [value, p.t[1]] : [p.t[0], value];
                          void act(
                            { action: "edit", passage: p.id, patch: { t } },
                            "Enregistrement…",
                          );
                        }}
                      />
                    </label>
                  ))}
                </div>
                {a?.error && <p className="notice notice--error">{a.error}</p>}
                {a && !a.error && (
                  <>
                    <p className={`evidence${weak ? " evidence--bad" : ""}`}>
                      <Icon name="info" />
                      <span>
                        Preuve acoustique {evidence?.toFixed(2)} par trame
                        {weak
                          ? " · la déclaration colle mal : réécoute (reprise oubliée, verset en trop ?)"
                          : " · l’audio soutient la déclaration (repère indicatif)"}
                      </span>
                    </p>
                    <ol className="aligned">
                      {a.spans?.map((s, i) => (
                        <li
                          key={`${s.kind === "verse" ? s.ref : s.label}-${i}`}
                        >
                          <button
                            type="button"
                            onClick={() => playRange(s.t[0], s.t[1])}
                          >
                            <Icon name="play" fill />
                            {s.kind === "verse" ? (
                              <>
                                <strong>{s.ref}</strong>
                                {s.partial
                                  ? ` mots ${s.words[0]}–${s.words[1]}`
                                  : ""}
                              </>
                            ) : (
                              <em>{FORMULA_LABELS[s.label]} (non coranique)</em>
                            )}
                            <span className="mono muted">
                              {formatTime(s.t[0])} – {formatTime(s.t[1])}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ol>
                  </>
                )}
                <div className="btnrow">
                  {p.status === "aligned" && (
                    <button
                      type="button"
                      className="btn btn--primary btn--sm"
                      disabled={busy}
                      onClick={() => setStatus(p, "validated", "Validation…")}
                    >
                      Valider après écoute
                    </button>
                  )}
                  {p.status === "validated" && (
                    <button
                      type="button"
                      className="btn btn--secondary btn--sm"
                      disabled={busy}
                      onClick={() => setStatus(p, "proposed", "Réouverture…")}
                    >
                      Rouvrir
                    </button>
                  )}
                  {p.status !== "excluded" ? (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={busy}
                      onClick={() => setStatus(p, "excluded", "Exclusion…")}
                    >
                      Exclure
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={busy}
                      onClick={() => setStatus(p, "proposed", "Réouverture…")}
                    >
                      Réintégrer
                    </button>
                  )}
                </div>
              </article>
            );
          })}
          <button
            type="button"
            className="btn btn--secondary btn--block btn--sm"
            disabled={busy || !duration}
            onClick={() => {
              const time = getPosition();
              void act(
                {
                  action: "add",
                  t: [
                    Number(Math.max(0, time - 1).toFixed(3)),
                    Number(Math.min(duration, time + 30).toFixed(3)),
                  ],
                  verses: "",
                },
                "Ajout…",
              );
            }}
          >
            + Passage à partir d’ici (30 s)
          </button>
          {passages.length > 0 && (
            <>
              <p className="hint">
                Le relecteur inscrit dans le manifeste est ton compte
                administrateur.
              </p>
              <button
                type="button"
                className="btn btn--primary btn--block"
                disabled={busy || !validated.length}
                onClick={() =>
                  act({ action: "manifest" }, "Écriture dans le manifeste…")
                }
              >
                Écrire {validated.length} passage(s) validé(s) dans le manifeste
              </button>
              {report && <p className="savebar">{report}</p>}
              <p className="hint hint--faint">
                Fichiers de développement seulement. Chaque passage validé
                devient une fenêtre annotée ; hors fenêtre, rien n’est vérité
                terrain.
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}
