import { describe, expect, it } from "vitest";
import {
  formatTimeInput,
  MAX_RANGES,
  normalizeRanges,
  parseRangeRows,
  parseTimeInput,
  rangeLabel,
  rangesFromCards,
} from "./export-video-ranges";

describe("normalizeRanges", () => {
  it("sans plage : tout l'audio, une seule vidéo", () => {
    expect(normalizeRanges(undefined, 41.5)).toEqual({
      ok: true,
      ranges: [{ start: 0, end: 41.5 }],
    });
    expect(normalizeRanges([], 10)).toEqual({
      ok: true,
      ranges: [{ start: 0, end: 10 }],
    });
  });

  it("garde l'ordre donné et ramène une fin trop lointaine à la durée", () => {
    const result = normalizeRanges(
      [
        { start: 20, end: 30 },
        { start: 5, end: 99 },
      ],
      40,
    );
    expect(result).toEqual({
      ok: true,
      ranges: [
        { start: 20, end: 30 },
        { start: 5, end: 40 },
      ],
    });
  });

  it("refuse une plage hors audio, trop courte, négative ou illisible", () => {
    const error = (r: { start: number; end: number }) => {
      const out = normalizeRanges([r], 40);
      return out.ok ? "" : out.error;
    };
    expect(error({ start: 50, end: 60 })).toMatch(/Plage 1.*après la fin/);
    expect(error({ start: 10, end: 10.2 })).toMatch(/trop courte/);
    expect(error({ start: -1, end: 5 })).toMatch(/négatif/);
    expect(error({ start: Number.NaN, end: 5 })).toMatch(/illisible/);
  });

  it("borne le nombre de plages", () => {
    const many = Array.from({ length: MAX_RANGES + 1 }, (_, i) => ({
      start: i,
      end: i + 1,
    }));
    expect(normalizeRanges(many, 1000).ok).toBe(false);
  });
});

describe("saisie des temps", () => {
  it("lit secondes, minutes:secondes et heures:minutes:secondes", () => {
    expect(parseTimeInput("83")).toBe(83);
    expect(parseTimeInput("1:23")).toBe(83);
    expect(parseTimeInput("1:23,5")).toBe(83.5);
    expect(parseTimeInput("1:02:03")).toBe(3723);
  });
  it("rejette ce qui n'est pas un temps", () => {
    for (const bad of ["", "abc", "1:2:3:4", "-5", "1::2"])
      expect(parseTimeInput(bad)).toBeNull();
  });
  it("reformate comme on le saisit", () => {
    expect(formatTimeInput(83)).toBe("1:23");
    expect(formatTimeInput(83.5)).toBe("1:23,5");
    expect(formatTimeInput(5)).toBe("0:05");
    expect(formatTimeInput(3723)).toBe("1:02:03");
    expect(parseTimeInput(formatTimeInput(41.5))).toBe(41.5);
  });
  it("nomme une plage pour un nom de fichier", () => {
    expect(rangeLabel({ start: 12, end: 100 })).toBe("0m12s-1m40s");
  });
});

describe("rangesFromCards", () => {
  it("fait une plage par passage, bornée à la durée", () => {
    expect(
      rangesFromCards(
        [
          { start: 0.4, end: 5 },
          { start: 5, end: 5.1 },
          { start: 6, end: 80 },
        ],
        41.5,
      ),
    ).toEqual([
      { start: 0.4, end: 5 },
      { start: 6, end: 41.5 },
    ]);
  });
});

describe("parseRangeRows", () => {
  const row = (id: number, start: string, end: string) => ({ id, start, end });
  it("lit les temps saisis", () => {
    expect(
      parseRangeRows([row(1, "0:05", "0:20"), row(2, "1:00", "1:10")], 80),
    ).toEqual({
      ok: true,
      ranges: [
        { start: 5, end: 20 },
        { start: 60, end: 70 },
      ],
    });
  });
  it("dit quelle partie est en cause", () => {
    const error = (rows: ReturnType<typeof row>[]) => {
      const r = parseRangeRows(rows, 40);
      return r.ok ? "" : r.error;
    };
    expect(error([])).toMatch(/au moins une partie/);
    expect(error([row(1, "a", "5")])).toMatch(/Partie 1.*1:23/);
    expect(error([row(1, "0:05", "0:10"), row(2, "0:30", "0:20")])).toMatch(
      /Partie 2.*fin doit venir après/,
    );
    expect(error([row(1, "2:00", "2:30")])).toMatch(/Partie 1.*après la fin/);
  });
});
