import { describe, expect, it } from "vitest";
import {
  bindAudioDrop,
  firstAcceptedAudio,
  isAcceptedAudioName,
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
