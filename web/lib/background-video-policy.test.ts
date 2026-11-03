import { describe, expect, it } from "vitest";
import {
  CLIP_ACCEPT,
  DEFAULT_CLIP_LIMITS,
  checkClipDuration,
  checkClipFile,
  clipExplanation,
  clipLimitsText,
  isClipName,
  parseClipLimits,
} from "./background-video-policy";

const MIB = 1024 * 1024;

describe("plafonds de la vidéo de fond", () => {
  it("donne les valeurs par défaut quand rien n'est réglé", () => {
    expect(parseClipLimits({})).toEqual(DEFAULT_CLIP_LIMITS);
    expect(DEFAULT_CLIP_LIMITS).toEqual({
      maxBytes: 500 * MIB,
      maxSeconds: 600,
      maxClips: 3,
    });
  });

  it("lit les réglages d'environnement et ignore ce qui n'est pas un entier positif", () => {
    expect(
      parseClipLimits({
        AQR_MAX_BACKGROUND_VIDEO_BYTES: String(100 * MIB),
        AQR_MAX_BACKGROUND_VIDEO_SECONDS: "120",
        AQR_MAX_BACKGROUND_VIDEOS: "5",
      }),
    ).toEqual({ maxBytes: 100 * MIB, maxSeconds: 120, maxClips: 5 });
    expect(
      parseClipLimits({
        AQR_MAX_BACKGROUND_VIDEO_BYTES: "-1",
        AQR_MAX_BACKGROUND_VIDEO_SECONDS: "abc",
        AQR_MAX_BACKGROUND_VIDEOS: "0",
      }),
    ).toEqual(DEFAULT_CLIP_LIMITS);
  });

  it("dit les plafonds en clair, avec les formats", () => {
    const text = clipLimitsText(DEFAULT_CLIP_LIMITS);
    expect(text).toContain("MP4");
    expect(text).toContain("500 Mo");
    expect(text).toContain("10 min");
    expect(text.toLowerCase()).toContain("muette");
  });
});

describe("type de fichier annoncé", () => {
  it("reconnaît les conteneurs vidéo, sans tenir compte de la casse", () => {
    for (const name of ["a.mp4", "A.MOV", "b.webm", "c.mkv", "d.m4v", "e.avi"])
      expect(isClipName(name)).toBe(true);
    for (const name of [
      "a.mp3",
      "b.png",
      "c",
      "d.mp4.exe",
      "e.gif",
      ".mp4x",
      ".mp4",
    ])
      expect(isClipName(name)).toBe(false);
  });

  it("propose les mêmes extensions au sélecteur de fichiers", () => {
    expect(CLIP_ACCEPT).toContain(".mp4");
    expect(CLIP_ACCEPT).toContain(".webm");
    expect(CLIP_ACCEPT).not.toContain(".mp3");
  });
});

describe("contrôle avant l'envoi (taille et format du fichier)", () => {
  const limits = DEFAULT_CLIP_LIMITS;
  it("accepte un fichier correct", () => {
    expect(
      checkClipFile({ name: "mer.mp4", size: 40 * MIB }, limits),
    ).toBeNull();
  });
  it("refuse un format inconnu, avec la liste des formats", () => {
    const problem = checkClipFile({ name: "notes.txt", size: 10 }, limits);
    expect(problem?.code).toBe("format");
    expect(problem?.message).toContain("MP4");
  });
  it("refuse un fichier vide", () => {
    expect(checkClipFile({ name: "a.mp4", size: 0 }, limits)?.code).toBe(
      "empty",
    );
  });
  it("refuse un fichier trop lourd en disant le plafond et la taille du fichier", () => {
    const problem = checkClipFile({ name: "a.mp4", size: 900 * MIB }, limits);
    expect(problem?.code).toBe("too_big");
    expect(problem?.message).toContain("500 Mo");
    expect(problem?.message).toContain("900 Mo");
  });
});

describe("contrôle de la durée", () => {
  const limits = DEFAULT_CLIP_LIMITS;
  it("accepte jusqu'au plafond inclus", () => {
    expect(checkClipDuration(30, limits)).toBeNull();
    expect(checkClipDuration(600, limits)).toBeNull();
  });
  it("refuse une vidéo trop longue en la mesurant", () => {
    const problem = checkClipDuration(725, limits);
    expect(problem?.code).toBe("too_long");
    expect(problem?.message).toContain("12 min 5 s");
    expect(problem?.message).toContain("10 min");
  });
  it("une durée nulle, négative ou infinie est « inconnue »", () => {
    for (const bad of [0, -3, Number.NaN, Number.POSITIVE_INFINITY])
      expect(checkClipDuration(bad, limits)?.code).toBe("no_duration");
  });
});

describe("explications d'erreur en français clair (cause, effet, que faire)", () => {
  const codes = [
    "format",
    "empty",
    "too_big",
    "too_long",
    "no_duration",
    "unreadable",
    "no_video",
    "network",
    "disk_full",
    "too_many",
    "missing",
    "session_missing",
    "not_ready",
    "interrupted",
    "server",
  ] as const;

  it("chaque code a une explication complète", () => {
    for (const code of codes) {
      const text = clipExplanation(code, { limits: DEFAULT_CLIP_LIMITS });
      expect(text.length).toBeGreaterThan(40);
      // jamais un code brut ni du jargon de première ligne
      expect(text).not.toMatch(/ffmpeg|ffprobe|ENOSPC|HTTP|\b\d{3}\b erreur/i);
    }
  });

  it("dit ce qui arrive à l'export quand la vidéo est perdue", () => {
    expect(clipExplanation("missing", {})).toMatch(/export/i);
    expect(clipExplanation("network", {})).toMatch(/réseau/i);
  });

  it("insère le plafond réel dans l'explication de taille et de durée", () => {
    const limits = { maxBytes: 100 * MIB, maxSeconds: 90, maxClips: 3 };
    expect(clipExplanation("too_big", { limits })).toContain("100 Mo");
    expect(clipExplanation("too_long", { limits })).toContain("1 min 30 s");
  });
});
