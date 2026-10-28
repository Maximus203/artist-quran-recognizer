"use client";
import { LIVE_UI } from "@/lib/live-config";
import { decimalFr, formatClock, plural, verseName } from "@/lib/live-format";
import type { LiveTranslation } from "@/lib/live-protocol";
import {
  counts,
  cutSeconds,
  historyRows,
  revisedCount,
  type HistRow,
  type LiveState,
} from "@/lib/live-store";
import { splitNoteMarkers } from "@/lib/passage";
import { Icon } from "../icons";

const JUMP_LABEL = {
  repeat: "Tu reprends le verset précédent",
  back: "Tu reviens en arrière",
  skip: "Des versets ont été sautés",
  other_surah: "Autre sourate",
} as const;

const range = (t: [number, number | null]): string =>
  `${formatClock(t[0])}–${t[1] === null ? "…" : formatClock(t[1])}`;

function Arabic({ text }: { text: string }) {
  return (
    <div className="ar" lang="ar" dir="rtl">
      {text}
    </div>
  );
}

function Translation({ tr }: { tr: LiveTranslation }) {
  return (
    <>
      <p className="tr" lang="fr">
        {splitNoteMarkers(tr.text).map((piece, i) =>
          piece.note ? <sup key={i}>{piece.text}</sup> : piece.text,
        )}
      </p>
      <p className="attr">
        {tr.attribution} · {tr.translation_id} · source {tr.version}
      </p>
    </>
  );
}

function Row({
  row,
  showTranslation,
}: {
  row: HistRow;
  showTranslation: boolean;
}) {
  if (row.kind === "jump")
    return (
      <li className="hrow hrow--sep">
        <div className="hrow-flat">
          <span className="glyph">
            <Icon name="jump" />
          </span>
          <div>
            <div className="hrow-t">{JUMP_LABEL[row.jump]}</div>
          </div>
          <span className="hrow-e">{formatClock(row.t)}</span>
        </div>
      </li>
    );
  if (row.kind === "nq")
    return (
      <li className="hrow hrow--sep">
        <div className="hrow-flat">
          <span className="sw s-formula" />
          <div>
            <div className="hrow-t">Parole non coranique</div>
            <div className="hrow-s">Rien n’est affiché</div>
          </div>
          <span className="hrow-e">{formatClock(row.t)}</span>
        </div>
      </li>
    );
  if (row.kind === "basmala")
    return (
      <li className="hrow">
        <details>
          <summary>
            <span className="sw s-formula" />
            <div>
              <div className="hrow-t">Basmala</div>
              <div className="hrow-s">Formule du début de sourate</div>
            </div>
            <span className="hrow-e">{formatClock(row.t)}</span>
          </summary>
          <div className="hrow-body">
            {row.text ? <Arabic text={row.text} /> : null}
            {showTranslation && row.translation ? (
              <Translation tr={row.translation} />
            ) : null}
          </div>
        </details>
      </li>
    );
  if (row.kind === "unres") {
    const sub = [
      row.wordsHeard
        ? plural(row.wordsHeard, "mot entendu", "mots entendus")
        : "passage entendu",
      "plusieurs versets possibles",
      row.between
        ? `entre ${row.between[0] ?? "le début"} et ${row.between[1] ?? "la suite"}`
        : "",
    ]
      .filter(Boolean)
      .join(" · ");
    return (
      <li className="hrow" data-kind="unres">
        <details>
          <summary>
            <span className="sw s-uncertain" />
            <div>
              <div className="hrow-t">Passage non nommé</div>
              <div className="hrow-s">{sub}</div>
            </div>
            <span className="hrow-e">{range(row.t)}</span>
          </summary>
          <div className="hrow-body">
            {row.heardText ? <Arabic text={row.heardText} /> : null}
            <p className="hrow-s">
              {row.heardText
                ? "Mots communs à tous les candidats. "
                : "Rien de commun à montrer. "}
              Ce n’est pas une erreur : le moteur préfère ne rien nommer.
              L’analyse complète de l’enregistrement peut en nommer davantage.
            </p>
          </div>
        </details>
      </li>
    );
  }
  const sw =
    row.status === "recognized"
      ? "s-recognized"
      : row.status === "inferred"
        ? "s-inferred"
        : "s-uncertain";
  const sub = row.revised
    ? "Nommé puis retiré · incertain après vérification"
    : row.status === "inferred"
      ? "Déduit de la position · texte entendu"
      : "Reconnu";
  return (
    <li
      className="hrow"
      data-revised={row.revised ? "true" : "false"}
      data-kind="verse"
    >
      <details>
        <summary>
          <span className={`sw ${sw}`} />
          <div>
            <div className="hrow-t">
              {verseName(row.ref)}
              {row.repetition ? <span className="lv-tag">Reprise</span> : null}
              {row.revised ? (
                <span className="lv-tag lv-tag--warn">Corrigé</span>
              ) : null}
              {row.interrupted && !row.revised ? (
                <span className="lv-tag">Interrompu</span>
              ) : null}
            </div>
            <div className="hrow-s">
              {sub}
              {row.wordsHeard
                ? ` · ${plural(row.wordsHeard, "mot", "mots")}`
                : ""}
            </div>
          </div>
          <span className="hrow-e">{range(row.t)}</span>
        </summary>
        <div className="hrow-body">
          {row.revised ? (
            <p className="hrow-s">
              Ce verset avait été nommé {row.ref}, puis n’a pas été confirmé par
              la vérification acoustique. Son texte n’est plus affiché : il ne
              serait plus présenté comme sûr.
            </p>
          ) : row.text ? (
            <>
              <Arabic text={row.text} />
              {showTranslation && row.translation ? (
                <Translation tr={row.translation} />
              ) : null}
            </>
          ) : (
            <p className="hrow-s">
              Le texte de ce verset n’est pas disponible.
            </p>
          )}
        </div>
      </details>
    </li>
  );
}

/** « Passages » : du plus récent au plus ancien ; un passage non nommé y a sa place (ce n'est pas une erreur). */
export function History({
  state,
  showTranslation,
}: {
  state: LiveState;
  showTranslation: boolean;
}) {
  const rows = historyRows(state);
  const { named, unnamed } = counts(state);
  const revised = revisedCount(state);
  const lock = state.lock;
  return (
    <section className="hist" aria-labelledby="hist-t" data-testid="live-hist">
      <div className="hist-h">
        <h2 id="hist-t">Passages</h2>
      </div>
      <p className="hist-sum">
        <b data-testid="live-named">{named}</b> {named > 1 ? "nommés" : "nommé"}{" "}
        · <b data-testid="live-unnamed">{unnamed}</b> non{" "}
        {unnamed > 1 ? "nommés" : "nommé"}
        {revised > 0 ? (
          <>
            {" "}
            · <b data-testid="live-revised">{revised}</b>{" "}
            {revised > 1 ? "corrigés" : "corrigé"}
          </>
        ) : null}
      </p>
      {rows.length || lock ? (
        <ul aria-label="Passages de cette écoute, du plus récent au plus ancien">
          {lock ? (
            <li className="hrow">
              <div className="hrow-flat">
                <span
                  className={
                    lock.status === "inferred"
                      ? "sw s-inferred"
                      : "sw s-recognized"
                  }
                />
                <div>
                  <div className="hrow-t">
                    {verseName(lock.ref)}
                    <span className="lv-tag">En cours</span>
                  </div>
                  <div className="hrow-s">
                    Affiché dans la carte « Passage en cours »
                  </div>
                </div>
                <span className="hrow-e" />
              </div>
            </li>
          ) : null}
          {rows.map((row) => (
            <Row key={row.id} row={row} showTranslation={showTranslation} />
          ))}
        </ul>
      ) : (
        <p className="hist-empty">
          Les passages apparaissent ici au fur et à mesure. Un passage non nommé
          y a sa place : il n’est pas une erreur.
        </p>
      )}
    </section>
  );
}

/** Mode technique : interrupteur local, éteint par défaut. Rien d'ici n'entre dans la région annoncée. */
export function TechSwitch({
  on,
  onChange,
  grantedAtStart,
  live,
}: {
  on: boolean;
  onChange: (value: boolean) => void;
  grantedAtStart: boolean;
  live: boolean;
}) {
  return (
    <div className="techsw">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Mode technique"
        data-testid="live-tech-switch"
        onClick={() => onChange(!on)}
      />
      <span>
        Mode technique
        <small>
          {on && live && !grantedAtStart
            ? "La transcription provisoire demande d’activer le mode avant de démarrer."
            : "Transcription provisoire et messages bruts du service (touche T)."}
        </small>
      </span>
    </div>
  );
}

export function Tech({ state }: { state: LiveState }) {
  const last = state.log.slice(-7).reverse();
  return (
    <section
      className="tech"
      aria-label="Mode technique"
      data-testid="live-tech"
    >
      <h3>Mode technique</h3>
      <div className="partial">
        <span className="lbl">
          Transcription provisoire (PARTIAL) : sortie du modèle, non vérifiée,
          jamais le texte du Mushaf
        </span>
        <div className="txt" lang="ar" dir="rtl">
          {state.partial?.text ?? "…"}
        </div>
      </div>
      <div>
        <h3>Derniers messages aqr.live/1</h3>
        <div className="log">
          {last.length
            ? last.map((entry) => (
                <div key={`${entry.seq}-${entry.type}-${entry.t}`}>
                  <span className="s">
                    #{entry.seq} t={decimalFr(entry.t)}
                  </span>{" "}
                  <span className="k">{entry.type}</span> {entry.detail}
                </div>
              ))
            : "—"}
        </div>
      </div>
      <div className="log">
        <div>
          <span className="s">retard de traitement</span>{" "}
          {decimalFr(state.degraded?.lagS ?? 0)} s
        </div>
        <div>
          <span className="s">son gardé côté client</span>{" "}
          {Math.floor(cutSeconds(state))} s (maximum {LIVE_UI.bufferMaxS} s)
        </div>
        <div>
          <span className="s">paliers sautés</span>{" "}
          {state.degraded?.skipped.length
            ? state.degraded.skipped.join(", ")
            : "aucun"}
        </div>
      </div>
    </section>
  );
}
