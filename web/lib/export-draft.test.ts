import { describe, expect, it } from "vitest";
import { clearOps, pendingOps, queueOps } from "./export-draft";

const memory = () => {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
};
const SESSION = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const op = { op: "withdraw", id: "x" } as const;

describe("décisions gardées hors ligne", () => {
  it("garde, relit puis vide", () => {
    const store = memory();
    expect(pendingOps(SESSION, store)).toEqual([]);
    queueOps(SESSION, [op], store);
    queueOps(SESSION, [{ op: "consent", training: false }], store);
    expect(pendingOps(SESSION, store)).toHaveLength(2);
    clearOps(SESSION, store);
    expect(pendingOps(SESSION, store)).toEqual([]);
  });
  it("une session ne lit jamais les décisions d'une autre", () => {
    const store = memory();
    queueOps(SESSION, [op], store);
    expect(pendingOps("11111111-bbbb-4ccc-8ddd-eeeeeeeeeeee", store)).toEqual(
      [],
    );
  });
  it("jette ce qui est illisible ou n'est pas une opération", () => {
    const store = memory();
    store.setItem(`aqr.ui.v1.export.draft.${SESSION}`, "{pas du json");
    expect(pendingOps(SESSION, store)).toEqual([]);
    store.setItem(
      `aqr.ui.v1.export.draft.${SESSION}`,
      JSON.stringify([op, { op: "rm -rf" }, 3, null]),
    );
    expect(pendingOps(SESSION, store)).toEqual([op]);
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
    expect(pendingOps(SESSION, hostile)).toEqual([]);
    expect(() => queueOps(SESSION, [op], hostile)).not.toThrow();
    expect(() => clearOps(SESSION, hostile)).not.toThrow();
  });
  it("ne garde que les 50 dernières opérations", () => {
    const store = memory();
    for (let n = 0; n < 60; n++)
      queueOps(SESSION, [{ op: "withdraw", id: String(n) }], store);
    const all = pendingOps(SESSION, store);
    expect(all).toHaveLength(50);
    expect(all.at(-1)).toEqual({ op: "withdraw", id: "59" });
  });
});
