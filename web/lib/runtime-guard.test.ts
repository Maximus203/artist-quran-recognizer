import { describe, expect, it } from "vitest";
import {
  enforceRuntime,
  guardStartup,
  nodeVersionStatus,
} from "./runtime-guard";

describe("version de Node (CVE-2026-111497, décodeur Brotli)", () => {
  it.each([
    ["24.22.1", true],
    ["24.22.2", true],
    ["v24.23.0", true],
    ["22.23.4", true],
    ["26.12.1", true],
    ["26.13.0", true],
    ["27.0.0", true],
  ])("%s est corrigée", (version, ok) => {
    expect(nodeVersionStatus(version).ok).toBe(ok);
  });

  it.each([
    "24.19.0",
    "24.22.0",
    "22.23.3",
    "22.20.0",
    "26.12.0",
    "25.4.0", // ligne impaire, fin de vie
    "23.9.0",
    "20.20.0", // fin de vie, aucun correctif officiel
    "18.20.4",
    "n'importe quoi",
    "",
  ])("%s est refusée", (version) => {
    const status = nodeVersionStatus(version);
    expect(status.ok).toBe(false);
    expect(status.message).toMatch(/Node/);
  });

  it("le message dit la version trouvée et la version attendue, en clair", () => {
    expect(nodeVersionStatus("24.19.0").message).toBe(
      "Node 24.19.0 contient la faille CVE-2026-111497 (décodeur Brotli) : passer à Node 24.22.1 ou plus.",
    );
    expect(nodeVersionStatus("20.20.0").message).toMatch(/fin de vie/);
  });
});

describe("démarrage du serveur", () => {
  it("en production, une version non corrigée empêche de démarrer", () => {
    expect(() => enforceRuntime("production", "24.19.0")).toThrow(
      /CVE-2026-111497/,
    );
  });
  it("en production, une version corrigée démarre", () => {
    expect(() => enforceRuntime("production", "24.22.2")).not.toThrow();
  });
  it("en développement, on prévient sans bloquer", () => {
    const warnings: string[] = [];
    expect(() =>
      enforceRuntime("development", "24.19.0", (m) => warnings.push(m)),
    ).not.toThrow();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/CVE-2026-111497/);
  });
});

describe("garde au démarrage", () => {
  const sink = () => {
    const out = {
      warn: [] as string[],
      error: [] as string[],
      exits: [] as number[],
    };
    return {
      out,
      report: {
        warn: (m: string) => out.warn.push(m),
        error: (m: string) => out.error.push(m),
      },
      exit: (code: number) => out.exits.push(code),
    };
  };
  it("production sur une version touchée : journalise puis sort avec le code 1", () => {
    const s = sink();
    guardStartup(s.report, {
      nodeEnv: "production",
      version: "24.19.0",
      exit: s.exit,
    });
    expect(s.out.exits).toEqual([1]);
    expect(s.out.error).toEqual(["démarrage refusé"]);
  });
  it("production sur une version corrigée, ou développement : on continue", () => {
    const s = sink();
    guardStartup(s.report, {
      nodeEnv: "production",
      version: "24.22.2",
      exit: s.exit,
    });
    guardStartup(s.report, {
      nodeEnv: "development",
      version: "24.19.0",
      exit: s.exit,
    });
    expect(s.out.exits).toEqual([]);
    expect(s.out.warn).toHaveLength(1);
  });
});
