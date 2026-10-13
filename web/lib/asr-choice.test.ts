import { describe, expect, it } from "vitest";
import { parseAsrChoice } from "./asr-choice";

describe("parseAsrChoice", () => {
  it("accepts the two installed engines", () => {
    expect(parseAsrChoice("fastconformer")).toBe("fastconformer");
    expect(parseAsrChoice("whisper")).toBe("whisper");
  });

  it("rejects an unavailable engine instead of silently substituting one", () => {
    expect(() => parseAsrChoice("muno-streaming")).toThrow(/indisponible/);
    expect(() => parseAsrChoice("anything")).toThrow(/inconnu/);
  });
});
