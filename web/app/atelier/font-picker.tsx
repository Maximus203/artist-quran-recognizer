"use client";
import { useEffect, useId, useRef, useState } from "react";
import {
  QURAN_FONTS,
  type QuranFont,
  type QuranFontId,
} from "@/lib/quran-fonts";
import { QURAN_SIZE, stepQuranSize } from "@/lib/ui-prefs";
import { Icon } from "./icons";

/**
 * Aperçu d'une police : des lettres arabes vocalisées qui ne sont PAS du Coran. Le texte du Mushaf
 * ne vient que du corpus (invariant I1) ; ici on ne sert qu'à juger la forme des lettres. Quand un
 * passage est affiché, son début (du corpus) sert d'aperçu plus fidèle.
 */
export const FONT_SAMPLE = "أَبْجَدِيَّةٌ عَرَبِيَّةٌ";

type Props = {
  font: QuranFontId;
  availability: Partial<Record<QuranFontId, boolean>>;
  /** Taille choisie ; null = valeur par défaut. */
  size: number | null;
  /** Taille effectivement appliquée (px), pour le curseur. */
  appliedSize: number;
  sample: string;
  onFont: (id: QuranFontId) => void;
  onSize: (px: number) => void;
  onReset: () => void;
};

const familyOf = (font: QuranFont) =>
  font.id === "kfgqpc-hafs"
    ? "'KFGQPC Uthmanic Script HAFS','Amiri Quran'"
    : `'${font.name}'`;

export function FontPicker(props: Props) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const size = props.appliedSize;
  return (
    <>
      <div className="pop-wrap" ref={wrap}>
        <button
          ref={trigger}
          type="button"
          className="btn btn--secondary btn--sm"
          data-testid="font-trigger"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen(!open)}
        >
          Police arabe
        </button>
        {open ? (
          <div
            id={id}
            className="popover"
            role="dialog"
            aria-label="Police du texte arabe"
            data-testid="font-popover"
          >
            <div className="pop-head">
              <h3>Police du texte arabe</h3>
              <button
                type="button"
                className="btn btn--ghost btn--icon btn--sm"
                aria-label="Fermer"
                onClick={() => {
                  setOpen(false);
                  trigger.current?.focus();
                }}
              >
                <Icon name="x" />
              </button>
            </div>
            <p className="hint">
              Aperçu en direct. Le texte, lui, ne change jamais : il vient du
              corpus.
            </p>
            <div className="fonts" role="radiogroup" aria-label="Police arabe">
              {QURAN_FONTS.map((font) => {
                const unavailable =
                  font.source === "local" &&
                  props.availability[font.id] !== true;
                return (
                  <button
                    key={font.id}
                    type="button"
                    className="fopt"
                    role="radio"
                    data-testid={`font-${font.id}`}
                    aria-checked={props.font === font.id}
                    aria-disabled={unavailable}
                    onClick={() => {
                      if (!unavailable) props.onFont(font.id);
                    }}
                  >
                    <span className="radio" />
                    <span className="nm">
                      {font.name} <small>{font.note}</small>
                    </span>
                    <span
                      className="sample"
                      lang="ar"
                      dir="rtl"
                      style={{ fontFamily: familyOf(font) }}
                    >
                      {props.sample}
                    </span>
                    <span className="lic">
                      {unavailable
                        ? "Non installée sur ce poste : fichier à placer dans AQR_FONTS_DIR (licence propriétaire, jamais redistribuée). "
                        : ""}
                      {font.licence}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="size-row">
              <span>Taille</span>
              <input
                type="range"
                min={QURAN_SIZE.min}
                max={QURAN_SIZE.max}
                step={QURAN_SIZE.step}
                value={size}
                aria-label="Taille du texte arabe"
                data-testid="font-size"
                style={
                  {
                    "--p": `${((size - QURAN_SIZE.min) / (QURAN_SIZE.max - QURAN_SIZE.min)) * 100}%`,
                  } as React.CSSProperties
                }
                onChange={(event) => props.onSize(Number(event.target.value))}
              />
              <output>{size} px</output>
            </div>
            <div className="foot">
              <span>Enregistré sur cet appareil</span>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={props.onReset}
              >
                Réinitialiser
              </button>
            </div>
          </div>
        ) : null}
      </div>
      <button
        type="button"
        className="btn btn--ghost btn--icon btn--sm"
        data-testid="font-smaller"
        aria-label="A−, réduire le texte arabe"
        onClick={() => props.onSize(stepQuranSize(size, -1))}
      >
        <span style={{ fontSize: ".8rem", fontWeight: 700 }}>A−</span>
      </button>
      <button
        type="button"
        className="btn btn--ghost btn--icon btn--sm"
        data-testid="font-larger"
        aria-label="A+, agrandir le texte arabe"
        onClick={() => props.onSize(stepQuranSize(size, 1))}
      >
        <span style={{ fontSize: "1rem", fontWeight: 700 }}>A+</span>
      </button>
    </>
  );
}
