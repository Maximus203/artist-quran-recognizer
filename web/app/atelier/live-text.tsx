import { Fragment } from "react";
import { splitNoteMarkers, type TranslationView } from "../../lib/passage";
import type { ArabicPart } from "../../lib/live-highlight";
import { activePartIndex } from "../../lib/translation-fragment";

/**
 * Le texte arabe et la traduction du passage actif, avec le surlignage en direct. Présentation
 * seulement : les textes viennent du résultat (corpus pour l'arabe, QuranEnc pour la traduction),
 * rendus tels quels. `aria-current` marque le mot et le segment en cours ; ni l'un ni l'autre n'est
 * une annonce pour un lecteur d'écran (changer un attribut n'en déclenche pas), et le texte du
 * passage ne change pas d'un mot à l'autre.
 */

type ArabicProps = {
  parts: ArabicPart[];
  /** Rang du mot en cours dans la plage affichée, -1 si aucun. */
  active: number;
  /** Un clic sur un mot place le lecteur à son début (lecture à l'arrêt, temps de mots valides). */
  seekable: boolean;
  onSeekWord: (word: number) => void;
};

/** Texte du corpus découpé en mots ; la concaténation des morceaux redonne exactement le texte. */
export function LiveArabic({
  parts,
  active,
  seekable,
  onSeekWord,
}: ArabicProps) {
  const onClick = (event: React.MouseEvent<HTMLElement>) => {
    if (!seekable) return;
    // Une sélection de texte (copier l'arabe) n'est pas un clic pour se déplacer.
    if (!window.getSelection()?.isCollapsed) return;
    const node = (event.target as HTMLElement).closest<HTMLElement>("[data-w]");
    if (node) onSeekWord(Number(node.dataset.w));
  };
  return (
    <span
      data-testid="arabic-text"
      data-seekable={seekable ? "true" : undefined}
      onClick={onClick}
    >
      {parts.map((part, i) =>
        part.word === null ? (
          <Fragment key={i}>{part.text}</Fragment>
        ) : (
          <span
            key={i}
            className="w"
            data-w={part.word}
            aria-current={part.word === active ? "true" : undefined}
          >
            {part.text}
          </span>
        ),
      )}
    </span>
  );
}

type TranslationProps = {
  translation: TranslationView;
  /** Numéro (dans le verset) du mot en cours, `null` si aucun mot n'est suivi. */
  word: number | null;
  /** Le passage est en cours de lecture mais aucun segment ne peut être désigné. */
  passageLive: boolean;
};

const Ellipsis = ({ at }: { at: "before" | "after" }) => (
  <span className="ell" data-at={at} aria-hidden="true">
    …
  </span>
);

export function LiveTranslation({
  translation,
  word,
  passageLive,
}: TranslationProps) {
  const { display } = translation;
  const active = word === null ? -1 : activePartIndex(display, word);
  return (
    <div
      className={passageLive ? "translation is-live" : "translation"}
      data-testid="translation"
      data-scope={display.scope}
    >
      {display.scope === "fragment" && display.wordsRange ? (
        <p className="tr-scope" data-testid="translation-scope">
          Traduction du passage (mots {display.wordsRange[0]}–
          {display.wordsRange[1]})
        </p>
      ) : null}
      <p data-testid="translation-text">
        {display.ellipsisBefore ? (
          <>
            <Ellipsis at="before" />{" "}
          </>
        ) : null}
        {display.parts.map((part, i) => (
          <Fragment key={i}>
            {i > 0 ? " " : null}
            <span
              className="seg"
              data-seg={part.segment ?? undefined}
              aria-current={i === active ? "true" : undefined}
            >
              {splitNoteMarkers(part.text).map((piece, j) =>
                piece.note ? <sup key={j}>{piece.text}</sup> : piece.text,
              )}
            </span>
          </Fragment>
        ))}
        {display.ellipsisAfter ? (
          <>
            {" "}
            <Ellipsis at="after" />
          </>
        ) : null}
      </p>
      <small>
        {translation.partialNote ? "Traduction du verset entier · " : ""}
        {display.scope === "fragment" && display.approximate
          ? "Découpage approximatif · "
          : ""}
        {translation.attribution} · {translation.translationId} · source{" "}
        {translation.version}
      </small>
    </div>
  );
}
