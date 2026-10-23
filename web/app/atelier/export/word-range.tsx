"use client";
import { useState } from "react";
import { wordsLabel } from "@/lib/export-text";

/**
 * Choisir une plage de mots : les mots du verset (texte du corpus, jamais saisi) en jetons, de droite à
 * gauche ; toucher le premier puis le dernier trace la plage. Les deux champs numériques sont le repli
 * (au tactile, viser un jeton est la partie la moins évidente).
 */
export function WordRange({
  tokens,
  value,
  onChange,
  label,
}: {
  tokens: readonly string[];
  value: [number, number];
  onChange: (range: [number, number]) => void;
  label: string;
}) {
  const [anchor, setAnchor] = useState<number | null>(null);
  const total = tokens.length;
  const pick = (word: number) => {
    if (anchor === null) {
      setAnchor(word);
      onChange([word, word]);
    } else {
      onChange([Math.min(anchor, word), Math.max(anchor, word)]);
      setAnchor(null);
    }
  };
  const field = (which: 0 | 1, text: string) => (
    <label className="ex-fld">
      {text}
      <input
        className="input mono"
        inputMode="numeric"
        value={value[which]}
        aria-label={`${text} (de 1 à ${total})`}
        onChange={(event) => {
          const n = Number(event.target.value.replace(/\D/g, ""));
          if (!Number.isInteger(n) || n < 1 || n > total) return;
          onChange(
            which === 0
              ? [Math.min(n, value[1]), Math.max(n, value[1])]
              : [Math.min(value[0], n), Math.max(value[0], n)],
          );
        }}
      />
    </label>
  );
  return (
    <div className="ex-word-range" data-testid="word-range">
      <p
        className="muted"
        style={{ fontSize: "var(--fs-sm)" }}
        aria-live="polite"
      >
        {label} : <b>{wordsLabel(value)}</b> sur {total}
        {anchor !== null ? " · choisis le dernier mot" : ""}
      </p>
      <div
        className="ex-tokens"
        lang="ar"
        dir="rtl"
        role="group"
        aria-label="Mots du verset"
      >
        {tokens.map((token, i) => {
          const word = i + 1;
          const inside = word >= value[0] && word <= value[1];
          return (
            <button
              key={word}
              type="button"
              className="ex-token"
              aria-pressed={inside}
              aria-label={`Mot ${word}`}
              data-testid={`token-${word}`}
              onClick={() => pick(word)}
            >
              {token}
            </button>
          );
        })}
      </div>
      <div className="ex-ref-inputs ex-two">
        {field(0, "Mot début")}
        {field(1, "Mot fin")}
      </div>
    </div>
  );
}
