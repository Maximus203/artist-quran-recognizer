"use client";
import { useEffect, useId, useState } from "react";
import {
  EXPORT_FONTS,
  type ExportContent,
  type ExportFormat,
  type ExportOptions,
} from "@/lib/export-options";
import { parseNumberFr } from "@/lib/export-number";

type Patch = (change: Partial<ExportOptions>) => void;

const FORMATS: { value: ExportFormat; label: string; hint: string }[] = [
  { value: "srt", label: "SRT", hint: "universel" },
  { value: "vtt", label: "WebVTT", hint: "web" },
  { value: "ass", label: "ASS", hint: "mot à mot" },
  { value: "json", label: "JSON", hint: "données" },
];
const CONTENTS: { value: ExportContent; label: string; hint: string }[] = [
  {
    value: "ar_fr",
    label: "Arabe et traduction française",
    hint: "Deux lignes par sous-titre.",
  },
  {
    value: "ar",
    label: "Arabe seul",
    hint: "Texte exact du Mushaf (corpus), jamais celui du moteur.",
  },
  {
    value: "fr",
    label: "Traduction française seule",
    hint: "QuranEnc, sans modification.",
  },
];
const FORMULAS: { value: ExportOptions["formulas"][number]; label: string }[] =
  [
    { value: "istiadha", label: "Isti‘adha" },
    { value: "basmala", label: "Basmala" },
    { value: "takbir", label: "Takbîr" },
    { value: "amin", label: "Âmîn" },
  ];

function Radio({
  name,
  checked,
  onChange,
  label,
  hint,
  danger = false,
  testId,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  label: React.ReactNode;
  hint?: React.ReactNode;
  danger?: boolean;
  testId?: string;
}) {
  return (
    <label className={`ex-rad${danger ? " is-danger" : ""}`}>
      <input
        type="radio"
        name={name}
        checked={checked}
        data-testid={testId}
        onChange={onChange}
      />
      <span>
        <b>{label}</b>
        {hint ? <small>{hint}</small> : null}
      </span>
    </label>
  );
}

export { Radio };

function Toggle({
  checked,
  onChange,
  title,
  hint,
  disabled = false,
  testId,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  title: string;
  hint: React.ReactNode;
  disabled?: boolean;
  testId?: string;
}) {
  const id = useId();
  return (
    <label className="ex-sw-row" htmlFor={id}>
      <span className="t">
        <b>{title}</b>
        <small>{hint}</small>
      </span>
      <span className="ex-tgl">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          data-testid={testId}
          onChange={(event) => onChange(event.target.checked)}
        />
        <i />
      </span>
    </label>
  );
}

/** Un nombre saisi à la française (« 7,0 ») : valide tant qu'il est dans les bornes, rouge sinon. */
function NumberField({
  label,
  unit,
  value,
  min,
  max,
  decimals,
  onCommit,
  testId,
}: {
  label: string;
  unit?: string;
  value: number;
  min: number;
  max: number;
  decimals: number;
  onCommit: (value: number) => void;
  testId?: string;
}) {
  const shown = value.toFixed(decimals).replace(".", ",");
  const [text, setText] = useState(shown);
  const [bad, setBad] = useState(false);
  useEffect(() => {
    setText(shown);
    setBad(false);
  }, [shown]);
  return (
    <label className="field">
      <span>
        {label} {unit ? <span className="opt">({unit})</span> : null}
      </span>
      <input
        className="input mono"
        value={text}
        inputMode={decimals ? "decimal" : "numeric"}
        aria-invalid={bad}
        data-testid={testId}
        onChange={(event) => {
          setText(event.target.value);
          const n = parseNumberFr(event.target.value);
          if (n === null || n < min || n > max) return setBad(true);
          setBad(false);
          onCommit(n);
        }}
        onBlur={() => {
          setText(shown);
          setBad(false);
        }}
      />
    </label>
  );
}

/** Les réglages d'export. Chaque réglage est un champ de `ExportOptions` : aucune valeur n'est en dur ici. */
export function ExportSettings({
  options,
  onChange,
  fileName,
  onFileName,
  defaultFileName,
}: {
  options: ExportOptions;
  onChange: Patch;
  fileName: string;
  onFileName: (name: string) => void;
  defaultFileName: string;
}) {
  const ass = options.format === "ass";
  const json = options.format === "json";
  const toggleFormula = (value: ExportOptions["formulas"][number]) => {
    const has = options.formulas.includes(value);
    onChange({
      formulas: has
        ? options.formulas.filter((f) => f !== value)
        : [...options.formulas, value],
    });
  };
  return (
    <>
      <div className="ex-set-head">
        <h3 id="ex-set-h">Réglages de l’export</h3>
      </div>

      <fieldset className="ex-set-sec">
        <legend>Format</legend>
        <div className="ex-fmt" role="radiogroup" aria-label="Format">
          {FORMATS.map((f) => (
            <label key={f.value}>
              <input
                type="radio"
                name="ex-format"
                checked={options.format === f.value}
                data-testid={`format-${f.value}`}
                onChange={() => onChange({ format: f.value })}
              />
              <span>
                {f.label}
                <small>{f.hint}</small>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="ex-set-sec">
        <legend>Contenu des sous-titres</legend>
        <div className="ex-rads">
          {CONTENTS.map((c) => (
            <Radio
              key={c.value}
              name="ex-content"
              checked={options.content === c.value}
              onChange={() => onChange({ content: c.value })}
              label={c.label}
              hint={c.hint}
              testId={`content-${c.value}`}
            />
          ))}
        </div>
      </fieldset>

      <div className="ex-set-sec">
        <span className="lg" id="ex-formulas-l">
          Formules
        </span>
        <div
          className="ex-chk-row"
          role="group"
          aria-labelledby="ex-formulas-l"
        >
          {FORMULAS.map((f) => (
            <label key={f.value} className="ex-chk">
              <input
                type="checkbox"
                checked={options.formulas.includes(f.value)}
                data-testid={`formula-${f.value}`}
                onChange={() => toggleFormula(f.value)}
              />
              <span>{f.label}</span>
            </label>
          ))}
        </div>
        <p className="muted" style={{ fontSize: "var(--fs-sm)" }}>
          La basmala est le verset 1:1 (texte et traduction du corpus). Les
          autres formules sont des <b style={{ fontWeight: 600 }}>libellés</b>,
          jamais du texte du Coran.
        </p>
      </div>

      <fieldset className="ex-set-sec">
        <legend>Répétitions</legend>
        <div className="ex-rads">
          <Radio
            name="ex-rep"
            checked={options.repetitions === "keep"}
            onChange={() => onChange({ repetitions: "keep" })}
            label="Garder toutes les récitations"
            hint="Chaque passage garde son propre temps."
          />
          <Radio
            name="ex-rep"
            checked={options.repetitions === "merge"}
            onChange={() => onChange({ repetitions: "merge" })}
            label="Fusionner les répétitions"
            hint="Un seul sous-titre, de la première à la dernière."
          />
        </div>
      </fieldset>

      <details className="ex-adv" data-testid="advanced">
        <summary>Mise en forme et synchronisation</summary>
        <div className="ex-set-sec">
          <div className="ex-grid3">
            <NumberField
              label="Durée min."
              unit="s"
              value={options.min_s}
              min={0}
              max={Math.min(30, options.max_s)}
              decimals={1}
              onCommit={(min_s) => onChange({ min_s })}
              testId="min-s"
            />
            <NumberField
              label="Durée max."
              unit="s"
              value={options.max_s}
              min={Math.max(0.5, options.min_s)}
              max={60}
              decimals={1}
              onCommit={(max_s) => onChange({ max_s })}
              testId="max-s"
            />
            <NumberField
              label="Signes / ligne"
              value={options.line_chars}
              min={10}
              max={200}
              decimals={0}
              onCommit={(line_chars) => onChange({ line_chars })}
              testId="line-chars"
            />
          </div>
          <div className="field">
            <span id="ex-offset-l">
              Décalage global <span className="opt">(ms, − pour avancer)</span>
            </span>
            <div
              className="ex-stepper"
              role="group"
              aria-labelledby="ex-offset-l"
            >
              <button
                className="btn btn--secondary"
                type="button"
                aria-label="Moins 100 millisecondes"
                disabled={options.offset_ms <= -5000}
                onClick={() =>
                  onChange({
                    offset_ms: Math.max(-5000, options.offset_ms - 100),
                  })
                }
              >
                −
              </button>
              <output className="input mono ex-stepper-v" data-testid="offset">
                {options.offset_ms}
              </output>
              <button
                className="btn btn--secondary"
                type="button"
                aria-label="Plus 100 millisecondes"
                disabled={options.offset_ms >= 5000}
                onClick={() =>
                  onChange({
                    offset_ms: Math.min(5000, options.offset_ms + 100),
                  })
                }
              >
                +
              </button>
            </div>
          </div>
          <Toggle
            checked={options.rtl}
            onChange={(rtl) => onChange({ rtl })}
            title="Balises de sens d’écriture (RTL)"
            hint="Garde l’arabe à droite dans les lecteurs qui l’inversent."
            disabled={ass || json}
            testId="opt-rtl"
          />
          <Toggle
            checked={options.strip_notes}
            onChange={(strip_notes) => onChange({ strip_notes })}
            title="Retirer les renvois de note [1]"
            hint="Change la traduction QuranEnc (I2) : coché = écart assumé."
            testId="opt-notes"
          />
          <Toggle
            checked={options.show_ref}
            onChange={(show_ref) => onChange({ show_ref })}
            title="Afficher la référence (2:255)"
            hint="Ajoute le numéro de sourate et de verset. Rend la référence incertaine gênante."
            testId="opt-ref"
          />
          <Toggle
            checked={options.bom && !json}
            onChange={(bom) => onChange({ bom })}
            title="Encodage UTF-8 avec BOM"
            hint={
              json
                ? "Sans objet en JSON."
                : "Pour de vieux lecteurs Windows ; sans BOM par défaut."
            }
            disabled={json}
            testId="opt-bom"
          />
          {ass ? (
            <div style={{ display: "grid", gap: "var(--sp-3)" }}>
              <Toggle
                checked={options.karaoke}
                onChange={(karaoke) => onChange({ karaoke })}
                title="Karaoké mot à mot"
                hint="Le mot s’allume quand il est récité (temps mesurés seulement)."
                testId="opt-karaoke"
              />
              <label className="field">
                Police arabe
                <select
                  className="input"
                  value={options.font}
                  data-testid="opt-font"
                  onChange={(event) =>
                    onChange({
                      font: event.target.value as ExportOptions["font"],
                    })
                  }
                >
                  {EXPORT_FONTS.map((font) => (
                    <option key={font} value={font}>
                      {font} (OFL)
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}
        </div>
      </details>

      <div className="ex-set-sec">
        <label className="field" htmlFor="ex-file-name">
          Nom du fichier
          <input
            className="input mono"
            id="ex-file-name"
            value={fileName}
            placeholder={defaultFileName}
            autoComplete="off"
            spellCheck={false}
            data-testid="file-name"
            onChange={(event) => onFileName(event.target.value)}
          />
        </label>
      </div>
    </>
  );
}
