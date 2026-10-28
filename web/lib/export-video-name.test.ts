import { describe, expect, it } from "vitest";
import { videoFileName } from "./export-video-name";

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
