"use client";
import { useEffect, useState } from "react";
import { formatSecondsFr, formatTenths } from "@/lib/format";
import { REVIEW_PRESETS } from "@/lib/review-presets";
import { canConfirm, type Annotation } from "@/lib/review";
import type { Store } from "@/lib/mini-store";
import { Icon } from "./icons";
import { useStoreValue } from "./hooks";
import type { ReviewController } from "./use-review";
import type { PlayerState } from "./use-player";

const EXPECTED = /^\d{1,3}:\d{1,3}$/;

type Props = {
  review: ReviewController;
  tester: string | null;
  store: Store<PlayerState>;
  getPosition: () => number;
  /** « Sur cette plage, le moteur affiche … » (null = aucun intervalle). */
  contextAt: (time: number) => string | null;
  onListen: (a: Annotation) => void;
  onLoop: (on: boolean) => void;
  onOpenList: () => void;
};

/** Longueur provisoire d'une plage en cours de pose : suit la lecture sans redessiner tout le panneau. */
function ProvisionalLength({
  store,
  start,
}: {
  store: Store<PlayerState>;
  start: number;
}) {
  const time = useStoreValue(store, (s) => s.time);
  return <b>{formatSecondsFr(Math.max(0, time - start))} s</b>;
}

function SaveLine({ review }: { review: ReviewController }) {
  if (review.save === "error")
    return (
      <div
        className="savebar err"
        role="status"
        data-testid="save-status"
        data-state="error"
      >
        <Icon name="alert" />
        Échec de l’enregistrement.
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          data-testid="save-retry"
          onClick={() => void review.retry()}
        >
          Réessayer
        </button>
      </div>
    );
  return (
    <div
      className="savebar"
      role="status"
      data-testid="save-status"
      data-state={review.save}
    >
      {review.save === "saving" ? (
        "Enregistrement…"
      ) : review.save === "saved" ? (
        <>
          <Icon name="check" />
          Enregistré sur cet ordinateur
        </>
      ) : null}
    </div>
  );
}

function Edge({
  label,
  value,
  edge,
  review,
  id,
  getPosition,
}: {
  label: string;
  value: number;
  edge: "start" | "end";
  review: ReviewController;
  id: string;
  getPosition: () => number;
}) {
  const word = edge === "start" ? "Début" : "Fin";
  return (
    <div className="nudge">
      <div className="field">
        <span>{label}</span>
        <div className="ctl">
          <button
            type="button"
            className="btn btn--secondary"
            data-testid={`${edge}-minus`}
            aria-label={`${word} 0,1 s plus tôt`}
            onClick={() => review.nudge(id, edge, -0.1)}
          >
            −
          </button>
          <input
            className="input"
            data-testid={`${edge}-value`}
            value={formatTenths(value)}
            aria-label={`${word} de la plage`}
            readOnly
          />
          <button
            type="button"
            className="btn btn--secondary"
            data-testid={`${edge}-plus`}
            aria-label={`${word} 0,1 s plus tard`}
            onClick={() => review.nudge(id, edge, 0.1)}
          >
            +
          </button>
        </div>
      </div>
      <button
        type="button"
        className="btn btn--ghost btn--icon"
        data-testid={`${edge}-snap`}
        aria-label={`Caler ${edge === "start" ? "le début" : "la fin"} sur la lecture`}
        title="Caler sur la lecture"
        onClick={() => review.edge(id, edge, getPosition())}
      >
        <Icon name="target" />
      </button>
    </div>
  );
}

export function SignalTab(props: Props) {
  const { review, tester } = props;
  const a = review.draft;
  const done = review.done;
  const mark = review.state.mark;
  const locked = !tester;
  const heard = a ? review.state.listened[a.id] === true : false;
  const steps = [
    { name: "Délimiter", done: Boolean(a) || Boolean(done) },
    { name: "Écouter", done: Boolean(a && heard) || Boolean(done) },
    { name: "Décrire", done: Boolean(done) },
  ];
  const currentStep = steps.findIndex((s) => !s.done);
  const [expected, setExpected] = useState("");
  const [expectedError, setExpectedError] = useState(false);
  const draftKey = a?.id ?? "";
  useEffect(() => {
    setExpected(a?.expected_ref ?? "");
    setExpectedError(false);
    // seulement quand on change de signalement
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);
  const confirmable = a ? canConfirm(a) : false;
  const range = (x: Annotation) =>
    `${formatTenths(x.start_s)}${x.end_s === null ? "" : ` → ${formatTenths(x.end_s)}`}`;
  const context = a ? props.contextAt(a.start_s) : null;

  return (
    <>
      <ol
        className="steps"
        aria-label="Étapes du signalement"
        data-testid="steps"
      >
        {steps.map((s, i) => (
          <li
            key={s.name}
            data-s={s.done ? "done" : i === currentStep ? "current" : "todo"}
          >
            <span data-n={i + 1}>{s.name}</span>
          </li>
        ))}
      </ol>

      <section
        className={`rcard${locked && !a ? " is-locked" : ""}`}
        data-testid="step-1"
      >
        {a ? (
          <>
            <h3>
              <span className="n">1</span>Plage à signaler
            </h3>
            <div className="range-chip" data-testid="range-chip">
              <Icon name="flag" />
              <span className="mono">{range(a)}</span>
              <span className="len">
                {a.end_s === null
                  ? "point"
                  : `${formatSecondsFr(a.end_s - a.start_s)} s`}
              </span>
            </div>
            {context ? (
              <p className="ctx">
                <Icon name="info" />
                <span>
                  Sur cette plage, le moteur affiche <b>{context}</b>.
                </span>
              </p>
            ) : null}
            <div className="btnrow">
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                data-testid="restart"
                style={{ justifyContent: "flex-start", paddingLeft: 0 }}
                onClick={() => review.reset(a.id)}
              >
                Tout recommencer
              </button>
            </div>
          </>
        ) : done ? (
          <>
            <h3>
              <span className="n">✓</span>Signalement enregistré
            </h3>
            <div className="range-chip" data-testid="done-chip">
              <span className="sw s-human">
                <i />
              </span>
              <span className="mono">{range(done)}</span>
              <span className="len">{done.tester}</span>
            </div>
            <div className="btnrow">
              <button
                type="button"
                className="btn btn--primary"
                data-testid="report-another"
                onClick={review.press}
              >
                <Icon name="flag" />
                Signaler autre chose <kbd>M</kbd>
              </button>
              <button
                type="button"
                className="btn btn--secondary"
                data-testid="see-list"
                onClick={props.onOpenList}
              >
                Voir la liste
              </button>
            </div>
          </>
        ) : mark !== null ? (
          <>
            <h3>
              <span className="n">1</span>Délimiter
            </h3>
            <div className="banner" data-testid="mark-banner">
              <span>
                Début posé à <b>{formatTenths(mark)}</b>
              </span>
              <small>
                Avance l’écoute jusqu’à la fin du problème, puis appuie pour
                poser la fin.
              </small>
              <small>
                Longueur provisoire :{" "}
                <ProvisionalLength store={props.store} start={mark} />
              </small>
            </div>
            <div className="btnrow">
              <button
                type="button"
                className="btn btn--primary btn--lg"
                data-testid="panel-mark"
                onClick={review.press}
              >
                <Icon name="flag" />
                Marquer la fin <kbd>M</kbd>
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--lg"
                style={{ flex: "none" }}
                onClick={review.cancel}
              >
                Annuler
              </button>
            </div>
          </>
        ) : (
          <>
            <h3>
              <span className="n">1</span>Où est le problème ?
            </h3>
            <div className="btnrow btnrow--col">
              <button
                type="button"
                className="btn btn--primary btn--lg"
                data-testid="panel-mark"
                aria-disabled={locked}
                onClick={review.press}
              >
                <Icon name="flag" />
                Marquer le début <kbd>M</kbd>
              </button>
              <button
                type="button"
                className="btn btn--secondary"
                data-testid="panel-point"
                aria-disabled={locked}
                onClick={review.point}
              >
                Signaler un point ici <kbd>P</kbd>
              </button>
            </div>
            <p className="hint">
              {locked
                ? "Indique d’abord qui teste (ci-dessus)."
                : "Écoute, appuie quand le problème commence, puis une seconde fois quand il finit. Ou trace-le directement sur la forme d’onde : « Tracer sur l’onde », puis glisse pour une plage, touche pour un point."}
            </p>
          </>
        )}
      </section>

      {a ? (
        <>
          <section className="rcard" data-testid="step-2">
            <h3>
              <span className="n">2</span>Écouter et affiner
            </h3>
            <Edge
              label="Début"
              value={a.start_s}
              edge="start"
              review={review}
              id={a.id}
              getPosition={props.getPosition}
            />
            {a.end_s === null ? null : (
              <Edge
                label="Fin"
                value={a.end_s}
                edge="end"
                review={review}
                id={a.id}
                getPosition={props.getPosition}
              />
            )}
            <div className="listen-row">
              <button
                type="button"
                className="btn btn--secondary"
                data-testid="listen-range"
                onClick={() => props.onListen(a)}
              >
                <Icon name="play" fill />
                {a.end_s === null
                  ? "Écouter autour du point"
                  : "Écouter la plage"}
              </button>
              <button
                type="button"
                className="switch"
                role="switch"
                data-testid="loop-switch"
                aria-checked={review.loop}
                onClick={() => props.onLoop(!review.loop)}
              >
                <i />
                En boucle <kbd>L</kbd>
              </button>
              <span className="ok" data-testid="heard">
                {heard ? (
                  <>
                    <Icon name="check" size={14} />
                    Écoutée
                  </>
                ) : (
                  "Pas encore écoutée"
                )}
              </span>
            </div>
            <p className="hint hint--xs">
              Tu peux aussi déplacer les poignées sur la forme d’onde (flèches
              du clavier : 0,1 s, avec Maj : 1 s).
            </p>
          </section>

          <section className="rcard" data-testid="step-3">
            <h3>
              <span className="n">3</span>Décrire le souci
            </h3>
            {a.tester !== tester && tester ? (
              <div className="banner" data-testid="other-tester-banner">
                <small>
                  Signalement de <b className="name">{a.tester}</b> : tu le
                  modifies en tant que <b className="name">{tester}</b>. Son nom
                  reste sur le signalement.
                </small>
              </div>
            ) : null}
            <p className="hint">
              Choisis une ou plusieurs puces, ou écris un commentaire.
            </p>
            <div className="fams">
              {REVIEW_PRESETS.map((family) => {
                const chosen = family.items.filter((item) =>
                  a.tags.includes(item.id),
                ).length;
                return (
                  <details
                    className="fam"
                    key={family.id}
                    data-testid={`family-${family.id}`}
                    open={family.defaultOpen || chosen > 0 || undefined}
                  >
                    <summary>
                      {family.label}
                      {chosen > 0 ? (
                        <span
                          className="sel-n"
                          aria-label={`${chosen} choisie${chosen > 1 ? "s" : ""}`}
                        >
                          {chosen}
                        </span>
                      ) : null}
                    </summary>
                    {family.hint ? <p className="fh">{family.hint}</p> : null}
                    <div
                      className="pchips"
                      role="group"
                      aria-label={family.label}
                    >
                      {family.items.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className="pchip"
                          data-testid={`preset-${item.id}`}
                          aria-pressed={a.tags.includes(item.id)}
                          onClick={() => review.toggle(a.id, item.id)}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </details>
                );
              })}
            </div>
            <label className="field">
              <span>
                Verset attendu <span className="opt">· facultatif</span>
              </span>
              <input
                className="input expected"
                data-testid="expected-ref"
                value={expected}
                placeholder="ex. 2:256"
                maxLength={7}
                inputMode="text"
                aria-describedby="exp-help"
                aria-invalid={expectedError ? true : undefined}
                onChange={(event) => {
                  const text = event.target.value;
                  setExpected(text);
                  if (text.trim() === "") {
                    setExpectedError(false);
                    review.patch(a.id, { expected_ref: null });
                  } else if (EXPECTED.test(text.trim())) {
                    setExpectedError(false);
                    review.patch(a.id, { expected_ref: text.trim() });
                  } else setExpectedError(true);
                }}
              />
              <span
                className="opt"
                id="exp-help"
                style={{
                  fontWeight: 400,
                  fontSize: "var(--fs-xs)",
                  color: expectedError ? "var(--danger)" : undefined,
                }}
              >
                Sourate:verset, par exemple 2:255.
              </span>
            </label>
            <label className="field">
              <span>
                Commentaire{" "}
                <span className="opt">
                  · {a.tags.length ? "facultatif" : "obligatoire sans puce"}
                </span>
              </span>
              <textarea
                className="input"
                data-testid="comment"
                maxLength={3000}
                placeholder="Qu’as-tu entendu ? Que faut-il corriger ?"
                value={a.description}
                onChange={(event) =>
                  review.patch(a.id, { description: event.target.value })
                }
              />
            </label>
            <div className="btnrow btnrow--col">
              <button
                type="button"
                className="btn btn--primary btn--lg"
                data-testid="confirm-report"
                aria-disabled={!confirmable}
                onClick={() => review.confirm(a.id)}
              >
                {a.status === "confirmed"
                  ? "Enregistrer les modifications"
                  : "Confirmer le signalement"}{" "}
                <kbd>Ctrl ↵</kbd>
              </button>
              <div className="row" style={{ alignItems: "center" }}>
                <button
                  type="button"
                  className="btn btn--ghost"
                  data-testid="keep-draft"
                  style={{ justifyContent: "flex-start" }}
                  onClick={review.keep}
                >
                  Garder en brouillon
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  data-testid="delete-report"
                  style={{ color: "var(--danger)" }}
                  onClick={() => review.remove(a.id)}
                >
                  Supprimer
                </button>
              </div>
            </div>
            <SaveLine review={review} />
          </section>
        </>
      ) : null}
    </>
  );
}
