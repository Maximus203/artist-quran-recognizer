"use client";
import type { BlockId, TextBlockId } from "@/lib/export-video-model";
import { ElementHeader } from "./text-sections";
import {
  ArabicLockNote,
  PanelSection,
  PositionSection,
  SizeSection,
  TextAdvancedSection,
  WaveSizeSection,
} from "./text-sections";
import {
  AdvancedSection,
  BackgroundSection,
  FormatSection,
  PassagesSection,
  type FrameToolKey,
} from "./frame-sections";
import type { EditorProps } from "./editor-types";
import type { EditorController } from "./use-editor-controller";

/**
 * Les réglages d'un élément et ceux du cadre, composés à partir des sections : la FEUILLE du téléphone en
 * affiche UNE à la fois (`only`), l'INSPECTEUR du bureau les affiche TOUTES, l'une sous l'autre. Ce sont les
 * mêmes composants et les mêmes fonctions du contrôleur : changer un réglage ici ou là donne le même résultat.
 */

export type ElementToolKey = "fond" | "position" | "reglages";

const isText = (id: BlockId): id is TextBlockId => id !== "wave";

/** Les sections de l'élément choisi. `only` : une seule (feuille du téléphone) ; absent : toutes (bureau). */
export function ElementSections({
  controller,
  id,
  only,
  attribution,
}: {
  controller: EditorController;
  id: BlockId;
  only?: ElementToolKey;
  attribution?: string | null;
}) {
  const all = only === undefined;
  const box = controller.layout[id];
  const onNudge = (
    key: string,
    modifiers: { shift?: boolean; ctrl?: boolean },
  ) => controller.nudge(id, key, modifiers);
  const position = (
    <PositionSection
      box={box}
      onNudge={onNudge}
      onField={(field, percent) => controller.setField(id, field, percent)}
      onCenter={() => controller.center(id)}
      onReset={() => controller.resetBlock(id)}
    />
  );
  return (
    <>
      {all ? (
        <>
          <ElementHeader
            id={id}
            attribution={attribution}
            canHide={controller.canHide(id)}
            onHide={() => controller.setVisible(id, false)}
          />
          {id === "arabic" ? <ArabicLockNote /> : null}
          <section className="xe-sec" aria-label="Taille">
            {isText(id) ? (
              <SizeSection
                block={id}
                size={controller.sizes[id]}
                onStep={(direction) => controller.stepTextSize(id, direction)}
                onReset={() => controller.setSize(id, 1)}
              />
            ) : (
              <WaveSizeSection
                box={box}
                onStep={(direction) => controller.stepWave(direction)}
              />
            )}
          </section>
        </>
      ) : null}
      {isText(id) && (all || only === "fond") ? (
        <section className="xe-sec" aria-label="Fond du texte">
          <PanelSection
            block={id}
            panel={controller.styles[id].panel}
            onChange={(change) => controller.setPanel(id, change)}
            heading={all}
          />
        </section>
      ) : null}
      {all || only === "position" ? (
        <section className="xe-sec" aria-label="Position">
          {position}
        </section>
      ) : null}
      {isText(id) && only === "reglages" ? (
        <section className="xe-sec" aria-label="Réglages du texte">
          <TextAdvancedSection
            block={id}
            style={controller.styles[id]}
            onStyle={(change) => controller.setTextStyle(id, change)}
            onPanel={(change) => controller.setPanel(id, change)}
            accent={
              id === "arabic"
                ? {
                    value: controller.committed.accent,
                    onChange: controller.setAccent,
                  }
                : undefined
            }
          />
        </section>
      ) : null}
      {all ? (
        <details className="xr-fine xe-advanced" data-testid="element-advanced">
          <summary>Avancé : remplissage, place du texte, fond</summary>
          <div>
            {isText(id) ? (
              <TextAdvancedSection
                block={id}
                style={controller.styles[id]}
                onStyle={(change) => controller.setTextStyle(id, change)}
                onPanel={(change) => controller.setPanel(id, change)}
                accent={
                  id === "arabic"
                    ? {
                        value: controller.committed.accent,
                        onChange: controller.setAccent,
                      }
                    : undefined
                }
              />
            ) : null}
          </div>
        </details>
      ) : null}
    </>
  );
}

/**
 * Les sections du cadre. `only` : une seule (feuille) ; absent : toutes (inspecteur du bureau, quand rien
 * n'est choisi). `onOpenPassages` ouvre la fenêtre des passages (frise, liste, souffle).
 */
export function FrameSections({
  editor,
  only,
  onOpenPassages,
}: {
  editor: EditorProps;
  only?: FrameToolKey;
  onOpenPassages: () => void;
}) {
  const { prefs, patch, frame, passages, advanced } = editor;
  const all = only === undefined;
  return (
    <>
      {all || only === "format" ? (
        <section className="xe-sec" aria-label="Format">
          <FormatSection
            orientation={prefs.orientation}
            isVideo={frame.isVideo}
            sourceSize={frame.sourceSize}
            onPick={(orientation) => patch({ orientation })}
          />
        </section>
      ) : null}
      {all || only === "fond" ? (
        <section className="xe-sec" aria-label="Fond">
          <BackgroundSection prefs={prefs} patch={patch} frame={frame} />
        </section>
      ) : null}
      {all || only === "passages" ? (
        <section className="xe-sec" aria-label="Passages">
          <PassagesSection
            summary={passages.summary}
            count={passages.count}
            onOpen={onOpenPassages}
          />
        </section>
      ) : null}
      {all || only === "avance" ? (
        <section className="xe-sec" aria-label="Réglages avancés">
          <AdvancedSection defaultOpen={only === "avance"}>
            {advanced}
          </AdvancedSection>
        </section>
      ) : null}
    </>
  );
}
