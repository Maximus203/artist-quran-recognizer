"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { formatTime } from "@/lib/recognition";
import {
  EVIDENCE_HINT,
  FORMULA_LABELS,
  type Passage,
  type Validation,
} from "@/lib/validation";

/**
 * Vérité terrain semi-automatique (étape A, ADR-0006) : tu dis ce qui est récité, l'alignement
 * forcé pose les temps, tu écoutes chaque verset puis tu valides ou exclus le passage. Seuls les
 * passages validés sont écrits dans le manifeste.
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
  audio: RefObject<HTMLAudioElement | null>;
  time: number;
  duration: number;
};

export default function ValidationPanel({
  sessionId,
  ready,
  audio,
  time,
  duration,
}: Props) {
  const [validation, setValidation] = useState<Validation | null>(null),
    [working, setWorking] = useState(""),
    [error, setError] = useState(""),
    [report, setReport] = useState(""),
    [reviewer, setReviewer] = useState("rel-01"),
    [drafts, setDrafts] = useState<Record<string, string>>({});
  const stopAt = useRef<(() => void) | null>(null);

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

  /** Lit [a, b] puis s'arrête : une écoute ciblée, sans boucle. */
  function playRange(a: number, b: number) {
    const node = audio.current;
    if (!node) return;
    stopAt.current?.();
    const onTime = () => {
      if (node.currentTime >= b) {
        node.pause();
        stop();
      }
    };
    const stop = () => {
      node.removeEventListener("timeupdate", onTime);
      stopAt.current = null;
    };
    stopAt.current = stop;
    node.addEventListener("timeupdate", onTime);
    node.currentTime = a;
    void node.play().catch(() => stop());
  }

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

  return (
    <div className="validation">
      <div className="section-head">
        <span>07 / VÉRITÉ TERRAIN</span>
      </div>
      <p className="review-intro">
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
              className="primary"
              disabled={busy}
              onClick={() =>
                act({ action: "propose" }, "Préparation des passages…")
              }
            >
              Proposer les passages du moteur
            </button>
          )}
          <div className="validation-tools">
            {pending.length > 0 && (
              <button
                className="primary"
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
            <button
              className="outline"
              disabled={busy || !duration}
              onClick={() =>
                act(
                  {
                    action: "add",
                    t: [
                      Number(Math.max(0, time - 1).toFixed(3)),
                      Number(Math.min(duration, time + 30).toFixed(3)),
                    ],
                    verses: "",
                  },
                  "Ajout…",
                )
              }
            >
              + Passage à partir d’ici (30 s)
            </button>
          </div>
          {working && (
            <p className="save" role="status">
              {working}
            </p>
          )}
          {error && <p className="notice error">{error}</p>}
          <div className="passages">
            {passages.map((p) => {
              const a = p.alignment;
              const evidence = a?.evidence?.llr_per_frame;
              return (
                <article key={p.id} className={`passage is-${p.status}`}>
                  <header>
                    <button
                      className="quiet"
                      onClick={() => playRange(p.t[0], p.t[1])}
                    >
                      ▶ {formatTime(p.t[0])} – {formatTime(p.t[1])}
                    </button>
                    <small>{statusLabel[p.status]}</small>
                  </header>
                  <label>
                    Versets récités, dans l’ordre
                    <input
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
                  <div className="form-row passage-bounds">
                    {(["début", "fin"] as const).map((name, i) => (
                      <label key={`${name}-${p.t[i]}`}>
                        {name} (s)
                        <input
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
                  {a?.error && <p className="notice error">{a.error}</p>}
                  {a && !a.error && (
                    <>
                      <p
                        className={`evidence ${evidence !== undefined && evidence < EVIDENCE_HINT ? "weak" : ""}`}
                      >
                        Preuve acoustique {evidence?.toFixed(2)} par trame
                        {evidence !== undefined && evidence < EVIDENCE_HINT
                          ? " · la déclaration colle mal : réécoute (reprise oubliée, verset en trop ?)"
                          : " · l’audio soutient la déclaration (repère indicatif)"}
                      </p>
                      <ol className="aligned-verses">
                        {a.spans?.map((s, i) => (
                          <li
                            key={`${s.kind === "verse" ? s.ref : s.label}-${i}`}
                            className={s.kind === "non_quran" ? "formula" : ""}
                          >
                            <button
                              className="quiet"
                              onClick={() => playRange(s.t[0], s.t[1])}
                            >
                              ▶{" "}
                              {s.kind === "verse" ? (
                                <>
                                  <strong>{s.ref}</strong>
                                  {s.partial
                                    ? ` mots ${s.words[0]}–${s.words[1]}`
                                    : ""}
                                </>
                              ) : (
                                <em>
                                  {FORMULA_LABELS[s.label]} (non coranique)
                                </em>
                              )}{" "}
                              · {formatTime(s.t[0])} – {formatTime(s.t[1])}
                            </button>
                          </li>
                        ))}
                      </ol>
                    </>
                  )}
                  <div className="passage-actions">
                    {p.status === "aligned" && (
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() =>
                          act(
                            {
                              action: "edit",
                              passage: p.id,
                              patch: { status: "validated" },
                            },
                            "Validation…",
                          )
                        }
                      >
                        Valider après écoute
                      </button>
                    )}
                    {p.status === "validated" && (
                      <button
                        className="outline"
                        disabled={busy}
                        onClick={() =>
                          act(
                            {
                              action: "edit",
                              passage: p.id,
                              patch: { status: "proposed" },
                            },
                            "Réouverture…",
                          )
                        }
                      >
                        Rouvrir
                      </button>
                    )}
                    {p.status !== "excluded" ? (
                      <button
                        className="quiet"
                        disabled={busy}
                        onClick={() =>
                          act(
                            {
                              action: "edit",
                              passage: p.id,
                              patch: { status: "excluded" },
                            },
                            "Exclusion…",
                          )
                        }
                      >
                        Exclure (douteux, non coranique…)
                      </button>
                    ) : (
                      <button
                        className="quiet"
                        disabled={busy}
                        onClick={() =>
                          act(
                            {
                              action: "edit",
                              passage: p.id,
                              patch: { status: "proposed" },
                            },
                            "Réouverture…",
                          )
                        }
                      >
                        Réintégrer
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
          {passages.length > 0 && (
            <div className="editor manifest-write">
              <label>
                Relecteur (identifiant anonyme, jamais un nom)
                <input
                  value={reviewer}
                  onChange={(e) => setReviewer(e.target.value)}
                />
              </label>
              <button
                className="primary"
                disabled={busy || !validated.length}
                onClick={() =>
                  act(
                    { action: "manifest", reviewed_by: reviewer.trim() },
                    "Écriture dans le manifeste…",
                  )
                }
              >
                Écrire {validated.length} passage(s) validé(s) dans le manifeste
              </button>
              {report && <p className="save">{report}</p>}
              <p className="fine">
                Fichiers dev seulement. Chaque passage validé devient une
                fenêtre annotée (annotation humaine) ; hors fenêtre, rien n’est
                vérité terrain.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
