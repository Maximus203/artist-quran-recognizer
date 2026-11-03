import { describe, expect, it } from "vitest";
import {
  DEFAULT_EDITOR_MODE,
  EDITOR_MODES,
  defaultEditorModeFor,
  effectiveEditorMode,
  isEditorMode,
  isPostponed,
  postpone,
  shouldAskEditorMode,
  canChooseEditorMode,
  editorChoiceFor,
} from "./export-editor-mode";
import type { Role } from "./users";

/**
 * La règle du format d'éditeur (téléphone), en UN seul endroit : qui est interrogé, quel éditeur sans choix,
 * qui peut changer. Aucun `if (role === …)` ailleurs.
 */

describe("les modes", () => {
  it("trois modes, le plateau d'abord et seul repli sûr", () => {
    expect(EDITOR_MODES).toEqual(["plateau", "table", "pas"]);
    expect(DEFAULT_EDITOR_MODE).toBe("plateau");
    expect(isEditorMode("table")).toBe(true);
    expect(isEditorMode("bureau")).toBe(false);
    expect(isEditorMode(null)).toBe(false);
    expect(isEditorMode(undefined)).toBe(false);
    expect(isEditorMode(2)).toBe(false);
  });
});

describe("l'éditeur sans choix, par rôle", () => {
  it("le récitateur : le pas à pas", () => {
    expect(defaultEditorModeFor("recitant")).toBe("pas");
  });
  it("le testeur et l'administrateur : le plateau", () => {
    expect(defaultEditorModeFor("user")).toBe("plateau");
    expect(defaultEditorModeFor("admin")).toBe("plateau");
  });
  it("un rôle inconnu retombe sur le plateau", () => {
    expect(defaultEditorModeFor("futur" as Role)).toBe("plateau");
  });
});

describe("shouldAskEditorMode : la question n'est posée qu'une fois, sur téléphone, aux testeurs", () => {
  const ask = (role: Role, saved: unknown, wide: boolean) =>
    shouldAskEditorMode({
      role,
      saved: saved as Parameters<typeof shouldAskEditorMode>[0]["saved"],
      wide,
    });

  it("testeur et administrateur, jamais choisi, téléphone : oui", () => {
    expect(ask("user", null, false)).toBe(true);
    expect(ask("admin", null, false)).toBe(true);
    expect(ask("user", undefined, false)).toBe(true);
  });
  it("déjà choisi : non, quel que soit le mode", () => {
    for (const mode of EDITOR_MODES) {
      expect(ask("user", mode, false)).toBe(false);
      expect(ask("admin", mode, false)).toBe(false);
    }
  });
  it("au bureau : jamais de question", () => {
    expect(ask("user", null, true)).toBe(false);
    expect(ask("admin", null, true)).toBe(false);
  });
  it("le récitateur : jamais de question, même sans choix", () => {
    expect(ask("recitant", null, false)).toBe(false);
    expect(ask("recitant", undefined, false)).toBe(false);
    expect(ask("recitant", null, true)).toBe(false);
  });
  it("un rôle inconnu : pas de question", () => {
    expect(ask("futur" as Role, null, false)).toBe(false);
  });
  it("une valeur enregistrée illisible compte comme « jamais choisi » pour un testeur", () => {
    expect(ask("user", "carrousel", false)).toBe(true);
  });
});

describe("effectiveEditorMode : l'éditeur à monter", () => {
  it("le choix enregistré d'abord, pour tous les rôles", () => {
    expect(effectiveEditorMode({ role: "user", saved: "table" })).toBe("table");
    expect(effectiveEditorMode({ role: "recitant", saved: "plateau" })).toBe(
      "plateau",
    );
  });
  it("sans choix, le défaut du rôle", () => {
    expect(effectiveEditorMode({ role: "recitant", saved: null })).toBe("pas");
    expect(effectiveEditorMode({ role: "admin", saved: null })).toBe("plateau");
  });
  it("une valeur inconnue retombe sur le défaut du rôle (jamais d'écran vide)", () => {
    expect(
      effectiveEditorMode({
        role: "recitant",
        saved: "carrousel" as never,
      }),
    ).toBe("pas");
    expect(
      effectiveEditorMode({ role: "user", saved: "carrousel" as never }),
    ).toBe("plateau");
  });
});

describe("canChooseEditorMode : la section des paramètres", () => {
  it("tous les rôles dont la page des paramètres montre déjà des préférences", () => {
    expect(canChooseEditorMode("user")).toBe(true);
    expect(canChooseEditorMode("admin")).toBe(true);
    expect(canChooseEditorMode("recitant")).toBe(true);
  });
  it("un rôle inconnu : non", () => {
    expect(canChooseEditorMode("futur" as Role)).toBe(false);
  });
});

describe("« Choisir plus tard » : valable pour la séance du navigateur, jamais enregistré", () => {
  const fake = () => {
    const data = new Map<string, string>();
    return {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
    };
  };

  it("rien au départ, puis reporté", () => {
    const storage = fake();
    expect(isPostponed(storage)).toBe(false);
    postpone(storage);
    expect(isPostponed(storage)).toBe(true);
  });
  it("un stockage absent ou bloqué ne casse rien (on redemandera)", () => {
    expect(isPostponed(null)).toBe(false);
    expect(() => postpone(null)).not.toThrow();
    const broken = {
      getItem: () => {
        throw new Error("bloqué");
      },
      setItem: () => {
        throw new Error("bloqué");
      },
    };
    expect(isPostponed(broken)).toBe(false);
    expect(() => postpone(broken)).not.toThrow();
  });
});

describe("editorChoiceFor : ce que l'écran fait, en une décision", () => {
  const base = { role: "user" as Role, saved: null, wide: false };

  it("testeur sur téléphone, jamais choisi : on demande", () => {
    expect(editorChoiceFor({ ...base, postponed: false }).ask).toBe(true);
  });
  it("« plus tard » : pas de question cette fois, le plateau", () => {
    expect(editorChoiceFor({ ...base, postponed: true })).toEqual({
      ask: false,
      mode: "plateau",
    });
  });
  it("déjà choisi : l'éditeur choisi, sans question", () => {
    expect(
      editorChoiceFor({ ...base, saved: "table", postponed: false }),
    ).toEqual({ ask: false, mode: "table" });
  });
  it("récitateur : le pas à pas, jamais de question, même sans « plus tard »", () => {
    expect(
      editorChoiceFor({ ...base, role: "recitant", postponed: false }),
    ).toEqual({ ask: false, mode: "pas" });
  });
  it("bureau : jamais de question, et le mode ne sert pas (vue unique)", () => {
    expect(editorChoiceFor({ ...base, wide: true, postponed: false }).ask).toBe(
      false,
    );
  });
});
