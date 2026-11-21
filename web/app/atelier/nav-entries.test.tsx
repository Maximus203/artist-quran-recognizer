import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Role } from "@/lib/users";
import { navLeaves, navTree } from "./nav-entries";
import { DrawerNav, SheetNav } from "./sheet-nav";

const ROLES: Role[] = ["admin", "user", "recitant"];
const anchors = (html: string) =>
  [...html.matchAll(/<a [^>]*>/g)].map((m) => m[0]);
const hrefsOf = (html: string) =>
  anchors(html).map((a) => /href="([^"]+)"/.exec(a)![1]);

describe("navigation : une seule source pour le bureau et le téléphone", () => {
  for (const role of ROLES) {
    it(`${role} : toute entrée de la barre du haut existe dans la feuille du téléphone`, () => {
      const wanted = navLeaves(navTree(role)).map((l) => l.href);
      const sheet = hrefsOf(
        renderToStaticMarkup(<SheetNav role={role} active="revue" />),
      );
      expect(wanted.length).toBeGreaterThan(0);
      for (const href of wanted) expect(sheet).toContain(href);
    });

    it(`${role} : la feuille n'ajoute aucune page que la barre ne connaît pas`, () => {
      const known = new Set(navLeaves(navTree(role)).map((l) => l.href));
      const sheet = hrefsOf(
        renderToStaticMarkup(<SheetNav role={role} active="revue" />),
      );
      for (const href of sheet) expect(known.has(href)).toBe(true);
    });
  }

  for (const role of ROLES) {
    it(`${role} : le tiroir de gauche offre les mêmes pages que la barre, ni plus ni moins`, () => {
      const wanted = navLeaves(navTree(role)).map((l) => l.href);
      const drawer = hrefsOf(renderToStaticMarkup(<DrawerNav role={role} />));
      for (const href of wanted) expect(drawer).toContain(href);
      for (const href of drawer) expect([...wanted, "/compte"]).toContain(href);
    });
  }

  it("le récitateur ne voit ni la performance, ni le direct, ni l'administration", () => {
    const hrefs = navLeaves(navTree("recitant")).map((l) => l.href);
    expect(hrefs).toContain("/telechargements");
    expect(hrefs).not.toContain("/performance");
    expect(hrefs).not.toContain("/direct");
    expect(hrefs.some((h) => h.startsWith("/gestion"))).toBe(false);
  });

  it("le testeur n'a pas l'administration ; l'administrateur a ses trois sections", () => {
    expect(
      navLeaves(navTree("user")).some((l) => l.href.startsWith("/gestion")),
    ).toBe(false);
    const admin = navLeaves(navTree("admin")).map((l) => l.href);
    expect(admin).toEqual(
      expect.arrayContaining([
        "/gestion/moteur",
        "/gestion/comptes",
        "/gestion/invitations",
        "/telechargements",
        "/direct",
      ]),
    );
  });

  it("la page courante est signalée dans la feuille (aria-current)", () => {
    const html = renderToStaticMarkup(
      <SheetNav role="admin" active="downloads" />,
    );
    const current = anchors(html).filter((a) =>
      a.includes('aria-current="page"'),
    );
    expect(current).toHaveLength(1);
    expect(current[0]).toContain('href="/telechargements"');
  });

  it("aucun composant n'a sa propre liste de pages (le menu du compte et la barre lisent la source)", () => {
    const dir = path.join(__dirname);
    for (const file of ["account-menu.tsx", "header.tsx", "admin-frame.tsx"]) {
      const source = readFileSync(path.join(dir, file), "utf8");
      expect(source, file).not.toMatch(/href:\s*"\/(sessions|playlists)"/);
      expect(source, file).not.toMatch(/href:\s*"\/gestion\//);
    }
  });
});
