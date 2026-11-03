import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NavMenu } from "./nav-menu";

const items = [
  { id: "sessions", href: "/sessions", label: "Récitations" },
  { id: "playlists", href: "/playlists", label: "Playlists" },
];
const render = (active: string) =>
  renderToStaticMarkup(
    <NavMenu id="library" label="Bibliothèque" items={items} active={active} />,
  );

describe("groupe de la barre du haut", () => {
  it("fermé : un seul bouton, ses pages ne sont pas encore dans la page", () => {
    const html = render("revue");
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("/playlists");
  });

  it("est souligné quand la page courante est l'une de ses pages", () => {
    expect(render("playlists")).toContain('aria-current="page"');
    expect(render("revue")).not.toContain('aria-current="page"');
  });
});
