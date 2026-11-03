import { describe, expect, it } from "vitest";
import { neighbours } from "./export-neighbours";
import type { ReadinessItem } from "./export-types";

const item = (key: string, state: ReadinessItem["state"]): ReadinessItem => ({
  key,
  type: "inferred",
  index: 0,
  fingerprint: key,
  t: [0, 1],
  ref: null,
  words: null,
  impact: "arabic",
  effective: true,
  state,
  decision: null,
  review_ids: [],
  related_reports: [],
});

describe("passer d'un passage au suivant", () => {
  const items = [
    item("a", "open"),
    item("b", "resolved"),
    item("c", "open"),
    item("d", "ignored"),
    item("e", "open"),
  ];
  it("rang parmi les non résolus et voisins non résolus", () => {
    expect(neighbours(items, "c")).toEqual({
      position: 2,
      open: 3,
      prev: "a",
      next: "e",
    });
  });
  it("le premier n'a pas de précédent, le dernier pas de suivant", () => {
    expect(neighbours(items, "a")).toMatchObject({
      position: 1,
      prev: null,
      next: "c",
    });
    expect(neighbours(items, "e")).toMatchObject({
      position: 3,
      prev: "c",
      next: null,
    });
  });
  it("un passage résolu n'a pas de rang mais garde ses voisins non résolus", () => {
    expect(neighbours(items, "b")).toEqual({
      position: null,
      open: 3,
      prev: "a",
      next: "c",
    });
  });
  it("un passage inconnu ne casse rien", () => {
    expect(neighbours(items, "zzz").position).toBeNull();
    expect(neighbours([], "a")).toEqual({
      position: null,
      open: 0,
      prev: null,
      next: null,
    });
  });
});
