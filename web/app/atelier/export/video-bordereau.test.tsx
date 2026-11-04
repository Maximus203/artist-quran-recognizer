import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Bordereau, type BordereauProps } from "./video-bordereau";

/**
 * Le bordereau pendant le rendu. Recette QA, m5 : après une coupure de réseau, il gardait « 17 % — Tu peux quitter
 * cette page » sans dire que la connexion était perdue. Il le dit maintenant, et sans alarmer : le rendu continue.
 */
const noop = () => undefined;
const props = (over: Partial<BordereauProps> = {}): BordereauProps => ({
  phase: "render",
  count: 1,
  seconds: 40,
  formatLabel: "16:9",
  width: 1920,
  height: 1080,
  fps: 30,
  weight: {
    bytes: 4_000_000,
    level: "ok",
  } as unknown as BordereauProps["weight"],
  level: "ok" as BordereauProps["level"],
  renderTime: "environ 1 min",
  firstFileName: "Al-Ikhlas.mp4",
  apiJson: "{}",
  files: [
    { name: "Al-Ikhlas.mp4", state: "run", ratio: 0.17, bytes: null },
  ] as BordereauProps["files"],
  failure: null,
  stopRequested: false,
  canLighten: false,
  onExport: noop,
  onStop: noop,
  onResume: noop,
  onFinish: noop,
  onNew: noop,
  onRedownload: noop,
  onLighten: noop,
  ...over,
});

describe("le rendu en cours", () => {
  it("connexion normale : la progression et la phrase « tu peux quitter la page », rien d'autre", () => {
    const html = renderToStaticMarkup(<Bordereau {...props()} />);
    expect(html).toContain("17 %");
    expect(html).toContain("Tu peux quitter cette page");
    expect(html).not.toContain('data-testid="bord-offline"');
  });

  it("connexion perdue : le dit en français clair, annonce que le rendu continue et que tout se rattrape", () => {
    const html = renderToStaticMarkup(
      <Bordereau {...props({ connectionLost: true })} />,
    );
    expect(html).toContain('data-testid="bord-offline"');
    expect(html).toContain("Connexion perdue");
    expect(html).toContain("Le rendu continue sur le serveur");
    expect(html).toContain("toute seule");
    // Une région d'annonce polie : le lecteur d'écran l'entend sans être interrompu.
    expect(html).toMatch(
      /role="status"[^>]*aria-live="polite"[^>]*data-testid="bord-offline"/,
    );
    // Jamais de code ni de jargon.
    expect(html).not.toMatch(/ERR_|ApiError|status 0|fetch/i);
  });
});
