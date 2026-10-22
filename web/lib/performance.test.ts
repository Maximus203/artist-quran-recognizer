import { describe, expect, it } from "vitest";
import {
  buildPerformance,
  median,
  splitDuration,
  type PerfSession,
} from "./performance";

const NOW = Date.parse("2026-10-22T12:00:00Z");
const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

let counter = 0;
const done = (over: Partial<PerfSession> = {}): PerfSession => ({
  id: `s-${++counter}`,
  name: "essai.mp3",
  extension: ".mp3",
  state: "done",
  engine: "cascade",
  audio_duration_s: 600,
  duration_s: 100,
  finished_at: day(1),
  ...over,
});

describe("median", () => {
  it("prend la valeur centrale ou la moyenne des deux centrales", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
  it("renvoie null pour une liste vide", () => {
    expect(median([])).toBeNull();
  });
});

describe("splitDuration", () => {
  it("découpe pour les grands chiffres en police display", () => {
    expect(splitDuration(242)).toEqual([
      { n: "4", u: "min" },
      { n: "02", u: "s" },
    ]);
    expect(splitDuration(3720)).toEqual([
      { n: "1", u: "h" },
      { n: "02", u: "" },
    ]);
    expect(splitDuration(45)).toEqual([{ n: "45", u: "s" }]);
  });
});

describe("buildPerformance", () => {
  it("compte durée moyenne, facteur médian et audio traité", () => {
    const model = buildPerformance(
      [
        done({ audio_duration_s: 600, duration_s: 100 }), // ×6
        done({ audio_duration_s: 1200, duration_s: 100 }), // ×12
        done({ audio_duration_s: 800, duration_s: 200 }), // ×4
      ],
      "all",
      NOW,
    );
    expect(model.analyses).toBe(3);
    expect(model.meanDurationS).toBeCloseTo(133.33, 1);
    expect(model.medianFactor).toBe(6);
    expect(model.audioTotalS).toBe(2600);
  });

  it("sépare l'audio de la vidéo", () => {
    const model = buildPerformance(
      [
        done({ audio_duration_s: 600 }),
        done({ audio_duration_s: 1800, extension: ".mp4" }),
      ],
      "all",
      NOW,
    );
    expect(model.videoAudioS).toBe(1800);
    expect(model.audioTotalS).toBe(2400);
  });

  it("ne compte que les analyses réussies, avec des durées exploitables", () => {
    const model = buildPerformance(
      [
        done(),
        done({ state: "failed" }),
        done({ state: "cancelled" }),
        done({ duration_s: null }),
        done({ audio_duration_s: null }),
        done({ state: "running", duration_s: null }),
      ],
      "all",
      NOW,
    );
    expect(model.analyses).toBe(1);
  });

  it("filtre par période sur la date de fin", () => {
    const sessions = [
      done({ finished_at: day(2) }),
      done({ finished_at: day(20) }),
      done({ finished_at: day(90) }),
    ];
    expect(buildPerformance(sessions, "7d", NOW).analyses).toBe(1);
    expect(buildPerformance(sessions, "30d", NOW).analyses).toBe(2);
    expect(buildPerformance(sessions, "all", NOW).analyses).toBe(3);
  });

  it("regroupe par moteur, du plus rapide au plus lent, avec des barres relatives", () => {
    const model = buildPerformance(
      [
        done({
          engine: "fastconformer",
          audio_duration_s: 1000,
          duration_s: 50,
        }), // ×20
        done({ engine: "cascade", audio_duration_s: 600, duration_s: 100 }), // ×6
        done({ engine: "cascade", audio_duration_s: 600, duration_s: 100 }),
        done({ engine: "whisper", audio_duration_s: 400, duration_s: 100 }), // ×4
      ],
      "all",
      NOW,
    );
    expect(model.engines.map((e) => e.engine)).toEqual([
      "fastconformer",
      "cascade",
      "whisper",
    ]);
    expect(model.engines[0]).toMatchObject({
      label: "FastConformer",
      count: 1,
      medianFactor: 20,
      ratio: 1,
    });
    expect(model.engines[1]).toMatchObject({ count: 2, medianFactor: 6 });
    expect(model.engines[1].ratio).toBeCloseTo(0.3, 5);
  });

  it("donne les 10 dernières analyses, la plus récente d'abord", () => {
    const sessions = Array.from({ length: 12 }, (_, i) =>
      done({ finished_at: day(12 - i), name: `s${i}.mp3` }),
    );
    const model = buildPerformance(sessions, "all", NOW);
    expect(model.recent).toHaveLength(10);
    expect(model.recent[0].name).toBe("s11.mp3");
    expect(model.recent[0].factor).toBe(6);
  });

  it("estime la durée d'une heure d'audio", () => {
    const model = buildPerformance(
      [done({ audio_duration_s: 600, duration_s: 100 })],
      "all",
      NOW,
    );
    expect(model.hourOfAudioS).toBe(600);
  });

  it("reste vide et sans NaN quand il n'y a rien", () => {
    const model = buildPerformance([], "all", NOW);
    expect(model).toMatchObject({
      analyses: 0,
      meanDurationS: null,
      medianFactor: null,
      audioTotalS: 0,
      videoAudioS: 0,
      engines: [],
      recent: [],
      hourOfAudioS: null,
    });
  });
});
