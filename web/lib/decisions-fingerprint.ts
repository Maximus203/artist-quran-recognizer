import { createHash } from "node:crypto";
import { DecisionsError } from "./decisions";

/**
 * Empreinte d'un intervalle du moteur (ADR-0014) : l'identité d'un passage, figée. Le miroir exact de
 * `src/aqr/decisions/fingerprint.py` : mêmes clés, temps en millisecondes entières `floor(x×1000+0,5)`
 * (le demi vers le haut, comme `Math.round` pour les positifs mais sans dépendre d'un détail
 * d'arrondi), JSON compact aux clés triées. Les vecteurs de `tests/fixtures/decisions/` le vérifient.
 */
export type EngineInterval = {
  kind: string;
  ref?: string | null;
  words?: readonly number[] | null;
  status?: string | null;
  t?: readonly number[] | null;
  candidates?: readonly string[] | null;
};

const millis = (seconds: number): number => Math.floor(seconds * 1000 + 0.5);

export function canonicalInterval(interval: EngineInterval): {
  candidates: string[];
  kind: "verse";
  ref: string | null;
  status: string | null;
  t: [number, number] | null;
  words: [number, number] | null;
} {
  if (interval.kind !== "verse")
    throw new DecisionsError("seul un intervalle « verse » a une empreinte");
  const { t, words } = interval;
  return {
    candidates: [...(interval.candidates ?? [])].map(String),
    kind: "verse",
    ref: interval.ref ?? null,
    status: interval.status ?? null,
    t: t ? [millis(t[0]), millis(t[1])] : null,
    words: words ? [Math.trunc(words[0]), Math.trunc(words[1])] : null,
  };
}

/** Les clés dans l'ordre alphabétique, sans espace : ce que Python écrit avec `sort_keys` et `(",", ":")`. */
export function intervalFingerprint(interval: EngineInterval): string {
  const c = canonicalInterval(interval);
  const text = JSON.stringify({
    candidates: c.candidates,
    kind: c.kind,
    ref: c.ref,
    status: c.status,
    t: c.t,
    words: c.words,
  });
  return createHash("sha256").update(text, "utf8").digest("hex");
}
