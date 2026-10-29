import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BlockList, STRIKE_DURATIONS_MS } from "./blocklist";
import { openDatabase, type Db } from "./db";

let db: Db;
beforeEach(() => {
  db = openDatabase(":memory:");
});
afterEach(() => db.close());

const list = () => new BlockList(db, "sel-de-test");
const H = 3_600_000;
const count = () =>
  (
    db.prepare("SELECT COUNT(*) AS n FROM blocked_addresses").get() as {
      n: number;
    }
  ).n;

describe("adresses bloquées", () => {
  it("une adresse inconnue n'est pas bloquée", () => {
    expect(list().isBlocked("203.0.113.5", 0)).toBe(false);
  });

  it("le premier passage bloque 1 h, puis la durée s'allonge à chaque récidive", () => {
    const l = list();
    const first = l.strike("203.0.113.5", "route piège", 0);
    expect(first.blockedUntil).toBe(H);
    expect(l.isBlocked("203.0.113.5", H - 1)).toBe(true);
    expect(l.isBlocked("203.0.113.5", H)).toBe(false);
    const second = l.strike("203.0.113.5", "route piège", H + 1);
    expect(second.strikes).toBe(2);
    expect(second.blockedUntil - (H + 1)).toBe(STRIKE_DURATIONS_MS[1]);
    for (let i = 1; i < STRIKE_DURATIONS_MS.length; i++)
      expect(STRIKE_DURATIONS_MS[i]).toBeGreaterThan(
        STRIKE_DURATIONS_MS[i - 1],
      );
  });

  it("la durée plafonne à 7 jours", () => {
    const l = list();
    let last = { blockedUntil: 0, strikes: 0 };
    for (let i = 0; i < 12; i++) last = l.strike("198.51.100.9", "x", i);
    expect(last.blockedUntil - 11).toBe(7 * 24 * H);
  });

  it("un passage de plus de 30 jours ne compte plus : on repart de 1 h", () => {
    const l = list();
    l.strike("203.0.113.5", "x", 0);
    expect(l.strike("203.0.113.5", "x", 31 * 24 * H).strikes).toBe(1);
  });

  it("survit à un redémarrage (nouvelle instance, même base)", () => {
    list().strike("203.0.113.5", "route piège", 0);
    expect(new BlockList(db, "sel-de-test").isBlocked("203.0.113.5", 100)).toBe(
      true,
    );
  });

  it("n'écrit jamais l'adresse en clair", () => {
    list().strike("203.0.113.77", "route piège", 0);
    const dump = JSON.stringify(
      db.prepare("SELECT * FROM blocked_addresses").all(),
    );
    expect(dump).not.toContain("203.0.113.77");
    const row = db.prepare("SELECT ip_hash FROM blocked_addresses").get() as {
      ip_hash: string;
    };
    expect(row.ip_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("deux adresses sont indépendantes ; un autre sel ne reconnaît pas la première", () => {
    const l = list();
    l.strike("203.0.113.5", "x", 0);
    expect(l.isBlocked("203.0.113.6", 1)).toBe(false);
    expect(new BlockList(db, "autre-sel").isBlocked("203.0.113.5", 1)).toBe(
      false,
    );
  });

  it("lever un blocage : par adresse ou par empreinte ; la liste donne empreinte, raison, fin", () => {
    const l = list();
    const { hash } = l.strike("203.0.113.5", "route piège", 0);
    l.strike("203.0.113.6", "formulaire leurre", 0);
    const rows = l.active(10, 10);
    expect(rows.map((r) => r.reason).sort()).toEqual([
      "formulaire leurre",
      "route piège",
    ]);
    expect(rows[0]).toHaveProperty("hash");
    expect(l.lift(hash)).toBe(true);
    expect(l.isBlocked("203.0.113.5", 10)).toBe(false);
    expect(l.lift("203.0.113.6")).toBe(true);
    expect(l.lift("203.0.113.6")).toBe(false);
    expect(l.active(10, 10)).toEqual([]);
  });

  it("purge les blocages expirés depuis longtemps", () => {
    const l = list();
    l.strike("203.0.113.5", "x", 0);
    expect(l.purge(8 * 24 * H)).toBe(1);
    expect(count()).toBe(0);
  });

  it("ne bloque jamais une adresse « locale » ou inconnue (tout le monde partagerait la même)", () => {
    const l = list();
    expect(l.strike("local", "x", 0).blockedUntil).toBe(0);
    expect(l.strike("unknown", "x", 0).blockedUntil).toBe(0);
    expect(l.isBlocked("local", 1)).toBe(false);
    expect(count()).toBe(0);
  });
});
