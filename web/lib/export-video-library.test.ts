import { describe, expect, it } from "vitest";
import { stableJson, videoKey } from "./export-video-library";

describe("stableJson", () => {
  it("ne dépend pas de l'ordre des clés", () => {
    expect(stableJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(
      stableJson({ a: [2, { c: 2, d: 1 }], b: 1 }),
    );
  });
  it("ignore les valeurs indéfinies", () => {
    expect(stableJson({ a: 1, b: undefined })).toBe(stableJson({ a: 1 }));
  });
});

describe("videoKey", () => {
  it("donne la même empreinte pour les mêmes réglages et une autre sinon", async () => {
    const a = await videoKey({ fps: 30, range: [0, 10], t: "x" });
    expect(a).toMatch(/^[0-9a-f]{40}$/);
    expect(await videoKey({ t: "x", range: [0, 10], fps: 30 })).toBe(a);
    expect(await videoKey({ fps: 60, range: [0, 10], t: "x" })).not.toBe(a);
    expect(await videoKey({ fps: 30, range: [0, 11], t: "x" })).not.toBe(a);
  });
});
