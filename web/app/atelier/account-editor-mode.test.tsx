import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorMode } from "@/lib/export-editor-mode";
import type { Role } from "@/lib/users";

/** La section « Éditeur d'export (téléphone) » des paramètres : qui la voit, ce qui est marqué. */
const state = vi.hoisted(() => ({
  role: "user" as Role,
  saved: null as EditorMode | null,
}));

vi.mock("./shell", () => ({
  useShell: () => ({
    user: { role: state.role },
    prefs: { editorMode: state.saved },
    update: () => undefined,
  }),
}));

import { EditorModeSetting } from "./account-editor-mode";

const render = () => renderToStaticMarkup(<EditorModeSetting />);

beforeEach(() => {
  state.role = "user";
  state.saved = null;
});

describe("la section des paramètres", () => {
  it("les trois formats, avec les mêmes cartes que la fenêtre de choix", () => {
    const html = render();
    expect(html).toContain("Éditeur d’export (téléphone)");
    for (const mode of ["plateau", "table", "pas"])
      expect(html).toContain(`data-testid="mode-card-${mode}"`);
    expect(html).toContain("prend effet à la prochaine");
  });

  it("testeur qui n'a jamais choisi : rien n'est marqué, on lui dit qu'on lui demandera", () => {
    const html = render();
    expect(html).not.toContain('data-current="true"');
    expect(html).toContain("Tu n’as pas encore choisi");
  });

  it("le format choisi est marqué, un seul, et les autres restent à un geste", () => {
    state.saved = "table";
    const html = render();
    expect((html.match(/data-current="true"/g) ?? []).length).toBe(1);
    expect(html).toMatch(
      /data-testid="mode-card-table"[^>]*data-current="true"/,
    );
    expect(html).toContain('data-testid="mode-pick-plateau"');
    expect(html).toContain('data-testid="mode-pick-pas"');
    expect(html).not.toContain('data-testid="mode-pick-table"');
    expect(html).not.toContain("Tu n’as pas encore choisi");
  });

  it("récitateur sans choix : le pas à pas, marqué « par défaut », et il peut changer", () => {
    state.role = "recitant";
    const html = render();
    expect(html).toMatch(/data-testid="mode-card-pas"[^>]*data-current="true"/);
    expect(html).toContain("Actuel · par défaut");
    expect(html).toContain('data-testid="mode-pick-plateau"');
    expect(html).not.toContain("Tu n’as pas encore choisi");
  });

  it("un rôle inconnu ne voit pas la section", () => {
    state.role = "futur" as Role;
    expect(render()).toBe("");
  });
});
