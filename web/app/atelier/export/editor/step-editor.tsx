"use client";
import { useEffect, useRef, useState } from "react";
import type { BlockId } from "@/lib/export-video-model";
import {
  STEP_IDS,
  STEP_LABEL,
  describeStep,
  isDone,
  nextStep,
  previousStep,
  resolveTextTab,
  stepNumber,
  type StepId,
  type StepsProgress,
  type TextTab,
} from "@/lib/export-video-steps";
import { XIcon } from "../export-icons";
import { EditableStage } from "./editable-stage";
import { EditorTopBar } from "./editor-chrome";
import type { EditorProps } from "./editor-types";
import { PassagesDialog } from "./frame-sections";
import { ExportPane, FramePane, TextsPane } from "./step-panes";
import { useEditorController } from "./use-editor-controller";
import { useFirstHint } from "./use-first-hint";
import { useStepProgress } from "./use-step-progress";

/**
 * LE PAS À PAS (téléphone, moins de 1024 px) : trois étapes, une seule chose à faire à l'écran.
 *
 *   1 Le cadre   — le format, le fond (couleurs, images, vidéo de fond) ; un encart propose d'exporter tout de suite ;
 *   2 Les textes — un onglet par élément : taille − / +, fond du texte, flèches ; l'aperçu se manipule ;
 *   3 Exporter   — le résumé, les passages, les réglages avancés, et le gros bouton.
 *
 * C'est l'éditeur par défaut du rôle récitateur : aucune explication à lire, aucun réglage obligatoire. L'aperçu
 * reste en haut ; on ne peut le manipuler qu'à l'étape des textes (le calque d'édition partagé y est monté,
 * ailleurs l'aperçu se regarde seulement). On passe d'une étape à l'autre par Précédent / Suivant ou, à tout
 * moment, par les pastilles ; l'étape où l'on est est mémorisée (par récitation, dans cet onglet).
 *
 * Les réglages sont ceux des sections partagées et du contrôleur de l'éditeur : un réglage se comporte ici
 * comme sur le plateau ou au bureau. L'étape du cadre reste MONTÉE (cachée) quand on la quitte : la section de
 * la vidéo de fond arrête son envoi à son démontage, changer d'étape ne doit jamais l'interrompre.
 */

/** L'aide du premier affichage du pas à pas (une seule fois par appareil, à l'arrivée à l'étape des textes). */
export const STEPS_HINT_KEY = "aqr.export-editor.hint.pas.v1";

export function StepEditor({
  initialProgress,
  ...editor
}: EditorProps & {
  /** Pour les tests et l'aperçu d'une étape précise ; absent en usage normal (la mémoire de l'onglet décide). */
  initialProgress?: StepsProgress;
}) {
  const controller = useEditorController({
    prefs: editor.prefs,
    patch: editor.patch,
    sourceSize: editor.preview.sourceSize,
  });
  const { progress, go } = useStepProgress(editor.sessionId, initialProgress);
  const { step } = progress;
  const hint = useFirstHint(STEPS_HINT_KEY, step === "textes");
  const [who, setWho] = useState<TextTab>("arabic");
  const [passagesOpen, setPassagesOpen] = useState(false);
  const [live, setLive] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);
  const shownStep = useRef<StepId>(step);
  const { select } = controller;

  // L'aperçu ne se manipule qu'à l'étape des textes : y arriver choisit l'élément ouvert, en partir ne laisse
  // rien de choisi (ni cadre ni poignées sur une étape qui ne les touche pas).
  useEffect(() => {
    select(step === "textes" ? who : null);
  }, [step, who, select]);

  // Changer d'étape : on l'annonce, on remonte en haut de la page de l'étape et le focus va à son titre.
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    setLive(describeStep(step));
    const body = bodyRef.current;
    body?.scrollTo({ top: 0 });
    body
      ?.querySelector<HTMLElement>(
        `[data-pane="${step}"] [data-testid="pas-title"]`,
      )
      ?.focus({ preventScroll: true });
  }, [step]);

  // Toucher l'aperçu change l'onglet ; toucher à côté garde l'élément ouvert (un réglage reste toujours ouvert).
  const pick = (id: BlockId | null) => {
    hint.dismiss();
    setWho((current) => resolveTextTab(current, id));
  };
  const overlay = {
    ...controller,
    overlay: { ...controller.overlay, onSelect: pick },
  };

  const openPassages = () => setPassagesOpen(true);
  const previous = previousStep(step);
  const next = nextStep(step);
  const exportAction = editor.exportAction;

  return (
    <div className="xp-root" data-testid="editor-pas" data-step={step}>
      <EditorTopBar
        title={editor.title}
        subtitle={editor.subtitle}
        onLeave={editor.onLeave}
        exportAction={exportAction}
      />

      <div className="xp-stage" data-step={step}>
        <EditableStage
          sessionId={editor.sessionId}
          source={editor.preview}
          controller={overlay}
          coach={hint.show ? who : null}
          interactive={step === "textes"}
        />
      </div>

      <section className="xp-panel" aria-label="Les étapes">
        <nav aria-label="Les trois étapes">
          <ol className="xp-steps">
            {STEP_IDS.map((id) => {
              const done = isDone(progress, id);
              return (
                <li key={id}>
                  <button
                    type="button"
                    className="xp-step"
                    aria-current={id === step ? "step" : undefined}
                    aria-label={`Étape ${stepNumber(id)} sur ${STEP_IDS.length} : ${STEP_LABEL[id]}${done ? " (faite)" : ""}`}
                    data-done={done || undefined}
                    data-testid={`pas-step-${stepNumber(id)}`}
                    onClick={() => go(id)}
                  >
                    <span className="xp-bar" aria-hidden="true" />
                    <span className="xp-name" aria-hidden="true">
                      <i>
                        {done ? (
                          <XIcon name="check" size={14} />
                        ) : (
                          stepNumber(id)
                        )}
                      </i>
                      {STEP_LABEL[id]}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="xp-body" ref={bodyRef} data-testid="pas-body">
          <div
            className="xp-pane"
            data-pane="cadre"
            data-testid="pas-pane-cadre"
            hidden={step !== "cadre"}
          >
            <FramePane editor={editor} onOpenPassages={openPassages} />
          </div>
          {step === "textes" ? (
            <div
              className="xp-pane"
              data-pane="textes"
              data-testid="pas-pane-textes"
            >
              <TextsPane
                controller={controller}
                who={who}
                onWho={setWho}
                attribution={editor.preview.attribution}
              />
            </div>
          ) : null}
          {step === "exporter" ? (
            <div
              className="xp-pane"
              data-pane="exporter"
              data-testid="pas-pane-exporter"
            >
              <ExportPane
                editor={editor}
                controller={controller}
                onOpenPassages={openPassages}
              />
            </div>
          ) : null}
        </div>

        <footer className="xp-foot" data-single={previous ? undefined : ""}>
          {previous ? (
            <button
              type="button"
              className="btn btn--secondary xp-btn"
              data-testid="pas-prev"
              onClick={() => go(previous)}
            >
              <XIcon name="chev-l" size={18} />
              Précédent
            </button>
          ) : null}
          {next ? (
            <button
              type="button"
              className="btn btn--primary xp-btn"
              data-testid="pas-next"
              onClick={() => go(next)}
            >
              Suivant · {STEP_LABEL[next]}
              <XIcon name="chev-r" size={18} />
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--accent xp-btn"
              aria-haspopup="dialog"
              disabled={exportAction.disabled}
              data-testid="pas-export"
              onClick={exportAction.onOpen}
            >
              <XIcon name="download" size={20} />
              {exportAction.label}
            </button>
          )}
        </footer>
      </section>

      <p className="sr" role="status" aria-live="polite" data-testid="pas-live">
        {live}
      </p>
      <p
        className="sr"
        role="status"
        aria-live="polite"
        data-testid="editor-status"
      >
        {controller.status}
      </p>
      <PassagesDialog
        open={passagesOpen}
        onClose={() => setPassagesOpen(false)}
      >
        {editor.passages.content}
      </PassagesDialog>
    </div>
  );
}
