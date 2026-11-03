import { describe, expect, it } from "vitest";
import { clearOps, pendingOps, queueOps } from "./export-draft";

const memory = () => {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    data,
  };
};
const SESSION = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ADMIN = 1;
const TESTER = 2;
const op = { op: "withdraw", id: "x" } as const;

describe("décisions gardées hors ligne, par compte", () => {
  it("garde, relit puis vide", () => {
    const store = memory();
    expect(pendingOps(ADMIN, SESSION, store)).toEqual([]);
    queueOps(ADMIN, SESSION, [op], store);
    queueOps(ADMIN, SESSION, [{ op: "consent", training: false }], store);
    expect(pendingOps(ADMIN, SESSION, store)).toHaveLength(2);
    clearOps(ADMIN, SESSION, store);
    expect(pendingOps(ADMIN, SESSION, store)).toEqual([]);
  });

  it("deux comptes sur le même navigateur ne lisent jamais les décisions l'un de l'autre", () => {
    const store = memory();
    queueOps(ADMIN, SESSION, [op], store);
    expect(pendingOps(TESTER, SESSION, store)).toEqual([]);
    queueOps(TESTER, SESSION, [{ op: "consent", training: false }], store);
    expect(pendingOps(ADMIN, SESSION, store)).toEqual([op]);
  });

  it("une session ne lit jamais les décisions d'une autre", () => {
    const store = memory();
    queueOps(ADMIN, SESSION, [op], store);
    expect(
      pendingOps(ADMIN, "11111111-bbbb-4ccc-8ddd-eeeeeeeeeeee", store),
    ).toEqual([]);
  });

  it("reprend l'ancienne file sans compte pour le premier compte qui l'ouvre, puis la supprime", () => {
    const store = memory();
    store.setItem(`aqr.ui.v1.export.draft.${SESSION}`, JSON.stringify([op]));
    expect(pendingOps(TESTER, SESSION, store)).toEqual([op]);
    expect(store.data.has(`aqr.ui.v1.export.draft.${SESSION}`)).toBe(false);
    expect(pendingOps(ADMIN, SESSION, store)).toEqual([]);
  });

  it("jette ce qui est illisible ou n'est pas une opération", () => {
    const store = memory();
    store.setItem(`aqr.ui.v2.export.draft.${ADMIN}.${SESSION}`, "{pas du json");
    expect(pendingOps(ADMIN, SESSION, store)).toEqual([]);
    store.setItem(
      `aqr.ui.v2.export.draft.${ADMIN}.${SESSION}`,
      JSON.stringify([op, { op: "rm -rf" }, 3, null]),
    );
    expect(pendingOps(ADMIN, SESSION, store)).toEqual([op]);
  });

  it("un stockage qui lève ne casse rien", () => {
    const hostile = {
      getItem: () => {
        throw new Error("bloqué");
      },
      setItem: () => {
        throw new Error("plein");
      },
      removeItem: () => {
        throw new Error("bloqué");
      },
    };
    expect(pendingOps(ADMIN, SESSION, hostile)).toEqual([]);
    expect(() => queueOps(ADMIN, SESSION, [op], hostile)).not.toThrow();
    expect(() => clearOps(ADMIN, SESSION, hostile)).not.toThrow();
  });

  it("ne garde que les 50 dernières opérations", () => {
    const store = memory();
    for (let n = 0; n < 60; n++)
      queueOps(ADMIN, SESSION, [{ op: "withdraw", id: String(n) }], store);
    const all = pendingOps(ADMIN, SESSION, store);
    expect(all).toHaveLength(50);
    expect(all[49]).toEqual({ op: "withdraw", id: "59" });
  });
});
