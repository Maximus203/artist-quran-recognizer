import { describe, expect, it, vi } from "vitest";
import { createStore } from "./mini-store";

describe("createStore", () => {
  it("garde et renvoie la valeur", () => {
    const store = createStore({ time: 0 });
    expect(store.get()).toEqual({ time: 0 });
    store.set({ time: 3 });
    expect(store.get()).toEqual({ time: 3 });
  });
  it("accepte une fonction de mise à jour", () => {
    const store = createStore(1);
    store.set((n) => n + 1);
    expect(store.get()).toBe(2);
  });
  it("prévient les abonnés, et plus après désabonnement", () => {
    const store = createStore(0);
    const listener = vi.fn();
    const off = store.subscribe(listener);
    store.set(1);
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    store.set(2);
    expect(listener).toHaveBeenCalledTimes(1);
  });
  it("ne prévient pas quand la valeur est identique", () => {
    const store = createStore(5);
    const listener = vi.fn();
    store.subscribe(listener);
    store.set(5);
    expect(listener).not.toHaveBeenCalled();
  });
  it("tolère un abonné qui se désabonne pendant la notification", () => {
    const store = createStore(0);
    const seen: string[] = [];
    const offA = store.subscribe(() => {
      seen.push("A");
      offA();
    });
    store.subscribe(() => seen.push("B"));
    store.set(1);
    store.set(2);
    expect(seen).toEqual(["A", "B", "B"]);
  });
});
