import { describe, expect, it } from "vitest";
import { readJson } from "./http";

const post = (body: BodyInit, headers: Record<string, string> = {}) =>
  new Request("http://127.0.0.1/api/x", { method: "POST", body, headers });

describe("readJson borné", () => {
  it("lit un JSON normal, et {} pour un corps vide", async () => {
    expect(await readJson(post('{"a":1}'))).toEqual({ a: 1 });
    expect(await readJson(post(""))).toEqual({});
  });
  it("JSON illisible : undefined", async () => {
    expect(await readJson(post("{pas du json"))).toBeUndefined();
  });
  it("corps au-delà de la limite : undefined, sans tout lire en mémoire", async () => {
    const big = "x".repeat(300);
    expect(await readJson(post(`"${big}"`), 100)).toBeUndefined();
    // flux sans Content-Length : la lecture s'arrête dès la limite franchie
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new TextEncoder().encode("y".repeat(64)));
        if (pulled > 1000) controller.close();
      },
    });
    const request = new Request("http://127.0.0.1/api/x", {
      method: "POST",
      body: stream,
      // @ts-expect-error requis par Node pour un corps en flux
      duplex: "half",
    });
    expect(await readJson(request, 256)).toBeUndefined();
    expect(pulled).toBeLessThan(20);
  });
});
