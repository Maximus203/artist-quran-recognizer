import { describe, expect, it } from "vitest";
import { parseServerMessage } from "./live-protocol";

const base = { schema: "aqr.live/1", seq: 3, t: 1.5 };

describe("parseServerMessage", () => {
  it("accepte un CANDIDATES réel, champs inconnus compris", () => {
    const parsed = parseServerMessage(
      JSON.stringify({
        ...base,
        type: "CANDIDATES",
        state: "ambiguous",
        span: [0.2, 0.65],
        words_heard: 1,
        count: 274,
        heard: { words: [1, 1] },
        items: [{ ref: "13:16", posterior: 0.0061, class: "start" }],
        leader: { ref: "13:16", posterior: 0.0061, basis: "words" },
        champ_futur: 1,
      }),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.message.type === "CANDIDATES") {
      expect(parsed.message.count).toBe(274);
      expect(parsed.message.heard?.text).toBeUndefined();
    }
  });

  it("accepte le READY réel du service, qui ne porte pas de t (docs/LIVE-PROTOCOL.md §4)", () => {
    const parsed = parseServerMessage(
      '{"schema":"aqr.live/1","type":"READY","seq":0,"session_id":"c0ZxUo2m3VnJ8pQ0yH4d1A","resumed":false,"last_seq":0,"replay_from":null,"audio_received_s":0.0,"audio_received_samples":0,"degraded":[],"technical":false,"resume_ttl_s":30.0,"limits":{"max_block_bytes":32000}}',
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.message.type === "READY") {
      expect(parsed.message.t).toBe(0);
      expect(parsed.message.resume_ttl_s).toBe(30);
    }
    const error = parseServerMessage(
      '{"schema":"aqr.live/1","type":"ERROR","seq":0,"code":"server_busy","message":"Le service est complet.","recoverable":true,"retry_after_s":5}',
    );
    expect(error.ok).toBe(true);
  });

  it("accepte un LOCKED inferred et un passage clos non nommé", () => {
    const locked = parseServerMessage({
      ...base,
      type: "LOCKED",
      interval: {
        kind: "verse",
        ref: "56:74",
        words: [1, 4],
        partial: false,
        status: "inferred",
        t: [0.2, null],
        text: "فَسَبِّحْ",
        translation: null,
        identity_basis: "context",
        words_heard: 2,
      },
    });
    expect(locked.ok).toBe(true);
    const closed = parseServerMessage({
      ...base,
      type: "CONTINUE",
      closed: {
        kind: "verse",
        ref: "1:3",
        words: [1, 2],
        status: "uncertain",
        t: [10.4, 12.4],
        candidates: ["1:3", "55:1"],
        candidate_count: 14,
        text: null,
        translation: null,
      },
      complete: false,
      expected: null,
    });
    expect(closed.ok).toBe(true);
  });

  it("écarte un message sans schéma exact, de type inconnu ou mal formé", () => {
    expect(parseServerMessage("pas du json")).toEqual({
      ok: false,
      reason: "not_json",
    });
    expect(parseServerMessage({ ...base, type: "SURPRISE" })).toEqual({
      ok: false,
      reason: "unknown_type",
    });
    expect(
      parseServerMessage({ ...base, schema: "aqr.live/2", type: "LOST" }),
    ).toEqual({ ok: false, reason: "malformed" });
    expect(
      parseServerMessage({ ...base, type: "PROGRESS", ref: "1:2" }),
    ).toEqual({ ok: false, reason: "malformed" });
    expect(parseServerMessage('{"type":"__proto__"}')).toEqual({
      ok: false,
      reason: "unknown_type",
    });
  });

  it("tolère un motif de JUMP ou de LOST inconnu sans inventer de sens", () => {
    const jump = parseServerMessage({ ...base, type: "JUMP", kind: "nouveau" });
    expect(jump.ok && jump.message.type === "JUMP" && jump.message.kind).toBe(
      "skip",
    );
    const lost = parseServerMessage({ ...base, type: "LOST", reason: "autre" });
    expect(lost.ok && lost.message.type === "LOST" && lost.message.reason).toBe(
      "no_candidate",
    );
  });
});
