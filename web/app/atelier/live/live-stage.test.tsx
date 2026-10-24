import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ServerMessage } from "../../../lib/live-protocol";
import {
  initialState,
  reduce,
  type LiveAction,
  type LiveState,
} from "../../../lib/live-store";
import { Stage } from "./live-stage";

/**
 * Ce que la carte « Passage en cours » rend pour chaque état du réducteur : les règles d'honnêteté
 * (I1, I3) vérifiées sur le HTML lui-même, pas seulement sur l'état. Les « mots » sont des lettres latines
 * (le découpage ne regarde que les lettres) : aucun texte coranique dans les tests.
 */
const msg = (m: Record<string, unknown>) =>
  ({ schema: "aqr.live/1", t: 0, ...m }) as unknown as ServerMessage;
const server = (nowMs: number, message: ServerMessage): LiveAction => ({
  type: "server",
  nowMs,
  message,
});
const TR = {
  text: "Louange à Allah[1], Seigneur des mondes.",
  translation_id: "french_hameedullah",
  version: "quranenc.com",
  attribution: "QuranEnc.com — Hamidullah",
  scope: "verse",
};
const open = (): LiveAction[] => [
  { type: "start", nowMs: 0 },
  { type: "mic_granted", nowMs: 1, keepAvailable: true },
  server(
    2,
    msg({
      type: "READY",
      seq: 0,
      session_id: "S",
      resumed: false,
      last_seq: 0,
      audio_received_samples: 0,
      degraded: [],
      technical: false,
      resume_ttl_s: 30,
    }),
  ),
];
const cands = (
  seq: number,
  count: number,
  extra: Record<string, unknown> = {},
) =>
  server(
    1000 + seq,
    msg({
      type: "CANDIDATES",
      seq,
      words_heard: 2,
      count,
      heard: { words: [1, 2], ...extra },
      items: [{ ref: "1:2" }, { ref: "6:1" }],
      leader: null,
    }),
  );
const locked = (status: "recognized" | "inferred", words = 3) =>
  server(
    3000,
    msg({
      type: "LOCKED",
      seq: 20,
      interval: {
        kind: "verse",
        ref: "1:2",
        words: [1, 4],
        partial: false,
        status,
        t: [1, null],
        text: "alpha beta gamma delta",
        translation: status === "recognized" ? TR : null,
        identity_basis: status === "recognized" ? "words" : "context",
        words_heard: words,
      },
    }),
  );
const run = (...actions: LiveAction[]): LiveState =>
  [...open(), ...actions].reduce(reduce, initialState());
const html = (state: LiveState) =>
  renderToStaticMarkup(
    <Stage
      state={state}
      fontTools={null}
      showTranslation={true}
      retryIn={null}
      onStart={() => {}}
    />,
  );
const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/&#x27;/g, "'");

describe("carte : écoute et candidats", () => {
  it("écoute : aucune donnée coranique, aucune référence", () => {
    const out = html(run());
    expect(out).toContain('data-view="listen"');
    expect(text(out)).toContain("Je t’écoute.");
    expect(out).not.toContain('lang="ar"');
    expect(out).not.toContain("live-ref");
  });

  it("candidats : le nombre, les mots communs du corpus, jamais un nom ni une traduction d'un candidat non nommé", () => {
    const out = html(run(cands(1, 52, { text: "alpha beta" })));
    expect(out).toContain('data-view="cands"');
    expect(out).toContain(">52<");
    expect(text(out)).toContain("versets possibles");
    expect(text(out)).toContain("Pas encore nommé");
    expect(out).toContain("alpha beta");
    expect(out).not.toContain("live-ref");
    expect(out).not.toContain("Traduction");
    // Les références ne vivent que dans le volet fermé, sans texte.
    expect(out).toMatch(
      /<details class="pistes"><summary>Voir les pistes \(2 sur 52\)/,
    );
  });

  it("sans mots communs : le dit, et ne montre aucun texte de substitution", () => {
    const out = html(run(cands(1, 274)));
    expect(text(out)).toContain("Rien de commun à montrer encore.");
    expect(out).not.toMatch(/class="w"/);
  });

  it("traduction commune des sosies : entière, étiquetée, avec son attribution (I2)", () => {
    const out = html(run(cands(1, 3, { text: "alpha beta", translation: TR })));
    expect(text(out)).toContain(
      "Traduction : la même pour les 3 versets possibles",
    );
    expect(text(out)).toContain("QuranEnc.com — Hamidullah");
    expect(out).toContain("<sup>[1]</sup>");
  });

  it("patience : rien avant 6 s, puis les trois phrases", () => {
    const base = [cands(1, 214)];
    const at = (ms: number) =>
      html(run(...base, { type: "tick", nowMs: 1001 + ms }));
    expect(at(5_000)).not.toContain("live-patience");
    expect(text(at(6_000))).toContain("quelques mots de plus");
    expect(text(at(12_000))).toContain("C’est plus long que d’habitude");
    expect(text(at(21_000))).toContain("Toujours pas départagé");
    expect(at(21_000)).toContain('data-stage="3"');
  });
});

describe("carte : verset nommé", () => {
  it("reconnu : mots entendus en encre pleine, dernier mot marqué, à venir en gris, traduction entière", () => {
    const out = html(run(locked("recognized", 3)));
    expect(out).toContain('data-view="named"');
    expect(text(out)).toContain("Reconnu");
    expect(out.match(/class="w on"/g)).toHaveLength(1);
    expect(out.match(/class="w next"/g)).toHaveLength(1);
    expect(text(out)).toContain("3 / 4 mots entendus");
    expect(text(out)).toContain("Louange à Allah");
    expect(text(out)).toContain("french_hameedullah");
    expect(out).toContain("<sup>[1]</sup>");
  });

  it("tous les mots entendus : plus aucun mot grisé", () => {
    const out = html(run(locked("recognized", 4)));
    expect(out).not.toContain('class="w next"');
  });

  it("déduit de la position : jamais le mot « Reconnu », et l'explication", () => {
    const out = html(run(locked("inferred", 2)));
    expect(out).toContain('data-view="inferred"');
    expect(text(out)).toContain("Déduit de la position");
    expect(text(out)).toContain("Entendu, mais pas reconnu à la voix");
    expect(out).not.toMatch(/>Reconnu</);
    expect(out).toContain("ref--ded");
  });

  it("un texte qui ne s'aligne pas sur la plage : le dit, sans surlignage inventé", () => {
    const state = run(
      server(
        3000,
        msg({
          type: "LOCKED",
          seq: 20,
          interval: {
            kind: "verse",
            ref: "1:2",
            words: [1, 9],
            status: "recognized",
            t: [1, null],
            text: "alpha beta",
            translation: null,
            words_heard: 1,
          },
        }),
      ),
    );
    const out = html(state);
    expect(text(out)).toContain("Suivi mot à mot indisponible");
    expect(out).not.toContain('class="w on"');
    expect(out).not.toContain('class="w next"');
  });
});

describe("carte : passage non nommé, saut, parole, entre deux versets", () => {
  const unresolved = server(
    5000,
    msg({
      type: "CONTINUE",
      seq: 30,
      closed: {
        kind: "verse",
        ref: "1:3",
        words: [1, 2],
        status: "uncertain",
        t: [2, 4],
        candidates: ["1:3", "55:1"],
        candidate_count: 14,
        text: null,
        translation: null,
      },
      complete: false,
      expected: null,
    }),
  );

  it("« pas de verset nommé » : état normal, rédigé pour rassurer, sans texte propre", () => {
    const out = html(run(cands(1, 14), unresolved));
    expect(out).toContain('data-view="unres"');
    expect(text(out)).toContain("Pas de verset nommé pour l’instant");
    expect(text(out)).toContain("Ce n’est pas une erreur.");
    expect(out).not.toContain("live-ref");
  });

  it("un saut ne nomme rien", () => {
    const out = html(
      run(
        server(
          6000,
          msg({ type: "JUMP", seq: 40, from: "1:2", kind: "other_surah" }),
        ),
      ),
    );
    expect(out).toContain('data-view="jump"');
    expect(text(out)).toContain("Le passage change");
    expect(out).not.toContain("live-ref");
  });

  it("parole non coranique : aucune récitation, rien d'arabe", () => {
    const out = html(
      run(server(6000, msg({ type: "LOST", seq: 41, reason: "non_quran" }))),
    );
    expect(text(out)).toContain("Ce n’est pas une récitation");
    expect(out).not.toContain('lang="ar"');
  });

  it("verset terminé : atténué, avec la suite attendue « pas encore confirmée »", () => {
    const out = html(
      run(
        locked("recognized"),
        server(
          7000,
          msg({
            type: "CONTINUE",
            seq: 50,
            closed: {
              kind: "verse",
              ref: "1:2",
              words: [1, 4],
              status: "recognized",
              t: [1, 4],
              text: "alpha beta gamma delta",
              translation: TR,
            },
            complete: true,
            expected: { ref: "1:3" },
          }),
        ),
      ),
    );
    expect(out).toContain('data-view="between"');
    expect(text(out)).toContain("Suite attendue : 1:3 (pas encore confirmée)");
    expect(out).toContain("pass--dim");
  });

  it("un verset corrigé n'est plus affiché comme sûr : plus de texte", () => {
    const out = html(
      run(
        locked("recognized"),
        server(
          7000,
          msg({
            type: "CONTINUE",
            seq: 50,
            closed: {
              kind: "verse",
              ref: "1:2",
              words: [1, 4],
              status: "recognized",
              t: [1, 4],
              text: "alpha beta gamma delta",
              translation: TR,
            },
            complete: true,
            expected: { ref: "1:3" },
          }),
        ),
        server(
          8000,
          msg({ type: "REVISION", seq: 60, ref: "1:2", status: "retracted" }),
        ),
      ),
    );
    expect(text(out)).toContain("Corrigé");
    expect(out).not.toContain("alpha beta");
    expect(out).not.toContain("Louange");
  });
});

describe("carte : accueil et attente", () => {
  it("l'accueil promet l'attente, dit où va le son, et donne la légende à quatre états", () => {
    const out = html(initialState());
    const t = text(out);
    expect(out).toContain('data-view="idle"');
    expect(t).toContain("Compte environ 5 secondes");
    expect(t).toContain("Le micro ne s’ouvre qu’au clic");
    expect(t).toContain("Le son n’est pas conservé sur le serveur");
    for (const label of [
      "Candidats",
      "Reconnu",
      "Déduit de la position",
      "Pas de verset nommé",
    ])
      expect(t).toContain(label);
    expect(out).not.toContain("Déduit · non entendu");
  });

  it("autorisation du micro puis connexion : sans minuterie, avec leurs étapes", () => {
    const perm = html(reduce(initialState(), { type: "start", nowMs: 0 }));
    expect(text(perm)).toContain("Autorise le micro");
    expect(text(perm)).toContain("Étape 1 sur 2");
    const steps: LiveAction[] = [
      { type: "start", nowMs: 0 },
      { type: "mic_granted", nowMs: 1, keepAvailable: true },
    ];
    const conn = html(steps.reduce(reduce, initialState()));
    expect(text(conn)).toContain("Étape 2 sur 2");
  });
});
