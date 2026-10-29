import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LogFiles } from "./log-files";
import {
  exitCode,
  render,
  signature,
  summarize,
  verifyChain as verifyInScript,
} from "../scripts/log-report.mjs";

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "aqr-report-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function write(
  day: string,
  level: "warn" | "error",
  scope: string,
  msg: string,
  times = 1,
) {
  const logs = new LogFiles({
    dir,
    now: () => new Date(`${day}T10:00:00.000Z`),
  });
  for (let i = 0; i < times; i++) logs.write("app", { level, scope, msg });
}

describe("rapport des journaux", () => {
  it("regroupe la même erreur malgré les identifiants et les nombres", () => {
    expect(
      signature({
        scope: "store",
        msg: "session 0f0e0d0c-0b0a-4908-8706-050403020100 illisible (code 12)",
      }),
    ).toBe("store · session <id> illisible (code #)");
  });

  it("une erreur qui revient depuis des jours est récurrente (sortie 2)", () => {
    for (const day of ["2026-10-24", "2026-10-26", "2026-10-29"])
      write(day, "error", "backup", "restic a échoué (code 1)", 2);
    write("2026-10-29", "warn", "preferences", "valeur invalide ignorée");
    const result = summarize(dir);
    expect(result.recurring).toHaveLength(1);
    expect(result.recurring[0]).toMatchObject({
      level: "error",
      count: 6,
      days: 3,
    });
    expect(exitCode(result)).toBe(2);
    expect(render(result)).toMatch(
      /\[error\] 6× sur 3 jour\(s\).*backup · restic a échoué/,
    );
  });

  it("un incident d'un seul jour, même répété, n'est pas récurrent", () => {
    write("2026-10-29", "error", "api", "GET /x a échoué", 50);
    const result = summarize(dir);
    expect(result.recurring).toEqual([]);
    expect(exitCode(result)).toBe(0);
  });

  it("des avertissements récurrents : sortie 1", () => {
    for (const day of ["2026-10-20", "2026-10-25", "2026-10-29"])
      write(day, "warn", "docs", "entrée d'index ignorée", 2);
    expect(exitCode(summarize(dir))).toBe(1);
  });

  it("lit aussi le journal du service du direct (Python) : une erreur récurrente y est signalée", async () => {
    for (const day of ["2026-10-24", "2026-10-27", "2026-10-29"]) {
      const row = JSON.stringify({
        ts: `${day}T10:00:00.000Z`,
        level: "error",
        scope: "live",
        msg: "engine.failed",
      });
      await writeFile(
        path.join(dir, `live-${day}.log`),
        `${row}
${row}
`,
      );
    }
    const result = summarize(dir);
    expect(result.recurring).toHaveLength(1);
    expect(result.recurring[0].signature).toBe("live · engine.failed");
    expect(exitCode(result)).toBe(2);
  });

  it("dossier absent : le dit, sans planter", () => {
    expect(render(summarize(path.join(dir, "absent")))).toMatch(
      /Aucun dossier/,
    );
  });

  it("vérifie la chaîne écrite par l'application et voit une falsification", async () => {
    const logs = new LogFiles({
      dir,
      now: () => new Date("2026-10-29T10:00:00.000Z"),
    });
    for (const msg of ["a", "b", "c"])
      logs.write("security", { level: "info", scope: "audit", msg });
    expect(summarize(dir).chain).toEqual([
      { file: "security-2026-10-29.log", ok: true, lines: 3 },
    ]);
    const file = path.join(dir, "security-2026-10-29.log");
    const text = await readFile(file, "utf8");
    expect(verifyInScript(text)).toEqual({ ok: true, lines: 3 });
    await writeFile(file, text.replace('"msg":"b"', '"msg":"X"'));
    const result = summarize(dir);
    expect(result.chain[0]).toMatchObject({ ok: false, badLine: 2 });
    expect(exitCode(result)).toBe(2);
    expect(render(result)).toMatch(/ROMPUE.*ligne 2/);
  });
});
