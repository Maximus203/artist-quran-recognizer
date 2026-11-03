import { describe, expect, it } from "vitest";
import { applyRenderState, type VideoJob } from "./video-jobs";

const job = (extra: Partial<VideoJob> = {}) =>
  ({
    ratio: 0,
    progress: "",
    files_done: 0,
    files_total: null,
    ...extra,
  }) as VideoJob;

describe("progression d'un job vidéo", () => {
  it("sans préparation, la barre suit le rendu tel quel", () => {
    const j = job();
    applyRenderState(j, { ratio: 0.4 });
    expect(j.ratio).toBeCloseTo(0.4);
  });

  it("après la préparation de la copie, le rendu occupe le reste de la barre sans jamais reculer", () => {
    const j = job({ prepare_share: 0.3, ratio: 0.3 });
    applyRenderState(j, { ratio: 0 });
    expect(j.ratio).toBeCloseTo(0.3);
    applyRenderState(j, { ratio: 0.5 });
    expect(j.ratio).toBeCloseTo(0.65);
    applyRenderState(j, { ratio: 1 });
    expect(j.ratio).toBeCloseTo(1);
  });
});
