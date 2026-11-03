import { describe, expect, it } from "vitest";
import {
  PREV_RESTART_S,
  createQueue,
  currentId,
  jumpTo,
  nextRepeat,
  onEnded,
  playOrder,
  skipNext,
  skipPrev,
  withRepeat,
  withShuffle,
} from "./playlist-queue";

/** File de lecture d'une playlist : ce que ferait un vrai lecteur (suivant, précédent, boucle, aléatoire). */
const IDS = ["a", "b", "c", "d"];
/** Hasard déterministe : suite fixe de valeurs dans [0, 1[. */
const seeded = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length];
};
const order = (q: ReturnType<typeof createQueue>) => playOrder(q);

describe("lecture dans l'ordre", () => {
  it("commence au premier audio, ou à celui demandé", () => {
    expect(currentId(createQueue(IDS))).toBe("a");
    expect(currentId(createQueue(IDS, { startId: "c" }))).toBe("c");
    expect(currentId(createQueue(IDS, { startId: "inconnu" }))).toBe("a");
  });

  it("une playlist vide n'a pas d'audio courant", () => {
    expect(currentId(createQueue([]))).toBeNull();
  });

  it("à la fin d'un audio, passe au suivant ; à la fin de la playlist, s'arrête", () => {
    let q = createQueue(IDS);
    for (const expected of ["b", "c", "d"]) {
      const r = onEnded(q);
      expect(r.play).toBe(true);
      expect(currentId(r.queue)).toBe(expected);
      q = r.queue;
    }
    const last = onEnded(q);
    expect(last.play).toBe(false);
    expect(currentId(last.queue)).toBe("d");
  });
});

describe("répétition", () => {
  it("un audio en boucle : rejoue le même, sans fin", () => {
    const q = withRepeat(createQueue(IDS, { startId: "b" }), "one");
    const r = onEnded(q);
    expect(r.play).toBe(true);
    expect(currentId(r.queue)).toBe("b");
  });

  it("toute la playlist en boucle : repart du premier après le dernier", () => {
    const q = withRepeat(createQueue(IDS, { startId: "d" }), "all");
    const r = onEnded(q);
    expect(r.play).toBe(true);
    expect(currentId(r.queue)).toBe("a");
  });

  it("le bouton de répétition fait le tour : aucune, toute la playlist, un audio", () => {
    expect(nextRepeat("off")).toBe("all");
    expect(nextRepeat("all")).toBe("one");
    expect(nextRepeat("one")).toBe("off");
  });
});

describe("suivant et précédent à la main", () => {
  it("suivant passe à l'audio suivant, même en répétition d'un seul", () => {
    const q = withRepeat(createQueue(IDS), "one");
    const r = skipNext(q);
    expect(r.action).toBe("move");
    expect(currentId(r.queue)).toBe("b");
  });

  it("suivant au dernier audio : ne bouge pas, sauf en boucle de la playlist", () => {
    const end = createQueue(IDS, { startId: "d" });
    expect(skipNext(end).action).toBe("none");
    expect(currentId(skipNext(withRepeat(end, "all")).queue)).toBe("a");
  });

  it(`précédent : revient au début de l'audio après ${PREV_RESTART_S} s, sinon à l'audio d'avant`, () => {
    const q = createQueue(IDS, { startId: "c" });
    expect(skipPrev(q, PREV_RESTART_S + 1).action).toBe("restart");
    const back = skipPrev(q, 1);
    expect(back.action).toBe("move");
    expect(currentId(back.queue)).toBe("b");
  });

  it("précédent au premier audio : recommence celui-ci, sauf en boucle de la playlist (va au dernier)", () => {
    const first = createQueue(IDS);
    expect(skipPrev(first, 0).action).toBe("restart");
    const wrapped = skipPrev(withRepeat(first, "all"), 0);
    expect(wrapped.action).toBe("move");
    expect(currentId(wrapped.queue)).toBe("d");
  });

  it("aller directement à un audio de la liste", () => {
    expect(currentId(jumpTo(createQueue(IDS), "c"))).toBe("c");
    expect(currentId(jumpTo(createQueue(IDS), "zzz"))).toBe("a");
  });
});

describe("lecture aléatoire", () => {
  it("l'audio courant reste en premier, les autres sont mélangés, aucun oublié", () => {
    const q = withShuffle(
      createQueue(IDS, { startId: "b" }),
      true,
      seeded(0.9, 0.1, 0.5),
    );
    const o = order(q);
    expect(o[0]).toBe("b");
    expect([...o].sort()).toEqual(IDS);
    expect(o).not.toEqual(["b", "a", "c", "d"]);
  });

  it("chaque audio est joué une fois par tour, puis la boucle de la playlist remélange", () => {
    let q = withRepeat(
      withShuffle(createQueue(IDS), true, seeded(0.3, 0.8, 0.2, 0.6)),
      "all",
    );
    const played: string[] = [currentId(q)!];
    for (let i = 0; i < 3; i++) {
      q = onEnded(q, seeded(0.4)).queue;
      played.push(currentId(q)!);
    }
    expect([...played].sort()).toEqual(IDS);
    const wrapped = onEnded(q, seeded(0.7, 0.2, 0.9));
    expect(wrapped.play).toBe(true);
    expect([...order(wrapped.queue)].sort()).toEqual(IDS);
    // le premier du nouveau tour n'est pas celui qui vient de finir (quand il y en a plusieurs)
    expect(currentId(wrapped.queue)).not.toBe(played[3]);
  });

  it("désactiver l'aléatoire rétablit l'ordre de la playlist, à partir de l'audio courant", () => {
    const shuffled = withShuffle(
      createQueue(IDS, { startId: "c" }),
      true,
      seeded(0.1, 0.9),
    );
    const plain = withShuffle(shuffled, false);
    expect(order(plain)).toEqual(IDS);
    expect(currentId(plain)).toBe("c");
  });

  it("précédent en aléatoire revient à l'audio réellement joué avant", () => {
    let q = withShuffle(createQueue(IDS), true, seeded(0.9, 0.1, 0.5));
    const first = currentId(q);
    q = skipNext(q).queue;
    expect(currentId(q)).not.toBe(first);
    expect(currentId(skipPrev(q, 0).queue)).toBe(first);
  });
});
