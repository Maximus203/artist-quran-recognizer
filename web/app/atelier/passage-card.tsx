"use client";
import { useCallback, useEffect, useMemo, useRef } from "react";
import gsap from "gsap";
import { FORMULA_NOTICE } from "@/lib/formulas";
import { formatTime, type Interval } from "@/lib/recognition";
import {
  describePassage,
  shownIndex,
  type PassageModel,
  type TranslationView,
} from "@/lib/passage";
import {
  currentWordIndex,
  seekTimeForWord,
  wordTimesOf,
} from "@/lib/live-highlight";
import { activePartIndex } from "@/lib/translation-fragment";
import type { Store } from "@/lib/mini-store";
import { useStoreValue } from "./hooks";
import { Icon } from "./icons";
import { LiveArabic, LiveTranslation } from "./live-text";
import type { PlayerState } from "./use-player";

/** Le surlignage en direct tel que la carte l'affiche (le suivi du temps vit dans `LivePassage`). */
export type LiveView = {
  /** Préférence « Surligner en direct ». */
  enabled: boolean;
  playing: boolean;
  /** Rang du mot en cours dans la plage affichée, -1 si aucun. */
  wordIndex: number;
  onSeekWord: (word: number) => void;
  onToggle: () => void;
};

type Props = {
  item: Interval | null;
  showTranslation: boolean;
  onToggleTranslation: () => void;
  live: LiveView;
  /** Police arabe + A− / A+ (le sélecteur lui-même vit dans `FontPicker`). */
  tools: React.ReactNode;
  onListen: (range: [number, number]) => void;
  /** Clé qui change quand le passage affiché change (déclenche le fondu). */
  fadeKey: string;
};

/** Traduction d'un verset : seul le fragment du passage quand le moteur l'a découpé, sinon le verset. */
function VerseTranslation({
  translation,
  model,
  live,
}: {
  translation: TranslationView;
  model: Extract<PassageModel, { type: "verse" }>;
  live: LiveView;
}) {
  const word =
    live.enabled && model.live && live.wordIndex >= 0
      ? model.live.first + live.wordIndex
      : null;
  const segmentFound =
    word !== null && activePartIndex(translation.display, word) >= 0;
  // Sans mot suivi (ou sans segment à désigner), c'est le passage entier qui est marqué en lecture.
  const passageLive = live.enabled && live.playing && !segmentFound;
  return (
    <LiveTranslation
      translation={translation}
      word={word}
      passageLive={passageLive}
    />
  );
}

function PlainTranslation({ translation }: { translation: TranslationView }) {
  return (
    <LiveTranslation
      translation={translation}
      word={null}
      passageLive={false}
    />
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
  live,
}: {
  model: PassageModel;
  showTranslation: boolean;
  live: LiveView;
}) {
  switch (model.type) {
    case "verse": {
      const words = model.live;
      const followWords = live.enabled && words !== null;
      const arabicLive = live.enabled && live.playing && words === null;
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
          <p
            className={arabicLive ? "arabic is-live" : "arabic"}
            lang="ar"
            dir="rtl"
            data-testid="arabic"
          >
            {/* Le texte du corpus seul ; le médaillon de fin de verset est un décor, hors du texte. */}
            {words ? (
              <LiveArabic
                parts={words.parts}
                active={followWords ? live.wordIndex : -1}
                seekable={!live.playing}
                onSeekWord={live.onSeekWord}
              />
            ) : (
              <span data-testid="arabic-text">{model.arabic}</span>
            )}
            {model.ayahNumber ? (
              <span className="ayah-end" aria-hidden="true">
                {model.ayahNumber}
              </span>
            ) : null}
          </p>
          {followWords && words.source === "interpolated" ? (
            <p className="live-note" data-testid="live-note">
              Surlignage estimé : les temps des mots sont interpolés.
            </p>
          ) : null}
          {showTranslation && model.translation ? (
            <VerseTranslation
              translation={model.translation}
              model={model}
              live={live}
            />
          ) : null}
        </>
      );
    }
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
                <PlainTranslation translation={model.translation} />
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
  const model = useMemo(() => describePassage(props.item), [props.item]);
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
      <Body
        model={model}
        showTranslation={props.showTranslation}
        live={props.live}
      />
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
        <div className="p-toggles">
          {model.type === "verse" ? (
            <button
              type="button"
              className="switch"
              role="switch"
              data-testid="live-switch"
              aria-checked={props.live.enabled}
              onClick={props.live.onToggle}
            >
              <i />
              Surligner en direct
            </button>
          ) : null}
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
      </div>
    </section>
  );
}

/**
 * La carte qui suit la lecture : seule elle se redessine quand l'intervalle affiché change ou que le
 * mot en cours change (jamais à chaque image). Le mot est retrouvé par recherche binaire sur le temps
 * de lecture : un retour en arrière (seek, boucle, reprise) se recale à l'image suivante.
 */
export function LivePassage(
  props: Omit<Props, "item" | "fadeKey" | "live"> & {
    store: Store<PlayerState>;
    intervals: readonly Interval[];
    selectedIndex: number | null;
    sessionId: string;
    /** Préférence « Surligner en direct » (enregistrée côté serveur). */
    liveHighlight: boolean;
    onToggleLive: () => void;
    /** Place le lecteur à cet instant (clic sur un mot arabe). */
    onSeek: (time: number) => void;
  },
) {
  const {
    store,
    intervals,
    selectedIndex,
    sessionId,
    liveHighlight,
    onToggleLive,
    onSeek,
    ...rest
  } = props;
  const index = useStoreValue(store, (s) =>
    shownIndex(intervals, selectedIndex, s.time),
  );
  const item = index >= 0 ? intervals[index] : null;
  const wordIndex = useStoreValue(store, (s) => {
    if (!liveHighlight) return -1;
    const shown = shownIndex(intervals, selectedIndex, s.time);
    const times = shown >= 0 ? wordTimesOf(intervals[shown]) : null;
    return times ? currentWordIndex(times, s.time) : -1;
  });
  const playing = useStoreValue(store, (s) => s.playing);
  const onSeekWord = useCallback(
    (word: number) => {
      const times = item ? wordTimesOf(item) : null;
      const time = times ? seekTimeForWord(times, word, item?.t ?? null) : null;
      if (time !== null) onSeek(time);
    },
    [item, onSeek],
  );
  const live = useMemo<LiveView>(
    () => ({
      enabled: liveHighlight,
      playing,
      wordIndex,
      onSeekWord,
      onToggle: onToggleLive,
    }),
    [liveHighlight, playing, wordIndex, onSeekWord, onToggleLive],
  );
  return (
    <PassageCard
      {...rest}
      live={live}
      item={item}
      fadeKey={`${sessionId}:${index}`}
    />
  );
}
