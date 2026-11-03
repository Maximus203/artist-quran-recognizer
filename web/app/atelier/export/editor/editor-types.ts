import type { ComponentType, ReactNode } from "react";
import type { VideoPrefs } from "@/lib/export-video-prefs";
import type { ListeningPeaks } from "@/lib/listening";
import type { Interval } from "@/lib/recognition";
import type { BackgroundVideoValue } from "../background-video-view";

/**
 * Les trois éditeurs de la vidéo d'export (vue téléphone ; au bureau, une seule vue unifiée sert tous les
 * rôles). Le choix de l'éditeur se fait ailleurs (préférence du compte, phase « choix du format ») : ce
 * module ne fait que NOMMER les éditeurs et décrire ce que chacun reçoit.
 *
 *  - `plateau` : l'aperçu est l'éditeur ; on touche un élément, sa barre d'outils apparaît.
 *  - `table`   : la table de montage (aperçu, chronologie, rail d'outils).
 *  - `pas`     : le pas à pas en trois étapes.
 */
export const EDITOR_MODES = ["plateau", "table", "pas"] as const;
export type EditorMode = (typeof EDITOR_MODES)[number];

/** L'éditeur d'avant tout choix (la préférence arrive avec la phase « choix du format »). */
export const DEFAULT_EDITOR_MODE: EditorMode = "plateau";

export const isEditorMode = (value: unknown): value is EditorMode =>
  typeof value === "string" &&
  (EDITOR_MODES as readonly string[]).includes(value);

/** D'où viennent l'image et le son de l'aperçu : ce que `VideoPreview` lit, sans les réglages. */
export type PreviewSource = {
  intervals: readonly Interval[] | null;
  peaks: ListeningPeaks | null;
  /** Image de fond choisie par la personne. */
  upload: File | null;
  /** Vidéo de fond choisie (muette). */
  clip?: File | null;
  isVideo: boolean;
  sourceSize: { width: number; height: number } | null;
  /** Instant montré (image fixe) : absent = le verset le plus long. */
  at?: number | null;
  /** Attribution de la traduction (« QuranEnc.com — Hamidullah »), jamais séparée d'elle (I2). */
  attribution?: string | null;
};

/** Ce que la section « Cadre » règle : format, fond, vidéo de fond. */
export type FrameControls = {
  isVideo: boolean;
  sourceSize: { width: number; height: number } | null;
  /** La session est une vidéo dont l'image est illisible : « Vidéo d'origine » n'est pas proposée. */
  sourceUnreadable: boolean;
  /** L'aperçu de ce navigateur n'affiche pas l'image de la vidéo d'origine (l'export, si). */
  previewUnavailable: boolean;
  /** Fond coché : id d'un fond proposé, « upload », « color », « video » ou « source ». */
  selectedBg: string;
  upload: File | null;
  uploadThumb: string | null;
  onUpload: (file: File | null) => void;
  onChooseBg: (id: string) => void;
  /**
   * EMPLACEMENT du fond vidéo (« Ma propre vidéo » : choix, boucle, portion), livré par la phase
   * « transport du fond vidéo ». Absent tant qu'elle n'est pas fusionnée.
   */
  backgroundVideo?: ReactNode;
};

/** Ce que le bouton « Exporter » fait : il ouvre la fenêtre-résumé existante. */
export type ExportAction = {
  /** « Exporter », « Exporter 3 vidéos »… */
  label: string;
  /** Une courte phrase sous le titre (« 1 vidéo · ≈ 4 Mo »). */
  summary: string;
  disabled: boolean;
  /** Une phrase quand l'export est en cours ou terminé (« Vidéo 1 sur 2 · 40 % »). */
  status?: string | null;
  onOpen: () => void;
};

/**
 * Tout ce qu'un éditeur reçoit. Le panneau « Vidéo » garde les données, les passages, la qualité et
 * l'export ; les éditeurs ne font que les ranger à l'écran.
 */
export type EditorProps = {
  sessionId: string;
  /** Nom de la session et une ligne d'information (barre du haut). */
  title: string;
  subtitle: string;
  prefs: VideoPrefs;
  patch: PatchPrefs;
  preview: PreviewSource;
  frame: FrameControls;
  passages: {
    /** « Tout l'audio · 8 s », « 3 plages · 25 s ». */
    summary: string;
    /** La version courte pour un bouton (« Tout l'audio », « 3 plages »). */
    short: string;
    /** Contenu de la fenêtre « Passages » (frise, liste, souffle) : fournie par le panneau. */
    content: ReactNode;
    /** Nombre de vidéos qui sortiront (une par plage). */
    count: number;
  };
  /** Qualité, fluidité et poids : rangés dans « Réglages avancés » du cadre. */
  advanced: ReactNode;
  exportAction: ExportAction;
  /** Quitter l'éditeur (retour à la page d'avant) ; absent = pas de bouton retour. */
  onLeave?: () => void;
  /** Ce que la table de montage lit en plus (plages exportées, vidéo de fond choisie) ; absent = sans chronologie du fond. */
  montage?: MontageData;
};

/**
 * Ce que la chronologie de la table de montage lit en plus de l'aperçu : les plages exportées (une vidéo
 * chacune), et la vidéo de fond choisie (sa durée, son départ, son comportement, son fichier pour les
 * vignettes) avec de quoi la changer. Les autres éditeurs n'en ont pas besoin.
 */
export type MontageData = {
  /** Les plages exportées, en secondes de la session. */
  ranges: ReadonlyArray<{ id: number; start: number; end: number }>;
  /** La plus longue (s) : borne le départ de la vidéo de fond, comme la section « Vidéo de fond ». */
  longest: number;
  /** La vidéo de fond choisie, prête sur le serveur, ou `null` (image, dégradé, couleur ou vidéo d'origine). */
  clip: BackgroundVideoValue | null;
  /** Change la vidéo de fond (départ, comportement) : même chemin que la section « Vidéo de fond ». */
  onClip: (value: BackgroundVideoValue | null) => void;
};

/**
 * Enregistre des réglages : un objet partiel, ou une fonction qui part des réglages LES PLUS RÉCENTS (deux
 * pas rapprochés d'un appui long ne se perdent pas l'un l'autre en repartant d'un état périmé).
 */
export type PatchPrefs = (
  next: Partial<VideoPrefs> | ((current: VideoPrefs) => Partial<VideoPrefs>),
) => void;

/** Un éditeur est un composant qui reçoit `EditorProps`. */
export type EditorComponent = ComponentType<EditorProps>;
