import type { ClipCode } from "./background-video-policy";

/**
 * Les étapes de la vidéo de fond côté écran, en une machine à états PURE (le composant n'a que des effets à
 * brancher dessus) : choisir → lire → envoyer → préparer → prête, ou une erreur expliquée. Une coupure de réseau
 * garde de quoi reprendre (`resumeId`) ; toute autre erreur a vidé le serveur.
 */
export type FlowError = { code: ClipCode; message: string; resumeId?: string };

export type Flow =
  | { phase: "idle" }
  | { phase: "reading"; fileName: string; file: File }
  | { phase: "sending"; fileName: string; file: File; ratio: number }
  | { phase: "preparing"; fileName: string; file: File; ratio: number }
  | { phase: "failed"; fileName: string; file: File; error: FlowError }
  /** La vidéo est prête : elle vit alors dans la valeur du parent. */
  | { phase: "ready" };

export type FlowEvent =
  | { type: "pick"; file: File }
  /** Les faits de la vidéo sont lus (ou le navigateur ne la lit pas : le serveur s'en charge) : l'envoi commence. */
  | { type: "probed" }
  | { type: "progress"; phase: "sending" | "preparing"; ratio: number }
  | { type: "ready" }
  | { type: "failed"; error: FlowError }
  | { type: "retry" }
  | { type: "cancel" };

export const IDLE: Flow = { phase: "idle" };

export function flowReducer(state: Flow, event: FlowEvent): Flow {
  switch (event.type) {
    case "pick":
      return { phase: "reading", fileName: event.file.name, file: event.file };
    case "probed":
      return state.phase === "reading"
        ? { ...state, phase: "sending", ratio: 0 }
        : state;
    case "progress": {
      if (state.phase !== "sending" && state.phase !== "preparing")
        return state;
      // Jamais de retour en arrière : ni de la préparation vers l'envoi, ni d'un pourcentage vers un plus petit.
      if (event.phase === "sending" && state.phase === "preparing")
        return state;
      const ratio =
        state.phase === event.phase
          ? Math.max(state.ratio, event.ratio)
          : event.ratio;
      return { ...state, phase: event.phase, ratio };
    }
    case "ready":
      return { phase: "ready" };
    case "failed":
      return state.phase === "idle" || state.phase === "ready"
        ? state
        : {
            phase: "failed",
            fileName: state.fileName,
            file: state.file,
            error: event.error,
          };
    case "retry":
      return state.phase === "failed"
        ? { ...state, phase: "sending", ratio: 0 }
        : state;
    case "cancel":
      return IDLE;
  }
}

/** Vrai de la lecture à la préparation : on ne choisit pas un second fichier par-dessus sans annuler. */
export const isBusy = (state: Flow): boolean =>
  state.phase === "reading" ||
  state.phase === "sending" ||
  state.phase === "preparing";

const percent = (ratio: number) =>
  Math.round(Math.min(1, Math.max(0, ratio)) * 100);

/** La phase et le pourcentage, en français clair (texte de la barre et de sa région vivante). */
export function progressLabel(state: Flow): string {
  switch (state.phase) {
    case "reading":
      return "Lecture de la vidéo…";
    case "sending":
      return `Envoi au serveur : ${percent(state.ratio)} %`;
    case "preparing":
      return `Préparation de la vidéo par le serveur : ${percent(state.ratio)} %`;
    default:
      return "";
  }
}
