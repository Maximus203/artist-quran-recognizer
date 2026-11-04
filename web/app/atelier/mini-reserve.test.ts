import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MINI_PLAYER_FLAG, announceMiniPlayer } from "./mini-reserve";

/**
 * Le lecteur réduit est posé en bas de TOUTE page connectée (`position: fixed`). Une page qui occupe toute la
 * hauteur de l'écran (les éditeurs de la vidéo d'export) doit lui laisser la place : UNE seule variable
 * (`--mini-reserve`, posée sur la racine tant qu'il est là), lue par chaque hauteur « plein écran ». Ces tests
 * gardent le contrat : sans lui, un toucher sur « Réglages » ouvrait la session et quittait l'éditeur (recette QA, B1).
 */

const APP = path.join(process.cwd(), "app");
const css = (file: string) => readFileSync(path.join(APP, file), "utf8");

describe("annonce du lecteur réduit", () => {
  it("pose le drapeau sur la racine tant que le lecteur est là, et le retire ensuite", () => {
    const root = { dataset: {} as Record<string, string | undefined> };
    const stop = announceMiniPlayer(root);
    expect(root.dataset[MINI_PLAYER_FLAG]).toBe("");
    stop();
    expect(root.dataset[MINI_PLAYER_FLAG]).toBeUndefined();
  });

  it("deux lecteurs annoncés de suite : le drapeau reste jusqu'au dernier retrait", () => {
    const root = { dataset: {} as Record<string, string | undefined> };
    const stopA = announceMiniPlayer(root);
    const stopB = announceMiniPlayer(root);
    stopA();
    expect(root.dataset[MINI_PLAYER_FLAG]).toBe("");
    stopB();
    expect(root.dataset[MINI_PLAYER_FLAG]).toBeUndefined();
  });

  it("un retrait appelé deux fois ne retire pas le drapeau d'un autre", () => {
    const root = { dataset: {} as Record<string, string | undefined> };
    const stopA = announceMiniPlayer(root);
    const stopB = announceMiniPlayer(root);
    stopA();
    stopA();
    expect(root.dataset[MINI_PLAYER_FLAG]).toBe("");
    stopB();
  });
});

describe("la place du lecteur réduit dans les feuilles de style", () => {
  const tokens = css("tokens.css");

  it("la réserve vaut zéro par défaut et la hauteur du lecteur quand il est annoncé", () => {
    expect(tokens).toMatch(/--mini-reserve:\s*0px/);
    expect(tokens).toMatch(
      /:root\[data-mini-player\]\s*\{[^}]*--mini-reserve:\s*calc\([^;]*var\(--mini-h\)/,
    );
  });

  it("le lecteur réduit lit la MÊME hauteur que la réserve", () => {
    const mini = css("playlists.css");
    expect(mini).toMatch(
      /\.mini-player\s*\{[^}]*min-height:\s*var\(--mini-h\)/,
    );
  });

  it("toute hauteur « écran moins l'en-tête » réserve le lecteur (aucun éditeur oublié)", () => {
    const files = readdirSync(APP).filter((f) => f.endsWith(".css"));
    const offenders: string[] = [];
    for (const file of files) {
      const lines = css(file).split("\n");
      lines.forEach((line, index) => {
        // Une hauteur FIXE (pas un max-height de tiroir) qui prend l'écran entier sous l'en-tête.
        if (!/^\s*height:\s*calc\(100dvh - var\(--header-h\)/.test(line))
          return;
        if (!line.includes("var(--mini-reserve)"))
          offenders.push(`${file}:${index + 1}  ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("les trois éditeurs du téléphone et la vue bureau en font partie", () => {
    expect(css("export-editor.css")).toMatch(
      /\.xe-plateau\s*\{[^}]*height:\s*calc\(100dvh - var\(--header-h\) - var\(--mini-reserve\)\)/,
    );
    expect(css("export-steps.css")).toMatch(
      /\.xp-root\s*\{[^}]*height:\s*calc\(100dvh - var\(--header-h\) - var\(--mini-reserve\)\)/,
    );
    expect(css("export-editor.css")).toMatch(
      /\.xe-desk\s*\{[^}]*height:\s*calc\(100dvh - var\(--header-h\) - var\(--sp-4\) - var\(--mini-reserve\)\)/,
    );
  });
});
