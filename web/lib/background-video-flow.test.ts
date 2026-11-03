import { describe, expect, it } from "vitest";
import {
  flowReducer,
  IDLE,
  isBusy,
  progressLabel,
  type Flow,
} from "./background-video-flow";

/**
 * Les étapes de la vidéo de fond côté écran, en une machine à états pure : choisir → lire → envoyer → préparer →
 * prête, ou une erreur expliquée (avec de quoi reprendre si le réseau a coupé).
 */
const file = new File(["x"], "mer.mp4", { type: "video/mp4" });

describe("machine à états de la vidéo de fond", () => {
  it("part de rien", () => {
    expect(IDLE).toEqual({ phase: "idle" });
  });

  it("choisir un fichier : lecture, puis envoi, puis préparation, puis prête", () => {
    let s: Flow = flowReducer(IDLE, { type: "pick", file });
    expect(s).toMatchObject({ phase: "reading", fileName: "mer.mp4" });
    s = flowReducer(s, { type: "probed" });
    expect(s).toMatchObject({ phase: "sending", ratio: 0 });
    s = flowReducer(s, { type: "progress", phase: "sending", ratio: 0.4 });
    expect(s).toMatchObject({ phase: "sending", ratio: 0.4 });
    s = flowReducer(s, { type: "progress", phase: "preparing", ratio: 0.1 });
    expect(s).toMatchObject({ phase: "preparing", ratio: 0.1 });
    s = flowReducer(s, { type: "ready" });
    expect(s).toEqual({ phase: "ready" });
  });

  it("la progression ne recule jamais dans une même phase, et une phase passée ne revient pas", () => {
    let s: Flow = { phase: "sending", fileName: "a.mp4", file, ratio: 0.6 };
    s = flowReducer(s, { type: "progress", phase: "sending", ratio: 0.3 });
    expect(s).toMatchObject({ ratio: 0.6 });
    s = flowReducer(s, { type: "progress", phase: "preparing", ratio: 0.2 });
    s = flowReducer(s, { type: "progress", phase: "sending", ratio: 0.9 });
    expect(s).toMatchObject({ phase: "preparing", ratio: 0.2 });
  });

  it("une progression hors de l'envoi (après une erreur, annulation) est ignorée", () => {
    const failed: Flow = {
      phase: "failed",
      fileName: "a.mp4",
      file,
      error: { code: "unreadable", message: "illisible" },
    };
    expect(
      flowReducer(failed, { type: "progress", phase: "sending", ratio: 0.5 }),
    ).toBe(failed);
    expect(
      flowReducer(IDLE, { type: "progress", phase: "sending", ratio: 0.5 }),
    ).toBe(IDLE);
  });

  it("une erreur garde le fichier (pour réessayer) et de quoi reprendre", () => {
    const s = flowReducer(
      { phase: "sending", fileName: "a.mp4", file, ratio: 0.5 },
      {
        type: "failed",
        error: { code: "network", message: "coupé", resumeId: "abc" },
      },
    );
    expect(s).toMatchObject({
      phase: "failed",
      fileName: "a.mp4",
      error: { code: "network", resumeId: "abc" },
    });
    expect((s as Extract<Flow, { phase: "failed" }>).file).toBe(file);
  });

  it("annuler pendant la lecture, l'envoi ou la préparation : retour à rien ; on peut aussi écarter une erreur", () => {
    for (const phase of ["reading", "sending", "preparing"] as const) {
      const s: Flow =
        phase === "reading"
          ? { phase, fileName: "a.mp4", file }
          : { phase, fileName: "a.mp4", file, ratio: 0.5 };
      expect(flowReducer(s, { type: "cancel" })).toEqual(IDLE);
    }
    const failed: Flow = {
      phase: "failed",
      fileName: "a.mp4",
      file,
      error: { code: "format", message: "x" },
    };
    expect(flowReducer(failed, { type: "cancel" })).toEqual(IDLE);
  });

  it("choisir un autre fichier pendant un envoi repart de zéro", () => {
    const busy: Flow = {
      phase: "sending",
      fileName: "a.mp4",
      file,
      ratio: 0.5,
    };
    expect(
      flowReducer(busy, { type: "pick", file: new File(["y"], "b.mp4") }),
    ).toMatchObject({ phase: "reading", fileName: "b.mp4" });
  });

  it("reprendre : repasse à l'envoi sans effacer le fichier", () => {
    const failed: Flow = {
      phase: "failed",
      fileName: "a.mp4",
      file,
      error: { code: "network", message: "coupé", resumeId: "abc" },
    };
    expect(flowReducer(failed, { type: "retry" })).toMatchObject({
      phase: "sending",
      fileName: "a.mp4",
      ratio: 0,
    });
  });

  it("l'écran est occupé de la lecture à la préparation, libre sinon", () => {
    expect(isBusy(IDLE)).toBe(false);
    expect(isBusy({ phase: "ready" })).toBe(false);
    expect(isBusy({ phase: "reading", fileName: "a", file })).toBe(true);
    expect(isBusy({ phase: "sending", fileName: "a", file, ratio: 0 })).toBe(
      true,
    );
    expect(isBusy({ phase: "preparing", fileName: "a", file, ratio: 0 })).toBe(
      true,
    );
    expect(
      isBusy({
        phase: "failed",
        fileName: "a",
        file,
        error: { code: "format", message: "x" },
      }),
    ).toBe(false);
  });

  it("l'étiquette de progression dit la phase et le pourcentage", () => {
    expect(progressLabel({ phase: "reading", fileName: "a", file })).toBe(
      "Lecture de la vidéo…",
    );
    expect(
      progressLabel({ phase: "sending", fileName: "a", file, ratio: 0.426 }),
    ).toBe("Envoi au serveur : 43 %");
    expect(
      progressLabel({ phase: "preparing", fileName: "a", file, ratio: 0.8 }),
    ).toBe("Préparation de la vidéo par le serveur : 80 %");
    expect(progressLabel(IDLE)).toBe("");
  });
});
