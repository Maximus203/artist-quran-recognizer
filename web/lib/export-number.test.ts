import { describe, expect, it } from "vitest";
import { parseNumberFr } from "./export-number";

describe("nombre à la française", () => {
  it.each([
    ["7,0", 7],
    ["7.5", 7.5],
    ["42", 42],
    ["-100", -100],
    [" 1 000 ", 1000],
  ])("lit %s", (text, expected) => {
    expect(parseNumberFr(text)).toBe(expected);
  });
  it.each(["", "abc", "1e5", "1,2,3", "7,", ",5", "--1", "Infinity"])(
    "refuse « %s »",
    (text) => {
      expect(parseNumberFr(text)).toBeNull();
    },
  );
});
