"use client";
import { useRef } from "react";
import { useFocusTrap } from "../hooks";
import { bytesFr } from "@/lib/export-text";
import type { FileRow } from "@/lib/export-video-progress";
import { progressCounts } from "@/lib/export-video-progress";
import {
  megabytesFr,
  type Weight,
  type WeightLevel,
} from "@/lib/export-video-weight";
import { formatDurationFr } from "@/lib/format";
import { XIcon } from "./export-icons";
import { LEVEL_LABEL } from "./video-quality";

/**
 * Le bordereau : récapitulatif + action, toujours visible (colonne collante au bureau, feuille
 * ouverte depuis le dock sur téléphone). Il porte aussi les états du rendu : progression PAR
 * FICHIER, succès multi-fichiers, échec qui dit ce qui est intact et propose de reprendre.
 */
export type ExportPhase =
  | "loading"
  | "empty"
  | "idle"
  | "render"
  | "done"
  | "error";
export type ExportFailure = { message: string; index: number; memory: boolean };

export type BordereauProps = {
  phase: ExportPhase;
  count: number;
  seconds: number;
  formatLabel: string;
  width: number;
  height: number;
  fps: number;
  weight: Weight;
  level: WeightLevel;
  renderTime: string;
  firstFileName: string;
  apiJson: string;
  files: FileRow[];
  failure: ExportFailure | null;
  stopRequested: boolean;
  canLighten: boolean;
  onExport: () => void;
  onStop: () => void;
  onResume: (lighter: boolean) => void;
  onNew: () => void;
  onRedownload: (index: number | null) => void;
  onLighten: () => void;
  onGoVerify: () => void;
  /** Un seul bouton porte l'identifiant de test (bureau ou téléphone). */
  primaryTestId?: string;
};

const plural = (n: number, one: string, many: string) =>
  `${n} ${n > 1 ? many : one}`;

function FileList({
  files,
  onRedownload,
}: {
  files: FileRow[];
  onRedownload?: (index: number) => void;
}) {
  return (
    <ul className="xr-files" data-testid="video-files">
      {files.map((file, i) => (
        <li key={`${i}-${file.name}`} data-s={file.state}>
          <XIcon
            name={
              file.state === "done"
                ? "check"
                : file.state === "err"
                  ? "alert"
                  : "film"
            }
          />
          <span className="fn" title={file.name}>
            {file.name}
          </span>
          <span className="st">
            {file.state === "done"
              ? file.bytes !== null
                ? bytesFr(file.bytes)
                : "prête"
              : file.state === "err"
                ? "échec"
                : file.state === "run"
                  ? `${Math.round(file.ratio * 100)} %`
                  : "en attente"}
          </span>
          {file.state === "run" ? (
            <span
              className="bar"
              role="progressbar"
              aria-label={`Rendu de ${file.name}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(file.ratio * 100)}
            >
              <i style={{ width: `${Math.round(file.ratio * 100)}%` }} />
            </span>
          ) : null}
          {file.state === "done" && onRedownload ? (
            <button
              type="button"
              className="btn btn--ghost btn--icon dl"
              aria-label={`Retélécharger ${file.name}`}
              onClick={() => onRedownload(i)}
            >
              <XIcon name="download" />
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function Bordereau(props: BordereauProps) {
  const { phase, count, files, failure } = props;
  const counts = progressCounts(files);
  if (phase === "loading")
    return (
      <div className="xr-bord" aria-busy="true">
        <div className="xr-skel" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <p className="xr-lead" role="status">
          Lecture de l’audio et des passages…
        </p>
      </div>
    );
  if (phase === "empty")
    return (
      <div className="xr-bord" data-testid="bord-empty">
        <div className="xr-big">
          <b>0</b>
          <span>vidéo</span>
        </div>
        <p className="xr-lead">
          Aucun passage coranique avec du texte à montrer : il n’y a rien à
          mettre en vidéo.
        </p>
        <button
          className="btn btn--primary btn--lg btn--block"
          type="button"
          disabled
        >
          Rien à exporter
        </button>
      </div>
    );
  if (phase === "render") {
    const current = files.findIndex((f) => f.state === "run");
    return (
      <div className="xr-bord" data-testid="bord-render" aria-live="off">
        <div className="xr-big">
          <b className="mono">{current < 0 ? counts.done : current + 1}</b>
          <span>vidéo en cours sur {files.length || count}</span>
        </div>
        <FileList files={files} />
        <p className="xr-note">
          <XIcon name="alert" />
          <span>
            Garde cet onglet ouvert : la vidéo se fabrique dans ton navigateur.
            Chaque vidéo se télécharge dès qu’elle est prête.
          </span>
        </p>
        {files.length > 1 ? (
          <button
            className="btn btn--secondary btn--lg btn--block"
            type="button"
            disabled={props.stopRequested}
            data-testid="video-stop"
            onClick={props.onStop}
          >
            {props.stopRequested
              ? "Arrêt après cette vidéo…"
              : "Arrêter après cette vidéo"}
          </button>
        ) : null}
      </div>
    );
  }
  if (phase === "done")
    return (
      <div className="xr-bord" data-testid="bord-done">
        <div className="xr-big">
          <b className="mono">{counts.done}</b>
          <span>
            {counts.done > 1 ? "vidéos prêtes" : "vidéo prête"}
            {counts.done < files.length
              ? ` sur ${files.length} (arrêt demandé)`
              : ""}
          </span>
        </div>
        <FileList files={files} onRedownload={props.onRedownload} />
        <p className="xr-lead">
          Téléchargées dans ton dossier habituel.
          {files.length > 1
            ? " Si le navigateur a bloqué les téléchargements multiples, autorise-les puis retélécharge celles qui manquent."
            : ""}
        </p>
        <div className="xr-row">
          <button
            className="btn btn--primary"
            type="button"
            data-testid="video-redownload"
            onClick={() => props.onRedownload(null)}
          >
            <XIcon name="download" />
            {counts.done > 1 ? "Retélécharger tout" : "Retélécharger"}
          </button>
          <button
            className="btn btn--ghost"
            type="button"
            onClick={props.onNew}
          >
            Nouvel export
          </button>
        </div>
      </div>
    );
  if (phase === "error" && failure)
    return (
      <div className="xr-bord" data-testid="bord-error">
        <div className="xr-big">
          <b className="mono">{counts.done}</b>
          <span>
            {counts.done > 1 ? "vidéos créées" : "vidéo créée"} sur{" "}
            {files.length || count}
          </span>
        </div>
        {files.length ? (
          <FileList files={files} onRedownload={props.onRedownload} />
        ) : null}
        <p className="xr-note xr-note--danger" role="alert">
          <XIcon name="alert" />
          <span>
            <b>La vidéo {failure.index + 1} n’a pas pu être fabriquée</b> :{" "}
            {failure.memory
              ? `le navigateur a manqué de mémoire en ${props.height}p à ${props.fps} im/s.`
              : failure.message}{" "}
            {counts.done > 0
              ? `${plural(counts.done, "vidéo est bien téléchargée", "vidéos sont bien téléchargées")}, rien n’est perdu.`
              : "Tes réglages et tes plages sont intacts."}
          </span>
        </p>
        <div className="xr-row">
          {props.canLighten ? (
            <button
              className="btn btn--primary"
              type="button"
              data-testid="video-resume-lighter"
              onClick={() => props.onResume(true)}
            >
              Reprendre en 1080p
            </button>
          ) : null}
          <button
            className={`btn ${props.canLighten ? "btn--ghost" : "btn--primary"}`}
            type="button"
            data-testid="video-resume"
            onClick={() => props.onResume(false)}
          >
            Reprendre tel quel
          </button>
        </div>
      </div>
    );
  return <IdleBordereau {...props} />;
}

function IdleBordereau(props: BordereauProps) {
  const { count, level } = props;
  return (
    <div className="xr-bord" data-testid="bord-idle">
      <div className="xr-big">
        <b className="mono">{count}</b>
        <span>{count > 1 ? "vidéos · une par plage" : "vidéo"}</span>
      </div>
      <dl>
        <dt>Durée totale</dt>
        <dd data-testid="bord-duration">{formatDurationFr(props.seconds)}</dd>
        <dt>Format</dt>
        <dd>
          {props.formatLabel} · {props.width} × {props.height}
        </dd>
        <dt>Fluidité</dt>
        <dd>{props.fps} images par seconde</dd>
        <dt>Poids estimé</dt>
        <dd
          className={`mono${level === "ok" ? "" : ` ${level === "danger" ? "danger" : "warn"}`}`}
          data-testid="bord-weight"
        >
          ≈ {megabytesFr(props.weight.totalMb)}
          {level !== "ok" ? ` · ${LEVEL_LABEL[level]}` : ""}
        </dd>
        <dt>Rendu</dt>
        <dd>{props.renderTime}, ici</dd>
      </dl>
      {level !== "ok" ? (
        <p className={`xr-note xr-note--${level}`}>
          <XIcon name="alert" />
          <span>
            {level === "danger" ? "Très lourd" : "Lourd"} pour un navigateur,
            surtout sur téléphone.{" "}
            {props.canLighten ? (
              <button
                type="button"
                className="xr-link"
                data-testid="video-lighten"
                onClick={props.onLighten}
              >
                Passer en 1080p · 30 im/s
              </button>
            ) : null}
          </span>
        </p>
      ) : null}
      <button
        className="btn btn--primary btn--lg btn--block"
        type="button"
        data-testid={props.primaryTestId}
        disabled={count === 0}
        onClick={props.onExport}
      >
        <XIcon name="download" />
        {count > 1 ? `Exporter ${count} vidéos` : "Exporter la vidéo"}
      </button>
      <p className="xr-namepat" data-testid="bord-filename">
        {props.firstFileName}
        {count > 1 ? " · …" : ""}
      </p>
      <details className="xr-api">
        <summary data-testid="api-toggle">
          <XIcon name="braces" />
          Même export par l’API (export_video)
        </summary>
        <pre data-testid="api-json">{props.apiJson}</pre>
      </details>
    </div>
  );
}

/** Barre basse sur téléphone : le résumé (ouvre la feuille) et l'action. */
export function ExportDock({
  props,
  onOpenSheet,
}: {
  props: BordereauProps;
  onOpenSheet: () => void;
}) {
  const { phase, count, files, failure } = props;
  const counts = progressCounts(files);
  const running = files.findIndex((f) => f.state === "run");
  const summary =
    phase === "loading"
      ? { title: "Chargement…", hint: "" }
      : phase === "empty"
        ? { title: "Rien à exporter", hint: "" }
        : phase === "render"
          ? {
              title: `Vidéo ${running < 0 ? counts.done : running + 1} sur ${files.length || count}${running >= 0 ? ` · ${Math.round(files[running].ratio * 100)} %` : ""}`,
              hint: "Garde cet onglet ouvert",
            }
          : phase === "done"
            ? {
                title: `${plural(counts.done, "vidéo prête", "vidéos prêtes")}`,
                hint: "Téléchargées",
              }
            : phase === "error" && failure
              ? {
                  title: `La vidéo ${failure.index + 1} a échoué`,
                  hint: failure.memory
                    ? "Mémoire du navigateur insuffisante"
                    : "Voir le détail",
                }
              : {
                  title: `${plural(count, "vidéo", "vidéos")} · ≈ ${megabytesFr(props.weight.totalMb)}`,
                  hint: `${props.height}p · ${props.fps} im/s · ${formatDurationFr(props.seconds)}${props.level === "ok" ? "" : ` · ${LEVEL_LABEL[props.level]}`}`,
                };
  return (
    <div className="xr-dock" data-testid="video-dock">
      <button
        type="button"
        className="sumbtn"
        aria-haspopup="dialog"
        data-testid="dock-summary"
        onClick={onOpenSheet}
      >
        <b>{summary.title}</b>
        {summary.hint ? (
          <small
            className={props.level !== "ok" && phase === "idle" ? "warn" : ""}
          >
            {summary.hint}
          </small>
        ) : null}
      </button>
      {phase === "idle" || phase === "empty" || phase === "loading" ? (
        <button
          type="button"
          className="btn btn--primary btn--lg"
          data-testid={props.primaryTestId}
          disabled={phase !== "idle" || count === 0}
          onClick={props.onExport}
        >
          Exporter
        </button>
      ) : phase === "render" && files.length > 1 ? (
        <button
          type="button"
          className="btn btn--secondary btn--lg"
          disabled={props.stopRequested}
          onClick={props.onStop}
        >
          Arrêter
        </button>
      ) : (
        <button
          type="button"
          className="btn btn--primary btn--lg"
          onClick={onOpenSheet}
        >
          Voir
        </button>
      )}
    </div>
  );
}

/** Feuille récapitulative (téléphone) : le même bordereau, au-dessus d'un voile ; Échap ferme. */
export function ExportSheet({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Même piège de focus que les tiroirs de l'atelier : Tab / Maj+Tab restent dans la feuille,
  // Échap la ferme, le focus revient au bouton qui l'a ouverte.
  useFocusTrap(ref, open, onClose);
  if (!open) return null;
  return (
    <>
      <div className="xr-scrim" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        className="xr-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Récapitulatif de l’export"
        tabIndex={-1}
        data-testid="video-sheet"
      >
        <div className="grab" aria-hidden="true" />
        {children}
      </div>
    </>
  );
}
