"use client";
import { FORMULA_NOTICE } from "@/lib/formulas";
import { describePassage, liveAt } from "@/lib/passage";
import type { Interval } from "@/lib/recognition";
import { LiveTranslation } from "./live-text";

export type PlaylistVerseProps = {
  status: "loading" | "ready" | "error";
  /** Les intervalles du résultat de l'audio en cours. */
  intervals: readonly Interval[];
  /** Position de lecture, en secondes. */
  time: number;
  playing: boolean;
  /** Décalage audio du compte : retarde l'affichage, jamais l'audio. */
  offsetMs: number;
};

/**
 * Le haut du lecteur de playlist : le verset entendu à cet instant et SA TRADUCTION, ce que l'application
 * met en avant. Le texte arabe est celui du résultat (corpus, invariant I1) et la traduction est rendue
 * sans modification, avec sa source (I2). Un passage incertain, déduit ou non coranique n'affiche aucun
 * verset (I3, I5) : la zone reste vide plutôt que de nommer un faux verset.
 */
export function PlaylistVerse({
  status,
  intervals,
  time,
  playing,
  offsetMs,
}: PlaylistVerseProps) {
  if (status !== "ready")
    return (
      <div
        className="pl-verse pl-verse--wait"
        data-testid="pl-verse"
        role="status"
      >
        <p className="mini">
          {status === "loading"
            ? "Chargement de la traduction…"
            : "La traduction n’a pas pu être chargée pour cet audio."}
        </p>
      </div>
    );
  const { index } = liveAt(intervals, null, time, { offsetMs, playing });
  const model = describePassage(index >= 0 ? intervals[index] : null);
  const ref =
    model.type === "verse" || model.type === "basmala" ? model.ref : null;
  return (
    <div
      className="pl-verse"
      data-testid="pl-verse"
      data-ref={ref ?? undefined}
      aria-live="polite"
    >
      {model.type === "verse" || model.type === "basmala" ? (
        <>
          {model.arabic ? (
            <p className="arabic pl-arabic" lang="ar" dir="rtl">
              {model.arabic}
              {model.type === "verse" && model.ayahNumber ? (
                <span className="ayah-end" aria-hidden="true">
                  {model.ayahNumber}
                </span>
              ) : null}
            </p>
          ) : null}
          {ref ? (
            <p className="pl-ref mono" data-testid="pl-verse-ref">
              {ref}
            </p>
          ) : null}
          {model.translation ? (
            <LiveTranslation
              translation={model.translation}
              word={null}
              passageLive={false}
            />
          ) : null}
        </>
      ) : model.type === "formula" ? (
        <>
          <p className="arabic pl-arabic" lang="ar" dir="rtl">
            {model.formula.arabic}
          </p>
          <div className="translation" data-testid="formula-translation">
            <p>{model.formula.translation}</p>
            <small>{FORMULA_NOTICE}</small>
          </div>
        </>
      ) : (
        <div className="pl-verse-blank" aria-hidden="true" />
      )}
    </div>
  );
}
