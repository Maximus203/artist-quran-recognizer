/**
 * Configuration unique de l'écran d'export vidéo : seuils de poids, règles de la frise, gestes,
 * imagettes. Aucun composant ne porte ces valeurs en dur ; on les calibre ICI.
 *
 * Les seuils de poids (250 / 800 / 500 Mo) sont des POINTS DE DÉPART de la direction artistique
 * (docs/design/export-refonte/SPEC.md §6) : aucune mesure ne les fonde encore. À recalibrer sur de
 * vrais rendus (téléphone Android milieu de gamme, iPhone, bureau).
 */
export const EXPORT_VIDEO_CONFIG = {
  weight: {
    /** Au-delà : « lourd » (motif hachuré + libellé). */
    warnMb: 250,
    /** Au-delà : « très lourd » (motif pointillé + libellé). */
    dangerMb: 800,
    /** Un seul fichier au-delà : « très lourd », même si le total reste raisonnable. */
    fileDangerMb: 500,
    /** Fin de la jauge. */
    gaugeMaxMb: 1000,
    /** Toujours « lourd » à cette qualité, quel que soit le poids. */
    alwaysHeavy: { resolution: 2160, fps: 60 },
  },
  render: {
    /** « ≈ moitié de la durée à 30 im/s » (description de l'outil MCP export_video, non mesurée au-delà). */
    secondsPerAudioSecond: 0.5,
    /** Au-delà de cette résolution ou à 60 im/s, rien ne mesure encore la durée : « plus de … ». */
    measuredMaxResolution: 1080,
    measuredMaxFps: 30,
  },
  /** Souffle gardé autour de la voix, côté formulaire (l'API accepte jusqu'à 5 s). */
  padding: { min: 0, max: 3, step: 0.1 },
  timeline: {
    /** Zoom maximal : jamais moins de 8 s dans la loupe. */
    minSpanSeconds: 8,
    /** Écart visé entre deux repères de la règle. */
    rulerTargetPx: 90,
    rulerSteps: [
      0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600,
    ],
    /** Un bord se colle à un repère du souffle à moins de ce nombre de pixels. */
    snapPx: 10,
    /** Appui long sur une poignée → mode précision. */
    longPressMs: 450,
    /** Mode précision : le geste est démultiplié (×5). */
    precisionScale: 0.2,
    /** En deçà, un geste est un toucher, pas un glisser. */
    moveThresholdPx: 3,
    panThresholdPx: 4,
    /** Tolérance (s) autour d'un passage touché. */
    verseHitSeconds: 0.3,
    /** Marques de silence visibles seulement quand la loupe montre moins de 2 min. */
    silenceMarksMaxSpan: 120,
    /** Plages listées avant « Voir les … autres plages ». */
    visibleRanges: 6,
    /** Une imagette toutes les 64 px. */
    thumbEveryPx: 64,
    /** Molette Ctrl : facteur de zoom par cran. */
    wheelZoomIn: 0.8,
    wheelZoomOut: 1.25,
  },
  keyboard: {
    step: 0.1,
    shiftStep: 1,
    altStep: 0.02,
    pageStep: 10,
    /** Fenêtre d'ensemble : part de la vue déplacée par ←/→ (Maj : la moitié). */
    viewStep: 0.1,
    viewShiftStep: 0.5,
    zoomIn: 0.7,
    zoomOut: 1.4,
  },
  thumbnails: {
    defaultCount: 40,
    maxCount: 120,
    minWidth: 32,
    maxWidth: 320,
    defaultWidth: 96,
    timeoutMs: 120_000,
  },
} as const;

export type WeightLimits = {
  warnMb: number;
  dangerMb: number;
  fileDangerMb: number;
  gaugeMaxMb: number;
  alwaysHeavy: { resolution: number; fps: number };
};
