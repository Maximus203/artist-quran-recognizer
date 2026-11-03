"use client";
import { LIVE_UI } from "@/lib/live-config";
import { LIVE_ERRORS } from "@/lib/live-errors";
import { decimalFr, formatClock, verseName } from "@/lib/live-format";
import {
  cutSeconds,
  lastNamed,
  recentRevision,
  silenceS,
  type LiveState,
} from "@/lib/live-store";
import { Icon } from "../icons";

/** La console : durée, ruban de niveau, Pause, Arrêter. Ancrée en bas sur téléphone (zone du pouce). */
export function Console({
  state,
  onStart,
  startDisabled = false,
  onPause,
  onResume,
  onStop,
  onCancel,
}: {
  state: LiveState;
  onStart: () => void;
  /** Récitation guidée sans sourate choisie : on ne démarre pas. */
  startDisabled?: boolean;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onCancel: () => void;
}) {
  const p = state.phase;
  if (p === "idle")
    return (
      <div className="dock dock--idle" data-testid="live-dock">
        <div className="grow">
          <b>Prêt à écouter</b>
          <div className="dock-note">
            Le micro ne s’ouvre qu’après ton accord.
          </div>
        </div>
        <button
          type="button"
          className="btn btn--primary btn--lg btn--wide"
          data-testid="live-start"
          disabled={startDisabled}
          onClick={onStart}
        >
          <Icon name="mic" />
          <span className="lbl">Démarrer l’écoute</span>
        </button>
      </div>
    );
  if (p === "permission")
    return (
      <div className="dock dock--idle" data-testid="live-dock">
        <div className="grow">
          <b>En attente de ton accord</b>
          <div className="dock-note">Réponds à la demande du navigateur.</div>
        </div>
        <button
          type="button"
          className="btn btn--secondary btn--lg btn--wide"
          data-testid="live-cancel"
          onClick={onCancel}
        >
          Annuler
        </button>
      </div>
    );
  if (p === "connecting")
    return (
      <div className="dock dock--idle" data-testid="live-dock">
        <div className="grow">
          <b>Connexion…</b>
          <div className="dock-note">
            Aucun son n’est envoyé pour l’instant.
          </div>
        </div>
        <button
          type="button"
          className="btn btn--secondary btn--lg btn--wide"
          data-testid="live-cancel"
          onClick={onCancel}
        >
          Annuler
        </button>
      </div>
    );
  if (p === "error")
    return (
      <div className="dock dock--idle" data-testid="live-dock">
        <div className="grow">
          <b>Écoute impossible</b>
          <div className="dock-note">Lis ce qui ne va pas, puis réessaie.</div>
        </div>
      </div>
    );
  if (p === "ending")
    return (
      <div className="dock dock--idle" role="status" data-testid="live-dock">
        <div className="grow">
          <b>Je termine l’analyse…</b>
          <div className="dock-note">
            Le dernier passage est en cours de vérification.
          </div>
        </div>
        <button
          type="button"
          className="btn btn--secondary btn--lg btn--wide"
          disabled
        >
          Arrêter
        </button>
      </div>
    );
  if (p === "ended")
    return (
      <div className="dock dock--idle" data-testid="live-dock">
        <div className="grow">
          <b>Écoute terminée</b>
          <div className="dock-note">
            {formatClock(state.endAtS ?? state.capturedS)}
          </div>
        </div>
        <button
          type="button"
          className="btn btn--secondary btn--lg btn--wide"
          data-testid="live-start"
          onClick={onStart}
        >
          <Icon name="mic" />
          <span className="lbl">Nouvelle écoute</span>
        </button>
      </div>
    );
  const paused = p === "paused";
  const cut = state.link === "lost";
  const quiet = paused || silenceS(state) > 3;
  const levels = state.levels;
  const bars = Array.from({ length: LIVE_UI.levelBars }, (_, i) => {
    const level = paused
      ? 0.04
      : (levels[levels.length - LIVE_UI.levelBars + i] ?? 0.03);
    return Math.round(8 + Math.min(1, level * LIVE_UI.ribbonGain) * 92);
  });
  return (
    <div
      className="dock"
      role="group"
      aria-label="Contrôles de l’écoute"
      data-testid="live-dock"
    >
      <span className="dock-time" role="timer" aria-label="Durée d’écoute">
        {paused ? (
          <span className="pausebars" aria-hidden="true">
            <i />
            <i />
          </span>
        ) : (
          <i className="recdot recdot--pulse" aria-hidden="true" />
        )}
        <span data-testid="live-time">{formatClock(state.capturedS)}</span>
      </span>
      <div
        className="ribbon"
        aria-hidden="true"
        data-quiet={quiet ? "true" : "false"}
      >
        {bars.map((h, i) => (
          <i key={i} style={{ "--h": `${h}%` } as React.CSSProperties} />
        ))}
      </div>
      {cut ? (
        <span className="dock-note">
          son gardé {Math.floor(cutSeconds(state))} s
        </span>
      ) : null}
      {paused ? (
        <button
          type="button"
          className="btn btn--primary btn--lg"
          data-testid="live-resume"
          onClick={onResume}
        >
          <Icon name="play" />
          <span className="lbl">Reprendre</span>
        </button>
      ) : (
        <button
          type="button"
          className="btn btn--secondary btn--lg"
          data-testid="live-pause"
          aria-label="Mettre en pause"
          onClick={onPause}
        >
          <Icon name="pause" />
          <span className="lbl">Pause</span>
        </button>
      )}
      <button
        type="button"
        className="btn btn--secondary btn--lg btn--wide"
        data-testid="live-stop"
        onClick={onStop}
      >
        <i className="sq" aria-hidden="true" />
        <span className="lbl">Arrêter</span>
      </button>
    </div>
  );
}

export function StatusBar({
  state,
  wakeHeld,
}: {
  state: LiveState;
  wakeHeld: boolean;
}) {
  const p = state.phase;
  if (p !== "listening" && p !== "paused" && p !== "ending") return null;
  return (
    <div className="statusbar" data-testid="live-status">
      {p === "paused" ? (
        <span className="pill">
          <span className="pausebars" aria-hidden="true">
            <i />
            <i />
          </span>
          En pause · rien n’est envoyé
        </span>
      ) : (
        <span className="pill pill--rec">
          <span className="recdot" aria-hidden="true" />
          Micro actif
        </span>
      )}
      {state.link === "lost" ? (
        <span className="pill pill--warn">
          <Icon name="link-off" />
          Connexion perdue
        </span>
      ) : state.link === "catchup" ? (
        <span className="pill">
          <Icon name="refresh" />
          Rattrapage en cours
        </span>
      ) : (
        <span className="pill">
          <span className="d d--ring" aria-hidden="true" />
          Connecté
        </span>
      )}
      {state.degraded ? (
        <span className="pill pill--warn">
          <Icon name="gauge" />
          Mode allégé
        </span>
      ) : null}
      {wakeHeld ? (
        <span className="pill hide-m">
          <Icon name="eye-off" />
          Écran maintenu allumé
        </span>
      ) : null}
    </div>
  );
}

const SKIPPED_TEXT: Record<string, string> = {
  acoustic: "je saute la vérification acoustique en fin de verset.",
  relisten:
    "je ne réécoute pas les passages douteux : une correction peut arriver plus tard, ou ne pas arriver.",
};

/** Bandeaux : jamais cachés, toujours dits en clair (coupure, mode allégé, correction, onglet, erreur). */
export function Notices({
  state,
  onRetryNow,
}: {
  state: LiveState;
  onRetryNow: () => void;
}) {
  const p = state.phase;
  const live = p === "listening" || p === "paused" || p === "ending";
  const rev = recentRevision(state);
  const items: React.ReactNode[] = [];
  if (live && state.link === "lost") {
    const cut = Math.floor(cutSeconds(state));
    const retry = LIVE_UI.retryEveryS - (cut % LIVE_UI.retryEveryS);
    items.push(
      <div key="lost" className="lnotice lnotice--warn fadein" role="status">
        <Icon name="link-off" />
        <div>
          <p>
            <b>Connexion perdue.</b> Je continue de capter ta voix et je garde
            le son ({cut} s) pour le renvoyer dès que la connexion revient. Les
            résultats reprendront ensuite.
          </p>
        </div>
        <div className="act">
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            data-testid="live-retry-now"
            onClick={onRetryNow}
          >
            Réessayer maintenant
          </button>
          <span className="meta">Nouvel essai dans {retry} s</span>
        </div>
      </div>,
    );
  } else if (live && state.link === "catchup") {
    items.push(
      <div key="back" className="lnotice lnotice--info fadein" role="status">
        <Icon name="refresh" />
        <div>
          <p>
            <b>Connexion rétablie.</b> J’envoie le son gardé pendant la coupure
            ({decimalFr(state.catchupS)} s). Les résultats vont rattraper leur
            retard ; rien n’est perdu.
          </p>
        </div>
      </div>,
    );
  }
  if (live && state.degraded) {
    const d = state.degraded;
    const lines = [
      d.overloaded
        ? `L’analyse a ${decimalFr(d.lagS)} s de retard : les mots arrivent plus tard.`
        : "",
      ...d.skipped.map((s) => SKIPPED_TEXT[s] ?? ""),
    ].filter(Boolean);
    items.push(
      <div
        key="deg"
        className="lnotice lnotice--warn fadein"
        role="status"
        data-testid="live-degraded"
      >
        <Icon name="gauge" />
        <div>
          <p>
            <b>Mode allégé{d.overloaded ? " : serveur surchargé" : ""}.</b>{" "}
            {lines.join(" ")} Pour rester sûr, je demande plus de mots avant de
            nommer un verset.
          </p>
          <p>
            <b>Ce que ça change.</b> Les noms arrivent plus tard, et un verset
            très court peut ne pas être nommé. Ce n’est jamais moins sûr : la
            règle ne s’assouplit pas.
          </p>
        </div>
      </div>,
    );
  }
  if (rev) {
    items.push(
      <div
        key="rev"
        className="lnotice lnotice--warn fadein"
        role="status"
        data-testid="live-revision"
      >
        <Icon name="alert" />
        <div>
          <p>
            <b>Correction.</b> {verseName(rev)} n’est plus nommé : la
            vérification acoustique n’a pas confirmé ces mots. Le passage reste
            dans la liste, marqué « corrigé », et son texte n’est plus affiché.
          </p>
        </div>
      </div>,
    );
  }
  if (live && state.tabGap) {
    items.push(
      <div key="tab" className="lnotice lnotice--warn" role="status">
        <Icon name="eye-off" />
        <div>
          <p>
            <b>L’onglet était en arrière-plan.</b> Le navigateur a peut-être
            coupé le micro vers {formatClock(state.tabGap.fromS)}, pendant
            environ {Math.round(state.tabGap.lostS)} s : ce passage n’a pas été
            écouté. Garde l’écran allumé et l’onglet au premier plan.
          </p>
        </div>
      </div>,
    );
  }
  if (live && state.streamError) {
    const text = LIVE_ERRORS[state.streamError.key];
    items.push(
      <div
        key="err"
        className="lnotice lnotice--danger lnotice--wide"
        role="status"
      >
        <Icon name={text.icon} />
        <div>
          <p>
            <b>{text.title}.</b> {state.streamError.message || text.cause}
          </p>
          <p>
            <b>Ce que ça change.</b> {text.impact}
          </p>
        </div>
      </div>,
    );
  }
  return (
    <div className="notices" data-testid="live-notice">
      {items}
    </div>
  );
}

/** Bande « Ce que je sais déjà » : seulement des faits mesurés (durée, mots, candidats, dernier nommé). */
export function Know({ state }: { state: LiveState }) {
  const p = state.phase;
  if (p !== "listening" && p !== "paused" && p !== "ending") return null;
  const words = state.lock
    ? state.lock.wordsHeard
    : (state.cand?.wordsHeard ?? 0);
  const cands = state.lock ? "1" : state.cand ? String(state.cand.count) : "—";
  const last = lastNamed(state);
  const ago =
    last && last.endT !== null
      ? Math.max(0, Math.round(state.capturedS - last.endT))
      : null;
  return (
    <dl className="know" data-testid="live-know">
      <div>
        <dt>Écoute</dt>
        <dd>
          {formatClock(state.capturedS)}
          <small>
            {state.link === "lost" ? "connexion coupée" : "connecté"}
          </small>
        </dd>
      </div>
      <div>
        <dt>Mots entendus</dt>
        <dd>
          {words || "—"}
          <small>dans ce passage</small>
        </dd>
      </div>
      <div>
        <dt>Candidats</dt>
        <dd>
          {cands}
          <small>{state.lock ? "verset nommé" : "versets possibles"}</small>
        </dd>
      </div>
      <div>
        <dt>Dernier nommé</dt>
        <dd>
          {last ? last.ref : "—"}
          <small>
            {last
              ? ago !== null
                ? `il y a ${ago} s`
                : "en cours"
              : "rien pour l’instant"}
          </small>
        </dd>
      </div>
    </dl>
  );
}
