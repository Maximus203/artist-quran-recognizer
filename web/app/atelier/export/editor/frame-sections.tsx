"use client";
import { useEffect, useRef, type ReactNode } from "react";
import {
  FREE_IMAGE_SITES,
  GRADIENT_BACKGROUNDS,
  PHOTO_BACKGROUNDS,
  SOURCE_BACKGROUND_ID,
} from "@/lib/export-video-backgrounds";
import { applyBackgroundPanels } from "@/lib/export-video-model";
import type { VideoPrefs } from "@/lib/export-video-prefs";
import { XIcon } from "../export-icons";
import { rovingKeys } from "../export-ui";
import type { FrameControls, PatchPrefs } from "./editor-types";
import { Field } from "./text-sections";

/**
 * Les sections du CADRE (ce qui concerne toute la vidéo, quand aucun élément n'est choisi) : Format, Fond,
 * Passages, Réglages avancés. Les mêmes composants servent la feuille du téléphone, l'inspecteur du bureau
 * et les autres éditeurs. Langage courant ; la qualité, la fluidité et le poids sont rangés sous « Réglages
 * avancés ».
 */

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
  if (id === "video") return "Ma vidéo";
  return (
    [...PHOTO_BACKGROUNDS, ...GRADIENT_BACKGROUNDS].find((p) => p.id === id)
      ?.label ?? id
  );
}

// ── format ──────────────────────────────────────────────────────────────────

/** Le format de la vidéo : chaque forme de cadre garde sa propre mise en page. */
export function FormatSection({
  orientation,
  isVideo,
  sourceSize,
  onPick,
}: {
  orientation: VideoPrefs["orientation"];
  isVideo: boolean;
  sourceSize: { width: number; height: number } | null;
  onPick: (orientation: VideoPrefs["orientation"]) => void;
}) {
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
  return (
    <Field title="Format de la vidéo" id="xe-format-h">
      <div
        className="xr-formats xe-formats"
        role="radiogroup"
        aria-labelledby="xe-format-h"
        data-count={formats.length}
        onKeyDown={rovingKeys}
      >
        {formats.map((f) => (
          <button
            key={f.id}
            type="button"
            role="radio"
            aria-checked={orientation === f.id}
            tabIndex={orientation === f.id ? 0 : -1}
            className="xr-fmt"
            data-testid={`video-orientation-${f.id}`}
            onClick={() => onPick(f.id)}
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
      <p className="xe-hint">
        Chaque format garde sa mise en page : tu peux régler le vertical sans
        toucher à l’horizontal.
      </p>
    </Field>
  );
}

// ── fond ────────────────────────────────────────────────────────────────────

/**
 * Le fond de la vidéo : une photo proposée, un dégradé, une couleur unie, ta propre image, la vidéo
 * d'origine d'une session vidéo. L'EMPLACEMENT « Ma propre vidéo » (choix du fichier, boucle, portion) se
 * trouve en bas de cette section : il est rempli par `frame.backgroundVideo` quand la phase « fond vidéo »
 * est présente.
 */
export function BackgroundSection({
  prefs,
  patch,
  frame,
}: {
  prefs: VideoPrefs;
  patch: PatchPrefs;
  frame: FrameControls;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const tile = (id: string) => ({
    role: "radio" as const,
    "aria-checked": frame.selectedBg === id,
    tabIndex: frame.selectedBg === id ? 0 : -1,
    className: "xr-bgt",
    "data-testid": `video-bg-${id}`,
  });
  const pickColor = (hex: string) => {
    frame.onUpload(null);
    patch((current) => ({
      bg: hex,
      background: "color",
      styles: applyBackgroundPanels(
        current.styles,
        current.background,
        "color",
      ),
    }));
  };
  return (
    <Field title="Fond de la vidéo" id="xe-bg-h">
      {frame.sourceUnreadable ? (
        <p className="xr-lead" data-testid="video-source-unreadable">
          Cet enregistrement n’a pas d’image (il ne contient que du son) :
          choisis un fond ci-dessous.
        </p>
      ) : null}
      {frame.previewUnavailable ? (
        <p className="xr-lead" data-testid="video-preview-unavailable">
          L’aperçu n’affiche pas encore l’image de la vidéo (ton appareil ne la
          lit pas, ou elle est en préparation sur le serveur), mais l’export la
          reprendra bien.
        </p>
      ) : null}
      <div
        className="xr-bgs"
        role="radiogroup"
        aria-labelledby="xe-bg-h"
        onKeyDown={rovingKeys}
      >
        <button
          type="button"
          {...tile("upload")}
          onClick={() => fileInput.current?.click()}
        >
          <span className="img">
            {frame.uploadThumb ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={frame.uploadThumb} alt="" width={96} height={64} />
            ) : (
              <XIcon name="plus" />
            )}
          </span>
          <span className="nm">
            {frame.upload ? frame.upload.name : "Ma propre image"}
          </span>
        </button>
        {frame.isVideo ? (
          <button
            type="button"
            {...tile(SOURCE_BACKGROUND_ID)}
            onClick={() => frame.onChooseBg(SOURCE_BACKGROUND_ID)}
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
            onClick={() => frame.onChooseBg(p.id)}
          >
            <span className="img">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.thumb} alt="" loading="lazy" width={96} height={64} />
            </span>
            <span className="nm">{p.label}</span>
          </button>
        ))}
        {GRADIENT_BACKGROUNDS.map((p) => (
          <button
            key={p.id}
            type="button"
            {...tile(p.id)}
            onClick={() => frame.onChooseBg(p.id)}
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
              onChange={(event) => pickColor(event.target.value)}
              onClick={() => pickColor(prefs.bg)}
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
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null;
          if (file) frame.onUpload(file);
          event.target.value = "";
        }}
      />
      <p className="xr-lead xr-small">
        Photos libres de droits (Pexels, crédits dans le dépôt). Pour d’autres
        photos, ouvre un de ces sites puis choisis « Ma propre image ».
      </p>
      <div className="xe-links">
        {FREE_IMAGE_SITES.map((site) => (
          <a
            key={site.name}
            className="xe-link"
            href={site.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {site.name}
          </a>
        ))}
        {frame.upload ? (
          <button
            type="button"
            className="xr-link"
            data-testid="video-bg-remove"
            onClick={() => frame.onUpload(null)}
          >
            Retirer mon image
          </button>
        ) : null}
      </div>
      {/* EMPLACEMENT — fond vidéo (phase « transport du fond vidéo ») : `frame.backgroundVideo`. */}
      {frame.backgroundVideo ?? null}
    </Field>
  );
}

// ── passages ────────────────────────────────────────────────────────────────

/** Un résumé court des passages exportés ; le détail (frise, liste, souffle) s'ouvre dans sa propre fenêtre. */
export function PassagesSection({
  summary,
  count,
  onOpen,
}: {
  summary: string;
  count: number;
  onOpen: () => void;
}) {
  return (
    <Field title="Passages à exporter">
      <div className="xe-passages">
        <p>
          <b data-testid="passages-summary">{summary}</b>
          <small>
            {count > 1 ? `${count} vidéos : une par plage` : "une seule vidéo"}
          </small>
        </p>
        <button
          type="button"
          className="btn btn--secondary xe-btn"
          aria-haspopup="dialog"
          data-testid="passages-open"
          onClick={onOpen}
        >
          <XIcon name="passages" size={18} />
          Choisir les passages…
        </button>
      </div>
    </Field>
  );
}

/** La fenêtre des passages : frise, liste des plages, souffle. Plein écran sur téléphone, Échap la ferme. */
export function PassagesDialog({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="xe-dialog"
      aria-labelledby="xe-passages-h"
      data-testid="passages-dialog"
      onClose={onClose}
      onCancel={onClose}
    >
      {open ? (
        <>
          <header className="xe-dialog-head">
            <h2 id="xe-passages-h">Passages à exporter</h2>
            <button
              type="button"
              className="btn btn--primary xe-btn"
              data-testid="passages-close"
              onClick={onClose}
            >
              Terminé
            </button>
          </header>
          <div className="xe-dialog-body">{children}</div>
        </>
      ) : null}
    </dialog>
  );
}

// ── réglages avancés ────────────────────────────────────────────────────────

/** La qualité, la fluidité et le poids : rangés à part, jamais en première ligne. */
export function AdvancedSection({
  children,
  defaultOpen = false,
}: {
  children: ReactNode;
  /** Ouvert d'emblée (dans la feuille « Avancé » du téléphone, où c'est tout ce qu'on voit). */
  defaultOpen?: boolean;
}) {
  return (
    <details
      className="xr-fine xe-advanced"
      data-testid="video-advanced"
      open={defaultOpen}
    >
      <summary>
        <XIcon name="chev-r" />
        Réglages avancés : qualité, fluidité, poids
      </summary>
      <div>{children}</div>
    </details>
  );
}

/** Les outils du cadre (barre d'outils du téléphone, quand aucun élément n'est choisi). */
export const FRAME_TOOLS = [
  { key: "format", label: "Format", icon: "format" },
  { key: "fond", label: "Fond", icon: "image" },
  { key: "passages", label: "Passages", icon: "list" },
  { key: "avance", label: "Avancé", icon: "sliders" },
] as const;
export type FrameToolKey = (typeof FRAME_TOOLS)[number]["key"];
