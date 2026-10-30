import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { UsersView, type UserRowView, type UsersViewProps } from "./users-view";

const NOW = Date.parse("2026-10-30T15:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const user = (over: Partial<UserRowView> = {}): UserRowView => ({
  id: 2,
  username: "Fatou",
  role: "user",
  disabled: false,
  created_at: ago(5 * 24 * 3600_000),
  last_login_at: ago(2 * 3600_000),
  sessions: 4,
  used_bytes: 12_500_000,
  tests: 3,
  ...over,
});
const props = (over: Partial<UsersViewProps> = {}): UsersViewProps => ({
  users: [user({ id: 1, username: "Cherif", role: "admin" }), user()],
  meId: 1,
  now: NOW,
  reveal: null,
  problem: "",
  busyId: null,
  onReset: vi.fn(),
  onToggleDisabled: vi.fn(),
  onToggleRole: vi.fn(),
  onDismissReveal: vi.fn(),
  ...over,
});
const html = (over: Partial<UsersViewProps> = {}) =>
  renderToStaticMarkup(<UsersView {...props(over)} />);
const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ");

describe("liste des comptes", () => {
  it("montre le rôle, l'usage et la dernière connexion de chacun", () => {
    const t = text(html());
    expect(t).toContain("Cherif");
    expect(t).toContain("Administrateur");
    expect(t).toContain("Fatou");
    expect(t).toContain("Testeur");
    expect(t).toContain("4 sessions");
    expect(t).toContain("il y a 2 h");
  });

  it("un compte jamais connecté le dit", () => {
    expect(text(html({ users: [user({ last_login_at: null })] }))).toContain(
      "jamais connecté",
    );
  });

  it("compte désactivé : signalé, avec l'action inverse", () => {
    const out = html({ users: [user({ disabled: true })] });
    expect(text(out)).toContain("Désactivé");
    expect(text(out)).toContain("Réactiver");
    expect(text(out)).not.toContain("Désactiver ");
  });

  it("chargement et liste vide", () => {
    expect(text(html({ users: null }))).toContain("Chargement");
    expect(text(html({ users: [] }))).toContain("Aucun compte");
  });
});

describe("actions", () => {
  it("ton propre compte n'offre aucune action (réinitialiser, désactiver, rétrograder te couperaient)", () => {
    const out = html();
    expect(out).not.toContain('data-testid="user-reset-1"');
    expect(out).not.toContain('data-testid="user-toggle-1"');
    expect(out).not.toContain('data-testid="user-role-1"');
    expect(text(out)).toContain("toi");
  });

  it("un testeur : réinitialiser, désactiver, promouvoir", () => {
    const out = html();
    expect(out).toContain('data-testid="user-reset-2"');
    expect(out).toContain('data-testid="user-toggle-2"');
    expect(out).toContain('data-testid="user-role-2"');
    expect(text(out)).toContain("Promouvoir");
  });

  it("un autre administrateur : rétrograder", () => {
    const out = html({
      users: [user({ id: 3, username: "Aminata", role: "admin" })],
    });
    expect(text(out)).toContain("Rétrograder");
  });

  it("une action en cours désactive les boutons de la ligne", () => {
    const out = html({ busyId: 2 });
    for (const kind of ["reset", "toggle", "role"]) {
      const button = new RegExp(
        `<button[^>]*data-testid="user-${kind}-2"[^>]*>`,
      ).exec(out)?.[0];
      expect(button, kind).toContain("disabled");
    }
  });
});

describe("mot de passe temporaire", () => {
  it("absent tant qu'aucune réinitialisation n'a eu lieu", () => {
    expect(html()).not.toContain('data-testid="user-reveal"');
  });

  it("montré en entier une seule fois, avec la consigne pour le transmettre", () => {
    const pw = "abcde-fghjk-mnpqr-stuvw";
    const out = html({ reveal: { username: "Fatou", password: pw } });
    expect(out).toContain('data-testid="user-reveal"');
    expect(out).toContain(pw);
    expect(out.split(pw).length - 1).toBe(1);
    const t = text(out);
    expect(t).toContain("ne sera plus jamais affiché");
    expect(t).toContain("Fatou");
    expect(t).toContain("Compte > Sécurité");
  });

  it("erreur d'une action en alerte", () => {
    const out = html({
      problem: "Tu ne peux pas retirer le dernier administrateur.",
    });
    expect(out).toContain("dernier administrateur");
    expect(out).toContain('role="alert"');
  });
});
