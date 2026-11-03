import type { CSSProperties, ReactNode } from "react";
import type { EditorMode } from "@/lib/export-editor-mode";
import { modeInfo } from "./mode-info";

/**
 * Les trois animations qui montrent COMMENT chaque format fonctionne : du SVG et du CSS (transform et opacity
 * seulement), une boucle de 9 s, aucune bibliothèque, aucune vidéo. Elles reprennent l'esprit des maquettes de
 * Sofia : le plateau (on touche le texte, sa barre d'outils apparaît), la table de montage (la tête de lecture
 * glisse, on cale le film), le pas à pas (trois étapes défilent). Aucune lettre d'arabe : des barres de texte.
 *
 * Sans mouvement (préférence du système) : le CSS cache l'animation et montre TROIS images fixes, les trois
 * temps de la même scène, gelés à des instants différents de la MÊME animation (un retard négatif, animation en
 * pause), donc rien n'est dessiné deux fois. Chaque image a sa légende en vrai texte.
 * Les valeurs visuelles sont dans `editor-mode.css` (jetons) ; ici seulement la géométrie.
 */

/** Instants (en secondes) où l'animation est gelée pour les images fixes : un par temps. */
export const STILL_TIMES: Record<
  EditorMode,
  readonly [number, number, number]
> = {
  plateau: [2.2, 4.2, 7],
  table: [1.3, 4, 7],
  pas: [1.6, 4.5, 7.6],
};

const WAVE = [3, 6, 9, 5, 11, 7, 4, 8, 3] as const;
const LONG_WAVE = [
  3, 6, 4, 8, 5, 9, 6, 3, 7, 10, 5, 4, 8, 6, 3, 7, 9, 5, 4, 6, 3,
] as const;

/** Le téléphone : le corps, l'écran, et sa zone d'outils (le fond du bas, dont le haut change selon le format). */
function Phone({
  zoneTop,
  sheet = false,
  children,
}: {
  zoneTop: number;
  /** Le haut de la zone est arrondi (une feuille qui monte). */
  sheet?: boolean;
  children: ReactNode;
}) {
  const top = sheet
    ? `M66 ${zoneTop + 6} a6 6 0 0 1 6 -6 H128 a6 6 0 0 1 6 6`
    : `M66 ${zoneTop} H134`;
  return (
    <g>
      <rect className="md-body" x="62" y="3" width="76" height="119" rx="10" />
      <rect className="md-screen" x="66" y="7" width="68" height="111" rx="6" />
      <path
        className="md-zone"
        d={`${top} V112 A6 6 0 0 1 128 118 H72 A6 6 0 0 1 66 112 Z`}
      />
      {children}
    </g>
  );
}

/** L'aperçu de la vidéo : des barres de texte, une carte de traduction, l'onde (jamais de vrai texte). */
function Video({
  x,
  y,
  scale,
  dragArabic = false,
}: {
  x: number;
  y: number;
  scale: number;
  /** Le bloc de texte arabe peut glisser (plateau). */
  dragArabic?: boolean;
}) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <rect className="md-video" width="40" height="64" rx="3" />
      <rect className="md-ink-2" x="13" y="5" width="14" height="1.6" rx=".8" />
      <g className={dragArabic ? "md-drag" : undefined}>
        <rect
          className="md-ink"
          x="7"
          y="15"
          width="26"
          height="3.2"
          rx="1.6"
        />
        <rect
          className="md-ink"
          x="11"
          y="20.5"
          width="18"
          height="3.2"
          rx="1.6"
        />
      </g>
      <rect className="md-panel" x="5" y="32" width="30" height="13" rx="2" />
      <rect className="md-ink-2" x="9" y="36" width="22" height="1.8" rx=".9" />
      <rect
        className="md-ink-2"
        x="12"
        y="40"
        width="16"
        height="1.8"
        rx=".9"
      />
      {WAVE.map((h, i) => (
        <rect
          key={i}
          className="md-ink-2"
          x={7 + 3 * i}
          y={55 - h / 2}
          width="1.6"
          height={h}
          rx=".8"
        />
      ))}
    </g>
  );
}

/** Le doigt : un anneau blanc cerclé de sombre, lisible sur la vidéo comme sur l'écran, dans les deux thèmes. */
function Finger({ className }: { className: string }) {
  return (
    <g className={`md-finger ${className}`}>
      <circle className="md-f-edge" r="6.6" />
      <circle className="md-f-ring" r="5.6" />
      <circle className="md-f-dot" r="2" />
    </g>
  );
}

/** Plateau : on touche le texte arabe, sa barre d'outils apparaît, on le déplace du doigt. */
function PlateauArt() {
  return (
    <>
      <Phone zoneTop={80}>
        <Video x={80} y={11} scale={1} dragArabic />
        {/* Rien de touché : les réglages du cadre, discrets. */}
        <g className="md-rest">
          <rect
            className="md-line"
            x="70"
            y="88"
            width="42"
            height="3"
            rx="1.5"
          />
          <rect
            className="md-line"
            x="70"
            y="96"
            width="28"
            height="3"
            rx="1.5"
          />
          <rect
            className="md-chip"
            x="104"
            y="94"
            width="26"
            height="9"
            rx="4.5"
          />
        </g>
        {/* Le texte touché : cadre et poignées. */}
        <g className="md-sel">
          <g className="md-drag">
            <rect
              className="md-sel-edge"
              x="84"
              y="23"
              width="32"
              height="15"
              rx="1.5"
            />
            <rect
              className="md-sel-rect"
              x="84"
              y="23"
              width="32"
              height="15"
              rx="1.5"
            />
            {[
              [84, 23],
              [116, 23],
              [84, 38],
              [116, 38],
            ].map(([cx, cy]) => (
              <circle
                key={`${cx}-${cy}`}
                className="md-handle"
                cx={cx}
                cy={cy}
                r="2"
              />
            ))}
          </g>
        </g>
        {/* Sa barre d'outils : le texte à régler, taille − / +. */}
        <g className="md-bar">
          <rect
            className="md-chip-on"
            x="70"
            y="85"
            width="17"
            height="8"
            rx="4"
          />
          <rect
            className="md-chip"
            x="89"
            y="85"
            width="22"
            height="8"
            rx="4"
          />
          <rect
            className="md-chip"
            x="113"
            y="85"
            width="17"
            height="8"
            rx="4"
          />
          <rect
            className="md-chip"
            x="70"
            y="98"
            width="12"
            height="12"
            rx="3"
          />
          <rect
            className="md-chip"
            x="84"
            y="98"
            width="22"
            height="12"
            rx="3"
          />
          <rect
            className="md-chip"
            x="108"
            y="98"
            width="12"
            height="12"
            rx="3"
          />
          <rect
            className="md-chip"
            x="123"
            y="98"
            width="8"
            height="12"
            rx="3"
          />
        </g>
        <Finger className="md-finger--plateau" />
      </Phone>
    </>
  );
}

/** Table de montage : aperçu, chronologie, tête de lecture qui glisse, film qu'on cale. */
function TableArt() {
  return (
    <Phone zoneTop={61}>
      <Video x={85} y={11} scale={0.75} />
      <g className="md-timeline">
        {Array.from({ length: 11 }, (_, i) => (
          <rect
            key={i}
            className="md-tick"
            x={70 + 6 * i}
            y={i % 2 === 0 ? 63 : 64.5}
            width="0.9"
            height={i % 2 === 0 ? 3.5 : 2}
          />
        ))}
        <rect className="md-seg" x="68" y="69" width="13" height="9" rx="2" />
        <rect
          className="md-seg md-seg--on"
          x="83"
          y="69"
          width="15"
          height="9"
          rx="2"
        />
        <rect className="md-seg" x="100" y="69" width="11" height="9" rx="2" />
        <rect className="md-seg" x="113" y="69" width="19" height="9" rx="2" />
        {LONG_WAVE.map((h, i) => (
          <rect
            key={i}
            className="md-wavebar"
            x={69 + 3 * i}
            y={85 - h / 2}
            width="1.5"
            height={h}
            rx=".7"
          />
        ))}
        {/* Le film de fond : sa boucle et ses raccords ; on le fait glisser sous la récitation. */}
        <svg x="68" y="92" width="64" height="12" overflow="hidden">
          <rect className="md-film-base" width="64" height="12" rx="2" />
          <g className="md-film">
            {Array.from({ length: 8 }, (_, i) => (
              <rect
                key={i}
                className={i % 2 === 0 ? "md-film-a" : "md-film-b"}
                x={-8 + i * 12.8}
                width="12.8"
                height="12"
              />
            ))}
            <circle className="md-seam" cx="26" cy="6" r="2.6" />
            <circle className="md-seam" cx="51" cy="6" r="2.6" />
          </g>
        </svg>
        <rect className="md-ring" x="67" y="91" width="66" height="14" rx="3" />
      </g>
      <g className="md-head">
        <line className="md-head-line" x1="0" y1="64" x2="0" y2="106" />
        <circle className="md-head-dot" cx="0" cy="64" r="2.4" />
      </g>
      {[76, 89, 102, 115].map((cx) => (
        <circle key={cx} className="md-rail" cx={cx} cy="112.5" r="2" />
      ))}
      <Finger className="md-finger--table" />
    </Phone>
  );
}

/** Pas à pas : trois étapes qui défilent, puis le gros bouton. */
function PasArt() {
  const dots = [76, 97, 118];
  return (
    <Phone zoneTop={61} sheet>
      <Video x={85} y={11} scale={0.75} />
      <g className="md-steps">
        {[69, 90, 111].map((x, i) => (
          <g key={x}>
            <rect
              className="md-track"
              x={x}
              y="66.5"
              width="19"
              height="2.4"
              rx="1.2"
            />
            <rect
              className={`md-fill md-fill--${i + 1}`}
              x={x}
              y="66.5"
              width="19"
              height="2.4"
              rx="1.2"
            />
          </g>
        ))}
        {dots.map((cx, i) => (
          <g key={cx}>
            <circle className="md-dot" cx={cx} cy="74.5" r="3" />
            <circle
              className={`md-dot-on md-dot-on--${i + 1}`}
              cx={cx}
              cy="74.5"
              r="3"
            />
          </g>
        ))}
        <svg x="68" y="80" width="64" height="24" overflow="hidden">
          <g className="md-strip">
            {/* Étape 1 : le cadre (trois formats). */}
            <g>
              <rect
                className="md-chip"
                x="3"
                y="1"
                width="18"
                height="22"
                rx="3"
              />
              <rect
                className="md-chip md-chip--pick"
                x="23"
                y="1"
                width="18"
                height="22"
                rx="3"
              />
              <rect
                className="md-chip"
                x="43"
                y="1"
                width="18"
                height="22"
                rx="3"
              />
            </g>
            {/* Étape 2 : les textes (onglets, taille). */}
            <g transform="translate(64 0)">
              <rect
                className="md-chip"
                x="3"
                y="1"
                width="58"
                height="7"
                rx="3.5"
              />
              <rect
                className="md-chip-on"
                x="3"
                y="1"
                width="15"
                height="7"
                rx="3.5"
              />
              <rect
                className="md-line"
                x="3"
                y="12"
                width="40"
                height="3"
                rx="1.5"
              />
              <rect
                className="md-chip"
                x="3"
                y="18"
                width="12"
                height="6"
                rx="2"
              />
              <rect
                className="md-chip"
                x="17"
                y="18"
                width="20"
                height="6"
                rx="2"
              />
              <rect
                className="md-chip"
                x="39"
                y="18"
                width="12"
                height="6"
                rx="2"
              />
            </g>
            {/* Étape 3 : prête à exporter. */}
            <g transform="translate(128 0)">
              <rect
                className="md-ready"
                x="3"
                y="1"
                width="58"
                height="22"
                rx="4"
              />
              <circle className="md-ready-dot" cx="12" cy="12" r="4" />
              <rect
                className="md-line"
                x="20"
                y="8"
                width="34"
                height="3"
                rx="1.5"
              />
              <rect
                className="md-line"
                x="20"
                y="14"
                width="24"
                height="3"
                rx="1.5"
              />
            </g>
          </g>
        </svg>
        <rect
          className="md-cta"
          x="70"
          y="106"
          width="60"
          height="9"
          rx="4.5"
        />
        <rect
          className="md-cta-label"
          x="90"
          y="109.5"
          width="20"
          height="2"
          rx="1"
        />
      </g>
      <Finger className="md-finger--pas" />
    </Phone>
  );
}

const ART: Record<EditorMode, () => ReactNode> = {
  plateau: PlateauArt,
  table: TableArt,
  pas: PasArt,
};

/** Le cadrage serré sur le téléphone, pour les images fixes. */
const STILL_VIEWBOX = "58 0 84 125";

/**
 * Une démonstration : l'animation (un seul `role="img"`, décrit par son texte alternatif ; le dessin est muet
 * pour les aides techniques) ET ses trois images fixes (en vraies légendes). Le CSS montre l'une ou l'autre
 * selon `prefers-reduced-motion`.
 */
export function ModeDemo({ mode }: { mode: EditorMode }) {
  const info = modeInfo(mode);
  const Art = ART[mode];
  return (
    <figure
      className="mdemo"
      data-mode={mode}
      data-testid={`mode-demo-${mode}`}
    >
      <div className="mdemo__live" role="img" aria-label={info.alt}>
        <svg
          className="mdemo__svg"
          viewBox="0 0 200 125"
          aria-hidden="true"
          focusable="false"
        >
          <Art />
        </svg>
        <p className="mdemo__cap" aria-hidden="true">
          {info.frames.map((frame, i) => (
            <span key={frame} className={`mdemo__cap-${i + 1}`}>
              <b>{i + 1}</b> {frame}
            </span>
          ))}
        </p>
      </div>
      <ol
        className="mdemo__frames"
        aria-label="Les trois temps, en images fixes"
      >
        {info.frames.map((frame, i) => (
          <li
            key={frame}
            className="mdemo--still"
            style={{ "--t": `-${STILL_TIMES[mode][i]}s` } as CSSProperties}
          >
            <svg
              className="mdemo__svg"
              viewBox={STILL_VIEWBOX}
              aria-hidden="true"
              focusable="false"
            >
              <Art />
            </svg>
            <span>
              <b>{i + 1}</b> {frame}
            </span>
          </li>
        ))}
      </ol>
    </figure>
  );
}
