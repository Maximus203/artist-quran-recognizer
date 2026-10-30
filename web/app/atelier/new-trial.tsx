"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { acceptedMediaFiles, mediaAccept } from "@/lib/audio-upload";
import { formatBytesFr } from "@/lib/format";
import { storageState, type Quota } from "@/lib/storage-meter";
import Recorder from "../recorder";
import { HeroWave } from "./hero-wave";
import { Icon } from "./icons";
import type { ImportItem, Visibility } from "./use-sessions";

type Props = {
  busy: boolean;
  items: readonly ImportItem[];
  onFiles: (files: File[]) => void;
  onFileWithResult: (audio: File, result: File) => void;
  onRecording: (file: File) => Promise<void>;
  onClear: () => void;
  onSeeQueue: () => void;
  error: string;
  /** Portée de l'essai (micro et import) : choisie ici, enregistrée comme préférence. */
  visibility: Visibility;
  onVisibility: (visibility: Visibility) => void;
  quota: Quota & { max_file_bytes: number; max_video_bytes: number };
};

const stateLabel: Record<ImportItem["state"], string> = {
  sending: "Envoi…",
  queued: "Dans la file d’analyse",
  ready: "Importé",
  error: "Échec",
};

export function NewTrial(props: Props) {
  const input = useRef<HTMLInputElement>(null);
  const audio = useRef<HTMLInputElement>(null);
  const result = useRef<HTMLInputElement>(null);
  const [pairError, setPairError] = useState("");
  const doneItems = props.items.filter((i) => i.state !== "sending");
  const space = storageState(props.quota);
  return (
    <div className="stack" data-testid="new-view">
      <div className="new">
        <header>
          <HeroWave />
          <h1>Nouvel essai</h1>
          <p className="lead">
            Enregistre une récitation ou dépose des audios et des vidéos. Chaque
            fichier part dans la file d’analyse ; tu peux fermer la page.
          </p>
        </header>
        <fieldset
          className="card visib"
          style={{ border: "1px solid var(--border)", margin: 0, minWidth: 0 }}
          data-testid="visibility"
        >
          <legend className="sr">Qui peut voir cet essai ?</legend>
          <p style={{ fontWeight: 700 }}>Qui peut voir cet essai ?</p>
          <div
            className="opts"
            role="radiogroup"
            aria-label="Portée de l’essai"
          >
            <button
              className="radio-card"
              type="button"
              role="radio"
              data-testid="visibility-global"
              aria-checked={props.visibility === "global"}
              onClick={() => props.onVisibility("global")}
            >
              <span className="radio" aria-hidden="true" />
              <b>
                <Icon name="globe" />
                Partagé
              </b>
              <span className="d">
                Tous les comptes de l’atelier l’écoutent et voient ses résultats
                et ses performances.
              </span>
            </button>
            <button
              className="radio-card"
              type="button"
              role="radio"
              data-testid="visibility-private"
              aria-checked={props.visibility === "private"}
              onClick={() => props.onVisibility("private")}
            >
              <span className="radio" aria-hidden="true" />
              <b>
                <Icon name="lock" />
                Privé{" "}
                <span
                  className="badge badge--plain badge--outline"
                  style={{ minHeight: 20, padding: "0 6px" }}
                >
                  par défaut
                </span>
              </b>
              <span className="d">
                Toi seul. Il n’apparaît pas dans les listes des autres testeurs.
              </span>
            </button>
          </div>
          <p
            className="quota-hint"
            data-testid="quota-hint"
            data-state={space.state}
          >
            <Icon name="drive" size={16} />
            <span>
              Espace utilisé :{" "}
              <b
                className="mono"
                style={{ fontWeight: 600, color: "var(--text)" }}
              >
                {formatBytesFr(props.quota.used_bytes)}
              </b>
              {props.quota.limit_bytes
                ? ` sur ${formatBytesFr(props.quota.limit_bytes)}`
                : ""}
            </span>
            {props.quota.limit_bytes ? (
              <span className="mini">
                <i
                  style={{ "--w": `${space.percent}%` } as React.CSSProperties}
                />
              </span>
            ) : null}
          </p>
          {space.state !== "ok" ? (
            <p className="notice notice--error" role="alert">
              {space.state === "full"
                ? "Quota atteint : les nouveaux imports sont bloqués. Supprime des sessions archivées pour libérer de la place."
                : "Espace presque plein : archive puis supprime les gros fichiers dont tu n’as plus besoin."}
            </p>
          ) : null}
          <p
            className="hint"
            style={{ fontSize: "var(--fs-xs)", color: "var(--text-3)" }}
          >
            Taille maximale d’un fichier :{" "}
            {formatBytesFr(props.quota.max_file_bytes)}
            {props.quota.max_video_bytes !== props.quota.max_file_bytes
              ? ` (audio), ${formatBytesFr(props.quota.max_video_bytes)} (vidéo)`
              : ""}
            .
          </p>
        </fieldset>
        <section className="live-card" data-testid="live-card">
          <span className="live-card-icon" aria-hidden="true">
            <Icon name="live" />
          </span>
          <div className="live-card-text">
            <h2>Écouter en direct</h2>
            <p>
              Le moteur nomme les versets pendant que tu récites. Le son n’est
              pas conservé.
            </p>
          </div>
          <Link
            className="btn btn--secondary"
            href="/direct"
            data-testid="live-open"
          >
            Écouter en direct
          </Link>
        </section>
        <Recorder onAnalyze={props.onRecording} />
        <div className="or">ou</div>
        <label className="drop" htmlFor="media-input" data-testid="drop-zone">
          <Icon name="upload" />
          <strong>Dépose des fichiers ici</strong>
          <span className="kinds">
            <span>
              <Icon name="audio" />
              mp3 · wav · m4a · ogg · webm
            </span>
            <span>
              <Icon name="video" />
              mp4 · mov · mkv
            </span>
          </span>
          <span className="btn btn--primary">Choisir des fichiers</span>
          <input
            ref={input}
            id="media-input"
            data-testid="media-input"
            className="sr"
            type="file"
            multiple
            accept={mediaAccept}
            onChange={(event) => {
              const files = acceptedMediaFiles(
                Array.from(event.target.files ?? []),
              );
              event.target.value = "";
              if (files.length) props.onFiles(files);
            }}
          />
        </label>
        {props.error ? (
          <p className="notice notice--error" role="alert">
            {props.error}
          </p>
        ) : null}
        {props.items.length > 0 ? (
          <div data-testid="import-queue">
            <ul className="import-queue">
              {props.items.map((item) => (
                <li key={item.key} data-state={item.state}>
                  <Icon
                    name={
                      item.state === "error"
                        ? "alert"
                        : item.state === "sending"
                          ? "upload"
                          : "check"
                    }
                  />
                  <span className="name">{item.name}</span>
                  <span className="muted">
                    {item.error ??
                      (item.state === "sending" && item.progress !== undefined
                        ? `Envoi… ${Math.round(item.progress * 100)} %`
                        : stateLabel[item.state])}
                  </span>
                </li>
              ))}
            </ul>
            {!props.busy && doneItems.length > 0 ? (
              <div className="btnrow" style={{ marginTop: "var(--sp-3)" }}>
                <button
                  type="button"
                  className="btn btn--secondary"
                  data-testid="see-queue"
                  onClick={props.onSeeQueue}
                >
                  Voir la file d’analyse
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={props.onClear}
                >
                  Effacer cette liste
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
        <details
          className="acc"
          style={{
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--r-md)",
            padding: "0 var(--sp-4)",
          }}
        >
          <summary>
            Importer aussi un résultat existant{" "}
            <span className="muted" style={{ fontWeight: 400 }}>
              · facultatif
            </span>
          </summary>
          <div className="acc-body">
            <p className="hint">
              Un fichier .json de résultat, avec l’audio auquel il correspond :
              l’empreinte SHA-256 est vérifiée, le moteur ne tourne pas.
            </p>
            <label className="field">
              Audio correspondant
              <input
                ref={audio}
                className="input"
                type="file"
                accept={mediaAccept}
                style={{ padding: 8 }}
              />
            </label>
            <label className="field">
              Résultat (.json)
              <input
                ref={result}
                className="input"
                type="file"
                accept=".json,application/json"
                style={{ padding: 8 }}
              />
            </label>
            {pairError ? (
              <p className="notice notice--error" role="alert">
                {pairError}
              </p>
            ) : null}
            <button
              type="button"
              className="btn btn--primary"
              data-testid="import-pair"
              disabled={props.busy}
              onClick={() => {
                const a = audio.current?.files?.[0];
                const r = result.current?.files?.[0];
                if (!a || !r) {
                  setPairError("Choisis l’audio et son résultat .json.");
                  return;
                }
                setPairError("");
                props.onFileWithResult(a, r);
              }}
            >
              Importer dans l’atelier
            </button>
          </div>
        </details>
        <div className="auto">
          <Icon name="wave" />
          <p>
            <b>Reconnaissance automatique.</b> FastConformer écoute tout ;
            Whisper et Muno réécoutent les passages douteux ; l’audio départage
            leurs propositions. Aucun choix à faire. Fichiers conservés
            localement, hors Git.
          </p>
        </div>
      </div>
    </div>
  );
}
