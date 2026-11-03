import { describe, expect, it } from "vitest";
import {
  SAME_DURATION_TOLERANCE_S,
  backgroundVideoTimeAt,
  clampBackgroundOffset,
  describeFit,
  fitSituation,
  loopSeams,
  maxBackgroundOffset,
  vtime,
} from "./export-video-vtime";

const input = (
  over: Partial<Parameters<typeof vtime>[1]> = {},
): Parameters<typeof vtime>[1] => ({
  videoDuration: 10,
  audioDuration: 25,
  offset: 0,
  mode: "loop",
  ...over,
});

describe("fitSituation", () => {
  it("distingue plus courte, plus longue et même durée", () => {
    expect(fitSituation(10, 25)).toBe("shorter");
    expect(fitSituation(40, 25)).toBe("longer");
    expect(fitSituation(25, 25)).toBe("same");
    expect(fitSituation(25 + SAME_DURATION_TOLERANCE_S, 25)).toBe("same");
    expect(fitSituation(25 + SAME_DURATION_TOLERANCE_S + 0.01, 25)).toBe(
      "longer",
    );
  });

  it("durée inconnue, nulle ou absurde : situation inconnue", () => {
    for (const bad of [0, -3, Number.NaN, Infinity]) {
      expect(fitSituation(bad, 25)).toBe("unknown");
      expect(fitSituation(10, bad)).toBe("unknown");
    }
  });
});

describe("vtime — vidéo plus courte", () => {
  it("boucle : recommence à zéro à chaque tour", () => {
    const o = input({ mode: "loop" });
    expect(vtime(0, o)).toBe(0);
    expect(vtime(4, o)).toBe(4);
    expect(vtime(10, o)).toBe(0);
    expect(vtime(23, o)).toBeCloseTo(3, 9);
  });

  it("aller-retour : avance puis recule", () => {
    const o = input({ mode: "pingpong" });
    expect(vtime(4, o)).toBe(4);
    expect(vtime(10, o)).toBe(10);
    expect(vtime(13, o)).toBeCloseTo(7, 9);
    expect(vtime(20, o)).toBeCloseTo(0, 9);
    expect(vtime(24, o)).toBeCloseTo(4, 9);
  });

  it("figé : reste sur la dernière image", () => {
    const o = input({ mode: "freeze" });
    expect(vtime(4, o)).toBe(4);
    expect(vtime(10, o)).toBe(10);
    expect(vtime(24, o)).toBe(10);
  });

  it("ralenti : étire la vidéo sur toute la récitation", () => {
    const o = input({ mode: "slow" });
    expect(vtime(0, o)).toBe(0);
    expect(vtime(12.5, o)).toBeCloseTo(5, 9);
    expect(vtime(25, o)).toBeCloseTo(10, 9);
  });

  it("ignore le départ quand la vidéo est plus courte", () => {
    expect(vtime(4, input({ offset: 7 }))).toBe(4);
  });
});

describe("vtime — vidéo plus longue ou de même durée", () => {
  it("plus longue : portion à partir du départ", () => {
    const o = input({ videoDuration: 60, audioDuration: 25, offset: 12 });
    expect(vtime(0, o)).toBe(12);
    expect(vtime(5, o)).toBe(17);
    expect(vtime(25, o)).toBe(37);
  });

  it("plus longue : le départ est borné pour que la portion tienne dans la vidéo", () => {
    const o = input({ videoDuration: 60, audioDuration: 25, offset: 500 });
    expect(vtime(0, o)).toBe(35);
    expect(vtime(25, o)).toBe(60);
    expect(vtime(-5, o)).toBe(35);
    expect(vtime(0, { ...o, offset: -4 })).toBe(0);
  });

  it("plus longue : le mode (boucle, ralenti…) ne change rien", () => {
    for (const mode of ["loop", "pingpong", "freeze", "slow"] as const)
      expect(vtime(5, input({ videoDuration: 60, offset: 3, mode }))).toBe(8);
  });

  it("même durée : suit la récitation, sans dépasser la vidéo", () => {
    const o = input({ videoDuration: 25, audioDuration: 25.1, offset: 9 });
    expect(vtime(7, o)).toBe(7);
    expect(vtime(25.1, o)).toBe(25);
  });
});

describe("vtime — cas limites", () => {
  it("vidéo de durée 0, négative, inconnue : image du début", () => {
    for (const videoDuration of [0, -1, Number.NaN, Infinity, 0.05])
      expect(vtime(12, input({ videoDuration }))).toBe(0);
  });

  it("récitation de durée inconnue : suit le temps, borné à la vidéo", () => {
    expect(vtime(4, input({ audioDuration: 0 }))).toBe(4);
    expect(vtime(40, input({ audioDuration: Number.NaN }))).toBe(10);
  });

  it("récitation plus courte qu'une seconde", () => {
    const longer = input({ videoDuration: 8, audioDuration: 0.6, offset: 2 });
    expect(vtime(0.3, longer)).toBeCloseTo(2.3, 9);
    const shorter = input({ videoDuration: 0.4, audioDuration: 0.9 });
    expect(vtime(0.7, shorter)).toBeCloseTo(0.3, 9);
  });

  it("instant négatif ou invalide : début", () => {
    expect(vtime(-3, input())).toBe(0);
    expect(vtime(Number.NaN, input())).toBe(0);
  });

  it("ne sort jamais de [0, durée de la vidéo]", () => {
    for (const mode of ["loop", "pingpong", "freeze", "slow"] as const)
      for (let t = -2; t < 80; t += 0.37) {
        const v = vtime(t, input({ mode }));
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(10);
      }
  });
});

describe("backgroundVideoTimeAt (une plage = une vidéo exportée)", () => {
  const clip = (
    over: Partial<Parameters<typeof backgroundVideoTimeAt>[0]> = {},
  ) =>
    backgroundVideoTimeAt({
      clip: true,
      t: 100,
      rangeStart: 100,
      rangeLength: 25,
      videoDuration: 60,
      offset: 12,
      mode: "loop",
      ...over,
    });

  it("la vidéo d'origine de la session suit le temps de la récitation", () => {
    expect(clip({ clip: false, t: 133.5 })).toBe(133.5);
  });

  it("une vidéo de fond compte depuis le début de CHAQUE vidéo exportée", () => {
    expect(clip({ t: 100 })).toBe(12);
    expect(clip({ t: 105 })).toBe(17);
    expect(clip({ t: 125 })).toBe(37);
    // Autre plage, même départ : la vidéo repart de la même image.
    expect(clip({ rangeStart: 400, t: 400 })).toBe(12);
  });

  it("le même départ vaut pour toutes les plages, borné selon la durée de chacune", () => {
    expect(clip({ rangeLength: 40, t: 100 })).toBe(12);
    expect(clip({ rangeLength: 55, t: 100 })).toBe(5);
  });

  it("vidéo plus courte : la boucle recommence à chaque plage", () => {
    const short = { videoDuration: 10, rangeLength: 25, offset: 7 };
    expect(clip({ ...short, t: 113 })).toBeCloseTo(3, 9);
    expect(clip({ ...short, rangeStart: 300, t: 313 })).toBeCloseTo(3, 9);
  });

  it("temps avant le début de la plage ou durée inconnue : première image", () => {
    expect(clip({ t: 90 })).toBe(12);
    expect(clip({ videoDuration: 0 })).toBe(0);
    // Durée de la plage inconnue : la vidéo suit le temps depuis son début.
    expect(clip({ rangeLength: 0, t: 103 })).toBe(3);
  });
});

describe("départ du fond vidéo", () => {
  it("le maximum est la marge entre la vidéo et la récitation", () => {
    expect(maxBackgroundOffset(60, 25)).toBe(35);
    expect(maxBackgroundOffset(10, 25)).toBe(0);
    expect(maxBackgroundOffset(0, 25)).toBe(0);
    expect(maxBackgroundOffset(60, 0)).toBe(0);
  });

  it("borne un départ choisi", () => {
    expect(clampBackgroundOffset(99, 60, 25)).toBe(35);
    expect(clampBackgroundOffset(-5, 60, 25)).toBe(0);
    expect(clampBackgroundOffset(Number.NaN, 60, 25)).toBe(0);
    expect(clampBackgroundOffset(12, 60, 25)).toBe(12);
  });
});

describe("describeFit", () => {
  it("plus courte, en boucle : le dit en clair avec le nombre de tours", () => {
    const d = describeFit(input({ videoDuration: 12, audioDuration: 30 }));
    expect(d.situation).toBe("shorter");
    expect(d.repeats).toBe(2.5);
    expect(d.text).toContain("plus courte");
    expect(d.text).toContain("recommence toute seule");
    expect(d.text).toContain("environ 2,5 fois");
  });

  it("arrondit le nombre de tours de façon lisible", () => {
    expect(
      describeFit(input({ videoDuration: 10, audioDuration: 13 })).text,
    ).toContain("environ 1,3 fois");
    expect(
      describeFit(input({ videoDuration: 10, audioDuration: 31 })).text,
    ).toContain("environ 3 fois");
    expect(
      describeFit(input({ videoDuration: 1, audioDuration: 120 })).text,
    ).toContain("environ 120 fois");
  });

  it("dit ce que fait chaque choix quand la vidéo est plus courte", () => {
    const base = { videoDuration: 10, audioDuration: 25 };
    expect(describeFit(input({ ...base, mode: "pingpong" })).text).toMatch(
      /aller-retour|va et vient/,
    );
    expect(describeFit(input({ ...base, mode: "freeze" })).text).toContain(
      "dernière image",
    );
    const slow = describeFit(input({ ...base, mode: "slow" }));
    expect(slow.text).toContain("ralentie");
    expect(slow.text).toContain("40 %");
  });

  it("plus longue : donne la portion gardée", () => {
    const d = describeFit(
      input({ videoDuration: 60, audioDuration: 25, offset: 12 }),
    );
    expect(d.situation).toBe("longer");
    expect(d.from).toBe(12);
    expect(d.to).toBe(37);
    expect(d.text).toContain("plus longue");
    expect(d.text).toContain("12 s");
    expect(d.text).toContain("37 s");
  });

  it("plus longue : la portion suit le départ borné", () => {
    const d = describeFit(
      input({ videoDuration: 60, audioDuration: 25, offset: 500 }),
    );
    expect(d.from).toBe(35);
    expect(d.to).toBe(60);
  });

  it("écrit les durées en minutes au-delà d'une minute et les décimales à la française", () => {
    const d = describeFit(
      input({ videoDuration: 300, audioDuration: 25.5, offset: 61 }),
    );
    expect(d.text).toContain("1 min 01 s");
    expect(d.text).toContain("1 min 26,5 s");
  });

  it("même durée : rien à régler", () => {
    const d = describeFit(input({ videoDuration: 25, audioDuration: 25.05 }));
    expect(d.situation).toBe("same");
    expect(d.text).toContain("même durée");
    expect(d.text).toContain("rien à régler");
  });

  it("durée inconnue : phrase honnête, pas de chiffre inventé", () => {
    const noVideo = describeFit(input({ videoDuration: 0 }));
    expect(noVideo.situation).toBe("unknown");
    expect(noVideo.repeats).toBeNull();
    expect(noVideo.text).toMatch(/inconnue/);
    const noAudio = describeFit(input({ audioDuration: Number.NaN }));
    expect(noAudio.situation).toBe("unknown");
  });

  it("propose une version courte pour une pastille", () => {
    expect(
      describeFit(input({ videoDuration: 12, audioDuration: 30 })).short,
    ).toBe("Plus courte · environ 2,5 fois");
    expect(
      describeFit(input({ videoDuration: 60, audioDuration: 25 })).short,
    ).toBe("Plus longue · de 0 s à 25 s");
    expect(
      describeFit(input({ videoDuration: 25, audioDuration: 25 })).short,
    ).toBe("Même durée");
  });
});

describe("loopSeams", () => {
  it("donne les raccords de la boucle (instants de la récitation)", () => {
    expect(loopSeams(input({ videoDuration: 10, audioDuration: 25 }))).toEqual([
      10, 20,
    ]);
    expect(
      loopSeams(
        input({ videoDuration: 10, audioDuration: 25, mode: "pingpong" }),
      ),
    ).toEqual([10, 20]);
  });

  it("figé : un seul repère, là où l'image s'arrête", () => {
    expect(
      loopSeams(
        input({ videoDuration: 10, audioDuration: 25, mode: "freeze" }),
      ),
    ).toEqual([10]);
  });

  it("aucun raccord pour le ralenti, la portion, la même durée ou l'inconnu", () => {
    expect(loopSeams(input({ mode: "slow" }))).toEqual([]);
    expect(loopSeams(input({ videoDuration: 60 }))).toEqual([]);
    expect(loopSeams(input({ videoDuration: 25 }))).toEqual([]);
    expect(loopSeams(input({ videoDuration: 0 }))).toEqual([]);
  });

  it("ne dépasse pas la récitation et reste raisonnable sur une vidéo minuscule", () => {
    const seams = loopSeams(input({ videoDuration: 0.2, audioDuration: 600 }));
    expect(seams.length).toBeLessThanOrEqual(500);
    for (const s of seams) expect(s).toBeLessThan(600);
  });
});
