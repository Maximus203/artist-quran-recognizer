import { describe, expect, it } from "vitest";
import {
  recordingExtension,
  recordingError,
  supportedRecordingType,
} from "./recording";

describe("microphone recordings", () => {
  it("keeps the original browser container when importing", () => {
    expect(recordingExtension("audio/webm;codecs=opus")).toBe(".webm");
    expect(recordingExtension("audio/ogg;codecs=opus")).toBe(".ogg");
    expect(recordingExtension("audio/mp4")).toBe(".m4a");
    expect(recordingExtension("audio/x-unknown")).toBeNull();
    expect(supportedRecordingType((mime) => mime === "audio/ogg")).toBe(
      "audio/ogg",
    );
    expect(supportedRecordingType(() => false)).toBeNull();
  });

  it("explains permission and device errors without exposing browser jargon", () => {
    expect(recordingError({ name: "NotAllowedError" })).toMatch(
      /autorisation/i,
    );
    expect(recordingError({ name: "NotFoundError" })).toMatch(/microphone/i);
    expect(recordingError({ name: "NotReadableError" })).toMatch(/utilisé/i);
  });
});
