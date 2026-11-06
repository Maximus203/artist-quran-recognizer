"use client";
import { useCallback, useMemo } from "react";
import { api } from "@/lib/api-client";
import {
  freeSpeechByIndex,
  type FreeSpeech,
  type FreeSpeechItem,
  type FreeSpeechReview,
} from "@/lib/free-speech";

/** La parole libre de la session affichée (par rang d'intervalle) et sa relecture (valider / rejeter). */
export function useFreeSpeech(
  sessionId: string | null,
  freeSpeech: FreeSpeech | null | undefined,
  reload: () => Promise<unknown>,
): {
  items: ReadonlyMap<number, FreeSpeechItem>;
  review: (index: number, review: FreeSpeechReview) => void;
} {
  const items = useMemo(
    () => freeSpeechByIndex(freeSpeech ?? null),
    [freeSpeech],
  );
  const review = useCallback(
    (index: number, value: FreeSpeechReview) => {
      if (!sessionId) return;
      void api(`/api/sessions/${sessionId}/free-speech`, {
        method: "PATCH",
        json: { index, review: value },
      })
        .then(() => reload())
        .catch(() => undefined);
    },
    [sessionId, reload],
  );
  return { items, review };
}
