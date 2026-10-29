import { describe, expect, it } from "vitest";
import { EXPORT_VIDEO_CONFIG } from "./export-video-config";
import { h264Bitrate } from "./export-video-codecs";
import {
  estimateVideoMegabytes,
  tierOf,
  VIDEO_QUALITY_TIERS,
} from "./export-video-format";
import {
  megabytesFr,
  rangesWeight,
  renderTimeFr,
  weightLevel,
} from "./export-video-weight";

const HD = { width: 1920, height: 1080 };

describe("paliers de qualité", () => {
  it("proposent cinq paliers, le standard étant 1080p à 30 im/s", () => {
    expect(VIDEO_QUALITY_TIERS.map((t) => [t.resolution, t.fps])).toEqual([
      [720, 30],
      [1080, 30],
      [1080, 60],
      [1440, 30],
      [2160, 60],
    ]);
    expect(tierOf(1080, 30)?.id).toBe("standard");
    expect(tierOf(480, 60)).toBeNull();
  });
});

describe("poids estimé", () => {
  it("est calculé plage par plage puis sommé (même formule que le rendu)", () => {
    const one = estimateVideoMegabytes(h264Bitrate(1920, 1080, 30), 10);
    const w = rangesWeight(HD, 30, [10, 10, 10]);
    expect(w.totalMb).toBeCloseTo(one * 3, 9);
    expect(w.maxFileMb).toBeCloseTo(one, 9);
  });
  it("aucune plage : zéro", () => {
    expect(rangesWeight(HD, 30, [])).toEqual({ totalMb: 0, maxFileMb: 0 });
  });
  it("s'écrit en Mo ou en Go, à la française", () => {
    expect(megabytesFr(81.4)).toBe("81 Mo");
    expect(megabytesFr(3.44)).toBe("3,4 Mo");
    expect(megabytesFr(2900)).toBe("2,9 Go");
  });
});

describe("niveau de poids : seuils lus dans la configuration", () => {
  const L = EXPORT_VIDEO_CONFIG.weight;
  const q = { resolution: 1080, fps: 30 };
  it("léger sous le seuil d'alerte", () => {
    expect(weightLevel({ totalMb: L.warnMb - 1, maxFileMb: 10 }, q)).toBe("ok");
  });
  it("lourd au-dessus du seuil d'alerte, et toujours en 2160p à 60 im/s", () => {
    expect(weightLevel({ totalMb: L.warnMb + 1, maxFileMb: 10 }, q)).toBe(
      "warn",
    );
    expect(
      weightLevel({ totalMb: 5, maxFileMb: 5 }, { resolution: 2160, fps: 60 }),
    ).toBe("warn");
  });
  it("très lourd au-delà du total ou d'un fichier trop gros", () => {
    expect(weightLevel({ totalMb: L.dangerMb + 1, maxFileMb: 10 }, q)).toBe(
      "danger",
    );
    expect(
      weightLevel(
        { totalMb: L.fileDangerMb + 1, maxFileMb: L.fileDangerMb + 1 },
        q,
      ),
    ).toBe("danger");
  });
  it("accepte des seuils injectés (calibrage futur)", () => {
    expect(
      weightLevel({ totalMb: 20, maxFileMb: 20 }, q, {
        ...L,
        warnMb: 10,
      }),
    ).toBe("warn");
  });
});

describe("temps de rendu", () => {
  it("≈ moitié de la durée à 30 im/s jusqu'en 1080p", () => {
    expect(renderTimeFr(126, { resolution: 1080, fps: 30 })).toBe(
      "≈ 1 min 3 s",
    );
  });
  it("« plus de » quand rien ne le mesure encore (60 im/s, ≥ 1440p)", () => {
    expect(renderTimeFr(126, { resolution: 1080, fps: 60 })).toBe(
      "plus de 1 min 3 s",
    );
    expect(renderTimeFr(126, { resolution: 1440, fps: 30 })).toBe(
      "plus de 1 min 3 s",
    );
  });
});
