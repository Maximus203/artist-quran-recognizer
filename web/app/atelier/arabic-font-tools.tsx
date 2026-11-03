"use client";
import type { Interval } from "@/lib/recognition";
import { QURAN_SIZE, clampQuranSize } from "@/lib/ui-prefs";
import { FontPicker, FONT_SAMPLE } from "./font-picker";
import { useMedia } from "./hooks";
import { useShell } from "./shell";

/** Police arabe et A− / A+ de la carte « Passage actif » (même réglage sur la lecture et sur les playlists). */
export function ArabicFontTools({
  intervals,
}: {
  intervals: readonly Interval[];
}) {
  const { prefs, update, font, fontAvailability } = useShell();
  const narrow = useMedia("(max-width: 767px)");
  const defaultSize = narrow ? 32 : QURAN_SIZE.fallback;
  const first = intervals.find(
    (i) => i.kind === "verse" && typeof i.text === "string" && i.text,
  );
  const sample =
    first && first.kind === "verse" && first.text
      ? first.text.split(/\s+/).slice(0, 5).join(" ")
      : FONT_SAMPLE;
  return (
    <FontPicker
      font={font}
      availability={fontAvailability}
      size={prefs.arabicSize}
      appliedSize={clampQuranSize(prefs.arabicSize ?? defaultSize)}
      sample={sample}
      onFont={(id) => update({ arabicFont: id })}
      onSize={(px) => update({ arabicSize: clampQuranSize(px) })}
      onReset={() => update({ arabicFont: null, arabicSize: null })}
    />
  );
}
