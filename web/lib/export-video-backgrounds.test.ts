import { describe, expect, it } from "vitest";
import {
  BACKGROUND_PRESETS,
  chooseBackground,
  DEFAULT_BACKGROUND_ID,
  PHOTO_BACKGROUNDS,
} from "./export-video-backgrounds";
import { existsSync } from "node:fs";
import path from "node:path";

describe("fonds de la vidéo", () => {
  it("propose des identifiants uniques", () => {
    const ids = BACKGROUND_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("embarque chaque photo annoncée (image et vignette)", () => {
    for (const photo of PHOTO_BACKGROUNDS) {
      expect(existsSync(path.join("public", photo.src))).toBe(true);
      expect(existsSync(path.join("public", photo.thumb))).toBe(true);
    }
  });

  it("n'utilise jamais le noir : le défaut est un dégradé lisible", () => {
    const choice = chooseBackground(null, { hasUpload: false, isVideo: false });
    expect(choice).toMatchObject({
      kind: "preset",
      preset: { id: DEFAULT_BACKGROUND_ID },
    });
  });

  it("prend la vidéo d'origine par défaut quand le source est une vidéo", () => {
    expect(chooseBackground(null, { hasUpload: false, isVideo: true })).toEqual(
      { kind: "source" },
    );
  });

  it("une image téléversée l'emporte sur tout", () => {
    expect(
      chooseBackground("desert-dunes", { hasUpload: true, isVideo: true }),
    ).toEqual({ kind: "upload" });
  });

  it("respecte un fond proposé, même sur une session vidéo", () => {
    expect(
      chooseBackground("desert-dunes", { hasUpload: false, isVideo: true }),
    ).toMatchObject({ kind: "preset", preset: { id: "desert-dunes" } });
  });

  it("ignore « source » quand la session n'est pas une vidéo", () => {
    expect(
      chooseBackground("source", { hasUpload: false, isVideo: false }),
    ).toMatchObject({ kind: "preset" });
  });

  it("garde la couleur unie si elle est choisie", () => {
    expect(
      chooseBackground("color", { hasUpload: false, isVideo: true }),
    ).toEqual({ kind: "color" });
  });
});
