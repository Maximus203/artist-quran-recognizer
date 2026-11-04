import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bindBackClose, type BackWindow } from "./back-close";

/**
 * Le bouton Retour du navigateur ferme d'abord la feuille ouverte (convention mobile, recette QA m3) au lieu de
 * quitter l'éditeur. Une fausse fenêtre rejoue l'historique : des entrées, une position, `popstate`.
 */

type Entry = { state: Record<string, unknown> | null };

function fakeWindow(initial: Record<string, unknown> | null = { __NA: true }) {
  const entries: Entry[] = [{ state: initial }];
  let index = 0;
  const listeners = new Set<(event: { state: unknown }) => void>();
  const fire = () => {
    for (const listener of [...listeners])
      listener({ state: entries[index].state });
  };
  const win: BackWindow = {
    history: {
      get state() {
        return entries[index].state;
      },
      pushState(data) {
        entries.splice(index + 1);
        entries.push({ state: data as Record<string, unknown> | null });
        index += 1;
      },
      back() {
        if (index > 0) {
          index -= 1;
          fire();
        }
      },
    },
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
  };
  return {
    win,
    entries,
    position: () => index,
    listenerCount: () => listeners.size,
    /** Un `popstate` qui ne déplace rien (un autre composant, un rechargement d'état). */
    fire,
    /** Le bouton Retour du navigateur. */
    pressBack: () => win.history.back(),
    /** Une navigation de l'application (un lien) : une nouvelle entrée, sans notre marque. */
    navigate: () => win.history.pushState({ __NA: true, page: "ailleurs" }, ""),
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("Retour ferme la feuille ouverte", () => {
  it("ouvrir ajoute UNE entrée marquée, sans perdre l'état de l'application", () => {
    const w = fakeWindow();
    bindBackClose(w.win, () => undefined);
    expect(w.entries).toHaveLength(2);
    expect(w.entries[1].state).toMatchObject({ __NA: true });
    expect(Object.keys(w.entries[1].state ?? {})).toHaveLength(2);
  });

  it("Retour referme la feuille (une fois) et reste sur la page", () => {
    const w = fakeWindow();
    const onBack = vi.fn();
    bindBackClose(w.win, onBack);
    w.pressBack();
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(w.position()).toBe(0);
    expect(w.listenerCount()).toBe(0);
    w.pressBack();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("fermer par le bouton « Terminé » retire l'entrée ajoutée, sans rappeler la fermeture", () => {
    const w = fakeWindow();
    const onBack = vi.fn();
    const release = bindBackClose(w.win, onBack);
    release();
    vi.runAllTimers();
    expect(w.position()).toBe(0);
    expect(onBack).not.toHaveBeenCalled();
    expect(w.listenerCount()).toBe(0);
  });

  it("si on est déjà ailleurs (navigation de l'application), on ne recule pas d'une page de trop", () => {
    const w = fakeWindow();
    const release = bindBackClose(w.win, () => undefined);
    w.navigate();
    const at = w.position();
    release();
    vi.runAllTimers();
    expect(w.position()).toBe(at);
  });

  it("monter, démonter, remonter dans le même instant ne ferme rien et n'ajoute qu'une entrée", () => {
    const w = fakeWindow();
    const first = vi.fn();
    const second = vi.fn();
    const release = bindBackClose(w.win, first);
    release();
    bindBackClose(w.win, second);
    vi.runAllTimers();
    expect(w.entries).toHaveLength(2);
    expect(w.position()).toBe(1);
    w.pressBack();
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it("libérer deux fois ne recule qu'une fois", () => {
    const w = fakeWindow();
    const release = bindBackClose(w.win, () => undefined);
    release();
    release();
    vi.runAllTimers();
    expect(w.position()).toBe(0);
  });

  it("un événement qui ne retire pas notre entrée est ignoré", () => {
    const w = fakeWindow();
    const onBack = vi.fn();
    bindBackClose(w.win, onBack);
    // Notre entrée est toujours la courante : un popstate de passage ne ferme rien.
    w.fire();
    expect(onBack).not.toHaveBeenCalled();
    expect(w.position()).toBe(1);
  });

  it("sans fenêtre (rendu serveur), rien ne se passe", () => {
    expect(() => bindBackClose(null, () => undefined)()).not.toThrow();
  });
});
