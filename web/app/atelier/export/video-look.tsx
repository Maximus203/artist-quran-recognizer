"use client";
import { useRef, useState } from "react";
import { accentSolidCss, DEFAULT_ACCENT } from "@/lib/export-video-accent";
import {
  FREE_IMAGE_SITES,
  GRADIENT_BACKGROUNDS,
  PHOTO_BACKGROUNDS,
  SOURCE_BACKGROUND_ID,
} from "@/lib/export-video-backgrounds";
import {
  ARABIC_SIZE_PRESETS,
  TRANSLATION_SIZE_PRESETS,
  type VideoPrefs,
} from "@/lib/export-video-prefs";
import { AccentDialog } from "./accent-dialog";
import { XIcon } from "./export-icons";
import { rovingKeys, Segmented, Switch } from "./export-ui";

/**
 * « À quoi elle ressemble » : format (tuiles avec silhouette), fond (bande défilante), taille de
 * l'arabe et place du texte (contrôles segmentés), traduction et onde ; le fin est replié
 * (tailles au point près, hauteur exacte, remplir, couleur d'accent).
 */
export const POSITIONS = [
  { id: "top", label: "Haut", value: 12 },
  { id: "middle", label: "Centre", value: 50 },
  { id: "bottom", label: "Bas", value: 88 },
] as const;
const ARABIC_RANGE = { min: 40, max: 240 };
const TRANSLATION_RANGE = { min: 16, max: 140 };

export const FORMATS = [
  { id: "16:9", label: "Horizontal", hint: "YouTube, écran", w: 36, h: 20 },
  { id: "9:16", label: "Vertical", hint: "Reels, Shorts", w: 18, h: 32 },
  { id: "1:1", label: "Carré", hint: "Publications", w: 26, h: 26 },
] as const;

export function formatName(orientation: VideoPrefs["orientation"]): string {
  return orientation === "source"
    ? "Comme la vidéo"
    : (FORMATS.find((f) => f.id === orientation)?.label ?? orientation);
}

export function backgroundName(id: string, hasUpload: boolean): string {
  if (hasUpload) return "Mon image";
  if (id === SOURCE_BACKGROUND_ID) return "Vidéo d’origine";
  if (id === "color") return "Couleur unie";
  return (
    [...PHOTO_BACKGROUNDS, ...GRADIENT_BACKGROUNDS].find((p) => p.id === id)
      ?.label ?? id
  );
}

export function sizeName(size: number): string {
  return (
    ARABIC_SIZE_PRESETS.find((p) => p.size === size)?.label.toLowerCase() ??
    `${size} pt`
  );
}

export function VideoLook({
  prefs,
  patch,
  isVideo,
  sourceSize,
  sourceUnreadable,
  selectedBg,
  upload,
  uploadThumb,
  onUpload,
  onChooseBg,
}: {
  prefs: VideoPrefs;
  patch: (next: Partial<VideoPrefs>) => void;
  isVideo: boolean;
  sourceSize: { width: number; height: number } | null;
  sourceUnreadable: boolean;
  selectedBg: string;
  upload: File | null;
  uploadThumb: string | null;
  onUpload: (file: File | null) => void;
  onChooseBg: (id: string) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [accentOpen, setAccentOpen] = useState(false);
  const formats = [
    ...FORMATS,
    ...(isVideo
      ? [
          {
            id: "source" as const,
            label: "Comme la vidéo",
            hint: sourceSize
              ? `${sourceSize.width} × ${sourceSize.height}`
              : "dimensions d’origine",
            w: 34,
            h: 20,
          },
        ]
      : []),
  ];
  const tile = (id: string) => ({
    role: "radio" as const,
    "aria-checked": selectedBg === id,
    tabIndex: selectedBg === id ? 0 : -1,
    className: "xr-bgt",
    "data-testid": `video-bg-${id}`,
  });
  return (
    <>
      <div className="xr-field">
        <span className="xr-cap" id="xr-format-h">
          Format
        </span>
        <div
          className="xr-formats"
          role="radiogroup"
          aria-labelledby="xr-format-h"
          data-count={formats.length}
          onKeyDown={rovingKeys}
        >
          {formats.map((f) => (
            <button
              key={f.id}
              type="button"
              role="radio"
              aria-checked={prefs.orientation === f.id}
              tabIndex={prefs.orientation === f.id ? 0 : -1}
              className="xr-fmt"
              data-testid={`video-orientation-${f.id}`}
              onClick={() => patch({ orientation: f.id })}
            >
              <span
                className="shape"
                style={{ width: f.w, height: f.h }}
                aria-hidden="true"
              />
              <b>{f.label}</b>
              <small>{f.hint}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="xr-field">
        <span className="xr-cap" id="xr-bg-h">
          Fond
        </span>
        {sourceUnreadable ? (
          <p className="xr-lead" data-testid="video-source-unreadable">
            La vidéo d’origine n’a pas pu servir de fond (ce navigateur ne la
            lit pas, ou elle ne contient que du son) : choisis un fond
            ci-dessous.
          </p>
        ) : null}
        <div
          className="xr-bgs"
          role="radiogroup"
          aria-labelledby="xr-bg-h"
          onKeyDown={rovingKeys}
        >
          <button
            type="button"
            {...tile("upload")}
            onClick={() => fileInput.current?.click()}
          >
            <span className="img">
              {uploadThumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={uploadThumb} alt="" width={96} height={64} />
              ) : (
                <XIcon name="plus" />
              )}
            </span>
            <span className="nm">
              {upload ? upload.name : "Ma propre image"}
            </span>
          </button>
          {isVideo ? (
            <button
              type="button"
              {...tile(SOURCE_BACKGROUND_ID)}
              onClick={() => onChooseBg(SOURCE_BACKGROUND_ID)}
            >
              <span className="img img--source">
                <XIcon name="play" />
              </span>
              <span className="nm">Vidéo d’origine</span>
            </button>
          ) : null}
          {PHOTO_BACKGROUNDS.map((p) => (
            <button
              key={p.id}
              type="button"
              {...tile(p.id)}
              onClick={() => onChooseBg(p.id)}
            >
              <span className="img">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.thumb}
                  alt=""
                  loading="lazy"
                  width={96}
                  height={64}
                />
              </span>
              <span className="nm">{p.label}</span>
            </button>
          ))}
          {GRADIENT_BACKGROUNDS.map((p) => (
            <button
              key={p.id}
              type="button"
              {...tile(p.id)}
              onClick={() => onChooseBg(p.id)}
            >
              <span
                className="img"
                style={{
                  background: `radial-gradient(circle at 50% 38%, ${p.glow}, transparent 70%), linear-gradient(${p.from}, ${p.to})`,
                }}
              />
              <span className="nm">{p.label}</span>
            </button>
          ))}
          <label {...tile("color")} data-testid="video-bg-color">
            <span className="img" style={{ background: prefs.bg }}>
              <input
                type="color"
                value={prefs.bg}
                aria-label="Couleur unie du fond"
                data-testid="video-color-bg"
                onChange={(e) => {
                  onUpload(null);
                  patch({ bg: e.target.value, background: "color" });
                }}
                onClick={() => {
                  onUpload(null);
                  patch({ background: "color" });
                }}
              />
            </span>
            <span className="nm">Couleur unie</span>
          </label>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          data-testid="video-bg-image"
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null;
            if (file) onUpload(file);
            e.target.value = "";
          }}
        />
        <p className="xr-lead xr-small">
          Photos libres de droits (Pexels, crédits dans le dépôt). Plus de choix
          :
          {FREE_IMAGE_SITES.map((site, i) => (
            <span key={site.name}>
              {i === 0 ? " " : " · "}
              <a href={site.url} target="_blank" rel="noopener noreferrer">
                {site.name}
              </a>
            </span>
          ))}
          , puis « Ma propre image ».
          {upload ? (
            <>
              {" "}
              <button
                type="button"
                className="xr-link"
                data-testid="video-bg-remove"
                onClick={() => onUpload(null)}
              >
                Retirer mon image
              </button>
            </>
          ) : null}
        </p>
      </div>

      <div className="xr-two">
        <div className="xr-field">
          <span className="xr-cap">Taille de l’arabe</span>
          <Segmented
            label="Taille de l’arabe"
            full
            items={ARABIC_SIZE_PRESETS.map((p) => ({
              value: p.size,
              label: p.label,
              id: p.id,
            }))}
            value={prefs.arabicSize}
            onPick={(size) => patch({ arabicSize: size })}
            testId="video-arabic"
          />
        </div>
        <div className="xr-field">
          <span className="xr-cap">Place du texte</span>
          <Segmented
            label="Place du texte"
            full
            items={POSITIONS.map((p) => ({
              value: p.value,
              label: p.label,
              id: p.id,
            }))}
            value={prefs.textPosition}
            onPick={(value) => patch({ textPosition: value })}
            testId="video-position"
          />
        </div>
      </div>
      <div className="xr-two">
        <Switch
          checked={prefs.showTranslation}
          testId="video-show-translation"
          onChange={(v) => patch({ showTranslation: v })}
          label="Afficher la traduction"
        />
        <Switch
          checked={prefs.showWave}
          testId="video-show-wave"
          onChange={(v) => patch({ showWave: v })}
          label="Onde audio en bas"
        />
      </div>

      <details className="xr-fine" data-testid="video-fine">
        <summary>
          <XIcon name="chev-r" />
          Réglages fins : tailles exactes, remplissage, couleur d’accent
        </summary>
        <div>
          <div className="xr-field">
            <span className="xr-cap">Taille de la traduction</span>
            <Segmented
              label="Taille de la traduction"
              full
              items={TRANSLATION_SIZE_PRESETS.map((p) => ({
                value: p.size,
                label: p.label,
                id: p.id,
              }))}
              value={prefs.translationSize}
              onPick={(size) => patch({ translationSize: size })}
              testId="video-translation"
            />
          </div>
          <label className="xr-rng">
            <span>
              Arabe <b className="mono">{prefs.arabicSize}</b>
            </span>
            <input
              type="range"
              min={ARABIC_RANGE.min}
              max={ARABIC_RANGE.max}
              step={2}
              value={prefs.arabicSize}
              data-testid="video-arabic-size"
              onChange={(e) => patch({ arabicSize: Number(e.target.value) })}
            />
          </label>
          <label className="xr-rng">
            <span>
              Traduction <b className="mono">{prefs.translationSize}</b>
            </span>
            <input
              type="range"
              min={TRANSLATION_RANGE.min}
              max={TRANSLATION_RANGE.max}
              step={1}
              value={prefs.translationSize}
              data-testid="video-translation-size"
              onChange={(e) =>
                patch({ translationSize: Number(e.target.value) })
              }
            />
          </label>
          <label className="xr-rng">
            <span>
              Hauteur du texte <b className="mono">{prefs.textPosition} %</b>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={prefs.textPosition}
              data-testid="video-position-fine"
              onChange={(e) => patch({ textPosition: Number(e.target.value) })}
            />
          </label>
          <Switch
            checked={prefs.fill}
            testId="video-fill"
            onChange={(v) => patch({ fill: v })}
            label="Remplir tout l’espace"
            hint="Les écritures grandissent jusqu’à occuper la vidéo ; un verset trop long est réduit, jamais coupé."
          />
          <button
            type="button"
            className="xr-accent-btn"
            data-testid="accent-open"
            onClick={() => setAccentOpen(true)}
          >
            <i
              style={{
                background: accentSolidCss(prefs.accent ?? DEFAULT_ACCENT),
                opacity: prefs.accent ? prefs.accent.a : 1,
              }}
              aria-hidden="true"
            />
            <span>
              Couleur d’accent
              <small>
                {prefs.accent
                  ? "personnalisée"
                  : "automatique, couleur principale du fond"}
              </small>
            </span>
          </button>
          <AccentDialog
            open={accentOpen}
            value={prefs.accent}
            onChange={(accent) => patch({ accent })}
            onClose={() => setAccentOpen(false)}
          />
        </div>
      </details>
    </>
  );
}
