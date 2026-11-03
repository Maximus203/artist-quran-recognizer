import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  path.join(__dirname, "..", "app", "shell.css"),
  "utf8",
);
const rule = (selector: string): string => {
  const match = new RegExp(
    `(?:^|\n)${selector.replace(".", "\.")} \{([^}]*)\}`,
  ).exec(css);
  if (!match) throw new Error(`règle ${selector} introuvable`);
  return match[1];
};

describe("cadre de l'application : un seul défilement", () => {
  it("la zone centrale est le bloc contenant de ses éléments absolus", () => {
    // Sans « position: relative », un champ masqué (.sr, position: absolute) dans la zone qui défile s'accroche
    // au document, échappe à son défilement et allonge la page : deuxième barre de défilement et fond qui s'arrête.
    const center = rule(".center");
    expect(center).toMatch(/overflow-y:\s*auto/);
    expect(center).toMatch(/position:\s*relative/);
  });

  it("le panneau latéral reste un bloc contenant lui aussi", () => {
    expect(rule(".panel")).toMatch(/position:\s*relative/);
  });
});
