"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { passageBlocks, stillTrackStyle } from "@/lib/export-table-timeline";
import { BLOCK_LABEL, BLOCK_SHORT } from "@/lib/export-video-edit-text";
import { frameCards } from "@/lib/export-video-frames";
import { SOURCE_BACKGROUND_ID } from "@/lib/export-video-backgrounds";
import type { BlockId } from "@/lib/export-video-model";
import { BackgroundVideoLayout } from "../background-video-view";
import { overflowFade } from "./controls";
import { EditableStage } from "./editable-stage";
import { EditorTopBar } from "./editor-chrome";
import { EIcon } from "./editor-icons";
import type { EditorProps } from "./editor-types";
import { backgroundName, PassagesDialog } from "./frame-sections";
import { FrameSections } from "./inspector-sections";
import {
  CadrePanel,
  ElementPanel,
  FRAME_TITLE,
  isElementTool,
  RAIL,
  type FrameTool,
  type TableTool,
} from "./table-panels";
import { TableHelp } from "./table-help";
import { TIcon } from "./table-icons";
import { TableTimeline, type FilmTrackData } from "./table-timeline";
import { useBackClose } from "./use-back-close";
import { useEditorController } from "./use-editor-controller";
import { useFirstHint } from "./use-first-hint";
import { usePlayhead } from "./use-playhead";
import { worstCase } from "../video-preview";
import { useFilmFrames } from "../use-film-frames";

/**
 * LA TABLE DE MONTAGE (téléphone, moins de 1024 px) : l'aperçu en haut, la chronologie dessous (règle de
 * temps, pistes « passages », « onde » et « fond », tête de lecture), puis le rail d'outils. Un outil ouvre
 * un panneau construit avec les sections partagées. Le fond vidéo se règle SUR la chronologie : plus court, ses
 * répétitions et leurs raccords se voient ; plus long, on fait glisser la bande sous la récitation.
 *
 * DEUX ÉTATS (et un intermédiaire) à comprendre :
 *  - la chronologie visible : on regarde, on déplace la tête de lecture, on règle le fond ;
 *  - un panneau d'ÉLÉMENT ouvert (arabe, traduction, onde, verset) : la chronologie se masque, sinon l'aperçu
 *    deviendrait minuscule ; « Chronologie » en haut du panneau, ou l'outil rappuyé, la ramène ;
 *  - un panneau du CADRE (cadre, fond, passages) : la chronologie reste, réduite à l'onde et au fond.
 *
 * L'aperçu est celui des autres éditeurs (`EditableStage`, même calque, mêmes gestes). La tête de lecture lui
 * donne l'instant à montrer ; la lecture animée part d'elle et la fait avancer.
 */

/** L'aide du premier affichage : un texte qui reste jusqu'à ce qu'on le ferme (la mémoire est propre à cet éditeur). */
export const TABLE_HINT_KEY = "aqr.export-editor.table-hint.v1";

/** Caractère invisible ajouté pour qu'une même phrase soit annoncée deux fois de suite. */
const REPEAT_MARK = String.fromCharCode(0x200b);

export function TableEditor(editor: EditorProps) {
  const controller = useEditorController({
    prefs: editor.prefs,
    patch: editor.patch,
    sourceSize: editor.preview.sourceSize,
  });
  const hint = useFirstHint(TABLE_HINT_KEY, true, null);
  const { selected } = controller;
  const { peaks, intervals } = editor.preview;
  const duration = peaks?.duration ?? 0;
  const montage = editor.montage;

  // Les plages exportées : celles du panneau, sinon tout l'audio.
  const ranges = useMemo(
    () => montage?.ranges ?? [{ id: 0, start: 0, end: duration }],
    [montage?.ranges, duration],
  );
  const longest = montage?.longest ?? duration;
  const blocks = useMemo(
    () => passageBlocks(intervals ?? [], ranges),
    [intervals, ranges],
  );
  const targets = useMemo(() => blocks.map((b) => b.start), [blocks]);

  // La tête de lecture commence sur le verset le plus long : c'est le pire cas pour le texte, donc celui qu'on veut voir.
  const initialHead = useMemo(
    () => worstCase(intervals ? frameCards(intervals, true, true) : [])?.t ?? 0,
    // Une seule fois : la tête est ensuite à la personne.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const playhead = usePlayhead({ duration, initial: initialHead, targets });

  // Un passage choisi dans la fenêtre des passages pose la tête à son début.
  const externalAt = useRef(editor.preview.at);
  const seek = playhead.seek;
  useEffect(() => {
    const next = editor.preview.at;
    if (next !== null && next !== undefined && next !== externalAt.current) {
      externalAt.current = next;
      seek(next);
    }
  }, [editor.preview.at, seek]);

  const [frameTool, setFrameTool] = useState<FrameTool | null>(null);
  const [passagesOpen, setPassagesOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [message, setMessage] = useState("");
  const opener = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const announce = useCallback(
    (text: string) =>
      setMessage(
        (old) => text + (old.endsWith(REPEAT_MARK) ? "" : REPEAT_MARK),
      ),
    [],
  );

  // L'état de l'écran : chronologie entière, réduite (panneau du cadre), ou masquée (panneau d'élément).
  const mode = selected !== null ? "element" : frameTool ? "compact" : "idle";
  const tool: TableTool | null = selected ?? frameTool;

  // Le fond vidéo : la chronologie en porte la bande, la section reste montée pour ne jamais couper un envoi.
  const fondOpen = mode === "compact" && frameTool === "fond";
  const [fondKept, setFondKept] = useState(false);
  const keepFond = fondKept || fondOpen;
  useEffect(() => {
    if (fondOpen) setFondKept(true);
  }, [fondOpen]);

  const clip = montage?.clip ?? null;
  const frames = useFilmFrames(clip?.file ?? null);
  const film: FilmTrackData =
    clip && editor.frame.selectedBg === "video"
      ? { kind: "clip", clip, frames }
      : {
          kind: "still",
          label: `Fond · ${backgroundName(editor.frame.selectedBg, editor.frame.upload !== null)}`,
          source: editor.frame.selectedBg === SOURCE_BACKGROUND_ID,
          style: stillTrackStyle(
            editor.frame.selectedBg,
            editor.prefs.bg,
            editor.frame.uploadThumb,
          ),
        };

  // La plage sous la tête de lecture : la vidéo de fond compte depuis SON début, comme à l'export.
  const clipRange = useMemo(() => {
    const range = ranges.find(
      (r) => playhead.at >= r.start && playhead.at <= r.end,
    );
    return range
      ? { start: range.start, length: range.end - range.start }
      : null;
  }, [ranges, playhead.at]);

  const openTool = (key: TableTool, button: HTMLElement) => {
    hint.dismiss();
    opener.current = button;
    if (isElementTool(key)) {
      if (!controller.visible[key]) controller.setVisible(key, true);
      setFrameTool(null);
      controller.select(selected === key ? null : key);
    } else {
      controller.select(null);
      setFrameTool(frameTool === key ? null : key);
    }
  };
  const closePanel = () => {
    controller.select(null);
    setFrameTool(null);
    window.setTimeout(() => opener.current?.focus(), 0);
  };
  // Le panneau qui s'ouvre prend le focus (clavier et lecteur d'écran ne se perdent pas).
  useEffect(() => {
    if (tool) panelRef.current?.focus({ preventScroll: true });
  }, [tool]);
  // Retour du navigateur : ferme le panneau ouvert au lieu de quitter l'éditeur (recette QA, m3).
  useBackClose(tool !== null, closePanel);

  // Toucher un élément de l'aperçu ouvre ses réglages ; toucher à côté ferme tout.
  const overlay = {
    ...controller,
    overlay: {
      ...controller.overlay,
      onSelect: (id: BlockId | null) => {
        hint.dismiss();
        if (id !== null) setFrameTool(null);
        controller.select(id);
      },
    },
  };

  const title =
    selected !== null
      ? BLOCK_LABEL[selected]
      : frameTool
        ? FRAME_TITLE[frameTool]
        : "";
  const panelOpen = tool !== null;

  return (
    <div className="xe-plateau xt" data-testid="editor-table" data-mode={mode}>
      <EditorTopBar
        title={editor.title}
        subtitle={editor.subtitle}
        onLeave={editor.onLeave}
        exportAction={editor.exportAction}
      />

      <div className="xe-stage-area">
        <EditableStage
          sessionId={editor.sessionId}
          source={{ ...editor.preview, at: playhead.at }}
          controller={overlay}
          coach={null}
          playFrom={playhead.at}
          onTime={playhead.onTime}
          onPlayingChange={playhead.onPlayingChange}
          clipRange={clipRange}
          stopToken={playhead.stopToken}
        />
      </div>

      <div className="xe-dock xt-dock" data-testid="editor-dock">
        {hint.show && mode !== "element" ? (
          <TableHelp onDismiss={hint.dismiss} />
        ) : null}

        {mode !== "element" && montage && peaks && duration > 0 ? (
          <TableTimeline
            duration={duration}
            peaks={peaks}
            blocks={blocks}
            ranges={ranges}
            longest={longest}
            film={film}
            head={playhead.store}
            zoom={zoom}
            onZoom={setZoom}
            compact={mode === "compact"}
            onSeek={playhead.seek}
            onNudge={playhead.nudge}
            onJump={(direction) => playhead.jump(direction) !== null}
            parts={ranges.length}
            onClip={(next) => montage.onClip(next)}
            onHelp={hint.show ? hint.dismiss : hint.reopen}
            announce={announce}
          />
        ) : null}

        {keepFond || panelOpen ? (
          <div
            ref={panelRef}
            className="xe-sheet xt-panel"
            hidden={!panelOpen}
            role="region"
            aria-label={title}
            tabIndex={-1}
            data-testid="editor-sheet"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                closePanel();
              }
            }}
          >
            <header className="xe-sheet-head xt-panel-head">
              {selected !== null ? (
                <button
                  type="button"
                  className="xt-back"
                  data-testid="table-back"
                  onClick={closePanel}
                >
                  <TIcon name="chev-left" size={22} />
                  <span>Chronologie</span>
                </button>
              ) : null}
              <h2>{title}</h2>
              {selected === null ? (
                <button
                  type="button"
                  className="btn btn--primary xe-btn"
                  data-testid="sheet-done"
                  onClick={closePanel}
                >
                  Terminé
                </button>
              ) : null}
            </header>
            <div className="xe-sheet-body">
              {keepFond ? (
                <div className="xe-pane" hidden={!fondOpen}>
                  <BackgroundVideoLayout.Provider
                    value={montage ? "timeline" : "standalone"}
                  >
                    <FrameSections
                      editor={editor}
                      only="fond"
                      onOpenPassages={() => setPassagesOpen(true)}
                    />
                  </BackgroundVideoLayout.Provider>
                </div>
              ) : null}
              {selected !== null ? (
                <ElementPanel
                  key={selected}
                  controller={controller}
                  id={selected}
                  attribution={editor.preview.attribution}
                />
              ) : frameTool === "cadre" ? (
                <CadrePanel
                  editor={editor}
                  onOpenPassages={() => setPassagesOpen(true)}
                />
              ) : frameTool === "passages" ? (
                <FrameSections
                  editor={editor}
                  only="passages"
                  onOpenPassages={() => setPassagesOpen(true)}
                />
              ) : null}
            </div>
          </div>
        ) : null}

        <nav
          className="xt-rail"
          aria-label="Outils de la table de montage"
          data-testid="table-rail"
        >
          <div className="xe-tb" ref={overflowFade}>
            {RAIL.map((item) => {
              const isElement = isElementTool(item.key);
              const shown =
                !isElement || controller.visible[item.key as BlockId];
              return (
                <button
                  key={item.key}
                  type="button"
                  className="xe-tool"
                  aria-pressed={tool === item.key}
                  data-off={!shown || undefined}
                  data-testid={`rail-${item.key}`}
                  aria-label={
                    shown
                      ? undefined
                      : `${BLOCK_LABEL[item.key as BlockId]} (masqué) : afficher et régler`
                  }
                  onClick={(event) => openTool(item.key, event.currentTarget)}
                >
                  <EIcon name={shown ? item.icon : "eye-off"} size={22} />
                  <span>
                    {isElement ? BLOCK_SHORT[item.key as BlockId] : item.label}
                  </span>
                </button>
              );
            })}
          </div>
        </nav>
      </div>

      <p
        className="sr"
        role="status"
        aria-live="polite"
        data-testid="editor-status"
      >
        {controller.status}
      </p>
      <p
        className="sr"
        role="status"
        aria-live="polite"
        data-testid="table-status"
      >
        {message}
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
