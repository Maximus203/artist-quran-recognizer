import { describe, expect, it } from "vitest";
import { ImportError } from "./import-session";
import type { PythonRun, PythonRunner } from "./python";
import { describeVerdict, refusalOf, verifyResultFile } from "./result-check";

const run =
  (result: Partial<PythonRun>): PythonRunner =>
  async () => ({ code: 0, stdout: "", stderr: "", ...result });
const report = (over: object) =>
  JSON.stringify({
    status: "ok",
    checked: 2,
    findings: [],
    findings_total: 0,
    unverifiable: [],
    unverifiable_total: 0,
    ...over,
  });
const finding = (over: object = {}) => ({
  index: 0,
  ref: "112:1",
  field: "text",
  message: "Le texte arabe ne correspond pas au Mushaf.",
  ...over,
});

describe("verifyResultFile — traduit la sortie du moteur", () => {
  it("lance verify-recognition sur le fichier, avec le corpus configuré", async () => {
    let seen: string[] = [];
    await verifyResultFile("/tmp/r.json", async (args) => {
      seen = args;
      return { code: 0, stdout: report({}), stderr: "" };
    });
    expect(seen[0]).toBe("verify-recognition");
    expect(seen[1]).toBe("/tmp/r.json");
    expect(seen).toContain("--corpus-dir");
  });
  it("code 0 : fidèle au corpus", async () => {
    expect(await verifyResultFile("f", run({ stdout: report({}) }))).toEqual({
      status: "ok",
    });
  });
  it("code 1 avec un rapport : le résultat contredit le corpus", async () => {
    const verdict = await verifyResultFile(
      "f",
      run({
        code: 1,
        stdout: report({
          status: "invalid",
          findings: [finding()],
          findings_total: 1,
        }),
      }),
    );
    expect(verdict).toEqual({
      status: "invalid",
      findings: [finding()],
      total: 1,
    });
  });
  it("code 4 : traduction invérifiable", async () => {
    const verdict = await verifyResultFile(
      "f",
      run({
        code: 4,
        stdout: report({
          status: "unverifiable",
          unverifiable: [finding({ field: "translation", message: "x" })],
          unverifiable_total: 1,
        }),
      }),
    );
    expect(verdict.status).toBe("unverifiable");
  });
  it("moteur absent, corpus manquant ou sortie illisible : indisponible, jamais accepté", async () => {
    for (const bad of [
      { code: null, stderr: "spawn python ENOENT" },
      { code: 1, stderr: "ERREUR LOCK.json introuvable" },
      { code: 0, stdout: "pas du json" },
      { code: 2, stdout: "" },
      { code: 0, stdout: report({ status: "n_importe_quoi" }) },
    ]) {
      const verdict = await verifyResultFile("f", run(bad));
      expect(verdict.status).toBe("unavailable");
    }
  });
  it("un rapport « ok » dont le code de sortie n'est pas 0 n'est pas accepté", async () => {
    const verdict = await verifyResultFile(
      "f",
      run({ code: 1, stdout: report({}) }),
    );
    expect(verdict.status).toBe("unavailable");
  });
});

describe("refusalOf — le refus montré à la personne", () => {
  it("ok : aucun refus", () => {
    expect(refusalOf({ status: "ok" })).toBeNull();
  });
  it("invalid : 422, en français, avec le rang et le verset, sans recopier le contenu", () => {
    const error = refusalOf({
      status: "invalid",
      findings: [
        finding(),
        finding({ index: 3, ref: "2:255", field: "words" }),
      ],
      total: 2,
    }) as ImportError;
    expect(error).toBeInstanceOf(ImportError);
    expect(error.status).toBe(422);
    expect(error.code).toBe("result_contradicts_corpus");
    expect(error.message).toMatch(/contredit le corpus/);
    expect(error.message).toMatch(/intervalle 1 \(112:1\)/);
    expect(error.message).toMatch(/intervalle 4 \(2:255\)/);
    expect(error.message).toMatch(/Rien n'a été importé/);
    expect(error.message).not.toMatch(/\.\./); // pas de point doublé
  });
  it("invalid : au plus trois écarts détaillés, le reste est compté", () => {
    const many = Array.from({ length: 5 }, (_, i) => finding({ index: i }));
    const error = refusalOf({
      status: "invalid",
      findings: many,
      total: 120,
    }) as ImportError;
    expect(error.message.match(/intervalle \d+/g)).toHaveLength(3);
    expect(error.message).toMatch(/117 autres écarts/);
  });
  it("invalid : une référence qui ne ressemble pas à sourate:verset n'est pas recopiée", () => {
    const error = refusalOf({
      status: "invalid",
      findings: [finding({ ref: "<script>alert(1)</script>" })],
      total: 1,
    }) as ImportError;
    expect(error.message).not.toMatch(/script/);
  });
  it("unverifiable : 503, on peut réessayer ou envoyer sans traduction", () => {
    const error = refusalOf({
      status: "unverifiable",
      findings: [finding({ field: "translation" })],
      total: 1,
    }) as ImportError;
    expect(error.status).toBe(503);
    expect(error.code).toBe("result_unverifiable");
    expect(error.message).toMatch(/QuranEnc/);
    expect(error.message).toMatch(/sans traduction/);
  });
  it.each([
    ["offline", /QuranEnc n'est pas joignable/],
    ["local_copy", /copie locale.*illisible/],
    ["no_source", /aucune source de traduction/],
  ])(
    "unverifiable (%s) : le message nomme la vraie cause (scénario QA N7)",
    (cause, expected) => {
      const error = refusalOf({
        status: "unverifiable",
        findings: [finding({ field: "translation", cause })],
        total: 1,
      }) as ImportError;
      expect(error.status).toBe(503);
      expect(error.code).toBe("result_unverifiable");
      expect(error.message).toMatch(expected);
      expect(error.message).toMatch(/Rien n'a été importé/);
      expect(error.message).toMatch(/sans traduction/);
    },
  );
  it("unverifiable : une cause d'un autre moteur ne devient jamais un mensonge, texte générique", () => {
    const error = refusalOf({
      status: "unverifiable",
      findings: [finding({ field: "translation", cause: "inconnue" })],
      total: 1,
    }) as ImportError;
    expect(error.message).toMatch(/n'a pas pu être vérifiée/);
    expect(error.message).not.toMatch(/QuranEnc n'est pas joignable/);
  });
  it("unavailable : 503, le contrôle n'a pas pu avoir lieu", () => {
    const error = refusalOf({
      status: "unavailable",
      reason: "corpus",
    }) as ImportError;
    expect(error.status).toBe(503);
    expect(error.code).toBe("result_check_unavailable");
    expect(error.message).toMatch(/Rien n'a été importé/);
  });
});

describe("describeVerdict — ce que le journal garde d'un refus (N10)", () => {
  it("ok : rien d'autre que l'issue", () => {
    expect(describeVerdict({ status: "ok" })).toEqual({ verdict: "ok" });
  });
  it("invalid : rang (à partir de 1), verset, champ du premier écart, champs distincts, total", () => {
    expect(
      describeVerdict({
        status: "invalid",
        findings: [
          finding({ index: 2, ref: "112:1", field: "text" }),
          finding({ index: 4, ref: "2:255", field: "words" }),
          finding({ index: 5, ref: "2:256", field: "text" }),
        ],
        total: 9,
      }),
    ).toEqual({
      verdict: "invalid",
      total: 9,
      rank: 3,
      ref: "112:1",
      field: "text",
      fields: "text,words",
    });
  });
  it("un écart du document entier n'a ni rang ni verset", () => {
    expect(
      describeVerdict({
        status: "invalid",
        findings: [
          finding({ index: null, ref: null, field: "riwaya.assumed" }),
        ],
        total: 1,
      }),
    ).toMatchObject({ rank: null, ref: null, field: "riwaya.assumed" });
  });
  it("jamais le message, jamais une référence qui n'a pas la forme sourate:verset", () => {
    const fields = describeVerdict({
      status: "invalid",
      findings: [
        finding({
          ref: "قل هو الله أحد",
          message: "نص مزيف لا يوجد في القرآن",
          field: "قل",
        }),
      ],
      total: 1,
    });
    expect(JSON.stringify(fields)).not.toMatch(/[؀-ۿ]/);
    expect(fields.ref).toBeNull();
    expect(fields.field).toBe("autre");
  });
  it("unverifiable : la cause du premier écart", () => {
    expect(
      describeVerdict({
        status: "unverifiable",
        findings: [finding({ field: "translation", cause: "offline" })],
        total: 4,
      }),
    ).toMatchObject({
      verdict: "unverifiable",
      total: 4,
      cause: "offline",
      rank: 1,
    });
  });
  it("unavailable : la raison du moteur, une ligne, bornée à 200 signes", () => {
    const fields = describeVerdict({
      status: "unavailable",
      reason: `ERREUR ${"x".repeat(500)}\nautre ligne`,
    });
    expect(fields.verdict).toBe("unavailable");
    expect(String(fields.reason).length).toBeLessThanOrEqual(200);
    expect(String(fields.reason)).not.toMatch(/\n/);
  });
});
