import { describe, expect, it } from "vitest";
import { ImportError } from "./import-error";
import { MAX_JSON_DEPTH, preparePrediction } from "./prediction-bytes";

const utf8 = (text: string) => Buffer.from(text, "utf8");
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const nested = (levels: number) => "[".repeat(levels) + "]".repeat(levels);

function refusal(bytes: Buffer): ImportError {
  try {
    preparePrediction(bytes);
  } catch (error) {
    return error as ImportError;
  }
  throw new Error("aucun refus");
}

describe("preparePrediction — le fichier joint avant d'être lu", () => {
  it("un JSON ordinaire est rendu tel quel, à l'octet près", () => {
    const bytes = utf8('{"schema":"aqr.recognition/1","intervals":[]}');
    expect(preparePrediction(bytes).equals(bytes)).toBe(true);
  });

  it("le BOM UTF-8 d'un outil Windows est retiré : c'est le seul octet changé", () => {
    const json = utf8('{"a":[1,2]}');
    const prepared = preparePrediction(Buffer.concat([BOM, json]));
    expect(prepared.equals(json)).toBe(true);
    expect(() => JSON.parse(prepared.toString("utf8"))).not.toThrow();
  });

  it("un BOM au milieu du fichier n'est pas retiré (ce n'est plus un BOM)", () => {
    const bytes = Buffer.concat([utf8('{"a":"'), BOM, utf8('"}')]);
    expect(preparePrediction(bytes).equals(bytes)).toBe(true);
  });

  it.each([
    ["UTF-16 petit-boutiste", Buffer.from([0xff, 0xfe, 0x7b, 0x00])],
    ["UTF-16 gros-boutiste", Buffer.from([0xfe, 0xff, 0x00, 0x7b])],
  ])("%s : refus clair en 400, il faut enregistrer en UTF-8", (_nom, bytes) => {
    const error = refusal(bytes);
    expect(error).toBeInstanceOf(ImportError);
    expect(error.status).toBe(400);
    expect(error.code).toBe("result_encoding");
    expect(error.message).toMatch(/UTF-16/);
    expect(error.message).toMatch(/UTF-8/);
  });

  it(`${MAX_JSON_DEPTH} niveaux d'imbrication passent, un de plus est un 422 explicite`, () => {
    expect(() => preparePrediction(utf8(nested(MAX_JSON_DEPTH)))).not.toThrow();
    const error = refusal(utf8(nested(MAX_JSON_DEPTH + 1)));
    expect(error.status).toBe(422);
    expect(error.code).toBe("result_too_deep");
    expect(error.message).toMatch(/imbriqué/);
    expect(error.message).not.toMatch(/indisponible|introuvable/);
  });

  it("20 000 niveaux (scénario QA N7) : refusé sans jamais lancer le moteur", () => {
    const error = refusal(utf8(`{"x":${nested(20000)}}`));
    expect(error.status).toBe(422);
    expect(error.code).toBe("result_too_deep");
  });

  it("les crochets dans les textes ne comptent pas, ni les guillemets échappés", () => {
    const text = `{"w":"${"[".repeat(500)}","v":"a\\"${"{".repeat(500)}\\\\","k":[[1]]}`;
    expect(() => preparePrediction(utf8(text))).not.toThrow();
  });

  it("un vrai résultat a une dizaine de niveaux au plus", () => {
    const real = {
      intervals: [
        {
          translation: {
            segments: [{ words: [1, 2], text: "x" }],
            fragment: { words: [1, 2] },
          },
          word_times: [[0, 1]],
        },
      ],
      acoustic_checks: [{ spans: [{ a: [1] }] }],
    };
    expect(() => preparePrediction(utf8(JSON.stringify(real)))).not.toThrow();
  });
});
