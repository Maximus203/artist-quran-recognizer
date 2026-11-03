"use client";
import { useRef, useState } from "react";
import { accentSolidCss, DEFAULT_ACCENT } from "@/lib/export-video-accent";
import {
  FREE_IMAGE_SITES,
  GRADIENT_BACKGROUNDS,
  PHOTO_BACKGROUNDS,
  SOURCE_BACKGROUND_ID,
} from "@/lib/export-video-backgrounds";
import { sizePercent, stepSize } from "@/lib/export-video-edit";
import {
  currentTextPosition,
  moveAllTextStacks,
  SIZE_LIMITS,
  type TextBlockId,
} from "@/lib/export-video-model";
import type { VideoPrefs } from "@/lib/export-video-prefs";
import { AccentDialog } from "./accent-dialog";
import { XIcon } from "./export-icons";
import { rovingKeys, Segmented, Switch } from "./export-ui";

/**
 * « À quoi elle ressemble » : format (tuiles avec silhouette), fond (bande défilante), taille de
 * l'arabe (boutons − / +) et place du texte (contrôle segmenté), traduction et onde ; le fin est replié
 * (tailles au pourcent près, hauteur exacte, remplir, couleur d'accent).
 *
 * Écran de TRANSITION : les éditeurs interactifs (plateau, table de montage, pas à pas) le remplacent.
 * Il ne règle que ce que l'ancien formulaire réglait, sur le modèle à blocs : un geste ici déplace ou
 * dimensionne les mêmes boîtes que les éditeurs.
 */
export const POSITIONS = [
  { id: "top", label: "Haut", value: 12 },
  { id: "middle", label: "Centre", value: 50 },
  { id: "bottom", label: "Bas", value: 88 },
] as const;
/** Bornes des curseurs de taille, en pourcents de la taille par défaut. */
const SIZE_PERCENT = {
  min: Math.round(SIZE_LIMITS.min * 100),
  max: Math.round(SIZE_LIMITS.max * 100),
};

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

/** Taille d'un texte en pourcentage de sa taille par défaut (« 106 % »). */
export function sizeLabel(size: number): string {
  return `${sizePercent(size)} %`;
}

/** Boutons − / + (≈ 6 % par appui) : la taille relative d'un texte ; le pourcentage remet à 100 %. */
function SizeStepper({
  label,
  size,
  onChange,
  testId,
}: {
  label: string;
  size: number;
  onChange: (size: number) => void;
  testId: string;
}) {
  return (
    <div className="xr-seg xr-seg--full" role="group" aria-label={label}>
      <button
        type="button"
        aria-label={`${label} : plus petit`}
        data-testid={`${testId}-down`}
        disabled={size <= SIZE_LIMITS.min}
        onClick={() => onChange(stepSize(size, -1))}
      >
        −
      </button>
      <button
        type="button"
        aria-label={`${label} : ${sizeLabel(size)}. Remettre à 100 %`}
        data-testid={`${testId}-value`}
        onClick={() => onChange(1)}
      >
        {sizeLabel(size)}
      </button>
      <button
        type="button"
        aria-label={`${label} : plus grand`}
        data-testid={`${testId}-up`}
        disabled={size >= SIZE_LIMITS.max}
        onClick={() => onChange(stepSize(size, 1))}
      >
        +
      </button>
    </div>
  );
}

export function VideoLook({
  prefs,
  patch,
  isVideo,
  sourceSize,
  sourceUnreadable,
  previewUnavailable,
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
  previewUnavailable: boolean;
  selectedBg: string;
  upload: File | null;
  uploadThumb: string | null;
  onUpload: (file: File | null) => void;
  onChooseBg: (id: string) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [accentOpen, setAccentOpen] = useState(false);
  const { styles } = prefs;
  const setStyle = (
    block: TextBlockId,
    change: Partial<(typeof styles)[TextBlockId]>,
  ) =>
    patch({ styles: { ...styles, [block]: { ...styles[block], ...change } } });
  /** La taille de l'arabe entraîne celle de la référence (comme avant le modèle à blocs). */
  const setArabicSize = (size: number) =>
    patch({
      styles: {
        ...styles,
        arabic: { ...styles.arabic, size },
        ref: { ...styles.ref, size },
      },
    });
  const position = Math.round(
    currentTextPosition(prefs.layouts, prefs.orientation, prefs.showWave) * 100,
  );
  const setPosition = (value: number) =>
    patch({
      layouts: moveAllTextStacks(prefs.layouts, value / 100, prefs.showWave),
    });
  const fillAll = styles.arabic.fill && styles.translation.fill;
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
            Cet enregistrement n’a pas d’image (il ne contient que du son) :
            choisis un fond ci-dessous.
          </p>
        ) : null}
        {previewUnavailable ? (
          <p className="xr-lead" data-testid="video-preview-unavailable">
            L’aperçu n’affiche pas encore l’image de la vidéo (ton appareil ne
            la lit pas, ou elle est en préparation sur le serveur), mais
            l’export la reprendra bien.
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
          <SizeStepper
            label="Taille de l’arabe"
            size={styles.arabic.size}
            onChange={setArabicSize}
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
            value={position}
            onPick={setPosition}
            testId="video-position"
          />
        </div>
      </div>
      <div className="xr-two">
        <Switch
          checked={prefs.showArabic}
          testId="video-show-arabic"
          onChange={(v) => patch({ showArabic: v })}
          label="Afficher l’écriture arabe"
          disabled={prefs.showArabic && !prefs.showTranslation}
          hint={
            prefs.showArabic && !prefs.showTranslation
              ? "Une des deux écritures reste affichée"
              : undefined
          }
        />
        <Switch
          checked={prefs.showTranslation}
          testId="video-show-translation"
          onChange={(v) => patch({ showTranslation: v })}
          label="Afficher la traduction"
          disabled={prefs.showTranslation && !prefs.showArabic}
          hint={
            prefs.showTranslation && !prefs.showArabic
              ? "Une des deux écritures reste affichée"
              : undefined
          }
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
            <SizeStepper
              label="Taille de la traduction"
              size={styles.translation.size}
              onChange={(size) => setStyle("translation", { size })}
              testId="video-translation"
            />
          </div>
          <label className="xr-rng">
            <span>
              Arabe <b className="mono">{sizeLabel(styles.arabic.size)}</b>
            </span>
            <input
              type="range"
              min={SIZE_PERCENT.min}
              max={SIZE_PERCENT.max}
              step={1}
              value={sizePercent(styles.arabic.size)}
              data-testid="video-arabic-size"
              onChange={(e) => setArabicSize(Number(e.target.value) / 100)}
            />
          </label>
          <label className="xr-rng">
            <span>
              Traduction{" "}
              <b className="mono">{sizeLabel(styles.translation.size)}</b>
            </span>
            <input
              type="range"
              min={SIZE_PERCENT.min}
              max={SIZE_PERCENT.max}
              step={1}
              value={sizePercent(styles.translation.size)}
              data-testid="video-translation-size"
              onChange={(e) =>
                setStyle("translation", { size: Number(e.target.value) / 100 })
              }
            />
          </label>
          <label className="xr-rng">
            <span>
              Hauteur du texte <b className="mono">{position} %</b>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={position}
              data-testid="video-position-fine"
              onChange={(e) => setPosition(Number(e.target.value))}
            />
          </label>
          <Switch
            checked={fillAll}
            testId="video-fill"
            onChange={(v) =>
              patch({
                styles: {
                  ...styles,
                  arabic: { ...styles.arabic, fill: v },
                  translation: { ...styles.translation, fill: v },
                },
              })
            }
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
