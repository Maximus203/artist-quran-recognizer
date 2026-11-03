import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { describeProblems, securityConfigProblems } from "./config-guard";
import { guardStartup } from "./runtime-guard";

const secret = (seed: string) => seed.repeat(40).slice(0, 40);

const PUBLIC = {
  AQR_ACCESS_TOKEN: secret("a1"),
  AQR_PUBLIC_ORIGIN: "https://atelier.exemple.org",
  AQR_TRUST_PROXY: "1",
  AQR_SIGNUP: "closed",
  AQR_AUDIT_SALT: secret("b2"),
  AQR_FORM_KEY: secret("c3"),
};
const names = (env: Record<string, string | undefined>) =>
  securityConfigProblems(env).map((p) => p.variable);

describe("configuration de sécurité exigée en production", () => {
  it("accès public complet : aucun écart", () => {
    expect(securityConfigProblems(PUBLIC)).toEqual([]);
  });

  it("poste local déclaré : accepté sans jeton ni clés", () => {
    expect(securityConfigProblems({ AQR_LOCAL_ONLY: "1" })).toEqual([]);
  });

  it("aucun mode d'accès déclaré : refusé", () => {
    expect(names({})).toEqual(["AQR_ACCESS_TOKEN"]);
  });

  it("local et public déclarés ensemble : refusé", () => {
    expect(names({ ...PUBLIC, AQR_LOCAL_ONLY: "1" })).toContain(
      "AQR_LOCAL_ONLY",
    );
  });

  it.each(["AQR_ACCESS_TOKEN", "AQR_AUDIT_SALT", "AQR_FORM_KEY"])(
    "%s absente en accès public : refusée",
    (variable) => {
      const env: Record<string, string | undefined> = { ...PUBLIC };
      delete env[variable];
      expect(names(env)).toContain(variable);
    },
  );

  it.each(["AQR_ACCESS_TOKEN", "AQR_AUDIT_SALT", "AQR_FORM_KEY"])(
    "%s courte ou prévisible : refusée",
    (variable) => {
      for (const weak of ["court", "aqr-audit", "password", "x".repeat(31)])
        expect(names({ ...PUBLIC, [variable]: weak })).toContain(variable);
    },
  );

  it.each([
    ["absente", undefined],
    ["en http", "http://atelier.exemple.org"],
    ["avec un chemin", "https://atelier.exemple.org/app"],
    ["avec identifiants", "https://u:p@atelier.exemple.org"],
    ["illisible", "pas une adresse"],
  ])("origine publique %s : refusée", (_label, origin) => {
    expect(names({ ...PUBLIC, AQR_PUBLIC_ORIGIN: origin })).toContain(
      "AQR_PUBLIC_ORIGIN",
    );
  });

  it("proxy de confiance non déclaré, ou valeur ambiguë : refusé", () => {
    expect(names({ ...PUBLIC, AQR_TRUST_PROXY: undefined })).toContain(
      "AQR_TRUST_PROXY",
    );
    expect(names({ ...PUBLIC, AQR_TRUST_PROXY: "oui" })).toContain(
      "AQR_TRUST_PROXY",
    );
    expect(names({ ...PUBLIC, AQR_TRUST_PROXY: "0" })).toEqual([]);
  });

  it("inscriptions : mode explicite, et code obligatoire en mode code", () => {
    expect(names({ ...PUBLIC, AQR_SIGNUP: undefined })).toContain("AQR_SIGNUP");
    expect(names({ ...PUBLIC, AQR_SIGNUP: "ouvert-a-tous" })).toContain(
      "AQR_SIGNUP",
    );
    expect(names({ ...PUBLIC, AQR_SIGNUP: "code" })).toContain(
      "AQR_SIGNUP_CODE",
    );
    expect(
      names({ ...PUBLIC, AQR_SIGNUP: "code", AQR_SIGNUP_CODE: "abc" }),
    ).toEqual([]);
  });

  it("direct branché : sa clé de signature doit venir de l'environnement", () => {
    const live = { ...PUBLIC, AQR_LIVE_URL: "wss://direct.exemple.org" };
    expect(names(live)).toContain("AQR_LIVE_KEY");
    expect(names({ ...live, AQR_LIVE_KEY: secret("d4") })).toEqual([]);
    expect(names(PUBLIC)).not.toContain("AQR_LIVE_KEY");
  });

  it("le message nomme les variables mais ne contient jamais une valeur secrète", () => {
    const env = {
      ...PUBLIC,
      AQR_ACCESS_TOKEN: "motdepasse-trop-court",
      AQR_PUBLIC_ORIGIN: "http://x",
    };
    const text = describeProblems(securityConfigProblems(env));
    expect(text).toMatch(/AQR_ACCESS_TOKEN/);
    expect(text).not.toContain("motdepasse-trop-court");
    expect(text).not.toContain(PUBLIC.AQR_AUDIT_SALT);
  });
});

describe("le démarrage en production applique ces exigences", () => {
  const run = (nodeEnv: string, env: Record<string, string | undefined>) => {
    const out = {
      exits: [] as number[],
      warn: [] as string[],
      error: [] as string[],
    };
    guardStartup(
      {
        warn: (m) => out.warn.push(m),
        error: (m) => out.error.push(m),
      },
      {
        nodeEnv,
        version: "24.22.2",
        env,
        exit: (code) => out.exits.push(code),
      },
    );
    return out;
  };

  it("production sans configuration : sortie avec le code 1", () => {
    expect(run("production", {}).exits).toEqual([1]);
  });
  it("production complète, publique ou locale : on continue", () => {
    expect(run("production", PUBLIC).exits).toEqual([]);
    expect(run("production", { AQR_LOCAL_ONLY: "1" }).exits).toEqual([]);
  });
  it("développement incomplet : avertissement seulement", () => {
    const out = run("development", {});
    expect(out.exits).toEqual([]);
    expect(out.warn.join(" ")).toMatch(/AQR_ACCESS_TOKEN/);
  });
});

describe("aucune route de test ou de développement n'est exposée", () => {
  const appDir = join(__dirname, "..", "app");
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? [join(dir, entry.name), ...walk(join(dir, entry.name))]
        : [],
    );
  const FORBIDDEN =
    /^(test|tests|debug|dev|devtools|sandbox|playground|storybook|e2e|mock|mocks|seed|__.*)$/i;

  it("aucun dossier de route ne porte un nom de test, de débogage ou de bac à sable", () => {
    const found = walk(appDir)
      .filter((dir) => FORBIDDEN.test(dir.split(/[\/]/).pop() ?? ""))
      .map((dir) => relative(appDir, dir));
    expect(found).toEqual([]);
  });

  it("le contrôle voit bien un dossier fautif (garde-fou)", () => {
    expect(FORBIDDEN.test("debug")).toBe(true);
    expect(FORBIDDEN.test("__test__")).toBe(true);
    expect(FORBIDDEN.test("sessions")).toBe(false);
  });
});
