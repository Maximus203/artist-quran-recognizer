"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import { videoCardInputs } from "@/lib/export-video-cards";
import {
  chooseBackground,
  FREE_IMAGE_SITES,
  GRADIENT_BACKGROUNDS,
  PHOTO_BACKGROUNDS,
  SOURCE_BACKGROUND_ID,
  type GradientBackground,
} from "@/lib/export-video-backgrounds";
import { isVideoExtension, loadSourceVideo } from "@/lib/export-video-assets";
import {
  ARABIC_SIZE_PRESETS,
  DEFAULT_VIDEO_PREFS,
  loadVideoPrefs,
  saveVideoPrefs,
  TRANSLATION_SIZE_PRESETS,
  type VideoPrefs,
} from "@/lib/export-video-prefs";
import { renderSessionVideo } from "@/lib/export-video-render";
import type { ListeningPeaks } from "@/lib/listening";
import type { Interval, Recognition } from "@/lib/recognition";
import { VideoPreview } from "./video-preview";

/**
 * Onglet « Vidéo » de l'export : formulaire indépendant de celui des sous-titres. Tout se règle
 * en regardant l'aperçu : format (horizontal / vertical / carré / comme la vidéo importée),
 * taille de l'arabe et de la traduction, traduction affichée ou non, fond (dégradés et photos
 * libres proposés, image à téléverser, couleur unie). Les réglages se mémorisent (préférences
 * du navigateur, comme les réglages de sous-titres).
 */

type Phase = "idle" | "busy" | "done" | "error";

const ORIENTATIONS = [
  { id: "16:9", label: "Horizontal", hint: "16:9 · YouTube, écran" },
  { id: "9:16", label: "Vertical", hint: "9:16 · Reels, Shorts, TikTok" },
  { id: "1:1", label: "Carré", hint: "1:1 · publications" },
] as const;

const ARABIC_RANGE = { min: 40, max: 140 };
const TRANSLATION_RANGE = { min: 16, max: 64 };

function SizeChips({
  label,
  testId,
  presets,
  value,
  onPick,
}: {
  label: string;
  testId: string;
  presets: readonly { id: string; label: string; size: number }[];
  value: number;
  onPick: (size: number) => void;
}) {
  return (
    <div className="ex-video-size">
      <span className="ex-video-size-label">{label}</span>
      <div
        className="ex-seg-tabs ex-seg-tabs--wrap"
        role="radiogroup"
        aria-label={label}
      >
        {presets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            role="radio"
            aria-checked={value === preset.size}
            data-testid={`${testId}-${preset.id}`}
            className={value === preset.size ? "is-active" : undefined}
            onClick={() => onPick(preset.size)}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function VideoPanel({
  sessionId,
  onError,
}: {
  sessionId: string;
  onError: (message: string) => void;
}) {
  const [prefs, setPrefs] = useState<VideoPrefs>(DEFAULT_VIDEO_PREFS);
  const [prefsReady, setPrefsReady] = useState(false);
  const [isVideo, setIsVideo] = useState(false);
  const [videoChecked, setVideoChecked] = useState(false);
  const [videoCandidate, setVideoCandidate] = useState(false);
  const [intervals, setIntervals] = useState<readonly Interval[] | null>(null);
  const [peaks, setPeaks] = useState<ListeningPeaks | null>(null);
  const [sourceSize, setSourceSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [bgFile, setBgFile] = useState<File | null>(null);
  const [bgThumb, setBgThumb] = useState<string | null>(null);
  const thumbUrl = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setPrefs(loadVideoPrefs());
    setPrefsReady(true);
    let cancelled = false;
    Promise.all([
      api<{ session: { extension?: string }; result: Recognition | null }>(
        `/api/sessions/${sessionId}`,
      ),
      api<ListeningPeaks>(`/api/sessions/${sessionId}/peaks`).catch(() => null),
    ])
      .then(([data, peakData]) => {
        if (cancelled) return;
        const candidate = isVideoExtension(data.session.extension ?? "");
        setVideoCandidate(candidate);
        setIntervals(data.result?.intervals ?? []);
        setPeaks(peakData);
        if (candidate)
          void loadSourceVideo(sessionId).then((element) => {
            if (cancelled) return;
            setVideoChecked(true);
            if (!element) return;
            setIsVideo(true);
            setSourceSize({
              width: element.videoWidth,
              height: element.videoHeight,
            });
            element.removeAttribute("src");
            element.load();
          });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const cardCount = useMemo(
    () => (intervals ? videoCardInputs(intervals).length : null),
    [intervals],
  );

  const patch = useCallback((next: Partial<VideoPrefs>) => {
    setPrefs((current) => {
      const value = { ...current, ...next };
      saveVideoPrefs(value);
      return value;
    });
  }, []);

  const pickUpload = useCallback((file: File | null) => {
    if (thumbUrl.current) URL.revokeObjectURL(thumbUrl.current);
    setBgFile(file);
    if (file) {
      thumbUrl.current = URL.createObjectURL(file);
      setBgThumb(thumbUrl.current);
    } else {
      thumbUrl.current = null;
      setBgThumb(null);
    }
  }, []);

  useEffect(
    () => () => {
      if (thumbUrl.current) URL.revokeObjectURL(thumbUrl.current);
    },
    [],
  );

  /** Choisir un fond proposé retire l'image téléversée : un seul fond à la fois. */
  const chooseTile = useCallback(
    (id: string) => {
      pickUpload(null);
      patch({ background: id });
    },
    [patch, pickUpload],
  );

  const choice = chooseBackground(prefs.background, {
    hasUpload: bgFile !== null,
    isVideo,
  });
  const selectedId =
    choice.kind === "upload"
      ? "upload"
      : choice.kind === "source"
        ? SOURCE_BACKGROUND_ID
        : choice.kind === "color"
          ? "color"
          : choice.preset.id;

  const exportVideo = useCallback(async () => {
    setPhase("busy");
    setMessage(null);
    try {
      await renderSessionVideo({
        sessionId,
        prefs,
        bgImage: bgFile,
        onProgress: (text) => setMessage(text),
      });
      setPhase("done");
      setMessage("Vidéo téléchargée.");
    } catch (error) {
      setPhase("error");
      const text =
        error instanceof Error ? error.message : "Export vidéo impossible.";
      setMessage(text);
      onError(text);
    }
  }, [bgFile, onError, prefs, sessionId]);

  const busy = phase === "busy";
  const orientationLabel =
    prefs.orientation === "source" ? "Comme la vidéo importée" : null;

  return (
    <div className="ex-video" data-testid="video-panel">
      <h2 id="ex-video-h">
        Votre <em>vidéo</em>
      </h2>
      <p className="ex-video-lead">
        Une vidéo MP4 de la session : le verset s&rsquo;affiche, le mot récité
        est surligné comme à l&rsquo;écran, et l&rsquo;onde audio défile en bas.
        Réglez tout en regardant l&rsquo;aperçu.
      </p>

      <VideoPreview
        sessionId={sessionId}
        intervals={intervals}
        peaks={peaks}
        prefs={prefs}
        upload={bgFile}
        isVideo={isVideo}
        sourceSize={sourceSize}
      />

      <fieldset className="ex-video-row">
        <legend className="ex-video-legend">1 · Format</legend>
        <div
          className="ex-video-formats"
          role="radiogroup"
          aria-label="Format de la vidéo"
        >
          {ORIENTATIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={prefs.orientation === item.id}
              data-testid={`video-orientation-${item.id}`}
              className={`ex-video-format${prefs.orientation === item.id ? " is-active" : ""}`}
              onClick={() => patch({ orientation: item.id })}
            >
              <span
                className={`ex-video-format-shape ex-video-format-shape--${item.id.replace(":", "-")}`}
                aria-hidden="true"
              />
              <b>{item.label}</b>
              <small>{item.hint}</small>
            </button>
          ))}
          {isVideo ? (
            <button
              type="button"
              role="radio"
              aria-checked={prefs.orientation === "source"}
              data-testid="video-orientation-source"
              className={`ex-video-format${prefs.orientation === "source" ? " is-active" : ""}`}
              onClick={() => patch({ orientation: "source" })}
            >
              <span
                className="ex-video-format-shape ex-video-format-shape--source"
                aria-hidden="true"
              />
              <b>{orientationLabel ?? "Comme la vidéo importée"}</b>
              <small>
                {sourceSize
                  ? `${sourceSize.width} × ${sourceSize.height}`
                  : "dimensions d'origine"}
              </small>
            </button>
          ) : null}
        </div>
      </fieldset>

      <fieldset className="ex-video-row">
        <legend className="ex-video-legend">2 · Écritures</legend>
        <SizeChips
          label="Texte arabe"
          testId="video-arabic"
          presets={ARABIC_SIZE_PRESETS}
          value={prefs.arabicSize}
          onPick={(size) => patch({ arabicSize: size })}
        />
        <SizeChips
          label="Traduction"
          testId="video-translation"
          presets={TRANSLATION_SIZE_PRESETS}
          value={prefs.translationSize}
          onPick={(size) => patch({ translationSize: size })}
        />
        <label className="ex-video-check">
          <input
            type="checkbox"
            checked={prefs.showTranslation}
            data-testid="video-show-translation"
            onChange={(event) =>
              patch({ showTranslation: event.target.checked })
            }
          />
          <span>Afficher la traduction</span>
        </label>
        <details className="ex-video-fine">
          <summary>Réglage précis</summary>
          <label className="ex-video-slider">
            <span>
              Arabe&nbsp;: <b className="mono">{prefs.arabicSize}</b>
            </span>
            <input
              type="range"
              min={ARABIC_RANGE.min}
              max={ARABIC_RANGE.max}
              step={2}
              value={prefs.arabicSize}
              data-testid="video-arabic-size"
              onChange={(event) =>
                patch({ arabicSize: Number(event.target.value) })
              }
            />
          </label>
          <label className="ex-video-slider">
            <span>
              Traduction&nbsp;: <b className="mono">{prefs.translationSize}</b>
            </span>
            <input
              type="range"
              min={TRANSLATION_RANGE.min}
              max={TRANSLATION_RANGE.max}
              step={1}
              value={prefs.translationSize}
              data-testid="video-translation-size"
              onChange={(event) =>
                patch({ translationSize: Number(event.target.value) })
              }
            />
          </label>
        </details>
        <p className="ex-micro">
          Si un verset est trop long, la vidéo réduit l&rsquo;écriture pour que
          tout reste lisible, sans jamais couper le texte.
        </p>
      </fieldset>

      <fieldset className="ex-video-row">
        <legend className="ex-video-legend">3 · Fond</legend>
        {videoCandidate && videoChecked && !isVideo ? (
          <p className="ex-micro" data-testid="video-source-unreadable">
            La vidéo d&rsquo;origine n&rsquo;a pas pu servir de fond (ce
            navigateur ne la lit pas, ou elle ne contient que du son) :
            choisissez un fond ci-dessous.
          </p>
        ) : null}
        <div
          className="ex-bg-grid"
          role="radiogroup"
          aria-label="Fond de la vidéo"
        >
          <button
            type="button"
            role="radio"
            aria-checked={selectedId === "upload"}
            data-testid="video-bg-upload"
            className={`ex-bg-tile ex-bg-tile--upload${selectedId === "upload" ? " is-active" : ""}`}
            onClick={() => fileInput.current?.click()}
          >
            {bgThumb ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={bgThumb} alt="" />
            ) : (
              <span className="ex-bg-plus" aria-hidden="true">
                +
              </span>
            )}
            <span className="ex-bg-name">
              {bgFile ? bgFile.name : "Ma propre image"}
            </span>
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            data-testid="video-bg-image"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              if (file) pickUpload(file);
              event.target.value = "";
            }}
          />

          {isVideo ? (
            <button
              type="button"
              role="radio"
              aria-checked={selectedId === SOURCE_BACKGROUND_ID}
              data-testid="video-bg-source"
              className={`ex-bg-tile ex-bg-tile--source${selectedId === SOURCE_BACKGROUND_ID ? " is-active" : ""}`}
              onClick={() => chooseTile(SOURCE_BACKGROUND_ID)}
            >
              <span className="ex-bg-plus" aria-hidden="true">
                ▶
              </span>
              <span className="ex-bg-name">Vidéo d&rsquo;origine</span>
            </button>
          ) : null}

          {GRADIENT_BACKGROUNDS.map((preset: GradientBackground) => (
            <button
              key={preset.id}
              type="button"
              role="radio"
              aria-checked={selectedId === preset.id}
              data-testid={`video-bg-${preset.id}`}
              className={`ex-bg-tile${selectedId === preset.id ? " is-active" : ""}`}
              onClick={() => chooseTile(preset.id)}
            >
              <span
                className="ex-bg-swatch"
                style={{
                  background: `radial-gradient(circle at 50% 38%, ${preset.glow}, transparent 70%), linear-gradient(${preset.from}, ${preset.to})`,
                }}
              />
              <span className="ex-bg-name">{preset.label}</span>
            </button>
          ))}

          {PHOTO_BACKGROUNDS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              role="radio"
              aria-checked={selectedId === preset.id}
              data-testid={`video-bg-${preset.id}`}
              className={`ex-bg-tile${selectedId === preset.id ? " is-active" : ""}`}
              onClick={() => chooseTile(preset.id)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preset.thumb} alt="" loading="lazy" />
              <span className="ex-bg-name">{preset.label}</span>
            </button>
          ))}

          <label
            className={`ex-bg-tile ex-bg-tile--color${selectedId === "color" ? " is-active" : ""}`}
          >
            <input
              type="color"
              value={prefs.bg}
              data-testid="video-color-bg"
              onChange={(event) =>
                patch({ bg: event.target.value, background: "color" })
              }
              onClick={() => {
                pickUpload(null);
                patch({ background: "color" });
              }}
            />
            <span className="ex-bg-name">Couleur unie</span>
          </label>
        </div>
        {bgFile ? (
          <button
            type="button"
            className="btn btn--ghost"
            data-testid="video-bg-remove"
            onClick={() => pickUpload(null)}
          >
            Retirer mon image
          </button>
        ) : null}
        <p className="ex-micro">
          Photos libres de droits (Pexels). Plus de choix&nbsp;:
          {FREE_IMAGE_SITES.map((site, index) => (
            <span key={site.name}>
              {index === 0 ? " " : " · "}
              <a
                href={site.url}
                target="_blank"
                rel="noopener noreferrer"
                data-testid={`video-bg-site-${site.name.toLowerCase()}`}
              >
                {site.name}
              </a>
              <span className="ex-video-site-note"> ({site.note})</span>
            </span>
          ))}
          . Téléchargez l&rsquo;image, puis ajoutez-la avec « Ma propre image ».
        </p>
      </fieldset>

      <div className="ex-video-foot">
        <button
          type="button"
          className="btn btn--primary btn--lg btn--block"
          data-testid="video-export"
          disabled={busy || !prefsReady || cardCount === 0}
          onClick={() => void exportVideo()}
        >
          {busy ? "Création de la vidéo…" : "Exporter la vidéo"}
        </button>
        <p className="ex-micro" role={phase === "error" ? "alert" : "status"}>
          {busy && message
            ? message
            : (message ??
              (cardCount === null
                ? "Comptage des passages…"
                : cardCount === 0
                  ? "Aucun passage coranique avec texte à montrer."
                  : `${cardCount} passage${cardCount > 1 ? "s" : ""} affiché${cardCount > 1 ? "s" : ""} dans la vidéo. Vos réglages sont mémorisés pour la prochaine fois.`))}
        </p>
      </div>
    </div>
  );
}
