import { describe, expect, it } from "vitest";
import { VIDEO_PIECE_BYTES, videoPieces } from "./export-video-pieces";

const bytes = (n: number, fill = 1) => new Uint8Array(n).fill(fill);

describe("videoPieces", () => {
  it("coupe un gros segment en morceaux numérotés d'affilée, le dernier est marqué", () => {
    const pieces = videoPieces([{ data: bytes(10) }], 4);
    expect(pieces.map((p) => p.data.length)).toEqual([4, 4, 2]);
    expect(pieces.map((p) => p.index)).toEqual([0, 1, 2]);
    expect(pieces.map((p) => p.last)).toEqual([false, false, true]);
  });
  it("numérote à travers les segments et garde l'ordre des octets", () => {
    const pieces = videoPieces(
      [{ data: bytes(5, 1) }, { data: bytes(3, 2) }],
      4,
    );
    expect(pieces.map((p) => p.index)).toEqual([0, 1, 2]);
    expect(pieces.flatMap((p) => [...p.data])).toEqual([
      1, 1, 1, 1, 1, 2, 2, 2,
    ]);
    expect(pieces.filter((p) => p.last)).toHaveLength(1);
  });
  it("un petit segment reste d'un seul morceau", () => {
    const pieces = videoPieces([{ data: bytes(100) }]);
    expect(pieces).toHaveLength(1);
    expect(pieces[0].last).toBe(true);
  });
  it("le plafond par défaut tient dans une requête de morceau (8 Mio)", () => {
    expect(VIDEO_PIECE_BYTES).toBeLessThanOrEqual(8 * 1024 * 1024);
  });
});
