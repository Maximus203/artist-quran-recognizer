"use client";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  activeLayoutKey,
  centerBox,
  nudgeBox,
  setBoxField,
  stepSize,
  type BoxField,
} from "@/lib/export-video-edit";
import {
  describeVisibility,
  fitReport,
  type FitReport,
} from "@/lib/export-video-edit-text";
import {
  canHide,
  isVisible,
  resetBlockBox,
  resetLayout,
  setBlockBox,
  setPanel,
  setTextSize,
  setVisibility,
  stepWaveBox,
  visibilityOf,
} from "@/lib/export-video-editor";
import type { GesturePhase } from "@/lib/export-video-gesture";
import type { CardLayout } from "@/lib/export-video-layout";
import {
  type BlockId,
  type Box,
  type ExportLayout,
  type ExportLayouts,
  type LayoutKey,
  type PanelStyle,
  type TextBlockId,
  type TextStyle,
  type TextStyles,
} from "@/lib/export-video-model";
import type { VideoPrefs } from "@/lib/export-video-prefs";
import type { EditOverlayProps } from "./edit-overlay";
import type { PatchPrefs } from "./editor-types";

/**
 * Le « cerveau » partagé des éditeurs : quel élément est choisi, les réglages tels que l'aperçu doit les
 * montrer PENDANT un geste (brouillon), et chaque changement possible (boîte, taille, fond, affichage…)
 * rendu sous forme d'une fonction. Le plateau, la vue bureau, la table de montage et le pas à pas ne
 * dessinent que leur disposition : ils appellent tous ce contrôleur, donc un réglage se comporte pareil
 * partout. Tous les calculs sont dans `export-video-editor.ts` et `export-video-edit.ts` (fonctions pures,
 * testées) : ce hook ne fait que garder l'état et enregistrer.
 *
 * Pendant un geste, rien n'est enregistré : le brouillon se montre dans l'aperçu ; au relâcher il devient
 * un réglage du compte, à l'annulation il disparaît.
 */

type Draft = { layouts?: ExportLayouts; styles?: TextStyles };

export type EditorController = {
  /** Les réglages enregistrés. */
  committed: VideoPrefs;
  /** Les réglages À MONTRER : les enregistrés, avec le brouillon du geste en cours. */
  prefs: VideoPrefs;
  layoutKey: LayoutKey;
  /** La mise en page du format montré, brouillon compris. */
  layout: ExportLayout;
  styles: TextStyles;
  visible: ReturnType<typeof visibilityOf>;
  /** L'élément choisi ; `null` = rien (les réglages du cadre). */
  selected: BlockId | null;
  select: (id: BlockId | null) => void;
  /** Taille relative de chaque texte, brouillon compris. */
  sizes: Record<TextBlockId, number>;
  /** Ce que l'ajustement du texte à sa zone a fait : « réduit à 87 % ». */
  fit: FitReport;
  /** La dernière phrase à annoncer aux lecteurs d'écran (élément masqué ou affiché) ; l'éditeur la pose dans une région `aria-live`. */
  status: string;
  reportLayout: (card: CardLayout | null) => void;
  /** Tout ce que `EditOverlay` attend. */
  overlay: Pick<
    EditOverlayProps,
    | "layout"
    | "visible"
    | "selected"
    | "sizes"
    | "fit"
    | "onSelect"
    | "onBox"
    | "onSize"
  >;
  // ── changements (chacun enregistre ; renvoient `false` quand rien n'a changé ou que c'est refusé) ──
  setBox: (id: BlockId, box: Box) => void;
  setField: (id: BlockId, field: BoxField, percent: number) => void;
  nudge: (
    id: BlockId,
    key: string,
    modifiers: { shift?: boolean; ctrl?: boolean },
  ) => boolean;
  center: (id: BlockId) => void;
  resetBlock: (id: BlockId) => void;
  resetAll: () => void;
  setSize: (block: TextBlockId, size: number) => void;
  stepTextSize: (block: TextBlockId, direction: 1 | -1) => boolean;
  stepWave: (direction: 1 | -1) => boolean;
  setPanel: (block: TextBlockId, change: Partial<PanelStyle>) => void;
  setTextStyle: (
    block: TextBlockId,
    change: Partial<Pick<TextStyle, "fill" | "valign">>,
  ) => void;
  setVisible: (id: BlockId, shown: boolean) => boolean;
  canHide: (id: BlockId) => boolean;
  /** Couleur du mot récité (null = automatique). */
  setAccent: (accent: VideoPrefs["accent"]) => void;
};

/** Caractère invisible ajouté pour qu'une même phrase soit annoncée deux fois de suite. */
const REPEAT_MARK = String.fromCharCode(0x200b);
const sameReport = (a: FitReport, b: FitReport): boolean =>
  JSON.stringify(a) === JSON.stringify(b);
const sameBox = (a: Box, b: Box): boolean =>
  a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

export function useEditorController({
  prefs: committed,
  patch,
  sourceSize,
}: {
  prefs: VideoPrefs;
  patch: PatchPrefs;
  sourceSize: { width: number; height: number } | null;
}): EditorController {
  const [rawSelected, setSelected] = useState<BlockId | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [fit, setFit] = useState<FitReport>({});
  const [status, setStatus] = useState("");

  const layoutKey = activeLayoutKey(committed.orientation, sourceSize);
  const latest = useRef({ committed, layoutKey });
  latest.current = { committed, layoutKey };

  const prefs = useMemo<VideoPrefs>(
    () => (draft ? { ...committed, ...draft } : committed),
    [committed, draft],
  );
  const visible = useMemo(() => visibilityOf(committed), [committed]);
  // Un élément masqué n'est plus choisi : on retombe sur les réglages du cadre.
  const selected =
    rawSelected && isVisible(committed, rawSelected) ? rawSelected : null;
  const layout = prefs.layouts[layoutKey];
  const styles = prefs.styles;
  const sizes = useMemo(
    () => ({
      ref: styles.ref.size,
      arabic: styles.arabic.size,
      translation: styles.translation.size,
    }),
    [styles],
  );

  const reportLayout = useCallback((card: CardLayout | null) => {
    const next = fitReport(card);
    setFit((previous) => (sameReport(previous, next) ? previous : next));
  }, []);

  const commitBox = useCallback(
    (id: BlockId, box: Box) =>
      patch((current) => ({
        layouts: setBlockBox(
          current.layouts,
          activeLayoutKey(current.orientation, sourceSize),
          id,
          box,
        ),
      })),
    [patch, sourceSize],
  );
  const commitSize = useCallback(
    (block: TextBlockId, size: number) =>
      patch((current) => ({
        styles: setTextSize(current.styles, block, size),
      })),
    [patch],
  );

  const onBox = useCallback(
    (id: BlockId, box: Box, phase: GesturePhase) => {
      const { committed: base, layoutKey: key } = latest.current;
      if (phase === "live")
        setDraft((old) => ({
          ...old,
          layouts: setBlockBox(base.layouts, key, id, box),
        }));
      else {
        setDraft(null);
        if (phase === "end") commitBox(id, box);
      }
    },
    [commitBox],
  );
  const onSize = useCallback(
    (id: BlockId, size: number, phase: GesturePhase) => {
      if (id === "wave") return;
      const { committed: base } = latest.current;
      if (phase === "live")
        setDraft((old) => ({
          ...old,
          styles: setTextSize(base.styles, id, size),
        }));
      else {
        setDraft(null);
        if (phase === "end") commitSize(id, size);
      }
    },
    [commitSize],
  );

  const select = useCallback((id: BlockId | null) => setSelected(id), []);

  const overlay = useMemo(
    () => ({
      layout,
      visible,
      selected,
      sizes,
      fit,
      onSelect: select,
      onBox,
      onSize,
    }),
    [layout, visible, selected, sizes, fit, select, onBox, onSize],
  );

  const boxOf = (id: BlockId): Box =>
    latest.current.committed.layouts[latest.current.layoutKey][id];

  return {
    committed,
    prefs,
    layoutKey,
    layout,
    styles,
    visible,
    selected,
    select,
    sizes,
    fit,
    status,
    reportLayout,
    overlay,
    setBox: commitBox,
    setField: (id, field, percent) =>
      commitBox(id, setBoxField(boxOf(id), field, percent)),
    nudge: (id, key, modifiers) => {
      const probe = nudgeBox(boxOf(id), key, modifiers);
      if (!probe || sameBox(probe, boxOf(id))) return false;
      // Le pas part des réglages les plus récents : un appui long ne perd aucun pas.
      patch((current) => {
        const at = activeLayoutKey(current.orientation, sourceSize);
        const next = nudgeBox(current.layouts[at][id], key, modifiers);
        return next
          ? { layouts: setBlockBox(current.layouts, at, id, next) }
          : {};
      });
      return true;
    },
    center: (id) => commitBox(id, centerBox(boxOf(id), "both")),
    resetBlock: (id) =>
      patch((current) => ({
        layouts: resetBlockBox(
          current.layouts,
          activeLayoutKey(current.orientation, sourceSize),
          id,
        ),
      })),
    resetAll: () =>
      patch((current) => ({
        layouts: resetLayout(
          current.layouts,
          activeLayoutKey(current.orientation, sourceSize),
        ),
      })),
    setSize: commitSize,
    stepTextSize: (block, direction) => {
      const size = latest.current.committed.styles[block].size;
      if (stepSize(size, direction) === size) return false;
      patch((current) => ({
        styles: setTextSize(
          current.styles,
          block,
          stepSize(current.styles[block].size, direction),
        ),
      }));
      return true;
    },
    stepWave: (direction) => {
      if (stepWaveBox(boxOf("wave"), direction).h === boxOf("wave").h)
        return false;
      patch((current) => {
        const at = activeLayoutKey(current.orientation, sourceSize);
        return {
          layouts: setBlockBox(
            current.layouts,
            at,
            "wave",
            stepWaveBox(current.layouts[at].wave, direction),
          ),
        };
      });
      return true;
    },
    setPanel: (block, change) =>
      patch((current) => ({ styles: setPanel(current.styles, block, change) })),
    setTextStyle: (block, change) =>
      patch((current) => ({
        styles: {
          ...current.styles,
          [block]: { ...current.styles[block], ...change },
        },
      })),
    setVisible: (id, shown) => {
      const change = setVisibility(latest.current.committed, id, shown);
      if (!change) return false;
      patch(change);
      if (!shown) setSelected((old) => (old === id ? null : old));
      // Le même texte deux fois de suite doit être annoncé deux fois : un caractère invisible l'alterne.
      setStatus(
        (old) =>
          describeVisibility(id, shown) +
          (old.endsWith(REPEAT_MARK) ? "" : REPEAT_MARK),
      );
      return true;
    },
    canHide: (id) => canHide(committed, id),
    setAccent: (accent) => patch({ accent }),
  };
}
