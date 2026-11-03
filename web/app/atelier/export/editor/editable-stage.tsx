"use client";
import type { BlockId } from "@/lib/export-video-model";
import { VideoPreview, type ClipRange } from "../video-preview";
import { EditOverlay } from "./edit-overlay";
import type { PreviewSource } from "./editor-types";
import type { EditorController } from "./use-editor-controller";

/**
 * L'aperçu qu'on manipule : `VideoPreview` (la vraie `drawFrame`, fidèle au rendu final) avec le calque
 * d'édition par-dessus. Il se met à la taille de la place disponible, sans jamais déformer le cadre. Pendant
 * un geste il montre le brouillon du contrôleur ; au relâcher le réglage est enregistré.
 *
 * Partagé par le plateau, la vue bureau, et — plus tard — la table de montage et le pas à pas (celui-ci
 * l'utilise sans l'éditer hors de l'étape des textes : `interactive={false}`).
 */
export function EditableStage({
  sessionId,
  source,
  controller,
  coach = null,
  interactive = true,
  onPlayingChange,
  playFrom,
  onTime,
  clipRange,
  stopToken,
}: {
  sessionId: string;
  source: PreviewSource;
  controller: EditorController;
  /** L'aide du premier affichage : la main désigne cet élément. */
  coach?: BlockId | null;
  /** Faux : l'aperçu se regarde sans se manipuler (pas à pas, hors de l'étape des textes). */
  interactive?: boolean;
  onPlayingChange?: (playing: boolean) => void;
  /** La table de montage : l'aperçu animé part de la tête de lecture, la lui rend, et suit la plage sous elle. */
  playFrom?: number | null;
  onTime?: (t: number) => void;
  clipRange?: ClipRange | null;
  stopToken?: number;
}) {
  return (
    <VideoPreview
      sessionId={sessionId}
      intervals={source.intervals}
      peaks={source.peaks}
      prefs={controller.prefs}
      upload={source.upload}
      clip={source.clip}
      isVideo={source.isVideo}
      sourceSize={source.sourceSize}
      at={source.at}
      onLayout={controller.reportLayout}
      onPlayingChange={onPlayingChange}
      playFrom={playFrom}
      onTime={onTime}
      clipRange={clipRange}
      stopToken={stopToken}
    >
      {interactive ? (
        <EditOverlay {...controller.overlay} coach={coach} />
      ) : null}
    </VideoPreview>
  );
}
