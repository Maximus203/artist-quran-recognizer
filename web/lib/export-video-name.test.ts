import { describe, expect, it } from "vitest";
import { videoFileName, videoRangeFileName } from "./export-video-name";

describe("nom de la vidéo exportée", () => {
  it("reprend le nom de l'audio, sans son extension", () => {
    expect(videoFileName("recitation-yasin.mp3")).toBe("recitation-yasin.mp4");
    expect(videoFileName("Ma récitation")).toBe("Ma récitation.mp4");
  });

  it("préfère le nom saisi, sans doubler l'extension", () => {
    expect(videoFileName("audio.mp3", "Sourate Ash-Shams")).toBe(
      "Sourate Ash-Shams.mp4",
    );
    expect(videoFileName("audio.mp3", "final.MP4")).toBe("final.mp4");
  });

  it("nettoie les séparateurs de chemin et les caractères interdits", () => {
    const name = videoFileName("a", "../../etc/passwd:x*?");
    expect(name).not.toMatch(/[\\/:*?]/);
    expect(name).not.toContain("..");
    expect(name.endsWith(".mp4")).toBe(true);
  });

  it("retombe sur « video » quand le nom est vide et borne la longueur", () => {
    expect(videoFileName("", "   ")).toBe("video.mp4");
    expect(videoFileName("x".repeat(500)).length).toBeLessThanOrEqual(120);
  });
});

describe("nom du fichier d'une plage", () => {
  const range = { start: 12, end: 40 };
  it("ajoute l'intervalle au nom de base", () => {
    expect(videoRangeFileName("rec.mp3", undefined, range, 2)).toBe(
      "rec 0m12s-0m40s.mp4",
    );
    expect(videoRangeFileName("rec.mp3", "Ma vidéo", range, 3)).toBe(
      "Ma vidéo 0m12s-0m40s.mp4",
    );
  });
  it("garde le nom saisi pour une plage unique, et le nom de base pour tout l'audio", () => {
    expect(videoRangeFileName("rec.mp3", "Ma vidéo", range, 1)).toBe(
      "Ma vidéo.mp4",
    );
    expect(videoRangeFileName("rec.mp3", undefined, null, 1)).toBe("rec.mp4");
  });
  it("le nom de la plage remplace l'intervalle, nettoyé (deux-points compris)", () => {
    expect(
      videoRangeFileName("rec.mp3", undefined, range, 2, "2:255-257"),
    ).toBe("rec — 2.255-257.mp4");
    // « 91.4 » n'est pas une extension : le numéro du verset reste.
    expect(videoRangeFileName("rec.mp3", undefined, range, 2, "91:4")).toBe(
      "rec — 91.4.mp4",
    );
    expect(
      videoRangeFileName("rec.mp3", "Ma vidéo", range, 2, "../x/Début"),
    ).not.toMatch(/[\\/:]|\.\./);
    expect(videoRangeFileName("rec.mp3", undefined, range, 2, "   ")).toBe(
      "rec 0m12s-0m40s.mp4",
    );
  });
});
