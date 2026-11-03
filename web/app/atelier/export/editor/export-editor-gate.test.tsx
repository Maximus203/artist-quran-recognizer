import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorMode } from "@/lib/export-editor-mode";
import type { Role } from "@/lib/users";
import type { EditorProps } from "./editor-types";

/**
 * La porte de l'éditeur : selon le rôle, le choix enregistré et la taille de l'écran, elle montre la fenêtre de
 * choix, OU l'éditeur du bon format. L'éditeur et le compte sont simulés : on ne vérifie que la décision.
 */
const state = vi.hoisted(() => ({
  role: "user" as Role,
  saved: null as EditorMode | null,
  wide: false,
}));

vi.mock("../../shell", () => ({
  useShell: () => ({
    user: { role: state.role },
    prefs: { editorMode: state.saved },
    update: () => undefined,
  }),
}));
vi.mock("./export-editor", () => ({
  DESKTOP_QUERY: "(min-width: 1024px)",
  useScreen: () => state.wide,
  ExportEditor: ({ mode }: { mode: EditorMode }) => (
    <div data-testid="editeur" data-mode={mode} />
  ),
}));

import { ExportEditorGate } from "./export-editor-gate";

const render = () =>
  renderToStaticMarkup(<ExportEditorGate {...({} as EditorProps)} />);

beforeEach(() => {
  state.role = "user";
  state.saved = null;
  state.wide = false;
});

describe("la porte de l'éditeur d'export", () => {
  it("testeur sur téléphone, jamais choisi : la question d'abord, pas d'éditeur derrière", () => {
    const html = render();
    expect(html).toContain('data-testid="mode-dialog"');
    expect(html).not.toContain('data-testid="editeur"');
  });

  it("administrateur : la même question", () => {
    state.role = "admin";
    expect(render()).toContain('data-testid="mode-dialog"');
  });

  for (const mode of ["plateau", "table", "pas"] as const)
    it(`déjà choisi (${mode}) : cet éditeur, jamais de question`, () => {
      state.saved = mode;
      const html = render();
      expect(html).not.toContain("mode-dialog");
      expect(html).toContain(`data-mode="${mode}"`);
    });

  it("récitateur sans choix : le pas à pas, AUCUNE fenêtre", () => {
    state.role = "recitant";
    const html = render();
    expect(html).not.toContain("mode-dialog");
    expect(html).toContain('data-mode="pas"');
  });

  it("récitateur qui a changé dans ses paramètres : son choix", () => {
    state.role = "recitant";
    state.saved = "plateau";
    expect(render()).toContain('data-mode="plateau"');
  });

  it("au bureau : jamais de question, quel que soit le rôle", () => {
    state.wide = true;
    for (const role of ["user", "admin", "recitant"] as const) {
      state.role = role;
      expect(render()).not.toContain("mode-dialog");
      expect(render()).toContain('data-testid="editeur"');
    }
  });
});
