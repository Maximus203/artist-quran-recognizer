import { describe, expect, it } from "vitest";
import { groupByDate, mergePages } from "./session-groups";

const at = (iso: string) => ({ id: iso, created_at: iso });
// Midi local : « mercredi 21 octobre 2026 », à l'abri des décalages de fuseau.
const NOW = new Date(2026, 9, 21, 12, 0, 0).getTime();
const local = (y: number, m: number, d: number, h = 10) =>
  new Date(y, m - 1, d, h).toISOString();

describe("groupByDate", () => {
  it("range par jour : aujourd'hui, hier, cette semaine, puis par mois", () => {
    const items = [
      at(local(2026, 10, 21, 9)),
      at(local(2026, 10, 20, 23)),
      at(local(2026, 10, 17, 8)),
      at(local(2026, 10, 2, 8)),
      at(local(2026, 9, 12, 8)),
      at(local(2025, 12, 31, 8)),
    ];
    const groups = groupByDate(items, "recent", NOW);
    expect(groups.map((g) => g.label)).toEqual([
      "Aujourd’hui",
      "Hier",
      "Cette semaine",
      "Octobre 2026",
      "Septembre 2026",
      "Décembre 2025",
    ]);
    expect(groups.map((g) => g.items.length)).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it("garde l'ordre reçu du serveur dans chaque groupe", () => {
    const a = at(local(2026, 10, 21, 11));
    const b = at(local(2026, 10, 21, 9));
    const [group] = groupByDate([a, b], "recent", NOW);
    expect(group.items).toEqual([a, b]);
  });

  it("regroupe aussi le tri « plus anciennes d'abord »", () => {
    const groups = groupByDate(
      [at(local(2026, 9, 1)), at(local(2026, 10, 21))],
      "oldest",
      NOW,
    );
    expect(groups.map((g) => g.label)).toEqual(["Septembre 2026", "Aujourd’hui"]);
  });

  it("ne regroupe pas quand le tri n'est pas chronologique (nom, durée, taille)", () => {
    for (const sort of ["name", "duration", "size"] as const) {
      const groups = groupByDate([at(local(2026, 10, 21))], sort, NOW);
      expect(groups).toHaveLength(1);
      expect(groups[0].label).toBeNull();
    }
  });

  it("une date illisible tombe dans « Date inconnue », jamais perdue", () => {
    const groups = groupByDate([{ id: "x", created_at: "pas une date" }], "recent", NOW);
    expect(groups[0].label).toBe("Date inconnue");
    expect(groups[0].items).toHaveLength(1);
  });

  it("liste vide : aucun groupe", () => {
    expect(groupByDate([], "recent", NOW)).toEqual([]);
  });
});

describe("mergePages", () => {
  it("ajoute la page suivante à la fin, sans doublon d'identifiant", () => {
    const merged = mergePages(
      [{ id: "a" }, { id: "b" }],
      [{ id: "b" }, { id: "c" }],
    );
    expect(merged.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("la version la plus récente d'une ligne remplace l'ancienne", () => {
    const merged = mergePages(
      [{ id: "a", v: 1 }],
      [{ id: "a", v: 2 }],
    );
    expect(merged).toEqual([{ id: "a", v: 2 }]);
  });
});
