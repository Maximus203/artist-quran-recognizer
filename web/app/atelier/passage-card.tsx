"use client";
import { useEffect, useRef } from "react";
import gsap from "gsap";
import { FORMULA_NOTICE } from "@/lib/formulas";
import { formatTime, type Interval } from "@/lib/recognition";
import {
  describePassage,
  shownIndex,
  splitNoteMarkers,
  type PassageModel,
  type TranslationView,
} from "@/lib/passage";
import type { Store } from "@/lib/mini-store";
import { useStoreValue } from "./hooks";
import { Icon } from "./icons";
import type { PlayerState } from "./use-player";

type Props = {
  item: Interval | null;
  showTranslation: boolean;
  onToggleTranslation: () => void;
  /** Police arabe + A− / A+ (le sélecteur lui-même vit dans `FontPicker`). */
  tools: React.ReactNode;
  onListen: (range: [number, number]) => void;
  /** Clé qui change quand le passage affiché change (déclenche le fondu). */
  fadeKey: string;
};

function Translation({ translation }: { translation: TranslationView }) {
  return (
    <div className="translation" data-testid="translation">
      <p>
        {splitNoteMarkers(translation.text).map((part, i) =>
          part.note ? <sup key={i}>{part.text}</sup> : part.text,
        )}
      </p>
      <small>
        {translation.partialNote ? "Traduction du verset entier · " : ""}
        {translation.attribution} · {translation.translationId} · source{" "}
        {translation.version}
      </small>
    </div>
  );
}

const Range = ({ range }: { range: [number, number] | null }) => (
  <span className="mono muted" style={{ fontSize: "var(--fs-sm)" }}>
    {range ? `${formatTime(range[0])} – ${formatTime(range[1])}` : "Sans temps"}
  </span>
);

function Body({
  model,
  showTranslation,
}: {
  model: PassageModel;
  showTranslation: boolean;
}) {
  switch (model.type) {
    case "verse":
      return (
        <>
          <div className="p-meta">
            <span className="badges" data-testid="badges">
              {model.badges.map((label, i) => (
                <span className="badge" key={label}>
                  {i === 0 ? <span className="sw s-recognized" /> : null}
                  {label}
                </span>
              ))}
            </span>
            <span className="p-ref ref" data-testid="ref">
              {model.ref}
            </span>
            <Range range={model.range} />
          </div>
          <p className="arabic" lang="ar" dir="rtl" data-testid="arabic">
            {/* Le texte du corpus seul ; le médaillon de fin de verset est un décor, hors du texte. */}
            <span data-testid="arabic-text">{model.arabic}</span>
            {model.ayahNumber ? (
              <span className="ayah-end" aria-hidden="true">
                {model.ayahNumber}
              </span>
            ) : null}
          </p>
          {showTranslation && model.translation ? (
            <Translation translation={model.translation} />
          ) : null}
        </>
      );
    case "basmala":
      return (
        <>
          <div className="p-meta">
            <span className="badge badge--ink" data-testid="badges">
              <Icon name="wave" size={14} />
              Basmala
            </span>
            <span className="p-ref p-ref--ar" lang="ar" dir="rtl">
              البسملة
            </span>
            <Range range={model.range} />
          </div>
          {model.arabic ? (
            <>
              <div className="orn" aria-hidden="true">
                <i />
              </div>
              <p
                className="arabic basmala"
                lang="ar"
                dir="rtl"
                data-testid="arabic"
              >
                {model.arabic}
              </p>
              {showTranslation && model.translation ? (
                <Translation translation={model.translation} />
              ) : null}
            </>
          ) : (
            <div className="p-empty">
              <p>
                Le texte de la basmala n’est pas inclus dans ce résultat
                (analyse faite avant son affichage). Relance l’analyse pour
                l’obtenir.
              </p>
            </div>
          )}
        </>
      );
    case "verse_no_text":
      return (
        <>
          <div className="p-meta">
            <span className="badge" data-testid="badges">
              <span className="sw s-recognized" />
              Reconnu
            </span>
            <span className="p-ref ref" data-testid="ref">
              {model.ref}
            </span>
            <Range range={model.range} />
          </div>
          <div className="p-empty">
            <p>Texte non inclus dans ce résultat.</p>
          </div>
        </>
      );
    case "hypothesis":
      return (
        <>
          <div className="p-meta">
            <span className="badge" data-testid="badges">
              <span className="sw s-inferred" />
              Hypothèse · non entendue
            </span>
            <span className="p-ref ref" data-testid="ref">
              {model.ref}
            </span>
            <Range range={model.range} />
          </div>
          <div className="p-empty">
            <p>
              Verset déduit du contexte, jamais entendu. Il n’est pas une
              preuve.
            </p>
          </div>
        </>
      );
    case "uncertain":
      return (
        <>
          <div className="p-meta">
            <span className="badge badge--warn" data-testid="badges">
              <span className="sw s-uncertain" />
              Incertain
            </span>
            <span className="p-ref ref" data-testid="ref">
              Identification ambiguë
            </span>
            <Range range={model.range} />
          </div>
          <div className="p-empty">
            <p>
              Références candidates : {model.candidates.join(" · ") || "aucune"}
              . Le texte n’est affiché que lorsque le verset est identifié.
            </p>
          </div>
        </>
      );
    case "formula":
      return (
        <>
          <div className="p-meta">
            <span className="badge" data-testid="badges">
              <span className="sw s-formula" />
              Formule non coranique
            </span>
            <span className="p-ref ref" data-testid="ref">
              {model.formula.name}
            </span>
            <span className="p-ref p-ref--ar" lang="ar" dir="rtl">
              {model.formula.label}
            </span>
            <Range range={model.range} />
          </div>
          <p
            className="arabic"
            lang="ar"
            dir="rtl"
            data-testid="formula-arabic"
          >
            {model.formula.arabic}
          </p>
          {showTranslation ? (
            <div className="translation" data-testid="formula-translation">
              <p>{model.formula.translation}</p>
              <small>{FORMULA_NOTICE}</small>
            </div>
          ) : null}
        </>
      );
    case "other_speech":
      return (
        <>
          <div className="p-meta">
            <span className="badge" data-testid="badges">
              <span className="sw s-formula" />
              Parole non coranique
            </span>
            <span className="p-ref ref" data-testid="ref">
              {model.label}
            </span>
            <Range range={model.range} />
          </div>
          <div className="p-empty">
            <p>
              Ce passage n’est pas un verset : aucun texte du Mushaf n’est
              affiché.
            </p>
          </div>
        </>
      );
    case "abstention":
      return (
        <>
          <div className="p-meta">
            <span className="badge" data-testid="badges">
              <span className="sw s-abstention" />
              Abstention
            </span>
            <Range range={model.range} />
          </div>
          <div className="p-empty">
            <p>
              {model.reason}. Le moteur préfère ne rien nommer plutôt que nommer
              un faux verset.
            </p>
          </div>
        </>
      );
    default:
      return (
        <div className="p-empty">
          <h3>Aucun verset localisé à cet instant</h3>
          <p>Lis un passage ou sélectionne un segment dans la liste.</p>
        </div>
      );
  }
}

export function PassageCard(props: Props) {
  const model = describePassage(props.item);
  const card = useRef<HTMLElement>(null);
  const range = props.item?.t ?? null;
  useEffect(() => {
    if (!card.current || props.fadeKey === "" || !card.current.isConnected)
      return;
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduce) return;
    const ctx = gsap.context(() =>
      gsap.fromTo(
        card.current,
        { opacity: 0.65, y: 7 },
        { opacity: 1, y: 0, duration: 0.22, ease: "power2.out" },
      ),
    );
    return () => ctx.revert();
  }, [props.fadeKey]);
  return (
    <section
      ref={card}
      className="card passage o-passage verse-card"
      data-testid="passage"
      aria-live="polite"
      aria-label="Passage actif"
    >
      <div className="p-top">
        <h2 className="eyebrow">Passage actif</h2>
        <div className="tools-inline">{props.tools}</div>
      </div>
      <Body model={model} showTranslation={props.showTranslation} />
      <div className="p-actions">
        <button
          type="button"
          className="btn btn--secondary"
          data-testid="listen-passage"
          disabled={!range}
          onClick={() => range && props.onListen(range)}
        >
          <Icon name="play" fill size={16} />
          Écouter ce passage
        </button>
        <button
          type="button"
          className="switch"
          role="switch"
          data-testid="translation-switch"
          aria-checked={props.showTranslation}
          onClick={props.onToggleTranslation}
        >
          <i />
          Afficher la traduction
        </button>
      </div>
    </section>
  );
}

/** La carte qui suit la lecture : seule elle se redessine quand l'intervalle affiché change. */
export function LivePassage(
  props: Omit<Props, "item" | "fadeKey"> & {
    store: Store<PlayerState>;
    intervals: readonly Interval[];
    selectedIndex: number | null;
    sessionId: string;
  },
) {
  const { store, intervals, selectedIndex, sessionId, ...rest } = props;
  const index = useStoreValue(store, (s) =>
    shownIndex(intervals, selectedIndex, s.time),
  );
  return (
    <PassageCard
      {...rest}
      item={index >= 0 ? intervals[index] : null}
      fadeKey={`${sessionId}:${index}`}
    />
  );
}
