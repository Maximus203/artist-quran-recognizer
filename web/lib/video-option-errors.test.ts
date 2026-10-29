import { describe, expect, it } from "vitest";
import { videoJobOptionsSchema } from "./video-job-options";
import { optionIssuesFr } from "./video-option-errors";

const explain = (value: unknown) => {
  const r = videoJobOptionsSchema.safeParse(value);
  if (r.success) throw new Error("devait échouer");
  return optionIssuesFr(r.error.issues);
};

describe("erreurs d'options d'export vidéo, en français clair", () => {
  it("bornes : « au moins » / « au plus », jamais « Too small / Too big »", () => {
    const text = explain({ lead_in: 9, ranges: [{ start: -1, end: 5 }] });
    expect(text).toMatch(/lead_in : 5 au plus/);
    expect(text).toMatch(/ranges\[0\]\.start : 0 au moins/);
    expect(text).not.toMatch(/Too (small|big)/);
  });
  it("clé inconnue : nommée, avec ce qui est accepté", () => {
    expect(explain({ per_vers: true })).toMatch(/option inconnue « per_vers »/);
  });
  it("règle d'exclusion : le message métier tel quel", () => {
    expect(
      explain({ per_verse: true, ranges: [{ start: 0, end: 5 }] }),
    ).toMatch(/s'excluent/);
  });
  it("nom de plage vide ou trop long", () => {
    expect(explain({ ranges: [{ start: 0, end: 5, name: "" }] })).toMatch(
      /name : 1 caractère au moins/,
    );
  });
  it("mauvais type", () => {
    expect(explain({ fill: "oui" })).toMatch(
      /fill : oui ou non attendu|fill : booléen attendu/,
    );
  });
});
