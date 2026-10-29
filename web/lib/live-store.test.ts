import { describe, expect, it } from "vitest";
import { LIVE_UI } from "./live-config";
import type { ServerMessage } from "./live-protocol";
import {
  announceChange,
  counts,
  cutSeconds,
  historyRows,
  initialState,
  lastNamed,
  patienceStage,
  quietHint,
  recentRevision,
  revisedCount,
  reduce,
  silenceS,
  viewOf,
  type LiveAction,
  type LiveState,
} from "./live-store";

// ───────── Fabrique de scénarios : les messages réels de aqr.live/1, rejoués à des instants précis ─────────
let seq = 0;
const base = (type: string, t: number) => ({
  schema: "aqr.live/1",
  type,
  seq: ++seq,
  t,
});
const msg = (m: Record<string, unknown>) => m as unknown as ServerMessage;
const server = (nowMs: number, message: ServerMessage): LiveAction => ({
  type: "server",
  nowMs,
  message,
});
const ready = (t = 0, extra: Record<string, unknown> = {}) =>
  msg({
    schema: "aqr.live/1",
    type: "READY",
    seq: 0,
    t,
    session_id: "c0ZxUo2m3VnJ8pQ0yH4d1A",
    resumed: false,
    last_seq: 0,
    audio_received_samples: 0,
    degraded: [],
    technical: false,
    resume_ttl_s: 30,
    ...extra,
  });
const cand = (
  t: number,
  count: number,
  words: number,
  o: { text?: string; refs?: string[]; context?: string; tr?: unknown } = {},
) =>
  msg({
    ...base("CANDIDATES", t),
    state: "ambiguous",
    words_heard: words,
    count,
    heard: o.text
      ? { words: [1, words], text: o.text, translation: o.tr }
      : { words: [1, words] },
    items: (o.refs ?? []).map((ref) => ({ ref, posterior: 0.1 })),
    leader: o.context ? { ref: o.context, basis: "context" } : null,
  });
const TR = {
  text: "Louange à Allah, Seigneur des mondes.",
  translation_id: "french_hameedullah",
  version: "quranenc.com",
  attribution: "QuranEnc.com",
  scope: "verse",
};
const locked = (
  t: number,
  ref: string,
  heard: number,
  o: {
    status?: string;
    basis?: string;
    text?: string;
    words?: [number, number];
  } = {},
) =>
  msg({
    ...base("LOCKED", t),
    interval: {
      kind: "verse",
      ref,
      words: o.words ?? [1, 4],
      partial: false,
      status: o.status ?? "recognized",
      t: [t - 2, null],
      repetition: false,
      text: o.text ?? "ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَـٰلَمِينَ",
      translation: TR,
      identity_basis: o.basis ?? "words",
      words_heard: heard,
    },
  });
const progress = (t: number, ref: string, heard: number) =>
  msg({ ...base("PROGRESS", t), ref, words_heard: heard });
const cont = (
  t: number,
  ref: string,
  expected: string | null,
  o: { status?: string } = {},
) =>
  msg({
    ...base("CONTINUE", t),
    closed: {
      kind: "verse",
      ref,
      words: [1, 4],
      partial: false,
      status: o.status ?? "recognized",
      t: [t - 4, t - 0.5],
      text: "ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَـٰلَمِينَ",
      translation: TR,
      identity_basis: o.status === "inferred" ? "context" : "words",
    },
    complete: true,
    expected: expected ? { ref: expected } : null,
  });
const unresolved = (t: number, words: number, refs: string[]) =>
  msg({
    ...base("CONTINUE", t),
    closed: {
      kind: "verse",
      ref: refs[0],
      words: [1, words],
      partial: true,
      status: "uncertain",
      t: [t - 3, t - 1],
      candidates: refs,
      candidate_count: refs.length + 9,
      text: null,
      translation: null,
    },
    complete: false,
    expected: null,
  });
const jump = (t: number, kind: string) =>
  msg({
    ...base("JUMP", t),
    from: "1:2",
    reason: "mismatch_with_expected",
    kind,
  });
const lost = (t: number, reason: string) => msg({ ...base("LOST", t), reason });

/** Démarre une écoute : clic, micro accordé, service prêt. */
const open = (): LiveAction[] => [
  { type: "start", nowMs: 0 },
  { type: "mic_granted", nowMs: 1500, keepAvailable: true },
  server(2000, ready()),
];
const replay = (actions: LiveAction[], from: LiveState = initialState()) =>
  actions.reduce(reduce, from);
const upTo = (actions: LiveAction[], nowMs: number) =>
  replay(
    actions
      .filter((a) => !("nowMs" in a) || a.nowMs <= nowMs)
      .concat({ type: "tick", nowMs }),
  );
const resetSeq = () => {
  seq = 0;
};

describe("parcours de démarrage", () => {
  it("clic → permission → connexion → écoute, et rien n'est affiché de coranique", () => {
    let s = reduce(initialState(), { type: "start", nowMs: 0 });
    expect(viewOf(s)).toBe("perm");
    s = reduce(s, { type: "mic_granted", nowMs: 900, keepAvailable: true });
    expect(viewOf(s)).toBe("conn");
    s = reduce(s, server(1500, ready()));
    expect(s.phase).toBe("listening");
    expect(viewOf(s)).toBe("listen");
    expect(s.sessionId).toBe("c0ZxUo2m3VnJ8pQ0yH4d1A");
    expect(s.cand).toBeNull();
    expect(s.lock).toBeNull();
  });

  it("un refus de micro explique et n'ouvre aucune session", () => {
    let s = reduce(initialState(), { type: "start", nowMs: 0 });
    s = reduce(s, { type: "failed", nowMs: 800, key: "denied" });
    expect(s.phase).toBe("error");
    expect(s.errorKey).toBe("denied");
    expect(viewOf(s)).toBe("err");
    expect(s.sessionId).toBeNull();
  });

  it("server_busy au départ garde le texte du service et le délai conseillé", () => {
    resetSeq();
    let s = replay([
      { type: "start", nowMs: 0 },
      { type: "mic_granted", nowMs: 500, keepAvailable: true },
    ]);
    s = reduce(
      s,
      server(
        900,
        msg({
          schema: "aqr.live/1",
          type: "ERROR",
          seq: 0,
          t: 0,
          code: "server_busy",
          message: "Le service est complet pour le moment.",
          recoverable: true,
          retry_after_s: 12,
        }),
      ),
    );
    expect(s.phase).toBe("error");
    expect(s.errorKey).toBe("server_busy");
    expect(s.errorMessage).toBe("Le service est complet pour le moment.");
    expect(s.retryAfterS).toBe(12);
  });

  it("annuler pendant la connexion revient à l'accueil", () => {
    const s = replay([
      { type: "start", nowMs: 0 },
      { type: "mic_granted", nowMs: 500, keepAvailable: false },
      { type: "cancel" },
    ]);
    expect(s.phase).toBe("idle");
  });
});

describe("Al-Fatiha : un verset nommé, un verset jamais nommé, un saut", () => {
  resetSeq();
  const script: LiveAction[] = [
    ...open(),
    server(8600, cand(2.0, 52, 2, { refs: ["1:2", "6:1", "18:1"] })),
    server(
      9500,
      cand(2.8, 7, 3, { refs: ["1:2", "6:1"], text: "ٱلْحَمْدُ لِلَّهِ" }),
    ),
    server(10400, locked(3.5, "1:2", 3)),
    server(11100, progress(4.2, "1:2", 4)),
    server(11500, cont(5.0, "1:2", "1:3")),
    server(12900, cand(6.0, 14, 2, { refs: ["1:3", "55:1"], context: "1:3" })),
    server(16000, unresolved(8.0, 2, ["1:3", "55:1"])),
    server(16000, jump(8.0, "skip")),
    server(16300, cand(8.3, 3, 2, { refs: ["1:4"] })),
    server(17900, locked(9.9, "1:4", 3)),
    server(18400, cont(10.4, "1:4", "1:5")),
  ];

  it("candidats sans texte tant qu'un seul candidat n'a pas passé le verrou", () => {
    const s = upTo(script, 8700);
    expect(viewOf(s)).toBe("cands");
    expect(s.cand).toEqual({
      count: 52,
      wordsHeard: 2,
      heardText: null,
      translation: null,
      refs: ["1:2", "6:1", "18:1"],
      piste: null,
    });
    expect(JSON.stringify(s.cand)).not.toMatch(/[؀-ۿ]/);
    expect(s.trail).toEqual([52]);
  });

  it("les mots communs n'apparaissent que s'ils viennent du corpus (heard.text)", () => {
    const s = upTo(script, 9600);
    expect(s.cand?.heardText).toBe("ٱلْحَمْدُ لِلَّهِ");
    expect(s.trail).toEqual([52, 7]);
  });

  it("verset nommé : arabe du corpus, traduction entière, mots entendus qui avancent", () => {
    let s = upTo(script, 10500);
    expect(viewOf(s)).toBe("named");
    expect(s.lock?.text).toBe("ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَـٰلَمِينَ");
    expect(s.lock?.translation?.text).toBe(TR.text);
    expect(s.lock?.wordsHeard).toBe(3);
    expect(s.cand).toBeNull();
    s = upTo(script, 11200);
    expect(s.lock?.wordsHeard).toBe(4);
  });

  it("PROGRESS ne recule jamais et ignore un autre verset", () => {
    let s = upTo(script, 11200);
    s = reduce(s, server(11300, progress(4.4, "1:2", 2)));
    expect(s.lock?.wordsHeard).toBe(4);
    s = reduce(s, server(11350, progress(4.5, "9:9", 8)));
    expect(s.lock?.wordsHeard).toBe(4);
  });

  it("CONTINUE range le verset dans la liste et annonce la suite attendue", () => {
    const s = upTo(script, 11600);
    expect(s.lock).toBeNull();
    expect(viewOf(s)).toBe("between");
    expect(s.between?.expected).toBe("1:3");
    expect(s.hist).toHaveLength(1);
    expect(s.hist[0]).toMatchObject({
      kind: "verse",
      ref: "1:2",
      status: "recognized",
    });
    expect(lastNamed(s)).toEqual({ ref: "1:2", endT: 4.5 });
  });

  it("la piste de suite n'est montrée que si le favori l'est par la position", () => {
    const s = upTo(script, 13000);
    expect(s.cand?.piste).toBe("1:3");
    expect(s.between).toBeNull();
  });

  it("un passage clos sans nom reste dans la liste, sans texte, et rien n'est une erreur", () => {
    const s = upTo(script, 16100);
    expect(viewOf(s)).toBe("unres");
    const row = s.hist[0];
    expect(row).toMatchObject({
      kind: "unres",
      candidates: ["1:3", "55:1"],
      gap: true,
    });
    expect(JSON.stringify(row)).not.toMatch(/"text":"[^"]/);
    expect(s.streamError).toBeNull();
  });

  it("GAP dérivé : le saut après un passage non nommé n'ajoute pas de ligne, le trou se dit 'entre 1:2 et 1:4'", () => {
    const s = upTo(script, 18500);
    expect(s.hist.filter((h) => h.kind === "jump")).toHaveLength(0);
    const gap = historyRows(s).find((r) => r.kind === "unres");
    expect(gap?.between).toEqual(["1:2", "1:4"]);
    expect(counts(s)).toEqual({ named: 2, unnamed: 1 });
  });

  it("un saut d'un autre genre reste une ligne de séparation, sans nom de verset", () => {
    const s = reduce(
      upTo(script, 11600),
      server(11700, { ...jump(5.5, "other_surah"), seq: 500 } as ServerMessage),
    );
    expect(viewOf(s)).toBe("jump");
    expect(s.hist[0]).toMatchObject({ kind: "jump", jump: "other_surah" });
    expect(s.hist[1]).toMatchObject({ kind: "verse", ref: "1:2" });
  });

  it("rejouer deux fois le même scénario donne le même état (réducteur pur)", () => {
    expect(JSON.stringify(upTo(script, 18500))).toBe(
      JSON.stringify(upTo(script, 18500)),
    );
  });

  it("un message déjà vu (seq) est ignoré : le rejeu d'une reprise ne double rien", () => {
    const s = upTo(script, 18500);
    const again = replay(
      [
        server(18600, cont(10.4, "1:4", "1:5")),
        server(18600, locked(3.5, "1:2", 3)),
      ],
      s,
    );
    expect(again.hist).toHaveLength(s.hist.length);
    expect(again.lock).toBeNull();
  });
});

describe("l'attente est un état, pas un trou (6 / 12 / 21 s)", () => {
  resetSeq();
  const script = [
    ...open(),
    server(8000, cand(2, 214, 1)),
    server(10000, cand(4, 61, 2)),
  ];
  it("aucune phrase avant 6 s, puis une par seuil, comptées depuis les premiers candidats", () => {
    const [a, b, c] = LIVE_UI.patienceS;
    expect(patienceStage(upTo(script, 8000 + a * 1000 - 1))).toBe(0);
    expect(patienceStage(upTo(script, 8000 + a * 1000))).toBe(1);
    expect(patienceStage(upTo(script, 8000 + b * 1000))).toBe(2);
    expect(patienceStage(upTo(script, 8000 + c * 1000))).toBe(3);
  });
  it("les seuils par défaut sont 6, 12 et 21 s (configuration unique)", () => {
    expect([...LIVE_UI.patienceS]).toEqual([6, 12, 21]);
  });
  it("sans candidats, pas de patience à afficher", () => {
    expect(patienceStage(upTo(open(), 60000))).toBe(0);
  });
});

describe("refrain identique : déduit de la position", () => {
  resetSeq();
  const script = [
    ...open(),
    server(
      8600,
      cand(2, 3, 3, {
        refs: ["56:74", "56:96", "69:52"],
        tr: TR,
        text: "فَسَبِّحْ",
      }),
    ),
    server(
      10700,
      locked(4, "56:74", 4, { status: "inferred", basis: "context" }),
    ),
    server(11600, cont(5, "56:74", "56:75", { status: "inferred" })),
  ];
  it("garde le statut INFERRED et la base 'context', jamais 'reconnu'", () => {
    const s = upTo(script, 10800);
    expect(viewOf(s)).toBe("inferred");
    expect(s.lock?.status).toBe("inferred");
    expect(s.lock?.basis).toBe("context");
    const after = upTo(script, 11700);
    expect(after.hist[0]).toMatchObject({
      status: "inferred",
      basis: "context",
    });
  });
  it("une traduction commune des sosies est portée par les candidats, entière", () => {
    const s = upTo(script, 8700);
    expect(s.cand?.translation?.text).toBe(TR.text);
  });
  it("annonce 'non reconnu à la voix' pour un verset déduit", () => {
    const before = upTo(script, 8700);
    const after = upTo(script, 10800);
    expect(announceChange(before, after, (r) => `Sourate ${r}`)).toBe(
      "Verset déduit de la position : Sourate 56:74. Non reconnu à la voix.",
    );
  });
});

describe("parole non coranique et silence", () => {
  resetSeq();
  const script = [
    ...open(),
    server(8600, cand(2, 52, 2)),
    server(12000, cont(5.5, "1:2", "1:3")),
    server(15600, lost(13.6, "non_quran")),
    server(20000, lost(18, "non_quran")),
  ];
  it("aucun candidat, aucun verset ; une ligne neutre, hors du compteur de versets", () => {
    const s = upTo(script, 16000);
    expect(viewOf(s)).toBe("nonquran");
    expect(s.cand).toBeNull();
    expect(counts(s).named).toBe(1);
    expect(s.hist[0].kind).toBe("nq");
  });
  it("deux pertes de suite ne font qu'une ligne", () => {
    const s = upTo(script, 21000);
    expect(s.hist.filter((h) => h.kind === "nq")).toHaveLength(1);
  });
  it("le silence garde le dernier verset affiché et ne crée aucune ligne", () => {
    resetSeq();
    const quiet = [
      ...open(),
      server(8000, cand(2, 9, 2)),
      server(9000, locked(3, "1:2", 3)),
      server(9500, cont(4, "1:2", "1:3")),
      server(20000, lost(14, "silence")),
    ];
    const s = upTo(quiet, 20100);
    expect(viewOf(s)).toBe("between");
    expect(s.hist).toHaveLength(1);
  });
  it("le fil perdu après des candidats laisse un passage non nommé (état normal)", () => {
    resetSeq();
    const s = upTo(
      [
        ...open(),
        server(8000, cand(2, 9, 2, { text: "قُلْ" })),
        server(14000, lost(8, "no_candidate")),
      ],
      14100,
    );
    expect(viewOf(s)).toBe("unres");
    expect(s.hist[0]).toMatchObject({ kind: "unres", heardText: "قُلْ" });
  });
});

describe("correction (REVISION) : jamais effacée, jamais présentée comme sûre", () => {
  resetSeq();
  const script = [
    ...open(),
    server(8000, cand(2, 11, 2)),
    server(10000, locked(4, "1:5", 3)),
    server(12000, cont(6, "1:5", "1:6")),
    server(15500, cand(9, 5, 2)),
    server(17500, locked(11, "1:6", 3)),
    server(
      18400,
      msg({
        ...base("REVISION", 12.4),
        ref: "1:5",
        status: "retracted",
        reason: "contradicted",
      }),
    ),
  ];
  it("garde la ligne, la marque 'corrigée' et retire son texte", () => {
    const before = upTo(script, 17600);
    const s = upTo(script, 18500);
    expect(s.hist).toHaveLength(before.hist.length);
    const row = s.hist.find((h) => h.kind === "verse" && h.ref === "1:5");
    expect(row).toMatchObject({
      revised: true,
      status: "uncertain",
      text: null,
      translation: null,
    });
    expect(counts(s).named).toBe(1);
    expect(revisedCount(s)).toBe(1); // dit à part, jamais passé sous silence
    expect(revisedCount(before)).toBe(0);
  });
  it("le bandeau reste 14 s puis disparaît, la ligne reste", () => {
    const s = upTo(script, 18500);
    expect(recentRevision(s)).toBe("1:5");
    const later = upTo(script, 18500 + LIVE_UI.revisionShownS * 1000 + 1);
    expect(recentRevision(later)).toBeNull();
    expect(later.hist.some((h) => h.kind === "verse" && h.revised)).toBe(true);
  });
  it("retirer le verset en cours le range dans la liste, corrigé", () => {
    resetSeq();
    const s = upTo(
      [
        ...open(),
        server(8000, cand(2, 11, 2)),
        server(10000, locked(4, "1:5", 3)),
        server(
          11000,
          msg({ ...base("REVISION", 5), ref: "1:5", status: "retracted" }),
        ),
      ],
      11100,
    );
    expect(s.lock).toBeNull();
    expect(s.hist[0]).toMatchObject({ ref: "1:5", revised: true, text: null });
  });
  it("annonce la correction", () => {
    const a = upTo(script, 17600);
    const b = upTo(script, 18500);
    expect(announceChange(a, b, (r) => r)).toBe(
      "Correction : 1:5 n’est plus nommé.",
    );
  });
});

describe("mode allégé : toujours dit, jamais caché", () => {
  resetSeq();
  const deg = (
    t: number,
    overloaded: boolean,
    skipped: string[],
    lag: number,
  ) =>
    msg({
      ...base("DEGRADED", t),
      tier: 1,
      overloaded,
      skipped,
      lag_s: lag,
      reason: overloaded ? "overload" : "recovered",
    });
  const script = [
    ...open(),
    server(12000, deg(10, true, [], 5.3)),
    server(27000, deg(25, false, [], 0.2)),
  ];
  it("actif pendant la surcharge, avec le retard réel, puis retour au normal", () => {
    const on = upTo(script, 13000);
    expect(on.degraded).toEqual({ overloaded: true, skipped: [], lagS: 5.3 });
    const off = upTo(script, 28000);
    expect(off.degraded).toBeNull();
    expect(off.degLog).toEqual([[10, 25]]);
    expect(announceChange(on, off, (r) => r)).toBe("Retour au mode normal.");
    expect(announceChange(upTo(script, 11000), on, (r) => r)).toBe(
      "Mode allégé : les noms arriveront plus tard.",
    );
  });
  it("un mode allégé annoncé dès READY est tracé", () => {
    resetSeq();
    const s = replay([
      { type: "start", nowMs: 0 },
      { type: "mic_granted", nowMs: 1, keepAvailable: true },
      server(2, ready(0, { degraded: ["overload"] })),
    ]);
    expect(s.degraded?.overloaded).toBe(true);
    expect(s.degLog).toEqual([[0, null]]);
  });
});

describe("connexion coupée puis reprise", () => {
  resetSeq();
  it("le son gardé s'allonge pendant la coupure, plafonné par la mémoire", () => {
    let s = replay(open());
    s = reduce(s, { type: "link_lost", nowMs: 9000 });
    expect(s.link).toBe("lost");
    expect(cutSeconds(reduce(s, { type: "tick", nowMs: 21000 }))).toBe(12);
    expect(cutSeconds(reduce(s, { type: "tick", nowMs: 9000 + 900_000 }))).toBe(
      LIVE_UI.bufferMaxS,
    );
  });
  it("retour : rattrapage en cours, puis connexion normale ; les messages rejoués ne se doublent pas", () => {
    resetSeq();
    const c1 = cand(2, 11, 2);
    let s = replay([...open(), server(8000, c1)]);
    s = reduce(s, { type: "link_lost", nowMs: 9000 });
    s = reduce(s, { type: "link_back", nowMs: 16000, catchupS: 3.4 });
    expect(s.link).toBe("catchup");
    s = reduce(
      s,
      server(16100, ready(0, { resumed: true, last_seq: s.lastSeq })),
    );
    s = reduce(s, server(16200, c1)); // rejeu du même message
    expect(s.trail).toEqual([11]);
    s = reduce(s, { type: "caught_up", nowMs: 20000 });
    expect(s.link).toBe("ok");
    expect(s.phase).toBe("listening");
  });
  it("annonces : connexion perdue, puis rétablie", () => {
    const a = replay(open());
    const lostS = reduce(a, { type: "link_lost", nowMs: 9000 });
    const back = reduce(lostS, {
      type: "link_back",
      nowMs: 12000,
      catchupS: 1,
    });
    expect(announceChange(a, lostS, (r) => r)).toBe(
      "Connexion perdue. L’écoute continue.",
    );
    expect(announceChange(lostS, back, (r) => r)).toBe("Connexion rétablie.");
  });
  it("session expirée : ERROR puis FINAL, ce qui était entendu est conservé", () => {
    resetSeq();
    let s = replay([
      ...open(),
      server(8000, cand(2, 11, 2)),
      server(9000, locked(3, "1:2", 3)),
      server(10000, cont(4, "1:2", "1:3")),
      { type: "link_lost", nowMs: 14000 },
    ]);
    s = reduce(
      s,
      server(
        44000,
        msg({
          schema: "aqr.live/1",
          type: "ERROR",
          seq: 0,
          t: 0,
          code: "session_expired",
          message: "La session est expirée.",
        }),
      ),
    );
    expect(s.phase).toBe("listening");
    s = reduce(s, server(44000, msg({ ...base("FINAL", 4), document: {} })));
    expect(s.phase).toBe("ended");
    expect(s.streamError?.key).toBe("expired");
    expect(counts(s).named).toBe(1);
  });
});

describe("pause, arrêt, fin d'écoute", () => {
  it("pause fige le niveau, reprendre repart ; arrêter passe par 'je termine' puis la fin", () => {
    resetSeq();
    let s = replay(open());
    s = reduce(s, { type: "audio", nowMs: 3000, capturedS: 1.0, level: 0.3 });
    s = reduce(s, { type: "pause", nowMs: 3100 });
    expect(s.phase).toBe("paused");
    expect(s.level).toBe(0);
    s = reduce(s, { type: "audio", nowMs: 4000, capturedS: 9, level: 0.9 });
    expect(s.capturedS).toBe(9); // le micro n'avance pas en pause : l'appelant n'émet plus
    s = reduce(s, { type: "resume", nowMs: 5000 });
    expect(s.phase).toBe("listening");
    s = reduce(s, { type: "stop", nowMs: 6000 });
    expect(s.phase).toBe("ending");
    expect(s.endAtS).toBe(9);
    s = reduce(
      s,
      server(6200, msg({ ...base("FINALIZING", 9), pending_s: null })),
    );
    s = reduce(s, server(7000, msg({ ...base("FINAL", 9), document: {} })));
    expect(s.phase).toBe("ended");
    expect(viewOf(s)).toBe("end");
  });
  it("le verset en cours quand on arrête reste dans la liste, 'interrompu'", () => {
    resetSeq();
    const s = replay([
      ...open(),
      server(8000, cand(2, 11, 2)),
      server(9000, locked(3, "1:2", 3)),
      { type: "stop", nowMs: 9500 },
      server(10000, msg({ ...base("FINAL", 5), document: {} })),
    ]);
    expect(s.lock).toBeNull();
    expect(s.hist[0]).toMatchObject({ ref: "1:2", interrupted: true });
    expect(counts(s).named).toBe(1);
  });
  it("arrêter hors écoute ne fait rien", () => {
    const s = reduce(initialState(), { type: "stop", nowMs: 1 });
    expect(s.phase).toBe("idle");
  });
  it("le ruban garde les 40 dernières barres", () => {
    let s = replay(open());
    for (let i = 0; i < 100; i += 1)
      s = reduce(s, {
        type: "audio",
        nowMs: 3000 + i,
        capturedS: i / 8,
        level: i / 100,
      });
    expect(s.levels).toHaveLength(LIVE_UI.levelBars);
    expect(s.levels[s.levels.length - 1]).toBeCloseTo(0.99);
  });
  it("silence perçu côté client : aide après 8 s sans voix, jamais avant", () => {
    let s = replay(open());
    s = reduce(s, { type: "audio", nowMs: 3000, capturedS: 1, level: 0.5 });
    s = reduce(s, { type: "audio", nowMs: 9000, capturedS: 8.5, level: 0.001 });
    expect(quietHint(s)).toBe(false);
    s = reduce(s, {
      type: "audio",
      nowMs: 10000,
      capturedS: 9.2,
      level: 0.001,
    });
    expect(silenceS(s)).toBeCloseTo(8.2);
    expect(quietHint(s)).toBe(true);
  });
});

describe("mode technique et PARTIAL", () => {
  it("PARTIAL n'entre ni dans la carte ni dans la liste : il alimente seulement partial", () => {
    resetSeq();
    const s = replay([
      ...open(),
      server(3000, msg({ ...base("PARTIAL", 0.4), text: "ق", stable: false })),
    ]);
    expect(s.partial).toEqual({ text: "ق", stable: false });
    expect(viewOf(s)).toBe("listen");
    expect(s.hist).toHaveLength(0);
  });
  it("le journal garde des entrées lisibles, bornées", () => {
    resetSeq();
    let s = replay(open());
    for (let i = 0; i < 80; i += 1)
      s = reduce(s, server(3000 + i, cand(1 + i / 10, 100 - i, 1)));
    expect(s.log.length).toBeLessThanOrEqual(LIVE_UI.logKeep);
    expect(s.log[s.log.length - 1].type).toBe("CANDIDATES");
  });
});

describe("onglet en arrière-plan", () => {
  it("dit qu'un passage n'a peut-être pas été écouté seulement si le micro a cessé d'avancer", () => {
    let s = replay(open());
    s = reduce(s, { type: "audio", nowMs: 3000, capturedS: 10, level: 0.1 });
    s = reduce(s, { type: "visibility", nowMs: 3100, hidden: true });
    s = reduce(s, { type: "visibility", nowMs: 13100, hidden: false });
    expect(s.tabGap).not.toBeNull();
    expect(s.tabGap?.fromS).toBe(10);
    expect(s.tabGap?.lostS).toBeCloseTo(10);
  });
  it("rien à dire si l'écoute a continué normalement", () => {
    let s = replay(open());
    s = reduce(s, { type: "visibility", nowMs: 3000, hidden: true });
    s = reduce(s, { type: "audio", nowMs: 8000, capturedS: 5, level: 0.1 });
    s = reduce(s, { type: "visibility", nowMs: 8100, hidden: false });
    expect(s.tabGap).toBeNull();
  });
});

describe("enregistrement local", () => {
  it("le geste 'garder' ne change que l'état de garde, jamais la liste", () => {
    const s = replay(open());
    const sending = reduce(s, {
      type: "keep",
      keep: { state: "sending", progress: 0.4 },
    });
    expect(sending.keep).toEqual({ state: "sending", progress: 0.4 });
    expect(sending.hist).toEqual(s.hist);
  });
  it("un nouveau départ efface l'état précédent", () => {
    const s = reduce(
      replay([
        ...open(),
        { type: "keep", keep: { state: "queued", sessionId: "x" } },
      ]),
      { type: "start", nowMs: 99 },
    );
    expect(s.keep).toEqual({ state: "idle" });
    expect(s.hist).toEqual([]);
  });
});

describe("annonces sobres", () => {
  it("jamais de nombre de candidats, de mots ni de niveau", () => {
    resetSeq();
    const a = replay(open());
    const b = reduce(a, server(8000, cand(2, 52, 2, { text: "قُلْ" })));
    expect(announceChange(a, b, (r) => r)).toBeNull();
    const c = reduce(b, {
      type: "audio",
      nowMs: 8100,
      capturedS: 3,
      level: 0.9,
    });
    expect(announceChange(b, c, (r) => r)).toBeNull();
  });
  it("démarrage, pause, fin", () => {
    const connecting = replay(open().slice(0, 2));
    const listening = replay(open());
    expect(announceChange(connecting, listening, (r) => r)).toBe(
      "Écoute démarrée.",
    );
    expect(
      announceChange(
        listening,
        reduce(listening, { type: "pause", nowMs: 3000 }),
        (r) => r,
      ),
    ).toBe("Écoute en pause.");
  });
  it("passage entendu non nommé", () => {
    resetSeq();
    const a = replay([...open(), server(8000, cand(2, 12, 2))]);
    const b = reduce(a, server(9000, unresolved(5, 2, ["1:3", "55:1"])));
    expect(announceChange(a, b, (r) => r)).toBe(
      "Passage entendu, non nommé. Ce n’est pas une erreur.",
    );
  });
});

describe("confirmation par le moteur du lot (ADR-0016)", () => {
  const confirmed = (
    t: number,
    span: [number, number],
    items: { ref: string; t: [number, number]; status?: string }[],
  ) =>
    msg({
      ...base("CONFIRMED", t),
      span,
      intervals: items.map((i) => ({
        kind: "verse",
        ref: i.ref,
        words: [1, 4],
        partial: false,
        status: i.status ?? "recognized",
        t: i.t,
        text: "ٱلْحَمْدُ لِلَّهِ",
        translation: TR,
        identity_basis: "words",
      })),
    });

  it("marque confirmée la ligne du direct de même verset, sans la dupliquer", () => {
    resetSeq();
    const script: LiveAction[] = [
      ...open(),
      server(10400, locked(3.5, "1:2", 3)),
      server(11500, cont(5.0, "1:2", "1:3")),
      server(20000, confirmed(14, [0, 12], [{ ref: "1:2", t: [1.0, 4.4] }])),
    ];
    const verses = historyRows(upTo(script, 20000)).filter(
      (r) => r.kind === "verse",
    );
    expect(verses).toHaveLength(1);
    expect(verses[0]).toMatchObject({ ref: "1:2", confirmed: true });
  });

  it("ajoute un verset que le direct n'avait pas nommé, à sa place dans le temps", () => {
    resetSeq();
    const script: LiveAction[] = [
      ...open(),
      server(11500, cont(5.0, "1:2", "1:3")),
      server(18400, cont(10.4, "1:4", "1:5")),
      server(
        30000,
        confirmed(
          20,
          [0, 12],
          [
            { ref: "1:2", t: [1.0, 4.5] },
            { ref: "1:3", t: [5.0, 7.0] },
            { ref: "1:4", t: [6.4, 9.9] },
          ],
        ),
      ),
    ];
    const rows = historyRows(upTo(script, 30000)).filter(
      (r) => r.kind === "verse",
    );
    expect(rows.map((r) => (r.kind === "verse" ? r.ref : ""))).toEqual([
      "1:4",
      "1:3",
      "1:2",
    ]);
    expect(counts(upTo(script, 30000)).named).toBe(3);
  });

  it("remplace un passage non nommé que la confirmation nomme", () => {
    resetSeq();
    const script: LiveAction[] = [
      ...open(),
      server(16000, unresolved(8.0, 2, ["1:3", "55:1"])),
      server(30000, confirmed(20, [0, 12], [{ ref: "1:3", t: [5.0, 7.0] }])),
    ];
    const s = upTo(script, 30000);
    expect(counts(s)).toEqual({ named: 1, unnamed: 0 });
  });

  it("ne touche ni un passage hors du temps confirmé, ni un verset corrigé", () => {
    resetSeq();
    const script: LiveAction[] = [
      ...open(),
      server(16000, unresolved(30.0, 2, ["1:3", "55:1"])),
      server(30000, confirmed(40, [0, 12], [{ ref: "1:3", t: [5.0, 7.0] }])),
    ];
    const s = upTo(script, 30000);
    expect(counts(s)).toEqual({ named: 1, unnamed: 1 });
  });

  it("ne rejoue jamais deux fois le même message numéroté", () => {
    resetSeq();
    const message = confirmed(14, [0, 12], [{ ref: "1:2", t: [1.0, 4.4] }]);
    const once = reduce(upTo([...open()], 0), server(20000, message));
    const twice = reduce(once, server(20100, message));
    expect(twice.hist).toHaveLength(once.hist.length);
  });

  it("retire aussi un passage non nommé quand le verset était déjà nommé par le direct", () => {
    resetSeq();
    const script: LiveAction[] = [
      ...open(),
      server(11500, cont(5.0, "1:2", "1:3")),
      server(16000, unresolved(8.0, 2, ["1:3", "55:1"])),
      server(30000, confirmed(20, [0, 12], [{ ref: "1:2", t: [1.0, 7.0] }])),
    ];
    const s = upTo(script, 30000);
    expect(counts(s)).toEqual({ named: 1, unnamed: 0 });
    expect(historyRows(s).filter((r) => r.kind === "verse")).toHaveLength(1);
  });
});
