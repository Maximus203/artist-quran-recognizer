/**
 * Fixtures de test dérivées de la session « Hud 11:61–90 » (intervalles 3 → 4 : la lecture revient
 * en arrière et reprend un passage déjà récité). Le découpage de la traduction en segments et les
 * temps des mots sont ILLUSTRATIFS : ils reproduisent la forme du contrat de données (`word_times`,
 * `translation.segments`, `translation.fragment`) sans prétendre être la sortie du moteur. Les
 * textes sont ceux de la session (corpus Tanzil, traduction QuranEnc), limités aux mots affichés.
 */
import type { Interval } from "../recognition";

const SEGMENTS = [
  {
    words: [1, 5],
    text: "Et (Nous avons envoyé) au Thamûd, leur frère Sâlih, qui dit :",
  },
  { words: [6, 8], text: '"Ô mon peuple ! Adorez Allah.' },
  { words: [9, 13], text: "Vous n’avez point de divinité en dehors de Lui." },
  { words: [14, 17], text: "De la terre Il vous a créé," },
  { words: [18, 19], text: "et Il vous l’a fait peupler (et exploiter)." },
  {
    words: [20, 23],
    text: "Implorez donc Son pardon, puis repentez-vous à Lui !",
  },
  {
    words: [24, 27],
    text: 'Mon Seigneur est bien proche et Il répond toujours (aux appels)."',
  },
] as const;

export const VERSE_TRANSLATION_TEXT = SEGMENTS.map((s) => s.text).join(" ");

const base = {
  translation_id: "french_hameedullah",
  version: "quranenc.com",
  attribution:
    "QuranEnc.com — Muhammad Hamidullah (révision du Complexe du Roi Fahd)",
};

/** Traduction du verset entier, sans le moindre champ du nouveau contrat (ancien résultat). */
export const TRANSLATION_LEGACY = {
  ...base,
  text: VERSE_TRANSLATION_TEXT,
  scope: "verse" as const,
};

/** Traduction découpée, mais pas encore ramenée au passage (`scope: "verse"`). */
export const TRANSLATION_SEGMENTED = {
  ...TRANSLATION_LEGACY,
  segments: SEGMENTS.map((s) => ({ words: [...s.words], text: s.text })),
};

const text3 =
  "لَكُم مِّنْ إِلَـٰهٍ غَيْرُهُۥ ۖ هُوَ أَنشَأَكُم مِّنَ ٱلْأَرْضِ";
const text4 =
  "أَنشَأَكُم مِّنَ ٱلْأَرْضِ وَٱسْتَعْمَرَكُمْ فِيهَا فَٱسْتَغْفِرُوهُ ثُمَّ تُوبُوٓا۟ إِلَيْهِ ۚ";

const verse = (over: Record<string, unknown>): Interval =>
  ({
    kind: "verse",
    ref: "11:61",
    partial: true,
    status: "recognized",
    time_interpolated: false,
    confidence: 0.86,
    candidates: [],
    repetition: false,
    ...over,
  }) as unknown as Interval;

/** Intervalle 3 : mots 10 à 17, 35,688 – 48,087 s. 8 mots (le signe ۖ n'est pas un mot). */
export const INTERVAL_3 = verse({
  words: [10, 17],
  t: [35.688, 48.087],
  text: text3,
  word_times: [
    [35.9, 36.8],
    [36.8, 37.6],
    [37.6, 39.0],
    [39.0, 40.6],
    [41.4, 42.2],
    [42.2, 44.0],
    [44.0, 45.2],
    [45.2, 47.9],
  ],
  word_times_source: "ctc-alignment",
  translation: {
    ...TRANSLATION_LEGACY,
    scope: "fragment",
    segments: TRANSLATION_SEGMENTED.segments,
    fragment: {
      words: [10, 17],
      text: `${SEGMENTS[2].text} ${SEGMENTS[3].text}`,
      approximate: true,
      ellipsis_before: true,
      ellipsis_after: true,
    },
  },
});

/** Intervalle 4 : reprise (mots 15 à 23), 55,12 – 77,955 s ; démarre au milieu d'un segment. */
export const INTERVAL_4 = verse({
  words: [15, 23],
  t: [55.12, 77.955],
  text: text4,
  repetition: true,
  confidence: 0.75,
  word_times: [
    [55.3, 57.5],
    [57.5, 59.0],
    [59.0, 61.5],
    [62.4, 66.0],
    [66.0, 68.5],
    [68.5, 71.0],
    [71.0, 72.8],
    [72.8, 75.0],
    [75.0, 77.8],
  ],
  word_times_source: "ctc-alignment",
  translation: {
    ...TRANSLATION_LEGACY,
    scope: "fragment",
    segments: TRANSLATION_SEGMENTED.segments,
    fragment: {
      words: [15, 23],
      text: `${SEGMENTS[3].text} ${SEGMENTS[4].text} ${SEGMENTS[5].text}`,
      approximate: true,
      ellipsis_before: true,
      ellipsis_after: true,
    },
  },
});

/** Les mêmes intervalles tels qu'ils sortent d'un ancien moteur : ni temps de mots ni découpage. */
export const INTERVAL_3_LEGACY = verse({
  words: [10, 17],
  t: [35.688, 48.087],
  text: text3,
  translation: TRANSLATION_LEGACY,
});
export const INTERVAL_4_LEGACY = verse({
  words: [15, 23],
  t: [55.12, 77.955],
  text: text4,
  repetition: true,
  translation: TRANSLATION_LEGACY,
});

/** Les deux passages dans l'ordre de la session, avec l'intervalle d'avant et celui d'après. */
export const SESSION_SLICE: Interval[] = [
  { kind: "non_quran", label: "basmala", t: [9.83, 14.87] } as Interval,
  INTERVAL_3,
  INTERVAL_4,
  verse({
    words: [24, 27],
    t: [83.44, 93.6],
    text: "إِنَّ رَبِّى قَرِيبٌ مُّجِيبٌ",
    translation: TRANSLATION_LEGACY,
  }),
];
