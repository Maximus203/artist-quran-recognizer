import { describe, expect, it } from "vitest";
import { parseAsrChoice } from "./asr-choice";

describe("parseAsrChoice", () => {
  it("cascade par défaut : le système choisit, pas l'utilisateur", () => {
    expect(parseAsrChoice(undefined)).toBe("cascade");
    expect(parseAsrChoice("cascade")).toBe("cascade");
  });

  it("accepts the two installed engines", () => {
    expect(parseAsrChoice("fastconformer")).toBe("fastconformer");
    expect(parseAsrChoice("whisper")).toBe("whisper");
    expect(parseAsrChoice("muno-streaming")).toBe("muno-streaming");
  });

  it("rejects an unavailable engine instead of silently substituting one", () => {
    expect(() => parseAsrChoice("anything")).toThrow(/inconnu/);
  });
});
