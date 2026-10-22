import { describe, expect, it } from "vitest";
import {
  attentionCount,
  buildRow,
  filterViews,
  groupViews,
  pageTitle,
  queueSummary,
  sessionCounts,
} from "./session-list";
import type { SessionView } from "./session-view";

// 22 octobre 2026, 15 h 00 en heure locale : les dates relatives se calculent par rapport à cet instant.
const NOW = new Date(2026, 9, 22, 15, 0, 0).getTime();
const at = (day: number, hour: number, minute = 0) =>
  new Date(2026, 9, day, hour, minute, 0).toISOString();

let counter = 0;
const view = (over: Partial<SessionView> = {}): SessionView =>
  ({
    id: `id-${++counter}`,
    name: "essai.mp3",
    extension: ".mp3",
    audio_sha256: "a".repeat(64),
    size: 1000,
    created_at: at(22, 12),
    state: "done",
    error: null,
    started_at: at(22, 12, 1),
    finished_at: at(22, 12, 2),
    prediction_sha256: "b".repeat(64),
    pid: null,
    engine: "cascade",
    audio_duration_s: 184.7,
    duration_s: 26,
    viewed_at: at(22, 13),
    queue_position: null,
    unread: false,
    elapsed_s: null,
    eta_s: null,
    eta_range_s: null,
    eta_reason: null,
    eta_overrun: false,
    ...over,
  }) as SessionView;

describe("buildRow : états de la liste (spec §7)", () => {
  it("prêt à analyser", () => {
    const row = buildRow(
      view({ state: "ready", finished_at: null, duration_s: null }),
      NOW,
    );
    expect(row.glyph).toBe("ready");
    expect(row.status).toBe("Prêt à analyser");
  });

  it("en attente : rang dans la file et fin estimée", () => {
    const row = buildRow(
      view({
        state: "queued",
        queue_position: 1,
        eta_s: 700,
        name: "conf.mp4",
        extension: ".mp4",
        audio_duration_s: 4328,
        finished_at: null,
        duration_s: null,
      }),
      NOW,
    );
    expect(row.glyph).toBe("queued");
    expect(row.rank).toBe(1);
    expect(row.status).toBe("En attente · n° 1 dans la file");
    expect(row.mediaKind).toBe("video");
    expect(row.meta).toBe("Vidéo · 1:12:08 · Cascade · ≈ 12 min avant la fin");
    expect(row.progress).toBeNull();
  });

  it("en attente sans estimation : n'invente aucun chiffre", () => {
    const row = buildRow(
      view({
        state: "queued",
        queue_position: 2,
        eta_s: null,
        eta_reason: "no_history",
      }),
      NOW,
    );
    expect(row.meta).not.toContain("≈");
    expect(row.meta).not.toContain("avant la fin");
  });

  it("en cours : reste à attendre, progression et pourcentage", () => {
    const row = buildRow(
      view({
        state: "running",
        elapsed_s: 160,
        eta_s: 100,
        finished_at: null,
        duration_s: null,
      }),
      NOW,
    );
    expect(row.glyph).toBe("running");
    expect(row.status).toBe("Analyse en cours · ≈ 2 min restantes");
    expect(row.tone).toBe("accent");
    expect(row.progress).toBeCloseTo(160 / 260, 3);
    expect(row.endLabel).toBe("62 %");
    expect(row.indeterminate).toBe(false);
  });

  it("en cours : moins d'une minute, et accord au singulier", () => {
    expect(
      buildRow(view({ state: "running", elapsed_s: 100, eta_s: 30 }), NOW)
        .status,
    ).toBe("Analyse en cours · moins d’une minute restante");
    expect(
      buildRow(view({ state: "running", elapsed_s: 100, eta_s: 55 }), NOW)
        .status,
    ).toContain("moins d’une minute restante");
    expect(
      buildRow(view({ state: "running", elapsed_s: 100, eta_s: 60 }), NOW)
        .status,
    ).toBe("Analyse en cours · ≈ 1 min restante");
  });

  it("en cours : la progression ne dépasse jamais 95 % avant la fin réelle", () => {
    const row = buildRow(
      view({ state: "running", elapsed_s: 1000, eta_s: 1 }),
      NOW,
    );
    expect(row.progress).toBe(0.95);
    expect(row.endLabel).toBe("95 %");
  });

  it("en cours depuis plus longtemps que prévu : pas d'ETA, barre indéterminée, ton d'alerte", () => {
    const row = buildRow(
      view({
        state: "running",
        elapsed_s: 900,
        eta_s: 0,
        eta_overrun: true,
      }),
      NOW,
    );
    expect(row.status).toBe("Analyse en cours · plus long que prévu");
    expect(row.tone).toBe("warn");
    expect(row.progress).toBeNull();
    expect(row.indeterminate).toBe(true);
  });

  it("en cours sans estimation : temps écoulé, barre indéterminée", () => {
    const row = buildRow(
      view({
        state: "running",
        elapsed_s: 72,
        eta_s: null,
        eta_reason: "no_history",
      }),
      NOW,
    );
    expect(row.status).toBe("Analyse en cours · 1 min 12 s écoulées");
    expect(row.indeterminate).toBe(true);
    expect(row.progress).toBeNull();
  });

  it("terminé non lu : point, durée réelle et facteur temps réel", () => {
    const row = buildRow(
      view({
        unread: true,
        viewed_at: null,
        duration_s: 340,
        audio_duration_s: 2475,
      }),
      NOW,
    );
    expect(row.glyph).toBe("done");
    expect(row.unread).toBe(true);
    expect(row.status).toBe("Résultat prêt · 5 min 40 s · ×7,3");
    expect(row.meta).toBe("Audio · 41:15 · Cascade");
  });

  it("terminé lu : pas de point", () => {
    const row = buildRow(
      view({ duration_s: 26, audio_duration_s: 184.7 }),
      NOW,
    );
    expect(row.unread).toBe(false);
    expect(row.status).toBe("Terminé en 26 s · ×7,1");
  });

  it("terminé sans durées connues : n'affiche pas de facteur", () => {
    const row = buildRow(
      view({
        duration_s: null,
        audio_duration_s: null,
        started_at: null,
        finished_at: null,
      }),
      NOW,
    );
    expect(row.status).toBe("Terminé");
    expect(row.meta).toBe("Audio · Cascade");
  });

  it("échec : motif court, danger, relance possible, non lu possible", () => {
    const row = buildRow(
      view({
        state: "failed",
        unread: true,
        viewed_at: null,
        error: "Moteur indisponible : le modèle est introuvable.\nTraceback...",
      }),
      NOW,
    );
    expect(row.glyph).toBe("failed");
    expect(row.tone).toBe("danger");
    expect(row.canRetry).toBe(true);
    expect(row.unread).toBe(true);
    expect(row.status).toBe(
      "Échec · Moteur indisponible : le modèle est introuvable.",
    );
  });

  it("échec : tronque un motif trop long", () => {
    const row = buildRow(
      view({ state: "failed", error: "x".repeat(200) }),
      NOW,
    );
    expect(row.status.length).toBeLessThan(70);
    expect(row.status.endsWith("…")).toBe(true);
  });

  it("annulé : durée avant l'arrêt, jamais de point", () => {
    const row = buildRow(
      view({
        state: "cancelled",
        duration_s: null,
        started_at: at(22, 12, 0),
        finished_at: at(22, 12, 2),
        unread: false,
      }),
      NOW,
    );
    expect(row.glyph).toBe("cancelled");
    expect(row.status).toBe("Annulé après 2 min");
    expect(row.unread).toBe(false);
    expect(row.canRetry).toBe(true);
  });

  it("libelle le moteur", () => {
    expect(buildRow(view({ engine: "muno-streaming" }), NOW).meta).toContain(
      "Muno",
    );
    expect(buildRow(view({ engine: "fastconformer" }), NOW).meta).toContain(
      "FastConformer",
    );
    expect(buildRow(view({ engine: "whisper" }), NOW).meta).toContain(
      "Whisper",
    );
  });

  it("date de droite : l'heure aujourd'hui, « hier », puis le jour", () => {
    expect(buildRow(view({ finished_at: at(22, 14, 2) }), NOW).endLabel).toBe(
      "14:02",
    );
    expect(buildRow(view({ finished_at: at(21, 9) }), NOW).endLabel).toBe(
      "hier",
    );
    expect(buildRow(view({ finished_at: at(14, 9) }), NOW).endLabel).toMatch(
      /^14 oct/,
    );
  });
});

describe("groupViews / filterViews / sessionCounts", () => {
  const running = view({
    state: "running",
    started_at: at(22, 14, 50),
    finished_at: null,
  });
  const queued1 = view({
    state: "queued",
    queue_position: 1,
    finished_at: null,
  });
  const queued2 = view({
    state: "queued",
    queue_position: 2,
    finished_at: null,
  });
  const unread = view({
    unread: true,
    viewed_at: null,
    finished_at: at(22, 14, 2),
  });
  const read = view({ finished_at: at(22, 12, 20) });
  const failed = view({
    state: "failed",
    unread: true,
    viewed_at: null,
    finished_at: at(22, 11, 5),
  });
  const ready = view({ state: "ready", finished_at: null });
  const all = [read, queued2, failed, ready, unread, queued1, running];

  it("sépare la file d'analyse, les prêtes et les terminées, dans le bon ordre", () => {
    const groups = groupViews(all);
    expect(groups.queue.map((v) => v.id)).toEqual([
      running.id,
      queued1.id,
      queued2.id,
    ]);
    expect(groups.ready.map((v) => v.id)).toEqual([ready.id]);
    expect(groups.done.map((v) => v.id)).toEqual([
      unread.id,
      read.id,
      failed.id,
    ]);
  });

  it("filtre Toutes / En cours / Non lues", () => {
    expect(filterViews(all, "all")).toHaveLength(7);
    expect(
      filterViews(all, "active")
        .map((v) => v.id)
        .sort(),
    ).toEqual([running.id, queued1.id, queued2.id].sort());
    expect(
      filterViews(all, "unread")
        .map((v) => v.id)
        .sort(),
    ).toEqual([unread.id, failed.id].sort());
  });

  it("compte pour les pastilles de filtre", () => {
    expect(sessionCounts(all)).toEqual({ all: 7, active: 3, unread: 2 });
  });
});

describe("queueSummary", () => {
  it("résume la file en une ligne", () => {
    const list = [
      view({ state: "running", eta_s: 100, finished_at: null }),
      view({
        state: "queued",
        queue_position: 1,
        eta_s: 700,
        finished_at: null,
      }),
    ];
    expect(queueSummary(list)).toBe(
      "1 en cours · 1 en attente · fin estimée dans ≈ 12 min",
    );
  });
  it("n'invente pas de fin quand une estimation manque", () => {
    const list = [
      view({ state: "running", eta_s: null, finished_at: null }),
      view({
        state: "queued",
        queue_position: 1,
        eta_s: null,
        finished_at: null,
      }),
    ];
    expect(queueSummary(list)).toBe("1 en cours · 1 en attente");
  });
  it("renvoie null quand la file est vide", () => {
    expect(queueSummary([view()])).toBeNull();
  });
});

describe("pageTitle / attentionCount", () => {
  it("préfixe le total de non lus", () => {
    expect(pageTitle(0)).toBe("Atelier de revue");
    expect(pageTitle(2)).toBe("(2) Atelier de revue");
  });
  it("signale quelque chose à voir : non lu ou analyse active", () => {
    expect(attentionCount([view()])).toBe(0);
    expect(attentionCount([view({ unread: true })])).toBe(1);
    expect(
      attentionCount([view({ state: "running", finished_at: null })]),
    ).toBe(1);
    expect(
      attentionCount([
        view({ unread: true }),
        view({ state: "queued", queue_position: 1 }),
      ]),
    ).toBe(2);
  });
});
