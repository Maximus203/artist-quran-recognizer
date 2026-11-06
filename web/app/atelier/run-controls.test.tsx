import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RunControls } from "./run-controls";

const html = (over: Partial<Parameters<typeof RunControls>[0]> = {}) =>
  renderToStaticMarkup(
    <RunControls
      state="done"
      canEdit
      busy={false}
      rerun={false}
      rerunError={null}
      onRun={vi.fn()}
      onCancel={vi.fn()}
      {...over}
    />,
  );

describe("RunControls", () => {
  it("une session terminée propose de la réanalyser avec la version actuelle", () => {
    const markup = html();
    expect(markup).toContain('data-testid="rerun"');
    expect(markup).toContain("Réanalyser avec la version actuelle");
    expect(markup).not.toContain('data-testid="run-engine"');
  });
  it("jamais pour qui ne peut pas modifier la session", () => {
    expect(html({ canEdit: false })).toBe("");
  });
  it("prête : lancer ; en échec ou annulée : relancer (comme avant)", () => {
    expect(html({ state: "ready" })).toContain("Lancer l’analyse");
    expect(html({ state: "failed" })).toContain("Relancer l’analyse");
    expect(html({ state: "cancelled" })).toContain("Relancer l’analyse");
  });
  it("pendant une réanalyse : annuler la réanalyse, pas « arrêter le traitement »", () => {
    expect(html({ state: "running", rerun: true })).toContain(
      "Annuler la réanalyse",
    );
    expect(html({ state: "queued", rerun: true })).toContain(
      "Annuler la réanalyse",
    );
    expect(html({ state: "running" })).toContain("Arrêter le traitement");
    expect(html({ state: "queued" })).toContain("Retirer de la file");
  });
  it("une réanalyse qui n'a pas abouti le dit, et garde le bouton", () => {
    const markup = html({ rerunError: "Modèle introuvable." });
    expect(markup).toContain('data-testid="rerun-error"');
    expect(markup).toContain("l’ancien résultat est conservé");
    expect(markup).toContain("Modèle introuvable.");
    expect(markup).toContain('data-testid="rerun"');
  });
  it("la confirmation n'est pas affichée d'emblée : un clic ne lance rien", () => {
    const onRun = vi.fn();
    const markup = html({ onRun });
    expect(markup).not.toContain('data-testid="rerun-confirm"');
    expect(onRun).not.toHaveBeenCalled();
  });
});
