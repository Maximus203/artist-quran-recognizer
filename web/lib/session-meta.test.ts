import { describe, expect, it } from "vitest";
import {
  elapsedSeconds,
  engineFromLabel,
  isUnread,
  realDurationSeconds,
  sessionEngine,
} from "./session-meta";

describe("isUnread — un résultat que l'utilisateur n'a pas encore ouvert", () => {
  it("terminé (done ou failed) et jamais ouvert : non lu", () => {
    expect(isUnread({ state: "done", viewed_at: null })).toBe(true);
    expect(isUnread({ state: "failed", viewed_at: null })).toBe(true);
  });
  it("ouvert : lu", () => {
    expect(
      isUnread({ state: "done", viewed_at: "2026-10-22T10:00:00.000Z" }),
    ).toBe(false);
  });
  it("migration : une session d'avant le suivi (champ absent) est considérée lue", () => {
    expect(isUnread({ state: "done" })).toBe(false);
    expect(isUnread({ state: "failed", viewed_at: undefined })).toBe(false);
  });
  it("une session qui n'est pas terminée n'a rien à lire", () => {
    for (const state of ["ready", "queued", "running", "cancelled"] as const)
      expect(isUnread({ state, viewed_at: null })).toBe(false);
  });
});

describe("engineFromLabel — nom court du moteur d'après la sortie du moteur", () => {
  it("reconnaît les quatre moteurs, versions comprises", () => {
    expect(engineFromLabel("fastconformer-quran@b33af7936f9a")).toBe(
      "fastconformer",
    );
    expect(engineFromLabel("whisper-base-quran@5c3c53fdf92")).toBe("whisper");
    expect(engineFromLabel("muno-fastconformer-quran-streaming@ab12")).toBe(
      "muno-streaming",
    );
    expect(
      engineFromLabel("cascade(fastconformer-quran@b3+whisper-base-quran@5c)"),
    ).toBe("cascade");
  });
  it("renvoie null pour un moteur inconnu, jamais un repli silencieux", () => {
    expect(engineFromLabel("autre-moteur@1")).toBeNull();
    expect(engineFromLabel("")).toBeNull();
  });
});

describe("sessionEngine", () => {
  it("préfère le champ engine, puis asr, puis la sortie du moteur", () => {
    expect(sessionEngine({ engine: "cascade", asr: "whisper" }, "x")).toBe(
      "cascade",
    );
    expect(sessionEngine({ asr: "whisper" }, "fastconformer@1")).toBe(
      "whisper",
    );
    expect(sessionEngine({}, "fastconformer@1")).toBe("fastconformer");
    expect(sessionEngine({}, undefined)).toBeNull();
  });
});

describe("durées", () => {
  it("realDurationSeconds : écart entre départ et fin, null si l'un manque ou si c'est incohérent", () => {
    expect(
      realDurationSeconds(
        "2026-10-22T10:00:00.000Z",
        "2026-10-22T10:01:30.500Z",
      ),
    ).toBe(90.5);
    expect(realDurationSeconds(null, "2026-10-22T10:01:30.500Z")).toBeNull();
    expect(realDurationSeconds("2026-10-22T10:00:00.000Z", null)).toBeNull();
    expect(realDurationSeconds("nawak", "2026-10-22T10:00:00.000Z")).toBeNull();
    expect(
      realDurationSeconds(
        "2026-10-22T10:05:00.000Z",
        "2026-10-22T10:00:00.000Z",
      ),
    ).toBeNull();
  });
  it("elapsedSeconds : jamais négatif (horloge reculée), null sans date valide", () => {
    const now = Date.parse("2026-10-22T10:00:10.000Z");
    expect(elapsedSeconds("2026-10-22T10:00:00.000Z", now)).toBe(10);
    expect(elapsedSeconds("2026-10-22T10:00:30.000Z", now)).toBe(0);
    expect(elapsedSeconds(null, now)).toBeNull();
    expect(elapsedSeconds("zzz", now)).toBeNull();
  });
});
