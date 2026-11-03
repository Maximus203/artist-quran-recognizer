"use client";
import { useState, type ReactNode } from "react";
import { accentSolidCss, DEFAULT_ACCENT } from "@/lib/export-video-accent";
import { BOX_FIELDS, boxFields, type BoxField } from "@/lib/export-video-edit";
import { BLOCK_LABEL, BLOCK_ROLE } from "@/lib/export-video-edit-text";
import { PANEL_SWATCHES, waveLimits } from "@/lib/export-video-editor";
import {
  PANEL_LIMITS,
  type BlockId,
  type Box,
  type PanelKind,
  type PanelStyle,
  type TextBlockId,
  type TextStyle,
} from "@/lib/export-video-model";
import type { AccentColor } from "@/lib/export-video-prefs";
import { AccentDialog } from "../accent-dialog";
import { XIcon } from "../export-icons";
import { Switch } from "../export-ui";
import {
  ColorField,
  RangeField,
  SizeStepper,
  Tiles,
  sizeBounds,
  useHoldRepeat,
  type TileOption,
} from "./controls";
import { EIcon, BLOCK_ICON } from "./editor-icons";

/**
 * Les sections de réglages d'UN élément : Taille, Fond du texte, Position, Réglages. Ce sont les MÊMES
 * composants dans la feuille du téléphone (un outil ouvre une section) et dans l'inspecteur du bureau (les
 * sections se suivent). Elles ne connaissent ni le plateau ni le bureau : des valeurs en entrée, des
 * fonctions en sortie. Texte en français courant ; le technique est rangé sous « Réglages ».
 */

/** Un champ : un petit titre, éventuellement une précision à droite, son contrôle dessous. */
export function Field({
  title,
  hint,
  children,
  id,
}: {
  title: string;
  hint?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <div className="xe-field">
      <div className="xe-field-head">
        <span className="xe-field-title" id={id}>
          {title}
        </span>
        {hint ? <small>{hint}</small> : null}
      </div>
      {children}
    </div>
  );
}

/** Un choix entre deux ou trois possibilités, toutes de 44 px : « Ombre douce » · « Contour noir ». */
export function Choice<T extends string>({
  label,
  options,
  value,
  onPick,
  testId,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onPick: (value: T) => void;
  testId: string;
}) {
  return (
    <div className="xe-choice" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          tabIndex={option.value === value ? 0 : -1}
          data-testid={`${testId}-${option.value}`}
          onClick={() => onPick(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

// ── en-tête d'un élément ────────────────────────────────────────────────────

/**
 * Le titre d'un élément, ce qu'il est (une phrase), et son bouton « Masquer ». Le texte arabe affiche son
 * cadenas et dit qu'il n'est jamais modifiable (I1) ; la traduction ne se montre jamais sans son
 * attribution (I2).
 */
export function ElementHeader({
  id,
  attribution,
  canHide,
  onHide,
}: {
  id: BlockId;
  /** Attribution de la traduction (« QuranEnc.com — Hamidullah »). */
  attribution?: string | null;
  canHide: boolean;
  onHide: () => void;
}) {
  return (
    <header className="xe-eh">
      <span className="xe-eh-icon" aria-hidden="true">
        <EIcon name={BLOCK_ICON[id]} size={22} />
      </span>
      <div className="xe-eh-text">
        <h2>{BLOCK_LABEL[id]}</h2>
        <p>
          {id === "arabic" ? (
            <>
              <XIcon name="lock" size={14} /> {BLOCK_ROLE.arabic}
            </>
          ) : (
            BLOCK_ROLE[id]
          )}
        </p>
        {id === "translation" ? (
          <p className="xe-attribution" data-testid="translation-attribution">
            {attribution ?? "QuranEnc.com"}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        className="xe-hide"
        disabled={!canHide}
        aria-label={`Masquer : ${BLOCK_LABEL[id].toLowerCase()}`}
        title={canHide ? undefined : "Une des deux écritures reste affichée."}
        data-testid="element-hide"
        onClick={onHide}
      >
        <EIcon name="eye-off" size={22} />
        <span>Masquer</span>
      </button>
    </header>
  );
}

/** La phrase qui explique pourquoi l'arabe n'a pas de champ de saisie (cadenas). */
export function ArabicLockNote() {
  return (
    <p className="xe-lock" data-testid="arabic-lock">
      <XIcon name="lock" size={16} />
      <span>
        Ce texte vient du Mushaf : tu peux le déplacer, l’agrandir et changer
        son fond, mais jamais le modifier.
      </span>
    </p>
  );
}

// ── taille ──────────────────────────────────────────────────────────────────

/** La taille d'un texte : « − 100 % + », appui long qui répète ; on peut aussi pincer l'aperçu. */
export function SizeSection({
  block,
  size,
  onStep,
  onReset,
  hint = true,
}: {
  block: TextBlockId;
  size: number;
  onStep: (direction: 1 | -1) => boolean;
  onReset: () => void;
  hint?: boolean;
}) {
  const bounds = sizeBounds(size);
  return (
    <Field title="Taille du texte">
      <SizeStepper
        label={`Taille : ${BLOCK_LABEL[block].toLowerCase()}`}
        value={bounds.label}
        sub="de la taille de départ"
        onStep={onStep}
        onReset={size === 1 ? undefined : onReset}
        atMin={bounds.atMin}
        atMax={bounds.atMax}
        minusLabel="Texte plus petit"
        plusLabel="Texte plus grand"
        testId={`size-${block}`}
      />
      {hint ? (
        <p className="xe-hint">
          Aussi : pincer sur l’aperçu à deux doigts, ou les touches + et − sur
          l’élément choisi.
        </p>
      ) : null}
    </Field>
  );
}

/** La hauteur de l'onde : l'onde n'a pas de texte, donc pas de taille en pourcents. */
export function WaveSizeSection({
  box,
  onStep,
}: {
  box: Box;
  onStep: (direction: 1 | -1) => boolean;
}) {
  const percent = Math.round(box.h * 100);
  return (
    <Field title="Hauteur de l’onde">
      <SizeStepper
        label="Hauteur de l’onde"
        value={`${percent} %`}
        sub="de la hauteur de l’image"
        onStep={onStep}
        atMin={waveLimits(box).atMin}
        atMax={waveLimits(box).atMax}
        minusLabel="Onde plus basse"
        plusLabel="Onde plus haute"
        testId="size-wave"
      />
      <p className="xe-hint">
        Tire aussi les poignées de l’aperçu pour changer la largeur.
      </p>
    </Field>
  );
}

// ── fond du texte ───────────────────────────────────────────────────────────

const PANEL_OPTIONS: readonly TileOption<PanelKind>[] = [
  {
    value: "none",
    label: "Aucun fond",
    hint: "Texte seul",
    visual: <span className="xe-chip xe-chip--none">Texte</span>,
    testId: "panel-none",
  },
  {
    value: "transparent",
    label: "Transparent",
    hint: "Rectangle clair",
    visual: <span className="xe-chip xe-chip--transparent">Texte</span>,
    testId: "panel-transparent",
  },
  {
    value: "blur",
    label: "Flou",
    hint: "Verre dépoli",
    visual: <span className="xe-chip xe-chip--blur">Texte</span>,
    testId: "panel-blur",
  },
  {
    value: "solid",
    label: "Plein",
    hint: "Opaque",
    visual: <span className="xe-chip xe-chip--solid">Texte</span>,
    testId: "panel-solid",
  },
];

/**
 * Le fond derrière le texte : aucun (ombre douce ou contour), transparent, flou, plein ; sa couleur (six
 * d'un clic ou une libre), sa transparence, l'arrondi de ses angles. Un fond par texte : l'arabe et la
 * traduction se règlent indépendamment.
 */
export function PanelSection({
  block,
  panel,
  onChange,
  heading = true,
}: {
  block: TextBlockId;
  panel: PanelStyle;
  onChange: (change: Partial<PanelStyle>) => void;
  /** Faux dans la feuille du téléphone : son titre dit déjà « Fond derrière le texte ». */
  heading?: boolean;
}) {
  const transparency = Math.round((1 - panel.opacity) * 100);
  const tiles = (
    <Tiles
      label={`Fond derrière le texte : ${BLOCK_LABEL[block].toLowerCase()}`}
      options={PANEL_OPTIONS}
      value={panel.kind}
      onPick={(kind) => onChange({ kind })}
    />
  );
  return (
    <>
      {heading ? <Field title="Fond derrière le texte">{tiles}</Field> : tiles}
      {panel.kind === "none" ? (
        <Field title="Pour rester lisible">
          <Choice
            label="Pour rester lisible"
            testId="legibility"
            value={panel.legibility}
            onPick={(legibility) => onChange({ legibility })}
            options={[
              { value: "shadow", label: "Ombre douce" },
              { value: "outline", label: "Contour noir" },
            ]}
          />
        </Field>
      ) : (
        <>
          <Field title="Couleur du fond">
            <ColorField
              label="Couleur du fond"
              value={panel.color}
              swatches={PANEL_SWATCHES}
              onChange={(color) => onChange({ color })}
              testId="panel-color"
            />
          </Field>
          {panel.kind !== "solid" ? (
            <RangeField
              label="Transparence"
              value={transparency}
              display={`${transparency} %`}
              min={0}
              max={100}
              step={5}
              onChange={(value) => onChange({ opacity: 1 - value / 100 })}
              testId="panel-transparency"
            />
          ) : null}
          <RangeField
            label="Arrondi des angles"
            value={panel.radius}
            display={`${Math.round((panel.radius / PANEL_LIMITS.radius.max) * 100)} %`}
            min={PANEL_LIMITS.radius.min}
            max={PANEL_LIMITS.radius.max}
            step={2}
            onChange={(radius) => onChange({ radius })}
            testId="panel-radius"
          />
        </>
      )}
    </>
  );
}

// ── position ────────────────────────────────────────────────────────────────

const ARROWS = [
  { key: "ArrowUp", icon: "arrow-up", label: "Monter" },
  { key: "ArrowLeft", icon: "arrow-left", label: "Aller à gauche" },
  { key: "ArrowRight", icon: "arrow-right", label: "Aller à droite" },
  { key: "ArrowDown", icon: "arrow-down", label: "Descendre" },
] as const;

function Arrow({
  arrow,
  onNudge,
}: {
  arrow: (typeof ARROWS)[number];
  onNudge: (key: string) => boolean;
}) {
  const hold = useHoldRepeat(() => onNudge(arrow.key));
  return (
    <button
      type="button"
      className="xe-arrow"
      data-key={arrow.key}
      aria-label={`${arrow.label} (1 %)`}
      data-testid={`nudge-${arrow.key}`}
      {...hold}
    >
      <EIcon name={arrow.icon} size={22} />
    </button>
  );
}

const FIELD_LABEL: Record<BoxField, string> = {
  left: "Gauche",
  top: "Haut",
  width: "Largeur",
  height: "Hauteur",
};

/** Un champ en pourcents du cadre : on tape, Entrée ou la sortie du champ valide. */
function PercentField({
  field,
  value,
  onCommit,
}: {
  field: BoxField;
  value: number;
  onCommit: (percent: number) => void;
}) {
  return (
    <label className="xe-pct">
      <span>{FIELD_LABEL[field]}</span>
      <span className="xe-pct-box">
        <input
          key={value}
          defaultValue={String(value).replace(".", ",")}
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          data-testid={`field-${field}`}
          aria-label={`${FIELD_LABEL[field]}, en pourcents de l’image`}
          onBlur={(event) =>
            onCommit(Number(event.currentTarget.value.replace(",", ".")))
          }
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onCommit(Number(event.currentTarget.value.replace(",", ".")));
            }
          }}
        />
        <i aria-hidden="true">%</i>
      </span>
    </label>
  );
}

/**
 * Déplacer sans glisser : une croix directionnelle de 1 % par appui (appui long qui répète), les quatre
 * champs Gauche, Haut, Largeur, Hauteur, « Centrer » et « Remettre à la place d'origine ». Les mêmes pas
 * que le clavier (flèches, Ctrl + flèches).
 */
export function PositionSection({
  box,
  onNudge,
  onField,
  onCenter,
  onReset,
  showFields = true,
}: {
  box: Box;
  onNudge: (
    key: string,
    modifiers: { shift?: boolean; ctrl?: boolean },
  ) => boolean;
  onField: (field: BoxField, percent: number) => void;
  onCenter: () => void;
  onReset: () => void;
  /** Les champs exacts se rangent sous « Avancé » sur le bureau. */
  showFields?: boolean;
}) {
  return (
    <>
      <Field title="Déplacer sans glisser" hint="1 % par appui">
        <div className="xe-dpad" role="group" aria-label="Déplacer">
          <Arrow arrow={ARROWS[0]} onNudge={(key) => onNudge(key, {})} />
          <Arrow arrow={ARROWS[1]} onNudge={(key) => onNudge(key, {})} />
          <span className="xe-dpad-mid" aria-hidden="true">
            <EIcon name="move" size={22} />
          </span>
          <Arrow arrow={ARROWS[2]} onNudge={(key) => onNudge(key, {})} />
          <Arrow arrow={ARROWS[3]} onNudge={(key) => onNudge(key, {})} />
        </div>
      </Field>
      {showFields ? <PositionFields box={box} onField={onField} /> : null}
      <div className="xe-actions">
        <button
          type="button"
          className="btn btn--secondary xe-btn"
          data-testid="position-center"
          onClick={onCenter}
        >
          <EIcon name="center" size={18} />
          Centrer dans l’image
        </button>
        <button
          type="button"
          className="btn btn--secondary xe-btn"
          data-testid="position-reset"
          onClick={onReset}
        >
          <XIcon name="undo" size={18} />
          Remettre à la place d’origine
        </button>
      </div>
    </>
  );
}

/** Les quatre champs de la zone : la taille et la place exactes, au clavier. */
export function PositionFields({
  box,
  onField,
}: {
  box: Box;
  onField: (field: BoxField, percent: number) => void;
}) {
  const fields = boxFields(box);
  return (
    <Field title="Place et zone exactes" hint="en % de l’image">
      <div className="xe-pcts">
        {BOX_FIELDS.map((field) => (
          <PercentField
            key={field}
            field={field}
            value={fields[field]}
            onCommit={(percent) => onField(field, percent)}
          />
        ))}
      </div>
    </Field>
  );
}

// ── réglages d'un texte ─────────────────────────────────────────────────────

/**
 * Le reste des réglages d'un texte, rangé à part : remplir la zone, place du texte dans sa zone, étendue du
 * fond et — pour l'arabe — la couleur du mot récité (couleur d'accent).
 */
export function TextAdvancedSection({
  block,
  style,
  onStyle,
  onPanel,
  accent,
}: {
  block: TextBlockId;
  style: TextStyle;
  onStyle: (change: Partial<Pick<TextStyle, "fill" | "valign">>) => void;
  onPanel: (change: Partial<PanelStyle>) => void;
  /** Couleur du mot récité (l'arabe seulement). */
  accent?: {
    value: AccentColor | null;
    onChange: (next: AccentColor | null) => void;
  };
}) {
  const [accentOpen, setAccentOpen] = useState(false);
  return (
    <>
      <Switch
        checked={style.fill}
        testId={`fill-${block}`}
        onChange={(fill) => onStyle({ fill })}
        label="Remplir la zone"
        hint="Le texte grandit jusqu’à occuper sa zone ; un texte trop long est réduit, jamais coupé."
      />
      <Field title="Place du texte dans sa zone">
        <Choice
          label="Place du texte dans sa zone"
          testId={`valign-${block}`}
          value={style.valign}
          onPick={(valign) => onStyle({ valign })}
          options={[
            { value: "start", label: "En haut" },
            { value: "center", label: "Au milieu" },
            { value: "end", label: "En bas" },
          ]}
        />
      </Field>
      {style.panel.kind !== "none" ? (
        <Field title="Le fond couvre">
          <Choice
            label="Le fond couvre"
            testId={`extent-${block}`}
            value={style.panel.extent}
            onPick={(extent) => onPanel({ extent })}
            options={[
              { value: "text", label: "Le texte" },
              { value: "box", label: "Toute la zone" },
            ]}
          />
        </Field>
      ) : null}
      {accent ? (
        <>
          <button
            type="button"
            className="xr-accent-btn"
            data-testid="accent-open"
            onClick={() => setAccentOpen(true)}
          >
            <i
              style={{
                background: accentSolidCss(accent.value ?? DEFAULT_ACCENT),
                opacity: accent.value ? accent.value.a : 1,
              }}
              aria-hidden="true"
            />
            <span>
              Couleur du mot récité
              <small>
                {accent.value
                  ? "personnalisée"
                  : "automatique, couleur principale du fond"}
              </small>
            </span>
          </button>
          <AccentDialog
            open={accentOpen}
            value={accent.value}
            onChange={accent.onChange}
            onClose={() => setAccentOpen(false)}
          />
        </>
      ) : null}
    </>
  );
}
