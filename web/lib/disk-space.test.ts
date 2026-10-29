import { describe, expect, it } from "vitest";
import { freeBytes, minFreeBytes, wouldFillDisk } from "./disk-space";

const GIB = 1024 ** 3;
describe("place disque avant un envoi", () => {
  it("réserve de 1 Gio par défaut, réglable, jamais invalide", () => {
    expect(minFreeBytes(undefined)).toBe(GIB);
    expect(minFreeBytes("0")).toBe(0);
    expect(minFreeBytes("5368709120")).toBe(5 * GIB);
    expect(minFreeBytes("abc")).toBe(GIB);
    expect(minFreeBytes("-3")).toBe(GIB);
  });
  it("refuse quand il ne resterait pas la réserve, accepte sinon", () => {
    expect(wouldFillDisk(3.5 * GIB, 3 * GIB, GIB)).toBe(true);
    expect(wouldFillDisk(10 * GIB, 3 * GIB, GIB)).toBe(false);
    expect(wouldFillDisk(2 * GIB, 0, GIB)).toBe(false);
    expect(wouldFillDisk(0.5 * GIB, 0, GIB)).toBe(true); // déjà sous la réserve : plus rien n'entre
  });
  it("taille inconnue ou volume inconnu : on ne bloque pas à tort", () => {
    expect(wouldFillDisk(null, 100 * GIB, GIB)).toBe(false);
    expect(wouldFillDisk(10 * GIB, Number.NaN, GIB)).toBe(false);
  });
  it("lit l'espace libre réel d'un dossier existant, et null pour un dossier absent", async () => {
    const free = await freeBytes(process.cwd());
    expect(free === null || free > 0).toBe(true);
    expect(await freeBytes("/chemin/qui/n/existe/pas")).toBeNull();
  });
});
