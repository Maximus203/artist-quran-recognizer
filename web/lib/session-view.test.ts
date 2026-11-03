import { describe, expect, it } from "vitest";
import { buildStats, buildViews, type ViewContext } from "./session-view";
import type { Session } from "./store";

const NOW = Date.parse("2026-10-22T12:00:00.000Z");
const iso = (secondsAgo: number) =>
  new Date(NOW - secondsAgo * 1000).toISOString();
let counter = 0;
const make = (over: Partial<Session> = {}): Session => {
  counter += 1;
  const n = String(counter).padStart(12, "0");
  return {
    id: `00000000-0000-4000-8000-${n}`,
    name: `fichier-${counter}.mp3`,
    extension: ".mp3",
    audio_sha256: "a".repeat(64),
    size: 1,
    source_kind: "file",
    created_at: iso(10_000 - counter),
    state: "ready",
    error: null,
    started_at: null,
    finished_at: null,
    prediction_sha256: null,
    pid: null,
    ...over,
  };
};
/** Analyse terminée du moteur donné : 45 s de chargement + 0,02 s par seconde d'audio. */
const finishedRun = (audio: number, engine: Session["engine"] = "cascade") =>
  make({
    state: "done",
    engine,
    asr: engine ?? undefined,
    audio_duration_s: audio,
    duration_s: 45 + 0.02 * audio,
    started_at: iso(5000),
    finished_at: iso(4900),
    viewed_at: iso(10),
  });
const history = [120, 600, 1800, 3600, 7200].map((a) => finishedRun(a));
const ctx = (over: Partial<ViewContext> = {}): ViewContext => ({
  now: NOW,
  concurrency: 1,
  queue: null,
  ...over,
});
const byId = (views: ReturnType<typeof buildViews>, s: Session) =>
  views.find((v) => v.id === s.id)!;

describe("non lu", () => {
  it("done ou failed jamais ouvert : unread ; ouvert, ancien, en cours : lu", () => {
    const fresh = make({ state: "done", viewed_at: null });
    const failed = make({ state: "failed", viewed_at: null });
    const opened = make({ state: "done", viewed_at: iso(5) });
    const legacy = make({ state: "done" }); // d'avant le suivi : champ absent
    const running = make({ state: "running", viewed_at: null });
    const views = buildViews([fresh, failed, opened, legacy, running], ctx());
    expect(byId(views, fresh).unread).toBe(true);
    expect(byId(views, failed).unread).toBe(true);
    expect(byId(views, opened).unread).toBe(false);
    expect(byId(views, legacy).unread).toBe(false);
    expect(byId(views, running).unread).toBe(false);
  });
});

describe("position dans la file", () => {
  it("suit l'ordre de la file ; null hors attente", () => {
    const run = make({ state: "running", started_at: iso(10) });
    const a = make({ state: "queued", queued_at: iso(30) });
    const b = make({ state: "queued", queued_at: iso(20) });
    const views = buildViews(
      [b, a, run],
      ctx({ queue: { active: [run.id], waiting: [a.id, b.id] } }),
    );
    expect(byId(views, a).queue_position).toBe(1);
    expect(byId(views, b).queue_position).toBe(2);
    expect(byId(views, run).queue_position).toBeNull();
  });
  it("sans file connue (serveur redémarré) : ordre de queued_at", () => {
    const first = make({ state: "queued", queued_at: iso(60) });
    const second = make({ state: "queued", queued_at: iso(30) });
    const views = buildViews([second, first], ctx());
    expect(byId(views, first).queue_position).toBe(1);
    expect(byId(views, second).queue_position).toBe(2);
  });
});

describe("estimation", () => {
  it("analyse en cours : durée estimée moins temps écoulé, bornée à 0", () => {
    const run = make({
      state: "running",
      engine: "cascade",
      audio_duration_s: 1800,
      started_at: iso(40),
    });
    const [v] = buildViews([...history, run], ctx()).filter(
      (x) => x.id === run.id,
    );
    // total = 45 + 0,02 × 1800 = 81 s ; écoulé 40 s
    expect(v.eta_s).toBeCloseTo(41, 0);
    expect(v.elapsed_s).toBe(40);
    expect(v.eta_overrun).toBe(false);
    expect(v.eta_reason).toBeNull();
  });
  it("plus long que prévu : eta_s vaut 0 et le dépassement est signalé", () => {
    const run = make({
      state: "running",
      engine: "cascade",
      audio_duration_s: 1800,
      started_at: iso(400),
    });
    const v = byId(buildViews([...history, run], ctx()), run);
    expect(v.eta_s).toBe(0);
    expect(v.eta_overrun).toBe(true);
  });
  it("file : la somme séquentielle des analyses devant + la sienne", () => {
    const run = make({
      state: "running",
      engine: "cascade",
      audio_duration_s: 1800,
      started_at: iso(40),
    });
    const a = make({
      state: "queued",
      engine: "cascade",
      asr: "cascade",
      audio_duration_s: 600,
      queued_at: iso(30),
    });
    const b = make({
      state: "queued",
      engine: "cascade",
      asr: "cascade",
      audio_duration_s: 3600,
      queued_at: iso(20),
    });
    const views = buildViews(
      [...history, run, a, b],
      ctx({ queue: { active: [run.id], waiting: [a.id, b.id] } }),
    );
    // en cours : 41 s restantes ; a : 45 + 12 = 57 s ; b : 45 + 72 = 117 s
    expect(byId(views, a).eta_s).toBeCloseTo(41 + 57, 0);
    expect(byId(views, b).eta_s).toBeCloseTo(41 + 57 + 117, 0);
  });
  it("sans historique du moteur : pas d'estimation, avec la raison — jamais un chiffre inventé", () => {
    const run = make({
      state: "running",
      engine: "whisper",
      audio_duration_s: 600,
      started_at: iso(10),
    });
    const v = byId(buildViews([...history, run], ctx()), run);
    expect(v.eta_s).toBeNull();
    expect(v.eta_reason).toBe("no_history");
  });
  it("l'historique d'un autre moteur ne sert pas", () => {
    const only = buildViews(
      [
        ...history,
        make({
          state: "queued",
          engine: "fastconformer",
          asr: "fastconformer",
          audio_duration_s: 100,
          queued_at: iso(1),
        }),
      ],
      ctx(),
    ).find((v) => v.state === "queued")!;
    expect(only.eta_s).toBeNull();
    expect(only.eta_reason).toBe("no_history");
  });
  it("durée de l'audio inconnue : pas d'estimation, et celles derrière elle non plus", () => {
    const unknown = make({
      state: "queued",
      engine: "cascade",
      asr: "cascade",
      audio_duration_s: null,
      queued_at: iso(30),
    });
    const after = make({
      state: "queued",
      engine: "cascade",
      asr: "cascade",
      audio_duration_s: 600,
      queued_at: iso(20),
    });
    const views = buildViews(
      [...history, unknown, after],
      ctx({ queue: { active: [], waiting: [unknown.id, after.id] } }),
    );
    expect(byId(views, unknown).eta_s).toBeNull();
    expect(byId(views, unknown).eta_reason).toBe("audio_duration_unknown");
    expect(byId(views, after).eta_s).toBeNull();
  });
  it("audio bien plus long que tout l'historique : refus d'extrapoler", () => {
    const huge = make({
      state: "queued",
      engine: "cascade",
      asr: "cascade",
      audio_duration_s: 60_000,
      queued_at: iso(5),
    });
    const v = byId(buildViews([...history, huge], ctx()), huge);
    expect(v.eta_s).toBeNull();
    expect(v.eta_reason).toBe("out_of_range");
  });
  it("seules les analyses réussies avec durées connues forment l'historique", () => {
    const polluters = [
      make({
        state: "failed",
        engine: "cascade",
        audio_duration_s: 1000,
        duration_s: 5,
      }),
      make({
        state: "cancelled",
        engine: "cascade",
        audio_duration_s: 1000,
        duration_s: 5,
      }),
      make({
        state: "done",
        engine: "cascade",
        audio_duration_s: null,
        duration_s: 5,
      }),
      make({
        state: "done",
        engine: "cascade",
        audio_duration_s: 1000,
        duration_s: null,
      }),
    ];
    const run = make({
      state: "running",
      engine: "cascade",
      audio_duration_s: 1800,
      started_at: iso(0),
    });
    const withNoise = byId(
      buildViews([...history, ...polluters, run], ctx()),
      run,
    );
    const clean = byId(buildViews([...history, run], ctx()), run);
    expect(withNoise.eta_s).toBe(clean.eta_s);
  });
  it("une analyse tout juste lancée (moteur pas encore écrit) utilise le moteur demandé : pas de trou d'estimation", () => {
    const starting = make({
      state: "ready",
      audio_duration_s: 1800,
      queued_at: iso(1),
    });
    const next = make({
      state: "queued",
      engine: "cascade",
      asr: "cascade",
      audio_duration_s: 600,
      queued_at: iso(0.5),
    });
    const views = buildViews(
      [...history, starting, next],
      ctx({
        queue: { active: [starting.id], waiting: [next.id] },
        pendingEngines: { [starting.id]: "cascade" },
      }),
    );
    expect(byId(views, starting).eta_s).toBeCloseTo(81, 0); // 45 + 0,02 × 1800
    expect(byId(views, next).eta_s).toBeCloseTo(81 + 57, 0);
    expect(byId(views, next).eta_reason).toBeNull();
  });
  it("sans moteur demandé connu, l'estimation reste indisponible, avec sa raison", () => {
    const starting = make({ state: "ready", audio_duration_s: 1800 });
    const view = byId(
      buildViews(
        [...history, starting],
        ctx({ queue: { active: [starting.id], waiting: [] } }),
      ),
      starting,
    );
    expect(view.eta_s).toBeNull();
    expect(view.eta_reason).toBe("no_history");
  });
  it("les sessions terminées n'ont ni estimation ni raison", () => {
    const done = make({ state: "done", viewed_at: null });
    const v = byId(buildViews([done], ctx()), done);
    expect(v.eta_s).toBeNull();
    expect(v.eta_reason).toBeNull();
    expect(v.eta_range_s).toBeNull();
  });
});

describe("buildStats — performance par moteur", () => {
  it("agrège par moteur : analyses, RTF médian/p90/moyen, durées, estimation", () => {
    const sessions = [
      ...history,
      finishedRun(300, "fastconformer"),
      make({
        state: "failed",
        engine: "cascade",
        audio_duration_s: 10,
        duration_s: 3,
        viewed_at: null,
      }),
    ];
    const stats = buildStats(sessions, ctx());
    const cascade = stats.engines.find((e) => e.engine === "cascade")!;
    expect(cascade.analyses).toBe(5);
    expect(cascade.failures).toBe(1);
    expect(cascade.audio_total_s).toBe(120 + 600 + 1800 + 3600 + 7200);
    expect(cascade.rtf!.median).toBeGreaterThan(0);
    expect(cascade.rtf!.p90).toBeGreaterThanOrEqual(cascade.rtf!.median);
    expect(cascade.rtf!.max).toBeGreaterThan(cascade.rtf!.min); // la dispersion se voit
    expect(cascade.estimate!.overhead_s).toBeCloseTo(45, 3);
    expect(cascade.estimate!.seconds_per_audio_s).toBeCloseTo(0.02, 4);
    expect(cascade.estimate_unavailable).toBeNull();
    const fast = stats.engines.find((e) => e.engine === "fastconformer")!;
    expect(fast.analyses).toBe(1);
    expect(fast.estimate).toBeNull();
    expect(fast.estimate_unavailable).toBe("insufficient_history");
    expect(stats.engines[0].engine).toBe("cascade"); // le plus utilisé d'abord
  });
  it("un résultat importé à la main (jamais lancé ici) n'est pas une analyse du moteur", () => {
    const imported = make({
      state: "done",
      engine: "cascade",
      asr: "cascade",
      audio_duration_s: 600,
      started_at: null,
      duration_s: null,
      viewed_at: iso(5),
    });
    const stats = buildStats([...history, imported], ctx());
    const cascade = stats.engines.find((e) => e.engine === "cascade")!;
    expect(cascade.analyses).toBe(5);
    expect(cascade.audio_total_s).toBe(120 + 600 + 1800 + 3600 + 7200);
    const onlyImported = buildStats([imported], ctx());
    expect(onlyImported.engines).toEqual([]);
  });
  it("file courante et dernières analyses, sans données hors session", () => {
    const run = make({
      state: "running",
      engine: "cascade",
      audio_duration_s: 1800,
      started_at: iso(40),
    });
    const waiting = make({
      state: "queued",
      engine: "cascade",
      asr: "cascade",
      audio_duration_s: 600,
      queued_at: iso(10),
    });
    const stats = buildStats(
      [...history, run, waiting],
      ctx({
        queue: { active: [run.id], waiting: [waiting.id] },
        concurrency: 1,
      }),
    );
    expect(stats.queue.concurrency).toBe(1);
    expect(stats.queue.running.map((r) => r.id)).toEqual([run.id]);
    expect(stats.queue.waiting.map((r) => r.id)).toEqual([waiting.id]);
    expect(stats.queue.waiting[0].queue_position).toBe(1);
    expect(stats.queue.running[0].eta_s).toBeGreaterThan(0);
    expect(stats.recent).toHaveLength(5);
    expect(Object.keys(stats.recent[0]).sort()).toEqual(
      [
        "audio_duration_s",
        "duration_s",
        "engine",
        "finished_at",
        "id",
        "name",
        "rtf",
        "state",
        "unread",
      ].sort(),
    );
    expect(stats.generated_at).toBe(new Date(NOW).toISOString());
  });
  it("aucune session : tout est vide, rien ne plante", () => {
    const stats = buildStats([], ctx());
    expect(stats.engines).toEqual([]);
    expect(stats.recent).toEqual([]);
    expect(stats.queue).toEqual({ concurrency: 1, running: [], waiting: [] });
  });
});
