import { describe, expect, it } from "vitest";
import { canStartWith, modeLabel, modeSurah, parseLiveMode } from "./live-mode";

describe("mode d'écoute en direct", () => {
  it("retombe sur l'écoute classique sans réglage ou avec un réglage illisible", () => {
    expect(parseLiveMode(null)).toEqual({ kind: "classic" });
    expect(parseLiveMode("pas du json")).toEqual({ kind: "classic" });
    expect(parseLiveMode('{"kind":"autre"}')).toEqual({ kind: "classic" });
  });

  it("relit une récitation guidée mémorisée", () => {
    expect(parseLiveMode('{"kind":"guided","surah":18}')).toEqual({
      kind: "guided",
      surah: 18,
    });
  });

  it("ignore une sourate hors bornes sans perdre le mode guidé", () => {
    for (const surah of [0, 115, 1.5, "18", null])
      expect(parseLiveMode(JSON.stringify({ kind: "guided", surah }))).toEqual({
        kind: "guided",
        surah: null,
      });
  });

  it("n'annonce une sourate au service qu'en récitation guidée", () => {
    expect(modeSurah({ kind: "classic" })).toBeNull();
    expect(modeSurah({ kind: "guided", surah: 112 })).toBe(112);
    expect(modeSurah({ kind: "guided", surah: null })).toBeNull();
  });

  it("exige une sourate pour démarrer en récitation guidée seulement", () => {
    expect(canStartWith({ kind: "classic" })).toBe(true);
    expect(canStartWith({ kind: "guided", surah: null })).toBe(false);
    expect(canStartWith({ kind: "guided", surah: 36 })).toBe(true);
  });

  it("nomme le mode pour l'affichage", () => {
    expect(modeLabel({ kind: "classic" })).toBe("Écoute classique");
    expect(modeLabel({ kind: "guided", surah: null })).toBe(
      "Récitation guidée",
    );
    expect(modeLabel({ kind: "guided", surah: 1 })).toBe(
      "Récitation guidée · Al-Fatiha",
    );
  });
});
