"use client";
import { useState } from "react";
import {
  announceVideosChanged,
  deleteSavedVideo,
  savedVideoUrl,
  type SavedVideo,
} from "@/lib/export-video-library";
import { formatBytesFr } from "@/lib/format";

const dateFr = (iso: string) =>
  new Date(iso).toLocaleString("fr-FR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * « Vidéos de cet enregistrement » : celles déjà fabriquées et gardées sur le serveur. On les lit, on les
 * télécharge sans les refaire, et on les supprime pour libérer de l'espace. Un nouvel export identique à
 * l'une d'elles la récupère au lieu de la refaire, sauf si « Refaire même si elle existe » est coché.
 */
export function VideoLibrary({
  sessionId,
  videos,
  totalBytes,
  loaded,
  canEdit,
  reuse,
  onReuse,
  onError,
}: {
  sessionId: string;
  videos: SavedVideo[];
  totalBytes: number;
  loaded: boolean;
  canEdit: boolean;
  reuse: boolean;
  onReuse: (reuse: boolean) => void;
  onError: (message: string) => void;
}) {
  const [playing, setPlaying] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const remove = async (video: SavedVideo) => {
    setBusy(video.id);
    try {
      await deleteSavedVideo(sessionId, video.id);
      if (playing === video.id) setPlaying(null);
      announceVideosChanged();
    } catch (error) {
      onError(
        error instanceof Error ? error.message : "Suppression impossible.",
      );
    } finally {
      setBusy(null);
      setAsking(null);
    }
  };

  if (!loaded || videos.length === 0) return null;
  return (
    <section
      className="xv-lib"
      aria-labelledby="xv-lib-title"
      data-testid="video-library"
    >
      <header className="xv-lib__head">
        <h3 id="xv-lib-title">Vidéos de cet enregistrement</h3>
        <p>
          {videos.length} {videos.length > 1 ? "vidéos" : "vidéo"} sur le
          serveur · {formatBytesFr(totalBytes)}
        </p>
      </header>
      <label className="xv-lib__reuse">
        <input
          type="checkbox"
          checked={!reuse}
          onChange={(e) => onReuse(!e.target.checked)}
        />
        <span>
          Refaire même si une vidéo identique existe déjà
          <small>
            Par défaut, une vidéo identique (mêmes réglages, même plage) est
            récupérée sans être refaite.
          </small>
        </span>
      </label>
      <ul className="xv-lib__list">
        {videos.map((video) => (
          <li key={video.id} className="xv-lib__item" data-testid="saved-video">
            <div className="xv-lib__meta">
              <b>{video.name}</b>
              <span>
                {video.label ? `${video.label} · ` : ""}
                {formatBytesFr(video.bytes)} · {dateFr(video.created_at)}
              </span>
            </div>
            <div className="xv-lib__actions">
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                aria-expanded={playing === video.id}
                onClick={() =>
                  setPlaying(playing === video.id ? null : video.id)
                }
              >
                {playing === video.id ? "Fermer" : "Lire"}
              </button>
              <a
                className="btn btn--ghost btn--sm"
                href={savedVideoUrl(sessionId, video.id, true)}
                download={video.name}
              >
                Télécharger
              </a>
              {canEdit ? (
                asking === video.id ? (
                  <>
                    <button
                      type="button"
                      className="btn btn--danger btn--sm"
                      disabled={busy === video.id}
                      onClick={() => void remove(video)}
                    >
                      Supprimer pour de bon
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => setAsking(null)}
                    >
                      Garder
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => setAsking(video.id)}
                  >
                    Supprimer
                  </button>
                )
              ) : null}
            </div>
            {playing === video.id ? (
              <video
                className="xv-lib__player"
                controls
                autoPlay
                playsInline
                preload="metadata"
                src={savedVideoUrl(sessionId, video.id)}
              />
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
