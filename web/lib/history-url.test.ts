import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { replaceUrl, type UrlWindow } from "./history-url";

/**
 * Recette QA 2, N2 : après F5 ou un lien direct sur une session, « Exporter » puis Retour changeait l'adresse sans
 * changer l'écran. Cause : `history.replaceState(null, …)` effaçait l'état que Next range dans l'entrée d'historique
 * (`__NA`, l'arbre de la page) ; sans lui, Next ignore l'événement `popstate`. Réécrire l'adresse sans toucher à l'état.
 */
function fakeWindow(state: unknown) {
  const calls: { state: unknown; url: string | null | undefined }[] = [];
  const win: UrlWindow = {
    history: {
      get state() {
        return state;
      },
      replaceState(next, _unused, url) {
        calls.push({ state: next, url });
        state = next;
      },
    },
  };
  return { win, calls, current: () => state };
}

describe("réécrire l'adresse sans effacer l'état de Next", () => {
  it("garde l'état de l'entrée courante tel quel", () => {
    const next = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ["", {}] };
    const w = fakeWindow(next);
    replaceUrl("?session=abc", w.win);
    expect(w.calls).toEqual([{ state: next, url: "?session=abc" }]);
    expect(w.current()).toBe(next);
  });

  it("n'invente pas d'état quand l'entrée n'en a pas", () => {
    const w = fakeWindow(null);
    replaceUrl("?vue=new", w.win);
    expect(w.calls[0].state).toBeNull();
  });
});

describe("plus aucun écran ne remet l'état à zéro", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      if (name === "node_modules" || name === ".next") return [];
      return statSync(full).isDirectory() ? files(full) : [full];
    });

  it("aucun `history.replaceState(null, …)` dans l'application", () => {
    const offenders = ["app", "lib"]
      .flatMap((dir) => files(path.join(process.cwd(), dir)))
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f))
      .filter((f) =>
        /history\.replaceState\(\s*null\b/.test(readFileSync(f, "utf8")),
      )
      .map((f) => path.relative(process.cwd(), f));
    expect(offenders).toEqual([]);
  });
});
