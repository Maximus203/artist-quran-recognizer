"use client";
import Link from "next/link";
import { useMemo } from "react";
import { LIVE_ERRORS } from "@/lib/live-errors";
import { plural, verseName } from "@/lib/live-format";
import { layoutArabicWords } from "@/lib/live-highlight";
import type { LiveTranslation } from "@/lib/live-protocol";
import {
  patienceStage,
  quietHint,
  silenceS,
  viewOf,
  type LiveState,
} from "@/lib/live-store";
import { splitNoteMarkers } from "@/lib/passage";
import { Icon } from "../icons";

/**
 * La carte « Passage en cours » : une seule carte qui change d'état sur place (le « calque »). Elle ne
 * montre que ce que le moteur a dit : jamais le texte d'un candidat non nommé (I3), jamais un nom
 * fabriqué. Textes : docs/design/en-direct.md §4 à §6.
 */
const JUMP_TEXT = {
  repeat: "Tu reprends le verset précédent.",
  back: "Tu reviens en arrière.",
  skip: "Des versets ont été sautés.",
  other_surah: "Autre sourate : je cherche où tu es.",
} as const;

const PATIENCE_TEXT = [
  "",
  "Je continue d’écouter : il faut en général quelques mots de plus pour être sûr.",
  "C’est plus long que d’habitude : récitation lente, ou mots mal entendus. Je continue, rien n’est perdu.",
  "Toujours pas départagé. Ce passage est difficile à identifier en direct ; il restera peut-être non nommé, et ce n’est pas une erreur.",
] as const;

export function Hearing({ still }: { still?: boolean }) {
  return (
    <div
      className={still ? "hearing hearing--still" : "hearing"}
      aria-hidden="true"
    >
      <Icon name="mic" />
    </div>
  );
}

/** Le texte arabe d'un verset verrouillé, mot par mot : entendus en encre pleine, à venir en gris. */
export function Words({
  text,
  heard,
  total,
  follow,
}: {
  text: string;
  heard: number;
  /** Nombre de mots attendus dans la plage (`words`), pour vérifier que le découpage s'aligne. */
  total: number | null;
  follow: boolean;
}) {
  const layout = useMemo(() => layoutArabicWords(text), [text]);
  const aligned = follow && (total === null || layout.wordCount === total);
  return (
    <>
      {layout.parts.map((part, i) => {
        if (part.word === null) return <span key={i}>{part.text}</span>;
        const cls = !aligned
          ? "w"
          : part.word < heard
            ? part.word === heard - 1
              ? "w on"
              : "w"
            : "w next";
        return (
          <span key={i} className={cls}>
            {part.text}
          </span>
        );
      })}
    </>
  );
}

export function TranslationBlock({
  translation,
  label,
}: {
  translation: LiveTranslation;
  label: string;
}) {
  return (
    <>
      <div className="sepline" />
      <div className="tr-lbl">{label}</div>
      <p className="tr" lang="fr">
        {splitNoteMarkers(translation.text).map((piece, i) =>
          piece.note ? <sup key={i}>{piece.text}</sup> : piece.text,
        )}
      </p>
      <p className="attr">
        {translation.attribution} · {translation.translation_id} · source{" "}
        {translation.version}
      </p>
    </>
  );
}

function Header({ label, tools }: { label: string; tools: React.ReactNode }) {
  return (
    <div className="pass-h">
      <span className="eyebrow">{label}</span>
      {tools}
    </div>
  );
}

function HeroSvg() {
  return (
    <svg className="hero" viewBox="0 0 420 110" fill="none" aria-hidden="true">
      <path
        d="M8 55h404"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeDasharray="1 6"
        strokeLinecap="round"
      />
      <g stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
        {[150, 162, 174, 186, 198].map((x, i) => {
          const h = [10, 22, 34, 18, 8][i];
          return <path key={x} d={`M${x} ${55 - h}v${2 * h}`} />;
        })}
        {[222, 234, 246, 258, 270].map((x, i) => {
          const h = [8, 16, 30, 20, 10][i];
          return <path key={x} d={`M${x} ${55 - h}v${2 * h}`} />;
        })}
      </g>
      <path d="M210 40l15 15-15 15-15-15z" fill="var(--accent)" stroke="none" />
      <path
        d="M62 30a40 40 0 0 0 0 50M34 16a68 68 0 0 0 0 78M358 30a40 40 0 0 1 0 50M386 16a68 68 0 0 1 0 78"
        stroke="var(--accent)"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity=".55"
      />
    </svg>
  );
}

type Props = {
  state: LiveState;
  fontTools: React.ReactNode;
  showTranslation: boolean;
  retryIn: number | null;
  onStart: () => void;
  /** Nom de la sourate annoncée en récitation guidée (texte d'accueil adapté). */
  guidedSurah?: string | null;
};

export function Stage({
  state,
  fontTools,
  showTranslation,
  retryIn,
  onStart,
  guidedSurah = null,
}: Props) {
  const view = viewOf(state);
  const wrap = (children: React.ReactNode, extra = "") => (
    <div data-testid="live-stage" data-view={view} className={extra}>
      {children}
    </div>
  );

  if (view === "idle")
    return wrap(
      <article
        className="pass pass--center pass--idle"
        aria-labelledby="st-title"
      >
        <span className="eyebrow eyebrow--start">En direct</span>
        <HeroSvg />
        <h2 className="pass-title" id="st-title">
          Récite, je t’écoute.
        </h2>
        <p className="pass-sub">
          {guidedSurah
            ? `Tu as annoncé la sourate ${guidedSurah} : le moteur ne cherche que dedans et suit les versets qui viennent après.`
            : "Le moteur reconnaît les versets pendant que tu récites, sans que tu aies à dire de quelle sourate il s’agit."}
        </p>
        <ul className="lv-legend" aria-label="Comment lire l’écran">
          <li>
            <span className="sw s-pending" />
            <span>
              <b>Candidats</b> : plusieurs versets commencent pareil, je garde
              les possibilités ouvertes et je n’écris aucun nom.
            </span>
          </li>
          <li>
            <span className="sw s-recognized" />
            <span>
              <b>Reconnu</b> : les mots entendus départagent, le verset est
              nommé, avec son texte et sa traduction.
            </span>
          </li>
          <li>
            <span className="sw s-inferred" />
            <span>
              <b>Déduit de la position</b> : le texte est entendu, mais
              plusieurs versets sont identiques, le numéro vient de la suite de
              ce que tu récitais.
            </span>
          </li>
          <li>
            <span className="sw s-uncertain" />
            <span>
              <b>Pas de verset nommé</b> : c’est normal, je préfère me taire
              plutôt que me tromper.
            </span>
          </li>
        </ul>
        <div className="promise">
          <p>
            <Icon name="clock" />
            <span>
              <b>Compte environ 5 secondes</b> avant un premier nom, parfois
              plus de 20 s si la récitation est lente ou difficile à entendre.
              Ce n’est pas une panne.
            </span>
          </p>
          <p>
            <Icon name="mic" />
            <span>
              <b>Le micro ne s’ouvre qu’au clic</b>, après ton accord dans le
              navigateur.
            </span>
          </p>
          <p>
            <Icon name="lock" />
            <span>
              <b>Le son n’est pas conservé sur le serveur.</b> Ton navigateur le
              garde en mémoire pendant l’écoute, pour te laisser choisir à la
              fin de le garder pour une analyse complète ou de ne rien garder.
              Rien n’en sort sans ton geste.
            </span>
          </p>
        </div>
        <details className="about">
          <summary>À propos de cette écoute</summary>
          <p>
            En direct, le moteur suit les mots entendus et nomme un verset
            seulement quand il est sûr. La vérification acoustique et la
            réécoute des passages douteux ne sont pas encore branchées : une
            correction automatique est donc rare. Le décalage audio réglé dans
            tes préférences ne s’applique pas ici (rien n’est joué, la voix
            vient de la salle). La police Hafs V30 n’est servie qu’à
            l’ordinateur qui héberge l’atelier ; ailleurs, l’écran retombe sur
            Amiri Quran.
          </p>
        </details>
      </article>,
    );

  if (view === "perm")
    return wrap(
      <article className="pass pass--center" aria-labelledby="st-title">
        <span className="eyebrow eyebrow--start">Étape 1 sur 2</span>
        <Hearing still />
        <h2 className="pass-title" id="st-title">
          Autorise le micro
        </h2>
        <p className="pass-sub">
          Ton navigateur va te demander l’accès au micro. Choisis « Autoriser »
          pour que je puisse t’écouter. Rien n’est envoyé tant que tu n’as pas
          répondu.
        </p>
      </article>,
    );

  if (view === "conn")
    return wrap(
      <article className="pass pass--center" aria-labelledby="st-title">
        <span className="eyebrow eyebrow--start">Étape 2 sur 2</span>
        <Hearing still />
        <h2 className="pass-title" id="st-title">
          Connexion au service d’écoute…
        </h2>
        <p className="pass-sub">
          Quelques secondes. Le micro est ouvert, mais aucun son n’est envoyé
          avant que la connexion soit prête.
        </p>
      </article>,
    );

  if (view === "err") {
    const text = LIVE_ERRORS[state.errorKey ?? "internal"];
    return wrap(
      <article className="pass" role="alert" aria-labelledby="st-title">
        <span className="eyebrow">Écoute impossible</span>
        <div className="lnotice lnotice--danger lnotice--wide">
          <Icon name={text.icon} />
          <div>
            <p>
              <b id="st-title">{text.title}</b>
            </p>
            <p>
              <b>Pourquoi.</b> {text.cause}
            </p>
            <p>
              <b>Ce que ça change.</b> {text.impact}
            </p>
            <p>
              <b>Que faire.</b> {text.todo}
            </p>
            {state.errorMessage ? (
              <p className="meta">
                Message du service : « {state.errorMessage} »
              </p>
            ) : null}
            {retryIn !== null ? (
              <p className="meta" data-testid="live-retry-in">
                Nouvel essai automatique dans {retryIn} s.
              </p>
            ) : null}
          </div>
        </div>
        <div className="end-acts">
          {text.retry ? (
            <button
              type="button"
              className="btn btn--primary"
              data-testid="live-start"
              onClick={onStart}
            >
              {retryIn !== null ? "Réessayer maintenant" : "Réessayer"}
            </button>
          ) : null}
          <Link className="btn btn--secondary" href="/?vue=new">
            Enregistrer puis analyser
          </Link>
        </div>
      </article>,
    );
  }

  if (view === "end") return null;

  const tools = fontTools;

  if (view === "listen") {
    const quiet = quietHint(state);
    return wrap(
      <article
        className="pass pass--center pass--listen"
        aria-labelledby="st-title"
      >
        <span className="eyebrow eyebrow--start">Passage en cours</span>
        <Hearing still={state.phase === "paused"} />
        <h2 className="pass-title" id="st-title">
          {state.phase === "paused"
            ? "En pause"
            : quiet
              ? "Je n’entends rien pour l’instant"
              : "Je t’écoute."}
        </h2>
        <p className="pass-sub">
          {state.phase === "paused"
            ? "Rien de ce que dit le micro n’est envoyé. Reprends quand tu veux."
            : quiet
              ? `Aucun son depuis ${Math.floor(silenceS(state))} s. Si tu récites, rapproche le micro ou vérifie qu’il n’est pas coupé. Je garde le dernier verset et je reprends dès que tu continues.`
              : "Rien d’entendu qui permette de nommer un verset. Je ne montre que ce dont je suis sûr."}
        </p>
      </article>,
    );
  }

  if (view === "cands" && state.cand) {
    const c = state.cand;
    const stage = patienceStage(state);
    return wrap(
      <article className="pass" aria-labelledby="st-title">
        <Header label="Passage en cours" tools={tools} />
        <div className="pass-meta">
          <span className="badge badge--outline">
            <span className="sw s-pending" />
            Candidats
          </span>
          <span className="rng">
            {plural(c.wordsHeard, "mot entendu", "mots entendus")}
          </span>
        </div>
        <div className="candwrap" id="st-title">
          <span
            className="candcount"
            aria-label={`${c.count} versets possibles`}
            data-testid="live-cand-count"
          >
            {c.count}
          </span>
          <span className="l">
            {c.count > 1 ? "versets possibles" : "verset possible"}
          </span>
        </div>
        {state.trail.length > 1 ? (
          <div className="funnel" aria-label="Évolution du nombre de candidats">
            {state.trail.map((n, i) => (
              <span key={i} style={{ display: "contents" }}>
                {i ? (
                  <span className="ar-sep" aria-hidden="true">
                    →
                  </span>
                ) : null}
                <span className={i === state.trail.length - 1 ? "n now" : "n"}>
                  {n}
                </span>
              </span>
            ))}
          </div>
        ) : null}
        {stage > 0 ? (
          <div
            className="patience"
            data-testid="live-patience"
            data-stage={stage}
          >
            <Icon name="clock" />
            <span>{PATIENCE_TEXT[stage]}</span>
          </div>
        ) : null}
        <div className="ar" lang="ar" dir="rtl" aria-label="Mots entendus">
          {c.heardText ? (
            <>
              <span className="w">{c.heardText}</span>{" "}
            </>
          ) : null}
          <span className="slot" aria-hidden="true" />
        </div>
        {!c.heardText ? (
          <p className="pass-note">Rien de commun à montrer encore.</p>
        ) : null}
        {showTranslation && c.translation ? (
          <TranslationBlock
            translation={c.translation}
            label={`Traduction : la même pour les ${c.count} versets possibles`}
          />
        ) : null}
        <p className="pass-note">
          <b>Pas encore nommé.</b>{" "}
          {c.translation
            ? "Ces versets ont exactement le même texte : seule la suite de ce que tu récitais peut dire lequel est le bon."
            : "Le texte ci-dessus est celui que tous les candidats ont en commun. Un mot de plus peut départager."}
        </p>
        {c.piste ? (
          <div className="piste">
            <Icon name="info" />
            <span>
              Piste : la suite attendue serait <b>{c.piste}</b> · pas encore
              confirmée
            </span>
          </div>
        ) : null}
        {c.refs.length ? (
          <details className="pistes">
            <summary>
              Voir les pistes ({c.refs.length} sur {c.count})
            </summary>
            <ul>
              {c.refs.map((ref) => (
                <li key={ref}>{ref}</li>
              ))}
            </ul>
            <p>
              Références seulement : un verset n’est montré, avec son texte, que
              lorsqu’il est nommé.
            </p>
          </details>
        ) : null}
      </article>,
    );
  }

  if ((view === "named" || view === "inferred") && state.lock) {
    const lock = state.lock;
    const inferred = view === "inferred";
    const total = lock.words ? lock.words[1] - lock.words[0] + 1 : null;
    const layoutWords = lock.text ? layoutArabicWords(lock.text).wordCount : 0;
    const followable =
      lock.text !== null && (total === null || layoutWords === total);
    return wrap(
      <article className="pass" aria-labelledby="st-title">
        <Header label="Passage en cours" tools={tools} />
        <div className="pass-meta">
          <span className="badge">
            <span className={inferred ? "sw s-inferred" : "sw s-recognized"} />
            {inferred ? "Déduit de la position" : "Reconnu"}
          </span>
          <span
            className={inferred ? "ref ref--ded" : "ref"}
            id="st-title"
            data-testid="live-ref"
          >
            {verseName(lock.ref)}
          </span>
          {lock.repetition ? <span className="lv-tag">Reprise</span> : null}
        </div>
        {lock.text ? (
          <div className="ar" lang="ar" dir="rtl" data-testid="live-arabic">
            <Words
              text={lock.text}
              heard={lock.wordsHeard}
              total={total}
              follow={followable}
            />
          </div>
        ) : (
          <p className="pass-note">
            Le texte de ce verset n’est pas disponible.
          </p>
        )}
        {followable && total ? (
          <div className="prog">
            <span className="lv-meter" aria-hidden="true">
              <i
                style={
                  {
                    "--p": `${Math.round((100 * Math.min(lock.wordsHeard, total)) / total)}%`,
                  } as React.CSSProperties
                }
              />
            </span>
            <span data-testid="live-words-heard">
              {Math.min(lock.wordsHeard, total)} / {total} mots entendus
            </span>
          </div>
        ) : lock.text ? (
          <p className="pass-note">
            <Icon name="info" className="sm" /> Suivi mot à mot indisponible
            pour ce verset : le verset entier est montré, sans surlignage.
          </p>
        ) : null}
        {inferred ? (
          <div className="lnotice lnotice--info lnotice--wide">
            <Icon name="info" />
            <div>
              <p>
                <b>Entendu, mais pas reconnu à la voix.</b> Ce texte existe à
                l’identique ailleurs dans le Coran. Le numéro{" "}
                {verseName(lock.ref)} vient de la suite de ce que tu venais de
                réciter.
              </p>
            </div>
          </div>
        ) : null}
        {showTranslation && lock.translation ? (
          <TranslationBlock
            translation={lock.translation}
            label="Traduction du verset"
          />
        ) : null}
        {showTranslation && !lock.translation && lock.translationUnavailable ? (
          <p className="pass-note">
            La traduction n’est pas disponible pour l’instant.
          </p>
        ) : null}
      </article>,
    );
  }

  if (view === "unres" && state.unres) {
    const last = state.hist.find((h) => h.kind === "unres");
    const heardText = last && last.kind === "unres" ? last.heardText : null;
    const words = last && last.kind === "unres" ? last.wordsHeard : 0;
    return wrap(
      <article className="pass" aria-labelledby="st-title">
        <Header label="Passage en cours" tools={tools} />
        <div className="pass-meta">
          <span className="badge badge--outline">
            <span className="sw s-uncertain" />
            Pas de verset nommé
          </span>
          {words ? (
            <span className="rng">
              {plural(words, "mot entendu", "mots entendus")}
            </span>
          ) : null}
        </div>
        <h2 className="pass-title" id="st-title">
          Pas de verset nommé pour l’instant
        </h2>
        <p className="pass-sub">
          J’ai entendu ce passage, mais plusieurs versets conviennent : je ne le
          nomme pas plutôt que de risquer un faux nom.
        </p>
        {heardText ? (
          <div className="ar" lang="ar" dir="rtl" aria-label="Mots entendus">
            <span className="w">{heardText}</span>
          </div>
        ) : null}
        <p className="pass-note">
          <b>Ce n’est pas une erreur.</b> En direct, un verset sur trois environ
          n’est jamais nommé (65 % nommés sur le banc de test, un jeu en studio
          : sur une voix réelle, attends moins) ; les versets très courts en
          font partie. Si tu gardes l’enregistrement, l’analyse complète peut en
          nommer davantage. Je continue d’écouter.
        </p>
        {state.jump ? (
          <div className="piste">
            <Icon name="jump" />
            <span>
              {JUMP_TEXT[state.jump.kind]} La suite ne correspond pas à ce que
              j’attendais.
            </span>
          </div>
        ) : null}
      </article>,
    );
  }

  if (view === "jump" && state.jump)
    return wrap(
      <article className="pass pass--center" aria-labelledby="st-title">
        <span className="eyebrow eyebrow--start">Passage en cours</span>
        <Hearing />
        <h2 className="pass-title" id="st-title">
          Le passage change
        </h2>
        <p className="pass-sub">
          {JUMP_TEXT[state.jump.kind]} Je n’écris aucun nom avant d’avoir
          entendu assez de mots.
        </p>
      </article>,
    );

  if (view === "nonquran")
    return wrap(
      <article className="pass pass--center" aria-labelledby="st-title">
        <span className="eyebrow eyebrow--start">Passage en cours</span>
        <span className="badge badge--outline">
          <span className="sw s-formula" />
          Parole non coranique
        </span>
        <h2 className="pass-title" id="st-title">
          Ce n’est pas une récitation
        </h2>
        <p className="pass-sub">
          Je ne montre rien tant que ce n’est pas du Coran. Dès qu’une
          récitation reprend, elle apparaît ici.
        </p>
      </article>,
    );

  if (view === "between" && state.between) {
    const b = state.between;
    return wrap(
      <article className="pass pass--dim" aria-labelledby="st-title">
        <Header label="Verset terminé" tools={tools} />
        <div className="pass-meta">
          <span className="badge badge--outline">Terminé</span>
          <span className="ref" id="st-title">
            {verseName(b.ref)}
          </span>
          {b.revised ? (
            <span className="lv-tag lv-tag--warn">Corrigé</span>
          ) : null}
        </div>
        {b.text ? (
          <div className="ar" lang="ar" dir="rtl">
            {b.text}
          </div>
        ) : null}
        {showTranslation && b.translation ? (
          <p className="tr" lang="fr" style={{ opacity: 0.8 }}>
            {splitNoteMarkers(b.translation.text).map((piece, i) =>
              piece.note ? <sup key={i}>{piece.text}</sup> : piece.text,
            )}
          </p>
        ) : null}
        <p className="pass-note">
          <b>J’écoute la suite…</b>{" "}
          {b.expected
            ? `Suite attendue : ${b.expected} (pas encore confirmée). `
            : ""}
          {quietHint(state)
            ? `Aucun son depuis ${Math.floor(silenceS(state))} s : rapproche le micro si tu récites.`
            : ""}
        </p>
      </article>,
    );
  }

  return null;
}
