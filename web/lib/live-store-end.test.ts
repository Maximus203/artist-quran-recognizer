import { describe, expect, it } from "vitest";
import type { ServerMessage } from "./live-protocol";
import {
  counts,
  initialState,
  reduce,
  type LiveAction,
  type LiveState,
} from "./live-store";

const msg = (m: Record<string, unknown>) =>
  ({ schema: "aqr.live/1", t: 0, ...m }) as unknown as ServerMessage;
const server = (nowMs: number, message: ServerMessage): LiveAction => ({
  type: "server",
  nowMs,
  message,
});
const replay = (actions: LiveAction[], from: LiveState = initialState()) =>
  actions.reduce(reduce, from);
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
const locked = server(
  9000,
  msg({
    type: "LOCKED",
    seq: 1,
    t: 3,
    interval: {
      kind: "verse",
      ref: "1:2",
      words: [1, 4],
      status: "recognized",
      t: [1, null],
      text: "ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَـٰلَمِينَ",
      translation: null,
      identity_basis: "words",
      words_heard: 3,
    },
  }),
);

describe("fin décidée côté client", () => {
  it("garde ce qui était entendu, dit la raison, et referme le verset resté ouvert", () => {
    const s = replay([
      ...open(),
      locked,
      { type: "link_lost", nowMs: 10000 },
      {
        type: "finish",
        nowMs: 50000,
        error: { key: "expired", message: "" },
      },
    ]);
    expect(s.phase).toBe("ended");
    expect(s.streamError?.key).toBe("expired");
    expect(s.link).toBe("ok");
    expect(s.hist[0]).toMatchObject({ ref: "1:2", interrupted: true });
    expect(counts(s).named).toBe(1);
  });

  it("sans erreur : simple fin locale quand FINAL n'arrive pas", () => {
    const s = replay([...open(), { type: "finish", nowMs: 5000 }]);
    expect(s.phase).toBe("ended");
    expect(s.streamError).toBeNull();
  });
});
