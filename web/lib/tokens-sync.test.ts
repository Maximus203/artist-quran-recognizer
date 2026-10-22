import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Les valeurs visuelles ont UNE source : docs/design/tokens.css. La copie utilisée par l'application
 * (web/app/tokens.css) doit lui rester identique, sinon la maquette validée et l'écran divergent.
 */
describe("tokens.css", () => {
  const read = (relative: string) =>
    readFileSync(path.join(process.cwd(), relative), "utf8").replace(
      /\r\n/g,
      "\n",
    );
  it("la copie de l'application est identique au design validé", () => {
    expect(read("app/tokens.css")).toBe(read("../docs/design/tokens.css"));
  });
  it("aucune feuille de l'application ne ré-introduit les anciennes couleurs vertes", () => {
    for (const file of [
      "base",
      "shell",
      "sessions",
      "console",
      "passage",
      "review",
      "perf",
    ]) {
      const css = read(`app/${file}.css`);
      expect(css).not.toMatch(/--mint|--gold|--red\b/);
      expect(css).not.toMatch(/Manrope|DM Sans/);
      expect(css).not.toMatch(/(linear|radial)-gradient\([^)]*#[0-9a-f]{3,6}/i);
    }
  });
});
