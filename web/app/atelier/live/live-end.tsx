"use client";
import Link from "next/link";
import { forwardRef } from "react";
import { LIVE_ERRORS } from "@/lib/live-errors";
import { formatClock } from "@/lib/live-format";
import { counts, type LiveState } from "@/lib/live-store";
import { Icon } from "../icons";

type Props = {
  state: LiveState;
  hasRecording: boolean;
  undoIn: number | null;
  onKeep: () => void;
  onCopy: () => void;
  onRestart: () => void;
  onDiscard: () => void;
  onUndo: () => void;
};

/** Fin d'écoute : un résumé honnête, puis le seul geste qui crée quelque chose (« Garder »). */
export const EndCard = forwardRef<HTMLHeadingElement, Props>(function EndCard(
  { state, hasRecording, undoIn, onKeep, onCopy, onRestart, onDiscard, onUndo },
  titleRef,
) {
  const { named, unnamed } = counts(state);
  const degraded = state.degLog.map(
    ([a, b]) =>
      `${formatClock(a)}–${b === null ? formatClock(state.endAtS ?? a) : formatClock(b)}`,
  );
  const error = state.streamError ? LIVE_ERRORS[state.streamError.key] : null;
  const keep = state.keep;
  return (
    <article
      className="pass end"
      aria-labelledby="lv-title"
      data-testid="live-end"
    >
      <span className="eyebrow">Écoute terminée</span>
      {error ? (
        <div className="lnotice lnotice--danger lnotice--wide" role="alert">
          <Icon name={error.icon} />
          <div>
            <p>
              <b>{error.title}</b>
            </p>
            <p>
              <b>Pourquoi.</b> {error.cause}
            </p>
            <p>
              <b>Ce que ça change.</b> {error.impact}
            </p>
            <p>
              <b>Que faire.</b> {error.todo}
            </p>
            {state.streamError?.message ? (
              <p className="meta">
                Message du service : « {state.streamError.message} »
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
      <h2 id="lv-title" tabIndex={-1} ref={titleRef}>
        {error ? "Ce qui avait été entendu" : "Voilà ce que j’ai entendu."}
      </h2>
      <p className="lv-facts" data-testid="live-facts">
        <span>
          Durée <b>{formatClock(state.endAtS ?? state.capturedS)}</b>
        </span>
        <span>
          <b>{named}</b> {named > 1 ? "versets nommés" : "verset nommé"}
        </span>
        <span>
          <b>{unnamed}</b>{" "}
          {unnamed > 1 ? "passages non nommés" : "passage non nommé"}
        </span>
        {degraded.length ? (
          <span>mode allégé {degraded.join(", ")}</span>
        ) : null}
      </p>
      {keep.state === "sending" ? (
        <div className="keep" role="status" data-testid="live-keep-sending">
          <p>
            <b>Envoi de l’enregistrement…</b> Il part comme un import classique
            ; l’analyse complète démarre ensuite.
          </p>
          <div className="bar">
            <i
              style={
                {
                  "--p": `${Math.round(keep.progress * 100)}%`,
                } as React.CSSProperties
              }
            />
          </div>
        </div>
      ) : keep.state === "queued" ? (
        <div className="keep" role="status" data-testid="live-keep-queued">
          <p>
            <b>Enregistrement gardé.</b> Il est dans la file d’analyse et
            apparaîtra dans tes sessions sous le nom « Récitation en direct ».
            L’analyse complète va le relire en entier.
          </p>
          <div className="end-acts">
            <Link className="btn btn--primary" href="/sessions">
              Ouvrir mes sessions
            </Link>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={onRestart}
            >
              Nouvelle écoute
            </button>
          </div>
        </div>
      ) : keep.state === "discarded" ? (
        <div className="keep" role="status" data-testid="live-keep-discarded">
          <p>
            <b>Rien n’a été gardé.</b> Le son et la liste ont été effacés de ce
            navigateur. Rien n’avait été enregistré sur le serveur.
          </p>
          <div className="end-acts">
            <button
              type="button"
              className="btn btn--primary"
              onClick={onRestart}
            >
              Nouvelle écoute
            </button>
            {undoIn !== null ? (
              <button
                type="button"
                className="btn btn--ghost"
                data-testid="live-undo"
                onClick={onUndo}
              >
                Annuler ({undoIn} s)
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="keep" data-testid="live-keep-box">
          {keep.state === "failed" ? (
            <div className="lnotice lnotice--danger lnotice--wide" role="alert">
              <Icon name="alert" />
              <div>
                <p>
                  <b>L’enregistrement n’a pas pu être gardé.</b> {keep.message}
                </p>
              </div>
            </div>
          ) : null}
          {hasRecording ? (
            <p>
              <b>Garder cet enregistrement ?</b> Le son n’a pas été conservé :
              il est resté dans la mémoire de ton navigateur, et rien n’est
              enregistré sur le serveur. Si tu le gardes, il est envoyé comme un
              import classique, analysé en entier (l’analyse complète peut
              nommer des versets que le direct n’a pas nommés), puis rangé dans
              tes sessions pour l’écouter et le relire.
            </p>
          ) : (
            <p>
              <b>Aucun enregistrement local.</b> Ce navigateur n’a pas pu garder
              le son de cette écoute, ou il n’est plus en mémoire : seule la
              liste des passages reste disponible.
            </p>
          )}
          <div className="end-acts">
            {hasRecording ? (
              <button
                type="button"
                className="btn btn--primary"
                data-testid="live-keep"
                onClick={onKeep}
              >
                <Icon name="keep" />
                {keep.state === "failed"
                  ? "Réessayer l’envoi"
                  : "Garder cet enregistrement"}
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn--secondary"
              data-testid="live-copy"
              onClick={onCopy}
            >
              <Icon name="copy" />
              Copier la liste
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              data-testid="live-restart"
              onClick={onRestart}
            >
              Recommencer
            </button>
            {hasRecording ? (
              <button
                type="button"
                className="btn btn--danger"
                data-testid="live-discard"
                onClick={onDiscard}
              >
                Ne rien garder
              </button>
            ) : null}
          </div>
        </div>
      )}
    </article>
  );
});
