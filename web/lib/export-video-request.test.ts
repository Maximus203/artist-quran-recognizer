import { describe, expect, it } from "vitest";
import { stepSize } from "./export-video-edit";
import { DEFAULT_VIDEO_PREFS, type VideoPrefs } from "./export-video-prefs";
import type { PlanRange } from "./export-video-plan";
import { apiDifferences, exportVideoRequest } from "./export-video-request";
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
  // Des réglages que l'API sait exprimer : ceux qu'elle produit elle-même.
  const prefs: VideoPrefs = videoPrefsFromOptions(
    {
      orientation: "9:16",
      resolution: 1080,
      fps: 60,
      arabic_size: 96,
      show_wave: false,
      text_position: 88,
      background: "mosquee-crepuscule",
    },
    false,
  );
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
  it("traduit le modèle à blocs en options à plat (tailles en points, hauteur, remplir)", () => {
    const body = exportVideoRequest(prefs, ranges, 40);
    expect(body).toMatchObject({
      arabic_size: 96,
      translation_size: 30,
      show_wave: false,
      text_position: 88,
      fill: false,
    });
  });
  it("les réglages par défaut donnent les options par défaut de l'API", () => {
    expect(exportVideoRequest(DEFAULT_VIDEO_PREFS, [], 40)).toMatchObject({
      arabic_size: 72,
      translation_size: 30,
      text_position: 50,
      fill: false,
      show_wave: true,
    });
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
  it("des tailles aux bornes restent acceptées par l'API", () => {
    const huge = structuredClone(prefs);
    huge.styles.arabic.size = 5;
    huge.styles.translation.size = 0.4;
    const body = exportVideoRequest(huge, ranges, 40);
    expect(videoJobOptionsSchema.safeParse(body).success).toBe(true);
    expect(body.arabic_size).toBe(240);
    expect(body.translation_size).toBe(16);
  });
  it("« comme la vidéo » (cadre libre) lit la mise en page paysage", () => {
    const source = { ...prefs, orientation: "source" as const };
    expect(exportVideoRequest(source, ranges, 40).text_position).toBe(88);
  });
});

describe("réglages fins : transmis à l'API, donc à l'export du serveur", () => {
  const base = videoPrefsFromOptions({}, false);
  const roundTrip = (prefs: VideoPrefs) =>
    videoPrefsFromOptions(
      videoJobOptionsSchema.parse(exportVideoRequest(prefs, [], 40)),
      false,
    );

  it("un export ordinaire reste court : ni mise en page, ni styles, ni sourate masquée", () => {
    const body = exportVideoRequest(base, [], 40);
    expect(body).not.toHaveProperty("layouts");
    expect(body).not.toHaveProperty("styles");
    expect(body).not.toHaveProperty("show_ref");
    const sized = videoPrefsFromOptions({ arabic_size: 96, fill: true }, false);
    expect(exportVideoRequest(sized, [], 40)).not.toHaveProperty("styles");
  });

  it("des zones déplacées sont envoyées et reviennent à l'identique", () => {
    const moved = structuredClone(base);
    moved.layouts["16:9"].arabic = { x: 0.2, y: 0.25, w: 0.6, h: 0.3 };
    moved.layouts["9:16"].wave = { x: 0.1, y: 0.9, w: 0.8, h: 0.08 };
    const body = exportVideoRequest(moved, [], 40);
    expect(body.layouts).toEqual(moved.layouts);
    expect(videoJobOptionsSchema.safeParse(body).success).toBe(true);
    expect(roundTrip(moved)).toEqual(moved);
  });

  it("des styles choisis (taille de la référence, fond flou, plein, contour) reviennent à l'identique", () => {
    const custom = structuredClone(base);
    custom.styles.ref.size = 1.4;
    custom.styles.arabic.panel = {
      ...custom.styles.arabic.panel,
      kind: "blur",
      opacity: 0.3,
      radius: 40,
    };
    custom.styles.translation.panel = {
      kind: "solid",
      color: "#102030",
      opacity: 1,
      radius: 8,
      legibility: "outline",
      extent: "box",
    };
    custom.styles.translation.fill = true;
    const body = exportVideoRequest(custom, [], 40);
    expect(body.styles).toEqual(custom.styles);
    expect(roundTrip(custom)).toEqual(custom);
  });

  it("sourate et verset masqués : transmis", () => {
    const hidden = { ...base, showRef: false };
    expect(exportVideoRequest(hidden, [], 40).show_ref).toBe(false);
    expect(roundTrip(hidden)).toEqual(hidden);
  });

  it("la mise en page fine l'emporte sur les options à plat", () => {
    const options = videoJobOptionsSchema.parse({
      arabic_size: 200,
      text_position: 10,
      layouts: base.layouts,
      styles: base.styles,
    });
    const prefs = videoPrefsFromOptions(options, false);
    expect(prefs.layouts).toEqual(base.layouts);
    expect(prefs.styles).toEqual(base.styles);
  });

  it("l'API refuse une mise en page ou un style invalides", () => {
    const bad = (patch: object) =>
      videoJobOptionsSchema.safeParse(patch).success;
    expect(
      bad({
        layouts: {
          ...base.layouts,
          "16:9": {
            ...base.layouts["16:9"],
            arabic: { x: 0.9, y: 0, w: 0.5, h: 0.5 },
          },
        },
      }),
    ).toBe(false);
    expect(
      bad({
        styles: { ...base.styles, arabic: { ...base.styles.arabic, size: 99 } },
      }),
    ).toBe(false);
    expect(bad({ layouts: { "16:9": base.layouts["16:9"] } })).toBe(false);
    expect(bad({ show_ref: "oui" })).toBe(false);
  });
});

describe("ce que l'API ne sait pas encore exprimer", () => {
  const base = videoPrefsFromOptions({}, false);

  it("rien à signaler, même avec des réglages fins : ils sont transmis", () => {
    expect(apiDifferences(base)).toEqual([]);
    const custom = structuredClone(base);
    custom.layouts["1:1"].arabic.x = 0.2;
    custom.styles.ref.size = 2;
    custom.styles.arabic.panel.kind = "solid";
    custom.showRef = false;
    expect(apiDifferences(custom)).toEqual([]);
  });

  it("signale la vidéo de fond : son fichier ne part pas encore au serveur", () => {
    const video = {
      ...base,
      background: "video",
      backgroundVideo: { file: "dunes.mp4", offset: 3, mode: "loop" as const },
    };
    expect(apiDifferences(video)).toEqual([
      expect.stringContaining("vidéo de fond"),
    ]);
  });
});
