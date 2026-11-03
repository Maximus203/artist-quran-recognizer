"use client";
import { useEffect, useRef, useState } from "react";
import { BLOCK_LABEL, BLOCK_SHORT } from "@/lib/export-video-edit-text";
import { waveLimits } from "@/lib/export-video-editor";
import { PANEL_KINDS, type BlockId } from "@/lib/export-video-model";
import { XIcon } from "../export-icons";
import { SizeStepper, overflowFade, sizeBounds } from "./controls";
import { EditableStage } from "./editable-stage";
import { BLOCK_ICON, EIcon, type EditorIconName } from "./editor-icons";
import { EditorTopBar } from "./editor-chrome";
import type { EditorProps } from "./editor-types";
import {
  backgroundName,
  formatName,
  FRAME_TOOLS,
  PassagesDialog,
  type FrameToolKey,
} from "./frame-sections";
import {
  ElementSections,
  FrameSections,
  type ElementToolKey,
} from "./inspector-sections";
import {
  useEditorController,
  type EditorController,
} from "./use-editor-controller";
import { useFirstHint } from "./use-first-hint";

/**
 * LE PLATEAU (téléphone, moins de 1024 px) : l'aperçu est l'éditeur. On touche un élément ; sa barre
 * d'outils apparaît sous l'aperçu (taille − / +, Fond, Position, Réglages, Masquer) ; un outil ouvre une
 * FEUILLE accrochée sous l'aperçu — non modale : l'aperçu reste visible pendant qu'on règle. Rien de choisi =
 * les réglages du cadre (Format, Fond, Passages, Avancé) et l'encart « déjà prête, exporter maintenant ».
 * Une rangée de pastilles (Arabe · Traduction · Onde · Verset · Cadre et fond) remplace le toucher quand les
 * éléments se chevauchent, et ramène un élément masqué.
 *
 * Les réglages sont ceux de `ElementSections` / `FrameSections` : les mêmes composants que l'inspecteur du
 * bureau. Les gestes sont ceux du calque d'édition partagé.
 */

const ORDER: readonly BlockId[] = ["arabic", "translation", "wave", "ref"];

type ToolSpec<K extends string> = {
  key: K;
  label: string;
  title: string;
  icon: EditorIconName;
};

const TEXT_TOOLS: readonly ToolSpec<ElementToolKey>[] = [
  { key: "fond", label: "Fond", title: "Fond derrière le texte", icon: "drop" },
  {
    key: "position",
    label: "Position",
    title: "Position et zone",
    icon: "move",
  },
  {
    key: "reglages",
    label: "Réglages",
    title: "Plus de réglages",
    icon: "sliders",
  },
];
const WAVE_TOOLS: readonly ToolSpec<ElementToolKey>[] = [TEXT_TOOLS[1]];

const PANEL_LABEL: Record<(typeof PANEL_KINDS)[number], string> = {
  none: "aucun",
  transparent: "transparent",
  blur: "flou",
  solid: "plein",
};

const FRAME_TITLE: Record<FrameToolKey, string> = {
  format: "Format de la vidéo",
  fond: "Fond de la vidéo",
  passages: "Passages à exporter",
  avance: "Réglages avancés",
};
const FRAME_ICON: Record<FrameToolKey, EditorIconName> = {
  format: "format",
  fond: "image",
  passages: "list",
  avance: "sliders",
};

/** La feuille ouverte appartient à l'élément (ou au cadre) qui l'a ouverte : en changer la ferme. */
type OpenSheet = { owner: BlockId | null; key: string };

export function PlateauEditor(editor: EditorProps) {
  const controller = useEditorController({
    prefs: editor.prefs,
    patch: editor.patch,
    sourceSize: editor.preview.sourceSize,
  });
  const hint = useFirstHint();
  const [sheet, setSheet] = useState<OpenSheet | null>(null);
  const [passagesOpen, setPassagesOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  const { selected } = controller;
  const tool = sheet && sheet.owner === selected ? sheet.key : null;
  const fondOpen = selected === null && tool === "fond";
  // La feuille « Fond » héberge l'envoi de la vidéo de fond : une fois ouverte, elle reste montée (cachée) pour que
  // fermer la feuille ou choisir un élément n'arrête pas l'envoi.
  const [fondKept, setFondKept] = useState(false);
  const keepFond = fondKept || fondOpen;
  useEffect(() => {
    if (fondOpen) setFondKept(true);
  }, [fondOpen]);

  const openTool = (key: string, button: HTMLElement) => {
    opener.current = button;
    setSheet({ owner: selected, key });
  };
  const closeTool = () => {
    setSheet(null);
    // Le focus revient au bouton qui a ouvert la feuille (clavier et lecteur d'écran ne se perdent pas).
    window.setTimeout(() => opener.current?.focus(), 0);
  };
  useEffect(() => {
    if (tool) sheetRef.current?.focus({ preventScroll: true });
  }, [tool]);

  const select = (id: BlockId | null) => {
    hint.dismiss();
    controller.select(id);
  };
  // Le contrôleur est partagé : le plateau y ajoute juste « l'aide s'efface au premier choix ».
  const overlay = {
    ...controller,
    overlay: { ...controller.overlay, onSelect: select },
  };

  const attribution = editor.preview.attribution;
  const onChip = (id: BlockId) => {
    hint.dismiss();
    if (!controller.visible[id]) controller.setVisible(id, true);
    controller.select(selected === id ? null : id);
  };

  const elementTools = selected === "wave" ? WAVE_TOOLS : TEXT_TOOLS;
  const frameSubs: Record<FrameToolKey, string> = {
    format: formatName(editor.prefs.orientation),
    fond: backgroundName(editor.frame.selectedBg, editor.frame.upload !== null),
    passages: editor.passages.short,
    avance: `${editor.prefs.resolution}p · ${editor.prefs.fps}`,
  };

  const sheetTitle =
    selected === null
      ? FRAME_TITLE[tool as FrameToolKey]
      : (elementTools.find((t) => t.key === tool)?.title ?? "");
  const sheetSub = selected === null ? "Toute la vidéo" : BLOCK_LABEL[selected];

  return (
    <div className="xe-plateau" data-testid="editor-plateau">
      <EditorTopBar
        title={editor.title}
        subtitle={editor.subtitle}
        onLeave={editor.onLeave}
        exportAction={editor.exportAction}
      />

      <div className="xe-stage-area">
        <EditableStage
          sessionId={editor.sessionId}
          source={editor.preview}
          controller={overlay}
          coach={
            hint.show && selected === null && tool === null ? "arabic" : null
          }
        />
      </div>

      <div className="xe-dock" data-testid="editor-dock">
        {keepFond || tool ? (
          <div
            ref={sheetRef}
            className="xe-sheet"
            hidden={!tool}
            role="region"
            aria-label={sheetTitle}
            tabIndex={-1}
            data-testid="editor-sheet"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                closeTool();
              }
            }}
          >
            <div className="xe-sheet-grab" aria-hidden="true" />
            <header className="xe-sheet-head">
              <div>
                <h2>{sheetTitle}</h2>
                <p>{sheetSub}</p>
              </div>
              <button
                type="button"
                className="btn btn--primary xe-btn"
                data-testid="sheet-done"
                onClick={closeTool}
              >
                Terminé
              </button>
            </header>
            <div className="xe-sheet-body">
              {keepFond ? (
                <div className="xe-pane" hidden={!fondOpen}>
                  <FrameSections
                    editor={editor}
                    only="fond"
                    onOpenPassages={() => setPassagesOpen(true)}
                  />
                </div>
              ) : null}
              {!tool || fondOpen ? null : selected === null ? (
                <FrameSections
                  editor={editor}
                  only={tool as FrameToolKey}
                  onOpenPassages={() => setPassagesOpen(true)}
                />
              ) : (
                <ElementSections
                  controller={controller}
                  id={selected}
                  only={tool as ElementToolKey}
                  attribution={attribution}
                />
              )}
            </div>
          </div>
        ) : null}
        {tool ? null : (
          <>
            <div
              ref={overflowFade}
              className="xe-chips"
              role="group"
              aria-label="Choisir un élément"
              data-testid="editor-chips"
            >
              {ORDER.map((id) => {
                const shown = controller.visible[id];
                return (
                  <button
                    key={id}
                    type="button"
                    className="xe-chip-btn"
                    aria-pressed={selected === id}
                    data-off={!shown || undefined}
                    data-testid={`chip-${id}`}
                    aria-label={
                      shown
                        ? BLOCK_LABEL[id]
                        : `${BLOCK_LABEL[id]} (masqué) : afficher et choisir`
                    }
                    onClick={() => onChip(id)}
                  >
                    <EIcon
                      name={shown ? BLOCK_ICON[id] : "eye-off"}
                      size={18}
                    />
                    {BLOCK_SHORT[id]}
                  </button>
                );
              })}
              <button
                type="button"
                className="xe-chip-btn"
                aria-pressed={selected === null}
                data-testid="chip-frame"
                onClick={() => select(null)}
              >
                <EIcon name="layers" size={18} />
                Cadre et fond
              </button>
            </div>

            <div
              className="xe-ctx"
              role="toolbar"
              aria-label="Outils"
              data-testid="editor-toolbar"
            >
              {selected !== null ? (
                <div className="xe-tb" ref={overflowFade}>
                  {selected === "wave" ? (
                    <WaveStep controller={controller} />
                  ) : (
                    <TextStep
                      block={selected}
                      size={controller.sizes[selected]}
                      onStep={(d) => controller.stepTextSize(selected, d)}
                      onReset={() => controller.setSize(selected, 1)}
                    />
                  )}
                  <span className="xe-vsep" aria-hidden="true" />
                  {elementTools.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      className="xe-tool"
                      data-testid={`tool-${t.key}`}
                      onClick={(event) => openTool(t.key, event.currentTarget)}
                    >
                      <EIcon name={t.icon} size={22} />
                      <span>{t.label}</span>
                      {t.key === "fond" && selected !== "wave" ? (
                        <small>
                          {PANEL_LABEL[controller.styles[selected].panel.kind]}
                        </small>
                      ) : null}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="xe-tool"
                    disabled={!controller.canHide(selected)}
                    aria-label={`Masquer : ${BLOCK_LABEL[selected].toLowerCase()}`}
                    data-testid="tool-hide"
                    onClick={() => controller.setVisible(selected, false)}
                  >
                    <EIcon name="eye-off" size={22} />
                    <span>Masquer</span>
                  </button>
                </div>
              ) : (
                <>
                  <div className="xe-tb" ref={overflowFade}>
                    {FRAME_TOOLS.map((t) => (
                      <button
                        key={t.key}
                        type="button"
                        className="xe-tool"
                        data-testid={`tool-${t.key}`}
                        onClick={(event) =>
                          openTool(t.key, event.currentTarget)
                        }
                      >
                        <EIcon name={FRAME_ICON[t.key]} size={22} />
                        <span>{t.label}</span>
                        <small>{frameSubs[t.key]}</small>
                      </button>
                    ))}
                  </div>
                  <div className="xe-ready" data-testid="editor-ready">
                    <p>
                      <b>Déjà prête</b>
                      <span>
                        Avec nos réglages conseillés. Touche un texte pour le
                        modifier.
                      </span>
                    </p>
                    <button
                      type="button"
                      className="btn btn--secondary xe-btn"
                      data-testid="ready-export"
                      disabled={editor.exportAction.disabled}
                      onClick={editor.exportAction.onOpen}
                    >
                      <XIcon name="download" size={18} />
                      Exporter maintenant
                    </button>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>

      <PassagesDialog
        open={passagesOpen}
        onClose={() => setPassagesOpen(false)}
      >
        {editor.passages.content}
      </PassagesDialog>
    </div>
  );
}

function TextStep({
  block,
  size,
  onStep,
  onReset,
}: {
  block: Exclude<BlockId, "wave">;
  size: number;
  onStep: (direction: 1 | -1) => boolean;
  onReset: () => void;
}) {
  const bounds = sizeBounds(size);
  return (
    <SizeStepper
      label={`Taille : ${BLOCK_LABEL[block].toLowerCase()}`}
      value={bounds.label}
      sub="taille"
      onStep={onStep}
      onReset={size === 1 ? undefined : onReset}
      atMin={bounds.atMin}
      atMax={bounds.atMax}
      minusLabel="Texte plus petit"
      plusLabel="Texte plus grand"
      testId={`size-${block}`}
    />
  );
}

function WaveStep({ controller }: { controller: EditorController }) {
  const box = controller.layout.wave;
  const limits = waveLimits(box);
  return (
    <SizeStepper
      label="Hauteur de l’onde"
      value={`${Math.round(box.h * 100)} %`}
      sub="hauteur"
      onStep={controller.stepWave}
      atMin={limits.atMin}
      atMax={limits.atMax}
      minusLabel="Onde plus basse"
      plusLabel="Onde plus haute"
      testId="size-wave"
    />
  );
}
