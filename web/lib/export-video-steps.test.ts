import { describe, expect, it } from "vitest";
import {
  START_PROGRESS,
  STEP_IDS,
  STEP_LABEL,
  describeStep,
  isDone,
  isStepId,
  loadProgress,
  moveTo,
  nextStep,
  parseProgress,
  previousStep,
  resolveTextTab,
  saveProgress,
  stepNumber,
  stepsKey,
  TEXT_TABS,
  type StepsProgress,
  type StepsStorage,
} from "./export-video-steps";

/** Une mémoire de navigateur en un objet : de quoi rejouer lecture, écriture et pannes. */
function memory(initial: Record<string, string> = {}): StepsStorage & {
  data: Record<string, string>;
} {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

const broken: StepsStorage = {
  getItem: () => {
    throw new Error("mémoire bloquée");
  },
  setItem: () => {
    throw new Error("mémoire pleine");
  },
};

describe("les trois étapes", () => {
  it("sont dans l'ordre : le cadre, les textes, exporter", () => {
    expect(STEP_IDS).toEqual(["cadre", "textes", "exporter"]);
    expect(STEP_IDS.map((id) => STEP_LABEL[id])).toEqual([
      "Le cadre",
      "Les textes",
      "Exporter",
    ]);
    expect(STEP_IDS.map(stepNumber)).toEqual([1, 2, 3]);
  });

  it("reconnaissent un identifiant d'étape, et rien d'autre", () => {
    expect(isStepId("textes")).toBe(true);
    expect(isStepId("quatre")).toBe(false);
    expect(isStepId(2)).toBe(false);
    expect(isStepId(undefined)).toBe(false);
  });

  it("suivante et précédente s'arrêtent aux bornes", () => {
    expect(nextStep("cadre")).toBe("textes");
    expect(nextStep("textes")).toBe("exporter");
    expect(nextStep("exporter")).toBeNull();
    expect(previousStep("exporter")).toBe("textes");
    expect(previousStep("textes")).toBe("cadre");
    expect(previousStep("cadre")).toBeNull();
  });

  it("la phrase annoncée dit où l'on est", () => {
    expect(describeStep("cadre")).toBe("Étape 1 sur 3 : Le cadre.");
    expect(describeStep("exporter")).toBe("Étape 3 sur 3 : Exporter.");
  });
});

describe("la progression", () => {
  it("part de la première étape, rien de fait", () => {
    expect(START_PROGRESS).toEqual({ step: "cadre", done: [] });
  });

  it("avancer d'une étape marque celle qu'on quitte comme faite", () => {
    const at2 = moveTo(START_PROGRESS, "textes");
    expect(at2).toEqual({ step: "textes", done: ["cadre"] });
    const at3 = moveTo(at2, "exporter");
    expect(at3).toEqual({ step: "exporter", done: ["cadre", "textes"] });
  });

  it("sauter directement à la dernière ne marque comme faite que celle qu'on quitte", () => {
    expect(moveTo(START_PROGRESS, "exporter")).toEqual({
      step: "exporter",
      done: ["cadre"],
    });
  });

  it("revenir en arrière ne défait rien", () => {
    const at3 = moveTo(moveTo(START_PROGRESS, "textes"), "exporter");
    const back = moveTo(at3, "cadre");
    expect(back.step).toBe("cadre");
    expect(back.done).toEqual(["cadre", "textes"]);
  });

  it("l'étape courante n'est jamais « faite », même si on l'a déjà passée", () => {
    const back = moveTo(moveTo(START_PROGRESS, "textes"), "cadre");
    expect(isDone(back, "cadre")).toBe(false);
    expect(isDone(back, "textes")).toBe(false);
    const forward = moveTo(START_PROGRESS, "textes");
    expect(isDone(forward, "cadre")).toBe(true);
    expect(isDone(forward, "textes")).toBe(false);
  });

  it("la garde : la même étape ou une étape inconnue ne changent rien (même objet)", () => {
    const at2 = moveTo(START_PROGRESS, "textes");
    expect(moveTo(at2, "textes")).toBe(at2);
    expect(moveTo(at2, "quatre" as never)).toBe(at2);
    expect(moveTo(at2, undefined as never)).toBe(at2);
  });

  it("ne mélange pas deux aller-retour : aucun doublon", () => {
    let p: StepsProgress = START_PROGRESS;
    for (const step of [
      "textes",
      "cadre",
      "textes",
      "cadre",
      "exporter",
    ] as const)
      p = moveTo(p, step);
    // « Les textes » n'a jamais été quittée vers l'avant : seule « Le cadre » est faite, une seule fois.
    expect(p.done).toEqual(["cadre"]);
    expect(moveTo(moveTo(p, "textes"), "exporter").done).toEqual([
      "cadre",
      "textes",
    ]);
  });
});

describe("la progression mémorisée", () => {
  it("la clé est propre à la récitation", () => {
    expect(stepsKey("abc")).not.toBe(stepsKey("def"));
    expect(stepsKey("abc")).toContain("abc");
  });

  it("revient là où on était, par récitation", () => {
    const store = memory();
    saveProgress(store, "a", { step: "textes", done: ["cadre"] });
    saveProgress(store, "b", { step: "exporter", done: ["cadre", "textes"] });
    expect(loadProgress(store, "a")).toEqual({
      step: "textes",
      done: ["cadre"],
    });
    expect(loadProgress(store, "b").step).toBe("exporter");
    expect(loadProgress(store, "autre")).toEqual(START_PROGRESS);
  });

  it("une valeur abîmée ou inconnue redonne le début, sans erreur", () => {
    for (const raw of [
      "",
      "pas du json",
      "null",
      "42",
      "[]",
      '{"step":"quatre","done":[]}',
      '{"done":["cadre"]}',
      '{"step":3}',
    ])
      expect(parseProgress(raw)).toEqual(START_PROGRESS);
    expect(parseProgress(null)).toEqual(START_PROGRESS);
  });

  it("garde l'étape valide et jette les étapes faites qui n'existent pas", () => {
    expect(
      parseProgress(
        JSON.stringify({
          step: "exporter",
          done: ["cadre", "cadre", "zéro", 7, "textes"],
        }),
      ),
    ).toEqual({ step: "exporter", done: ["cadre", "textes"] });
    expect(
      parseProgress(JSON.stringify({ step: "textes", done: "cadre" })),
    ).toEqual({ step: "textes", done: [] });
  });

  it("une mémoire qui range l'étape courante parmi les faites n'y met pas de coche", () => {
    const read = parseProgress(
      JSON.stringify({ step: "textes", done: ["textes"] }),
    );
    expect(read.done).toEqual(["textes"]);
    expect(isDone(read, "textes")).toBe(false);
  });

  it("sans mémoire, ou avec une mémoire qui refuse : le début, et l'écriture ne plante pas", () => {
    expect(loadProgress(null, "a")).toEqual(START_PROGRESS);
    expect(loadProgress(broken, "a")).toEqual(START_PROGRESS);
    expect(() => saveProgress(null, "a", START_PROGRESS)).not.toThrow();
    expect(() => saveProgress(broken, "a", START_PROGRESS)).not.toThrow();
  });

  it("n'écrit que ce qu'il faut : l'étape et les faites, rien d'autre", () => {
    const store = memory();
    saveProgress(store, "a", { step: "textes", done: ["cadre"] });
    expect(JSON.parse(store.data[stepsKey("a")])).toEqual({
      step: "textes",
      done: ["cadre"],
    });
  });
});

describe("l'élément réglé à l'étape des textes", () => {
  it("quatre éléments, l'arabe d'abord", () => {
    expect(TEXT_TABS).toEqual(["arabic", "translation", "wave", "ref"]);
  });

  it("choisir un élément dans l'aperçu change l'onglet", () => {
    expect(resolveTextTab("arabic", "wave")).toBe("wave");
    expect(resolveTextTab("wave", "ref")).toBe("ref");
  });

  it("toucher à côté (rien de choisi) garde l'onglet : un réglage reste toujours ouvert", () => {
    expect(resolveTextTab("translation", null)).toBe("translation");
  });
});
