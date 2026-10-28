import { describe, expect, it } from "vitest";
import { parseByteRange } from "./byte-range";

describe("parseByteRange", () => {
  it("sans en-tête : tout le fichier", () => {
    expect(parseByteRange(null, 100)).toEqual({ kind: "full" });
  });
  it("intervalle fermé, ouvert et borné à la taille", () => {
    expect(parseByteRange("bytes=10-19", 100)).toEqual({
      kind: "partial",
      start: 10,
      end: 19,
    });
    expect(parseByteRange("bytes=90-", 100)).toEqual({
      kind: "partial",
      start: 90,
      end: 99,
    });
    expect(parseByteRange("bytes=90-500", 100)).toEqual({
      kind: "partial",
      start: 90,
      end: 99,
    });
  });
  it("suffixe : les derniers octets", () => {
    expect(parseByteRange("bytes=-10", 100)).toEqual({
      kind: "partial",
      start: 90,
      end: 99,
    });
  });
  it("hors fichier : non satisfaisable", () => {
    expect(parseByteRange("bytes=100-", 100).kind).toBe("unsatisfiable");
    expect(parseByteRange("bytes=50-10", 100).kind).toBe("unsatisfiable");
  });
  it("en-tête illisible : tout le fichier", () => {
    expect(parseByteRange("items=1-2", 100)).toEqual({ kind: "full" });
  });
});
