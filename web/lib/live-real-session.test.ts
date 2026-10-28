import { describe, expect, it } from "vitest";
import session from "./__fixtures__/live-session-fatiha.json";
import { parseServerMessage, type ServerMessage } from "./live-protocol";
import {
  counts,
  historyRows,
  initialState,
  reduce,
  viewOf,
  type LiveAction,
} from "./live-store";

/**
 * Contrat avec le VRAI service : `__fixtures__/live-session-fatiha.json` est une écoute réelle (Al-Fatiha,
 * récitation EveryAyah, navigateur Chrome, service `aqr live-serve` avec le vrai modèle), enregistrée par
 * `e2e/live-browser.mjs`. Les textes arabes et les traductions y sont remplacés par du remplissage (aucun
 * texte coranique dans les fixtures) ; tout le reste est tel que le service l'a émis. Ce test a une raison :
 * le premier `READY` réel ne portait pas de `t`, ce que les messages écrits à la main ne montraient pas.
 */
const raws = (session.messages as unknown[]).map((m) => JSON.stringify(m));

describe("écoute réelle rejouée", () => {
  it("tous les messages réels sont reconnus par le validateur", () => {
    for (const raw of raws) {
      const parsed = parseServerMessage(raw);
      expect(parsed.ok, raw.slice(0, 120)).toBe(true);
    }
  });

  it("le réducteur en tire l'écran attendu : noms, passages non nommés, trou, basmala, fin", () => {
    const messages = raws.map((raw) => {
      const parsed = parseServerMessage(raw);
      if (!parsed.ok) throw new Error("message illisible");
      return parsed.message as ServerMessage;
    });
    const actions: LiveAction[] = [
      { type: "start", nowMs: 0 },
      { type: "mic_granted", nowMs: 500, keepAvailable: true },
      ...messages.map(
        (message, i): LiveAction => ({
          type: "server",
          nowMs: 1000 + i * 700,
          message,
        }),
      ),
    ];
    const state = actions.reduce(reduce, initialState());
    expect(state.phase).toBe("ended");
    expect(viewOf(state)).toBe("end");
    expect(state.lastSeq).toBe(Math.max(...messages.map((m) => m.seq)));

    const closed = messages.filter((m) => m.type === "CONTINUE");
    const named = closed.filter((m) => m.closed.status !== "uncertain").length;
    const unnamed = closed.filter(
      (m) => m.closed.status === "uncertain",
    ).length;
    expect(counts(state)).toEqual({ named, unnamed });
    expect(named).toBeGreaterThan(0);

    const rows = historyRows(state);
    expect(rows.filter((r) => r.kind === "basmala")).toHaveLength(
      messages.filter((m) => m.type === "BASMALA").length,
    );
    // I3 : un passage non nommé ne porte jamais de texte propre.
    for (const row of rows) {
      if (row.kind === "unres") {
        expect(row.candidates.length).toBeGreaterThan(0);
        expect(JSON.stringify(row)).not.toMatch(/"text"/);
      }
    }
    // Aucun nom de verset inventé : chaque verset de la liste vient d'un CONTINUE du service.
    const refs = new Set(closed.map((m) => m.closed.ref));
    for (const row of rows)
      if (row.kind === "verse") expect(refs.has(row.ref)).toBe(true);
    expect(state.streamError).toBeNull();
  });

  it("rejouer deux fois la même écoute donne le même état", () => {
    const run = () =>
      raws
        .map((raw) => {
          const parsed = parseServerMessage(raw);
          if (!parsed.ok) throw new Error("message illisible");
          return parsed.message;
        })
        .map(
          (message, i): LiveAction => ({
            type: "server",
            nowMs: 1000 + i * 700,
            message,
          }),
        )
        .reduce(
          reduce,
          reduce(reduce(initialState(), { type: "start", nowMs: 0 }), {
            type: "mic_granted",
            nowMs: 1,
            keepAvailable: false,
          }),
        );
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });
});
