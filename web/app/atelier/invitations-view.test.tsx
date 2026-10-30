import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  InvitationsView,
  type InvitationRowView,
  type InvitationsViewProps,
} from "./invitations-view";

const NOW = Date.parse("2026-10-30T15:00:00.000Z");
const day = (n: number) => new Date(NOW + n * 86_400_000).toISOString();
const row = (over: Partial<InvitationRowView> = {}): InvitationRowView => ({
  id: 1,
  label: "Aminata",
  prefix: "AbCdEf",
  created_by: 1,
  created_at: day(-2),
  expires_at: day(12),
  max_uses: 1,
  uses: 0,
  last_used_at: null,
  revoked_at: null,
  ...over,
});
const props = (
  over: Partial<InvitationsViewProps> = {},
): InvitationsViewProps => ({
  invitations: [row()],
  now: NOW,
  fresh: null,
  problem: "",
  label: "",
  days: "14",
  maxUses: "1",
  pending: false,
  onLabel: vi.fn(),
  onDays: vi.fn(),
  onMaxUses: vi.fn(),
  onCreate: vi.fn(),
  onRevoke: vi.fn(),
  onCopy: vi.fn(),
  onDismissFresh: vi.fn(),
  ...over,
});
const html = (over: Partial<InvitationsViewProps> = {}) =>
  renderToStaticMarkup(<InvitationsView {...props(over)} />);
const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ");

describe("liste", () => {
  it("états lisibles : active, épuisée, expirée, révoquée", () => {
    const t = text(
      html({
        invitations: [
          row({ id: 1, label: "Active" }),
          row({ id: 2, label: "Epuisee", uses: 1 }),
          row({ id: 3, label: "Expiree", expires_at: day(-1) }),
          row({ id: 4, label: "Revoquee", revoked_at: day(-1) }),
        ],
      }),
    );
    for (const label of ["Active", "Épuisée", "Expirée", "Révoquée"])
      expect(t).toContain(label);
    expect(t).toContain("qui est invité");
  });

  it("montre les inscriptions utilisées, l'expiration et la dernière ouverture", () => {
    const t = text(
      html({
        invitations: [row({ max_uses: 3, uses: 2, last_used_at: day(0) })],
      }),
    );
    expect(t).toContain("2 / 3 inscriptions");
    expect(t).toContain("expire le");
    expect(t).toContain("à l'instant");
  });

  it("jamais le jeton : seulement son préfixe", () => {
    const out = html();
    expect(text(out)).toContain("inv_AbCdEf…");
    expect(out).not.toMatch(/inv_[A-Za-z0-9_-]{22}/);
  });

  it("révoquer n'est proposé que pour une invitation qui ouvre encore l'accès", () => {
    const out = html({
      invitations: [
        row({ id: 1 }),
        row({ id: 2, uses: 1 }), // épuisée : l'accès marche encore, on peut la révoquer
        row({ id: 3, expires_at: day(-1) }),
        row({ id: 4, revoked_at: day(-1) }),
      ],
    });
    expect(out).toContain('data-testid="invitation-revoke-1"');
    expect(out).toContain('data-testid="invitation-revoke-2"');
    expect(out).not.toContain('data-testid="invitation-revoke-3"');
    expect(out).not.toContain('data-testid="invitation-revoke-4"');
  });

  it("chargement et liste vide", () => {
    expect(text(html({ invitations: null }))).toContain("Chargement");
    expect(text(html({ invitations: [] }))).toContain("Aucune invitation");
  });
});

describe("création et lien montré une seule fois", () => {
  const link =
    "https://quran-tr.artist-dev.com/access?invitation=inv_" + "A".repeat(22);

  it("sans lien frais : aucun bloc de lien", () => {
    expect(html()).not.toContain('data-testid="invitation-fresh"');
  });

  it("lien frais : le lien entier, un message prêt à envoyer, et l'avertissement", () => {
    const out = html({
      fresh: { label: "Aminata", link, expires_at: day(14) },
    });
    expect(out).toContain('data-testid="invitation-fresh"');
    expect(out).toContain(link);
    const t = text(out);
    expect(t).toContain("ne sera plus jamais affiché");
    expect(t).toContain("Aminata");
    expect(t).toContain("valable jusqu'au");
  });

  it("le lien n'apparaît que dans son bloc (pas deux fois comme texte brut hors message)", () => {
    const out = html({ fresh: { label: "x", link, expires_at: day(14) } });
    // une fois dans la case du lien, une fois dans le message prêt à copier
    expect(out.split(link).length - 1).toBe(2);
  });

  it("choix de durée et de nombre d'inscriptions proposés", () => {
    const out = html();
    for (const v of ["7", "14", "30", "90"])
      expect(out).toContain(`value="${v}"`);
    expect(out).toContain('data-testid="invitation-days"');
    expect(out).toContain('data-testid="invitation-max-uses"');
  });

  it("erreur en alerte ; bouton désactivé pendant l'envoi", () => {
    expect(html({ problem: "50 invitations actives au plus." })).toContain(
      'role="alert"',
    );
    const button = /<button[^>]*data-testid="invitation-create"[^>]*>/.exec(
      html({ pending: true }),
    )?.[0];
    expect(button).toContain("disabled");
  });
});
