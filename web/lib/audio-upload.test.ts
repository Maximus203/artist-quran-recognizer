import { describe, expect, it } from "vitest";
import {
  acceptedMediaFiles,
  bindAudioDrop,
  bindMediaDrop,
  firstAcceptedAudio,
  isAcceptedAudioName,
  isAcceptedMediaName,
  isVideoName,
  mediaAccept,
} from "./audio-upload";

describe("audio import", () => {
  it("accepts the same extensions as the server regardless of case", () => {
    for (const extension of [
      "mp3",
      "m4a",
      "wav",
      "ogg",
      "opus",
      "flac",
      "aac",
      "webm",
    ])
      expect(isAcceptedAudioName(`recitation.${extension.toUpperCase()}`)).toBe(
        true,
      );
    expect(isAcceptedAudioName("result.json")).toBe(false);
    expect(isAcceptedAudioName("recording.mp4")).toBe(false);
  });

  it("selects the first supported audio in a mixed drop", () => {
    const files = [
      { name: "notes.txt", type: "text/plain" },
      { name: "recording.WAV", type: "" },
      { name: "second.mp3", type: "audio/mpeg" },
    ];
    expect(firstAcceptedAudio(files)).toBe(files[1]);
    expect(firstAcceptedAudio(files.slice(0, 1))).toBeNull();
  });

  it("does not treat an unsupported file as valid solely from its MIME type", () => {
    expect(
      firstAcceptedAudio([{ name: "movie.mp4", type: "audio/mp4" }]),
    ).toBeNull();
  });

  it("handles a global file drop and prevents browser navigation", () => {
    const target = new EventTarget();
    const received: string[] = [];
    const active: boolean[] = [];
    const unbind = bindAudioDrop(target, {
      onActive: (value) => active.push(value),
      onAudio: (audio) => received.push(audio.name),
      onError: (message) => received.push(message),
    });
    const drag = (kind: string, name = "test.wav") => {
      const event = new Event(kind, { cancelable: true });
      Object.defineProperty(event, "dataTransfer", {
        value: {
          types: ["Files"],
          files: [{ name }],
          dropEffect: "none",
        },
      });
      target.dispatchEvent(event);
      return event;
    };
    expect(drag("dragenter").defaultPrevented).toBe(true);
    expect(active).toEqual([true]);
    expect(drag("drop").defaultPrevented).toBe(true);
    expect(received).toEqual(["test.wav"]);
    expect(active).toEqual([true, false]);
    drag("drop", "notes.txt");
    expect(received[1]).toMatch(/Aucun audio compatible/);
    unbind();
    drag("drop");
    expect(received).toHaveLength(2);
  });
});

describe("audio et vidéo", () => {
  it("accepte les conteneurs vidéo (mp4, mkv, mov, webm, avi, m4v) sans casse", () => {
    for (const extension of ["mp4", "mkv", "mov", "webm", "avi", "m4v"])
      expect(isAcceptedMediaName(`cours.${extension.toUpperCase()}`)).toBe(
        true,
      );
    for (const extension of ["mp3", "wav", "m4a"])
      expect(isAcceptedMediaName(`a.${extension}`)).toBe(true);
    expect(isAcceptedMediaName("notes.txt")).toBe(false);
    expect(isAcceptedMediaName("result.json")).toBe(false);
    expect(isAcceptedMediaName("sans-extension")).toBe(false);
  });

  it("isVideoName : seulement les conteneurs vidéo (webm reste audio, enregistrement micro)", () => {
    expect(isVideoName("a.mp4")).toBe(true);
    expect(isVideoName("a.MKV")).toBe(true);
    expect(isVideoName("a.webm")).toBe(false);
    expect(isVideoName("a.mp3")).toBe(false);
  });

  it("le sélecteur de fichiers annonce audio et vidéo", () => {
    for (const extension of [
      ".mp3",
      ".mp4",
      ".mkv",
      ".mov",
      ".avi",
      ".m4v",
      ".webm",
    ])
      expect(mediaAccept.split(",")).toContain(extension);
  });

  it("acceptedMediaFiles garde tous les médias d'un dépôt multiple, dans l'ordre", () => {
    const files = [
      { name: "notes.txt" },
      { name: "a.mp4" },
      { name: "b.MP3" },
      { name: "c.json" },
      { name: "d.mkv" },
    ];
    expect(acceptedMediaFiles(files).map((f) => f.name)).toEqual([
      "a.mp4",
      "b.MP3",
      "d.mkv",
    ]);
    expect(acceptedMediaFiles([])).toEqual([]);
  });

  it("un dépôt multiple remonte tous les médias en une fois ; sans média : message d'erreur", () => {
    const target = new EventTarget();
    const received: string[][] = [];
    const errors: string[] = [];
    bindMediaDrop(target, {
      onActive: () => undefined,
      onFiles: (files) => received.push(files.map((f) => f.name)),
      onError: (message) => errors.push(message),
    });
    const drop = (names: string[]) => {
      const event = new Event("drop", { cancelable: true });
      Object.defineProperty(event, "dataTransfer", {
        value: {
          types: ["Files"],
          files: names.map((name) => ({ name })),
          dropEffect: "none",
        },
      });
      target.dispatchEvent(event);
      return event;
    };
    expect(drop(["a.mp4", "notes.txt", "b.mp3"]).defaultPrevented).toBe(true);
    expect(received).toEqual([["a.mp4", "b.mp3"]]);
    drop(["notes.txt"]);
    expect(errors[0]).toMatch(/Aucun audio ou vidéo compatible/);
    expect(received).toHaveLength(1);
  });

  it("bindAudioDrop reste audio seulement : une vidéo déposée n'est pas un audio", () => {
    const target = new EventTarget();
    const got: string[] = [];
    bindAudioDrop(target, {
      onActive: () => undefined,
      onAudio: (file) => got.push(file.name),
      onError: (message) => got.push(message),
    });
    const event = new Event("drop", { cancelable: true });
    Object.defineProperty(event, "dataTransfer", {
      value: {
        types: ["Files"],
        files: [{ name: "a.mp4" }],
        dropEffect: "none",
      },
    });
    target.dispatchEvent(event);
    expect(got[0]).toMatch(/Aucun audio compatible/);
  });
});
