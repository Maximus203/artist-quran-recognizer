import { describe, expect, it } from "vitest";
import {
  filmSegments,
  MAX_PX_PER_SECOND,
  movePlayhead,
  offsetFromFilmDrag,
  passageBlocks,
  playheadKey,
  pxToTime,
  rulerMarks,
  scrollAfterZoom,
  scrollToReveal,
  stepZoom,
  timeToPx,
  trackWidth,
  zoomLevels,
} from "./export-table-timeline";

describe("zoom : de « tout voir » à une seconde lisible", () => {
  it("le premier niveau montre tout l'audio dans la largeur de l'écran", () => {
    const levels = zoomLevels(360, 72);
    expect(levels[0]).toBe(1);
    expect(trackWidth(360, 1)).toBe(360);
  });
  it("les niveaux doublent, et s'arrêtent avant d'étirer une seconde au-delà de la limite", () => {
    const levels = zoomLevels(360, 72);
    expect(levels).toEqual([1, 2, 4, 8, 16]);
    for (const zoom of levels.slice(1))
      expect((360 * zoom) / 72).toBeLessThanOrEqual(MAX_PX_PER_SECOND);
    // un cran de plus dépasserait la limite
    expect((360 * 32) / 72).toBeGreaterThan(MAX_PX_PER_SECOND);
  });
  it("un audio très court ou nul garde au moins « tout voir »", () => {
    expect(zoomLevels(360, 0)).toEqual([1]);
    expect(zoomLevels(360, 2)).toEqual([1]);
    expect(zoomLevels(0, 30)).toEqual([1]);
  });
  it("stepZoom passe au niveau voisin et s'arrête aux bornes", () => {
    const levels = [1, 2, 4];
    expect(stepZoom(1, 1, levels)).toBe(2);
    expect(stepZoom(2, 1, levels)).toBe(4);
    expect(stepZoom(4, 1, levels)).toBe(4);
    expect(stepZoom(2, -1, levels)).toBe(1);
    expect(stepZoom(1, -1, levels)).toBe(1);
  });
  it("un niveau inconnu (écran redimensionné) retombe sur le plus proche", () => {
    expect(stepZoom(16, -1, [1, 2, 4])).toBe(2);
    expect(stepZoom(3, 1, [1, 2, 4])).toBe(4);
  });
  it("la piste n'est jamais plus étroite que l'écran", () => {
    expect(trackWidth(360, 0.2)).toBe(360);
    expect(trackWidth(360, 4)).toBe(1440);
  });
});

describe("temps ↔ pixels sur la piste", () => {
  it("place le début à 0 et la fin au bout de la piste", () => {
    expect(timeToPx(0, 72, 720)).toBe(0);
    expect(timeToPx(72, 72, 720)).toBe(720);
    expect(timeToPx(36, 72, 720)).toBe(360);
  });
  it("est réciproque et bornée à [0, durée]", () => {
    expect(pxToTime(360, 72, 720)).toBe(36);
    expect(pxToTime(-40, 72, 720)).toBe(0);
    expect(pxToTime(9999, 72, 720)).toBe(72);
  });
  it("ne divise jamais par zéro", () => {
    expect(Number.isFinite(timeToPx(5, 0, 0))).toBe(true);
    expect(pxToTime(5, 10, 0)).toBe(0);
  });
});

describe("défilement : la tête de lecture reste visible", () => {
  it("ne bouge pas quand la tête est déjà bien dans l'écran", () => {
    expect(scrollToReveal(100, 360, 250, 24)).toBe(100);
  });
  it("avance juste assez quand la tête sort à droite", () => {
    expect(scrollToReveal(0, 360, 400, 24)).toBe(64);
  });
  it("recule juste assez quand la tête sort à gauche", () => {
    expect(scrollToReveal(300, 360, 310, 24)).toBe(286);
  });
  it("jamais de défilement négatif", () => {
    expect(scrollToReveal(10, 360, 5, 24)).toBe(0);
  });
  it("après un zoom, le point d'ancrage reste au même endroit de l'écran", () => {
    // ancre : t = 36 s sur 72 s. Avant : piste de 360, défilement 0 → x = 180. Après : piste de 720.
    const left = scrollAfterZoom({
      scrollLeft: 0,
      viewport: 360,
      oldWidth: 360,
      newWidth: 720,
      anchor: 36,
      duration: 72,
    });
    expect(timeToPx(36, 72, 720) - left).toBe(180);
  });
  it("ne dépasse pas la fin de la piste après un zoom", () => {
    const left = scrollAfterZoom({
      scrollLeft: 0,
      viewport: 360,
      oldWidth: 360,
      newWidth: 720,
      anchor: 72,
      duration: 72,
    });
    expect(left).toBe(360);
  });
  it("un retour à « tout voir » ramène le défilement à 0", () => {
    expect(
      scrollAfterZoom({
        scrollLeft: 500,
        viewport: 360,
        oldWidth: 1440,
        newWidth: 360,
        anchor: 40,
        duration: 72,
      }),
    ).toBe(0);
  });
});

describe("règle de temps", () => {
  it("donne un repère assez espacé, et des étiquettes aux repères principaux", () => {
    const marks = rulerMarks(72, 360, 64);
    expect(marks[0]).toMatchObject({ t: 0, major: true, label: "0:00" });
    const majors = marks.filter((m) => m.major);
    expect(majors.length).toBeGreaterThan(1);
    // jamais deux repères principaux plus près que la cible
    for (let i = 1; i < majors.length; i++)
      expect(
        timeToPx(majors[i].t, 72, 360) - timeToPx(majors[i - 1].t, 72, 360),
      ).toBeGreaterThanOrEqual(63);
  });
  it("se resserre quand on zoome", () => {
    const wide = rulerMarks(72, 360, 64);
    const zoomed = rulerMarks(72, 1440, 64);
    expect(zoomed.length).toBeGreaterThan(wide.length);
  });
  it("un audio nul n'a pas de règle", () => {
    expect(rulerMarks(0, 360, 64)).toEqual([]);
  });
  it("ne dépasse jamais la durée", () => {
    for (const mark of rulerMarks(72, 360, 64))
      expect(mark.t).toBeLessThanOrEqual(72);
  });
});

describe("tête de lecture : clavier et boutons", () => {
  it("flèches : 0,1 s ; Maj : 1 s ; Page haut/bas : 5 s", () => {
    expect(playheadKey("ArrowRight", false)).toEqual({ delta: 0.1 });
    expect(playheadKey("ArrowLeft", false)).toEqual({ delta: -0.1 });
    expect(playheadKey("ArrowRight", true)).toEqual({ delta: 1 });
    expect(playheadKey("ArrowLeft", true)).toEqual({ delta: -1 });
    expect(playheadKey("PageUp", false)).toEqual({ delta: 5 });
    expect(playheadKey("PageDown", false)).toEqual({ delta: -5 });
  });
  it("Début et Fin vont aux extrémités ; [ et ] au passage voisin", () => {
    expect(playheadKey("Home", false)).toEqual({ to: "start" });
    expect(playheadKey("End", false)).toEqual({ to: "end" });
    expect(playheadKey("[", false)).toEqual({ jump: -1 });
    expect(playheadKey("]", false)).toEqual({ jump: 1 });
  });
  it("les autres touches gardent leur sens (Tab, lettres…)", () => {
    expect(playheadKey("Tab", false)).toBeNull();
    expect(playheadKey("a", false)).toBeNull();
    expect(playheadKey("Enter", false)).toBeNull();
  });
  it("movePlayhead reste dans [0, durée] et au dixième près", () => {
    expect(movePlayhead(9.3, 0.1, 72)).toBe(9.4);
    expect(movePlayhead(0.05, -1, 72)).toBe(0);
    expect(movePlayhead(71.95, 1, 72)).toBe(72);
    expect(movePlayhead(0.1 + 0.2, 0.1, 72)).toBe(0.4);
  });
  it("une valeur illisible vaut le début", () => {
    expect(movePlayhead(Number.NaN, 1, 72)).toBe(1);
    expect(movePlayhead(5, Number.NaN, 72)).toBe(5);
  });
});

const verses = [
  { kind: "verse", ref: "112:1", t: [0, 6] },
  { kind: "formula", ref: null, t: [6, 8] },
  { kind: "verse", ref: "112:2", t: [8, 14], status: "inferred" },
  { kind: "verse", ref: null, t: [14, 20], status: "uncertain" },
  { kind: "verse", ref: "112:4", t: null },
] as const;

describe("passages : les blocs de la piste", () => {
  it("un bloc par passage coranique daté, numéroté d'après le verset", () => {
    const blocks = passageBlocks(verses as never, [{ start: 0, end: 20 }]);
    expect(blocks.map((b) => [b.label, b.start, b.end])).toEqual([
      ["1", 0, 6],
      ["2", 8, 14],
      ["3", 14, 20],
    ]);
  });
  it("un passage sans référence est numéroté par sa place", () => {
    const blocks = passageBlocks(verses as never, [{ start: 0, end: 20 }]);
    expect(blocks[2].label).toBe("3");
    expect(blocks[2].status).toBe("uncertain");
  });
  it("dit lesquels sont dans la vidéo (chevauchent une plage exportée)", () => {
    const blocks = passageBlocks(verses as never, [{ start: 7, end: 10 }]);
    expect(blocks.map((b) => b.included)).toEqual([false, true, false]);
  });
  it("sans plage exportée, aucun passage n'est dans la vidéo", () => {
    const blocks = passageBlocks(verses as never, []);
    expect(blocks.every((b) => !b.included)).toBe(true);
  });
  it("une session sans passage donne une piste vide", () => {
    expect(passageBlocks([], [{ start: 0, end: 5 }])).toEqual([]);
  });
});

describe("piste « Fond » : ce que la vidéo fait sous chaque plage", () => {
  const range = (start: number, end: number, id = 1) => ({ id, start, end });

  it("vidéo plus courte : des répétitions et un raccord à chaque reprise", () => {
    const [segment] = filmSegments([range(0, 30)], {
      duration: 12,
      offset: 0,
      mode: "loop",
    });
    expect(segment.fit.situation).toBe("shorter");
    expect(segment.film.seamTimes).toEqual([12, 24]);
    expect(segment.film.tiles).toHaveLength(3);
    expect(segment.portion).toBeNull();
  });
  it("les raccords se comptent depuis le début de CHAQUE plage", () => {
    const segments = filmSegments([range(10, 40, 1), range(50, 70, 2)], {
      duration: 12,
      offset: 0,
      mode: "loop",
    });
    expect(segments[0].film.seamTimes).toEqual([12, 24]);
    expect(segments[1].film.seamTimes).toEqual([12]);
    expect(segments[1].start).toBe(50);
  });
  it("aller-retour : les tuiles paires sont retournées", () => {
    const [segment] = filmSegments([range(0, 30)], {
      duration: 12,
      offset: 0,
      mode: "pingpong",
    });
    expect(segment.film.tiles.map((t) => t.flipped)).toEqual([
      false,
      true,
      false,
    ]);
  });
  it("dernière image : un seul raccord, puis l'image figée", () => {
    const [segment] = filmSegments([range(0, 30)], {
      duration: 12,
      offset: 0,
      mode: "freeze",
    });
    expect(segment.film.seamTimes).toEqual([12]);
    expect(segment.film.frozen).not.toBeNull();
  });
  it("ralenti : aucun raccord, la vidéo couvre toute la plage", () => {
    const [segment] = filmSegments([range(0, 30)], {
      duration: 12,
      offset: 0,
      mode: "slow",
    });
    expect(segment.film.seamTimes).toEqual([]);
    expect(segment.film.tiles).toEqual([
      { left: 0, width: 100, flipped: false },
    ]);
  });
  it("vidéo plus longue : une portion, qui commence au départ choisi", () => {
    const [segment] = filmSegments([range(5, 27)], {
      duration: 65,
      offset: 12,
      mode: "loop",
    });
    expect(segment.fit.situation).toBe("longer");
    expect(segment.portion).toEqual({ from: 12, to: 34, filmStart: -7 });
  });
  it("le départ est ramené dans les bornes de la plage (jamais au-delà de la fin de la vidéo)", () => {
    const [segment] = filmSegments([range(0, 22)], {
      duration: 65,
      offset: 999,
      mode: "loop",
    });
    expect(segment.portion?.from).toBe(43);
    expect(segment.portion?.to).toBe(65);
  });
  it("même durée : rien à régler", () => {
    const [segment] = filmSegments([range(0, 12)], {
      duration: 12.05,
      offset: 0,
      mode: "loop",
    });
    expect(segment.fit.situation).toBe("same");
    expect(segment.portion).toBeNull();
    expect(segment.film.seamTimes).toEqual([]);
  });
  it("durée inconnue : la première image reste", () => {
    const [segment] = filmSegments([range(0, 12)], {
      duration: 0,
      offset: 0,
      mode: "loop",
    });
    expect(segment.fit.situation).toBe("unknown");
  });
  it("aucune plage : aucun segment", () => {
    expect(filmSegments([], { duration: 12, offset: 0, mode: "loop" })).toEqual(
      [],
    );
  });
});

describe("glisser le film sous la récitation", () => {
  const span = { videoDuration: 65, audioDuration: 22 };
  it("glisser vers la droite fait reculer le départ (le film suit le doigt)", () => {
    // 5 px par seconde : 25 px à droite = le film recule de 5 s
    expect(offsetFromFilmDrag(20, 25, 5, span)).toBe(15);
  });
  it("glisser vers la gauche avance le départ", () => {
    expect(offsetFromFilmDrag(20, -10, 5, span)).toBe(22);
  });
  it("reste entre 0 et la marge (vidéo − récitation), au dixième", () => {
    expect(offsetFromFilmDrag(2, 100, 5, span)).toBe(0);
    expect(offsetFromFilmDrag(40, -500, 5, span)).toBe(43);
    expect(offsetFromFilmDrag(0, -1, 3, span)).toBe(0.3);
  });
  it("sans échelle valable, le départ ne bouge pas", () => {
    expect(offsetFromFilmDrag(20, 25, 0, span)).toBe(20);
  });
});
