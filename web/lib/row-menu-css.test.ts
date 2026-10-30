import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("menu d'une ligne de la liste", () => {
  it("n'est pas tronqué par la coupe de la liste quand il est ouvert", () => {
    const css = readFileSync(
      path.join(process.cwd(), "app", "phase2.css"),
      "utf8",
    );
    // La liste est coupée à ses bords (coins arrondis) ; le menu s'ouvre vers le bas et, sur les
    // dernières lignes, serait invisible sans cette levée de la coupe tant qu'un menu est ouvert.
    expect(css).toMatch(
      /\.list-card:has\(\.rowmenu\)\s*\{[^}]*overflow:\s*visible/,
    );
  });
});
