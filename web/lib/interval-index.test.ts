import { describe, expect, it } from "vitest";
import {
  buildTimeIndex,
  indexAt,
  indicesOverlapping,
  nearestIndex,
  timeIndexOf,
  type TimedItem,
} from "./interval-index";

const item = (a: number, b: number): TimedItem => ({ t: [a, b] });
const none: TimedItem = { t: null };

/** Référence naïve : première entrée (ordre du tableau) qui couvre l'instant. */
const naiveAt = (items: readonly TimedItem[], time: number) =>
  items.findIndex((i) => i.t !== null && i.t[0] <= time && time < i.t[1]);
const naiveOverlap = (items: readonly TimedItem[], a: number, b: number) =>
  items.flatMap((i, n) =>
    i.t !== null && i.t[0] < b && i.t[1] > a ? [n] : [],
  );

describe("indexAt", () => {
  const items = [item(0, 2), none, item(2, 5), item(5, 6), item(8, 9)];
  const index = buildTimeIndex(items);

  it("trouve l'intervalle qui couvre l'instant (début inclus, fin exclue)", () => {
    expect(indexAt(index, 0)).toBe(0);
    expect(indexAt(index, 1.99)).toBe(0);
    expect(indexAt(index, 2)).toBe(2);
    expect(indexAt(index, 5.5)).toBe(3);
    expect(indexAt(index, 8)).toBe(4);
  });
  it("renvoie -1 dans un trou, avant le premier et après le dernier", () => {
    expect(indexAt(index, 6)).toBe(-1);
    expect(indexAt(index, 7.5)).toBe(-1);
    expect(indexAt(index, 9)).toBe(-1);
    expect(indexAt(index, -1)).toBe(-1);
  });
  it("ignore les intervalles sans temps et les instants non finis", () => {
    expect(indexAt(buildTimeIndex([none, none]), 1)).toBe(-1);
    expect(indexAt(index, Number.NaN)).toBe(-1);
    expect(indexAt(buildTimeIndex([]), 0)).toBe(-1);
  });
  it("garde la sémantique de findIndex quand des intervalles se chevauchent", () => {
    const overlapping = [item(0, 10), item(2, 3), item(4, 12)];
    const built = buildTimeIndex(overlapping);
    for (const time of [0, 1, 2.5, 3, 4.5, 9.9, 10, 11, 12])
      expect(indexAt(built, time)).toBe(naiveAt(overlapping, time));
  });
  it("accepte des intervalles désordonnés (ordre du tableau ≠ ordre du temps)", () => {
    const shuffled = [item(8, 9), item(0, 2), none, item(5, 6), item(2, 5)];
    const built = buildTimeIndex(shuffled);
    for (const time of [0, 1, 2, 4.9, 5, 5.9, 6, 8.5, 9])
      expect(indexAt(built, time)).toBe(naiveAt(shuffled, time));
  });
  it("est équivalent à la recherche linéaire sur des données tirées au hasard", () => {
    let seed = 7;
    const rand = () =>
      (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (let round = 0; round < 40; round++) {
      const items = Array.from({ length: 60 }, () => {
        if (rand() < 0.1) return none;
        const a = rand() * 100;
        return item(a, a + 0.05 + rand() * (rand() < 0.2 ? 30 : 3));
      });
      const built = buildTimeIndex(items);
      for (let k = 0; k < 120; k++) {
        const time = rand() * 135 - 5;
        expect(indexAt(built, time)).toBe(naiveAt(items, time));
      }
    }
  });
});

describe("nearestIndex", () => {
  const items = [item(0, 2), none, item(10, 12), item(20, 21)];
  const index = buildTimeIndex(items);

  it("donne l'intervalle qui couvre l'instant quand il y en a un", () => {
    expect(nearestIndex(index, 1)).toBe(0);
    expect(nearestIndex(index, 11)).toBe(2);
  });
  it("sinon le plus proche, avant ou après (un clic dans le vide d'un bloc)", () => {
    expect(nearestIndex(index, 3)).toBe(0);
    expect(nearestIndex(index, 9)).toBe(2);
    expect(nearestIndex(index, 15)).toBe(2);
    expect(nearestIndex(index, 17)).toBe(3);
  });
  it("borne aux extrémités : avant le premier, après le dernier", () => {
    expect(nearestIndex(index, -5)).toBe(0);
    expect(nearestIndex(index, 99)).toBe(3);
  });
  it("renvoie -1 sans intervalle daté ou pour un instant non fini", () => {
    expect(nearestIndex(buildTimeIndex([none]), 1)).toBe(-1);
    expect(nearestIndex(buildTimeIndex([]), 1)).toBe(-1);
    expect(nearestIndex(index, Number.NaN)).toBe(-1);
  });
  it("est équivalent à la recherche linéaire du plus proche sur des données tirées au hasard", () => {
    let seed = 5;
    const rand = () =>
      (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (let round = 0; round < 30; round++) {
      const many = Array.from({ length: 50 }, () => {
        const a = rand() * 100;
        return item(a, a + 0.05 + rand() * 2);
      });
      const built = buildTimeIndex(many);
      for (let k = 0; k < 60; k++) {
        const time = rand() * 110 - 5;
        const got = nearestIndex(built, time);
        const distance = (i: TimedItem) =>
          Math.max(
            0,
            (i.t as [number, number])[0] - time,
            time - (i.t as [number, number])[1],
          );
        const best = Math.min(...many.map(distance));
        expect(distance(many[got])).toBeCloseTo(best, 9);
      }
    }
  });
});

describe("indicesOverlapping", () => {
  const items = [item(0, 2), none, item(2, 5), item(5, 6), item(8, 9)];
  const index = buildTimeIndex(items);

  it("liste, dans l'ordre du tableau, ce qui touche la fenêtre", () => {
    expect(indicesOverlapping(index, 1, 5.5)).toEqual([0, 2, 3]);
    expect(indicesOverlapping(index, 6, 8)).toEqual([]);
    expect(indicesOverlapping(index, 0, 100)).toEqual([0, 2, 3, 4]);
  });
  it("exclut ce qui ne fait que toucher le bord de la fenêtre", () => {
    expect(indicesOverlapping(index, 2, 5)).toEqual([2]);
    expect(indicesOverlapping(index, 5, 8)).toEqual([3]);
  });
  it("retrouve un grand intervalle qui englobe la fenêtre", () => {
    const wide = [item(0, 100), item(10, 11), item(50, 51)];
    expect(indicesOverlapping(buildTimeIndex(wide), 70, 72)).toEqual([0]);
  });
  it("renvoie vide pour une fenêtre vide ou non finie", () => {
    expect(indicesOverlapping(index, 3, 3)).toEqual([]);
    expect(indicesOverlapping(index, 4, 2)).toEqual([]);
    expect(indicesOverlapping(index, Number.NaN, 2)).toEqual([]);
  });
  it("est équivalent à la recherche linéaire sur des données tirées au hasard", () => {
    let seed = 11;
    const rand = () =>
      (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (let round = 0; round < 40; round++) {
      const items = Array.from({ length: 80 }, () => {
        if (rand() < 0.1) return none;
        const a = rand() * 200;
        return item(a, a + 0.05 + rand() * (rand() < 0.15 ? 60 : 4));
      });
      const built = buildTimeIndex(items);
      for (let k = 0; k < 60; k++) {
        const a = rand() * 220 - 10;
        const b = a + rand() * 40;
        expect(indicesOverlapping(built, a, b)).toEqual(
          naiveOverlap(items, a, b),
        );
      }
    }
  });
});

describe("timeIndexOf", () => {
  it("mémorise l'index par tableau d'intervalles (un seul calcul par résultat)", () => {
    const items = [item(0, 1), item(1, 2)];
    expect(timeIndexOf(items)).toBe(timeIndexOf(items));
    expect(timeIndexOf([...items])).not.toBe(timeIndexOf(items));
  });
});
