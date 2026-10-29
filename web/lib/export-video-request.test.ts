import { describe, expect, it } from "vitest";
import { DEFAULT_VIDEO_PREFS, type VideoPrefs } from "./export-video-prefs";
import type { PlanRange } from "./export-video-plan";
import { exportVideoRequest } from "./export-video-request";
import {
  videoJobOptionsSchema,
  videoPrefsFromOptions,
} from "./video-job-options";

const range = (start: number, end: number, name: string): PlanRange => ({
  id: start,
  start,
  end,
  name,
  auto: true,
  anchor: null,
});

describe("« Même export par l'API » : le JSON export_video exact", () => {
  const prefs: VideoPrefs = {
    ...DEFAULT_VIDEO_PREFS,
    orientation: "9:16",
    resolution: 2160,
    fps: 60,
    arabicSize: 96,
    showWave: false,
    textPosition: 88,
    background: "mosquee-crepuscule",
  };
  const ranges = [range(4.4, 10.4, "2:255"), range(29.4, 36.4, "")];

  it("est accepté tel quel par l'API (même schéma)", () => {
    const body = exportVideoRequest(prefs, ranges, 40);
    expect(videoJobOptionsSchema.safeParse(body).success).toBe(true);
  });
  it("redonne exactement les mêmes réglages de rendu", () => {
    const body = exportVideoRequest(prefs, ranges, 40);
    const parsed = videoJobOptionsSchema.parse(body);
    expect(videoPrefsFromOptions(parsed, false)).toEqual(prefs);
  });
  it("porte les plages dans l'ordre, avec leur nom quand il y en a un", () => {
    const body = exportVideoRequest(prefs, ranges, 40);
    expect(body.ranges).toEqual([
      { start: 4.4, end: 10.4, name: "2:255" },
      { start: 29.4, end: 36.4 },
    ]);
  });
  it("tout l'audio : aucune plage (une seule vidéo)", () => {
    const body = exportVideoRequest(prefs, [range(0, 40, "Tout l'audio")], 40);
    expect(body.ranges).toBeUndefined();
  });
  it("couleur unie : envoie la couleur ; accent personnalisé : l'envoie", () => {
    const body = exportVideoRequest(
      {
        ...prefs,
        background: "color",
        bg: "#123456",
        accent: { h: 10, s: 50, l: 50, a: 1 },
      },
      ranges,
      40,
    );
    expect(body.background).toBe("color");
    expect(body.color).toBe("#123456");
    expect(body.accent).toEqual({ h: 10, s: 50, l: 50, a: 1 });
    expect(videoJobOptionsSchema.safeParse(body).success).toBe(true);
  });
  it("souffle réglé : repris pour l'agent, et toujours le même aller-retour", () => {
    const tuned = {
      ...prefs,
      paddingBefore: 1.2,
      paddingAfter: 0,
      snapToSilence: false,
    };
    const body = exportVideoRequest(tuned, ranges, 40);
    expect(body).toMatchObject({
      lead_in: 1.2,
      tail_out: 0,
      snap_to_silence: false,
    });
    expect(
      videoPrefsFromOptions(videoJobOptionsSchema.parse(body), false),
    ).toEqual(tuned);
  });
  it("nom de fichier saisi : repris", () => {
    expect(exportVideoRequest(prefs, ranges, 40, "ma vidéo").file_name).toBe(
      "ma vidéo",
    );
  });
});
