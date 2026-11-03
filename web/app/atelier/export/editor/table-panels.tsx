"use client";
import { useState } from "react";
import { BLOCK_LABEL, BLOCK_ROLE } from "@/lib/export-video-edit-text";
import type { BlockId, TextBlockId } from "@/lib/export-video-model";
import { Segmented } from "../export-ui";
import { EIcon, type EditorIconName } from "./editor-icons";
import type { EditorProps } from "./editor-types";
import { ElementSections, FrameSections } from "./inspector-sections";
import { ArabicLockNote, SizeSection, WaveSizeSection } from "./text-sections";
import type { EditorController } from "./use-editor-controller";

/**
 * Les panneaux du rail d'outils de la table de montage, construits avec les SECTIONS PARTAGÉES du plateau et
 * de la vue bureau (`ElementSections`, `FrameSections`, `SizeSection`…) : un réglage a le même effet ici,
 * sur la feuille du plateau et dans l'inspecteur du bureau.
 */

/** Un outil du rail : un élément de la vidéo, ou une partie du cadre. */
export type FrameTool = "cadre" | "fond" | "passages";
export type TableTool = BlockId | FrameTool;

export const ELEMENT_IDS: readonly BlockId[] = [
  "arabic",
  "translation",
  "wave",
  "ref",
];
export const isElementTool = (tool: TableTool): tool is BlockId =>
  (ELEMENT_IDS as readonly string[]).includes(tool);

/** Le rail, dans l'ordre de la maquette : Cadre · Arabe · Traduction · Onde · Verset · Fond · Passages. */
export const RAIL: ReadonlyArray<{
  key: TableTool;
  label: string;
  icon: EditorIconName;
}> = [
  { key: "cadre", label: "Cadre", icon: "format" },
  { key: "arabic", label: "Arabe", icon: "text" },
  { key: "translation", label: "Traduction", icon: "quote" },
  { key: "wave", label: "Onde", icon: "wave" },
  { key: "ref", label: "Verset", icon: "hash" },
  { key: "fond", label: "Fond", icon: "image" },
  { key: "passages", label: "Passages", icon: "list" },
];

export const FRAME_TITLE: Record<FrameTool, string> = {
  cadre: "Cadre de la vidéo",
  fond: "Fond de la vidéo",
  passages: "Passages à exporter",
};

type Tab = "texte" | "onde" | "fond" | "place";
const TABS: Record<BlockId, ReadonlyArray<{ value: Tab; label: string }>> = {
  arabic: [
    { value: "texte", label: "Texte" },
    { value: "fond", label: "Fond" },
    { value: "place", label: "Place" },
  ],
  translation: [
    { value: "texte", label: "Texte" },
    { value: "fond", label: "Fond" },
    { value: "place", label: "Place" },
  ],
  wave: [
    { value: "onde", label: "Onde" },
    { value: "place", label: "Place" },
  ],
  ref: [
    { value: "texte", label: "Texte" },
    { value: "place", label: "Place" },
  ],
};

/** La phrase qui dit ce qu'est l'élément, son attribution (traduction : jamais séparée d'elle) et « Masquer ». */
function ElementIntro({
  id,
  attribution,
  canHide,
  onHide,
}: {
  id: BlockId;
  attribution?: string | null;
  canHide: boolean;
  onHide: () => void;
}) {
  return (
    <div className="xt-intro">
      <div className="xt-intro-text">
        <p>{BLOCK_ROLE[id]}</p>
        {id === "translation" ? (
          <p className="xe-attribution" data-testid="translation-attribution">
            {attribution ?? "QuranEnc.com"}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        className="xe-hide"
        disabled={!canHide}
        aria-label={`Masquer : ${BLOCK_LABEL[id].toLowerCase()}`}
        title={canHide ? undefined : "Une des deux écritures reste affichée."}
        data-testid="element-hide"
        onClick={onHide}
      >
        <EIcon name="eye-off" size={20} />
        <span>Masquer</span>
      </button>
    </div>
  );
}

/** Les réglages d'un élément, en onglets : Texte (ou Onde), Fond, Place. Un onglet à la fois. */
export function ElementPanel({
  controller,
  id,
  attribution,
}: {
  controller: EditorController;
  id: BlockId;
  attribution?: string | null;
}) {
  const tabs = TABS[id];
  const [tab, setTab] = useState<Tab>(tabs[0].value);
  const current = tabs.some((t) => t.value === tab) ? tab : tabs[0].value;
  const box = controller.layout[id];
  const isText = id !== "wave";
  return (
    <>
      <Segmented
        label={`Réglages : ${BLOCK_LABEL[id].toLowerCase()}`}
        items={tabs.map((t) => ({ value: t.value, label: t.label }))}
        value={current}
        onPick={setTab}
        testId="tl-tab"
        full
      />
      {current === "texte" || current === "onde" ? (
        <>
          <ElementIntro
            id={id}
            attribution={attribution}
            canHide={controller.canHide(id)}
            onHide={() => controller.setVisible(id, false)}
          />
          {id === "arabic" ? <ArabicLockNote /> : null}
          {isText ? (
            <SizeSection
              block={id as TextBlockId}
              size={controller.sizes[id as TextBlockId]}
              onStep={(direction) =>
                controller.stepTextSize(id as TextBlockId, direction)
              }
              onReset={() => controller.setSize(id as TextBlockId, 1)}
            />
          ) : (
            <WaveSizeSection
              box={box}
              onStep={(direction) => controller.stepWave(direction)}
            />
          )}
          {isText ? (
            <ElementSections
              controller={controller}
              id={id}
              only="reglages"
              attribution={attribution}
            />
          ) : null}
        </>
      ) : null}
      {current === "fond" ? (
        <ElementSections
          controller={controller}
          id={id}
          only="fond"
          attribution={attribution}
        />
      ) : null}
      {current === "place" ? (
        <ElementSections
          controller={controller}
          id={id}
          only="position"
          attribution={attribution}
        />
      ) : null}
    </>
  );
}

/** Les panneaux du cadre : le format et les réglages avancés ensemble, les passages. (Le fond est tenu monté à part.) */
export function CadrePanel({
  editor,
  onOpenPassages,
}: {
  editor: EditorProps;
  onOpenPassages: () => void;
}) {
  return (
    <>
      <FrameSections
        editor={editor}
        only="format"
        onOpenPassages={onOpenPassages}
      />
      <FrameSections
        editor={editor}
        only="avance"
        onOpenPassages={onOpenPassages}
      />
    </>
  );
}
