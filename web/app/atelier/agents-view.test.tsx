import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AgentsView, type AgentsViewProps } from "./agents-view";

const NOW = Date.parse("2026-10-30T15:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const row = (over: Record<string, unknown> = {}) => ({
  id: 1,
  name: "atlas",
  prefix: "JJQuynVR",
  created_by: 1,
  created_at: ago(3600_000),
  last_seen_at: ago(10_000),
  revoked_at: null,
  priority: 10,
  ...over,
});
const props = (over: Partial<AgentsViewProps> = {}): AgentsViewProps => ({
  online: true,
  remote: true,
  queue: { waiting: 0, leased: 0 },
  agents: [row()],
  now: NOW,
  fresh: null,
  problem: "",
  name: "",
  pending: false,
  onName: vi.fn(),
  onCreate: vi.fn(),
  onRevoke: vi.fn(),
  onMove: vi.fn(),
  onDismissFresh: vi.fn(),
  ...over,
});
const html = (over: Partial<AgentsViewProps> = {}) =>
  renderToStaticMarkup(<AgentsView {...props(over)} />);
const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ");

describe("bandeau d'état du moteur", () => {
  it("en ligne : le dit, et ne crie pas", () => {
    const out = html();
    expect(text(out)).toContain("Moteur en ligne");
    expect(out).not.toContain('role="alert"');
  });

  it("hors ligne avec des analyses en attente : dit combien et pourquoi c'est bloqué", () => {
    const out = html({
      online: false,
      queue: { waiting: 3, leased: 0 },
      agents: [row({ last_seen_at: ago(3 * 3600_000) })],
    });
    expect(text(out)).toContain("Aucun agent en ligne");
    expect(text(out)).toContain("3 analyses attendent");
    expect(out).toContain('role="alert"');
  });

  it("hors ligne sans analyse : avertit sans alarmer", () => {
    const out = html({ online: false, queue: { waiting: 0, leased: 0 } });
    expect(text(out)).toContain("Aucun agent en ligne");
    expect(text(out)).not.toContain("attendent");
  });

  it("moteur local (pas de moteur à distance) : l'explique au lieu de réclamer un agent", () => {
    const out = html({ remote: false, online: false, queue: null });
    expect(text(out)).toContain("moteur tourne sur cette machine");
    expect(text(out)).not.toContain("Aucun agent en ligne");
  });
});

describe("liste des agents", () => {
  it("affiche l'état de chacun, sans jamais le jeton entier", () => {
    const out = html({
      agents: [
        row({ id: 1, name: "atlas" }),
        row({ id: 2, name: "poste GPU", last_seen_at: ago(3 * 3600_000) }),
        row({ id: 3, name: "neuf", last_seen_at: null }),
        row({ id: 4, name: "ancien", revoked_at: ago(1000) }),
      ],
    });
    const t = text(out);
    expect(t).toContain("En ligne");
    expect(t).toContain("Silencieux");
    expect(t).toContain("Jamais vu");
    expect(t).toContain("Révoqué");
    expect(t).toContain("qea_JJQuynVR…");
    expect(t).toContain("il y a 3 h");
    expect(out).not.toMatch(/qea_[A-Za-z0-9_-]{43}/);
  });

  it("propose de révoquer un agent actif, jamais un agent déjà révoqué", () => {
    const out = html({
      agents: [row({ id: 1 }), row({ id: 4, revoked_at: ago(1000) })],
    });
    expect(out).toContain('data-testid="agent-revoke-1"');
    expect(out).not.toContain('data-testid="agent-revoke-4"');
  });

  it("liste vide : dit quoi faire", () => {
    expect(text(html({ agents: [] }))).toContain("Aucun agent");
  });

  it("chargement en cours", () => {
    expect(text(html({ agents: null }))).toContain("Chargement");
  });
});

describe("création d'un agent et jeton montré une seule fois", () => {
  it("sans jeton frais : aucun bloc de jeton", () => {
    expect(html()).not.toContain('data-testid="agent-fresh"');
  });

  it("avec un jeton frais : le montre en entier, dit qu'il ne reviendra pas, et la marche à suivre", () => {
    const token = "qea_" + "A".repeat(43);
    const out = html({ fresh: { name: "poste GPU", token } });
    expect(out).toContain('data-testid="agent-fresh"');
    expect(out).toContain(token);
    expect(text(out)).toContain("ne sera plus jamais affiché");
    expect(text(out)).toContain("/etc/aqr/engine-agent.token");
  });

  it("le jeton n'apparaît qu'une fois dans la page (pas dans la liste)", () => {
    const token = "qea_" + "B".repeat(43);
    const out = html({ fresh: { name: "x", token } });
    expect(out.split(token).length - 1).toBe(1);
  });

  it("affiche l'erreur de création en alerte", () => {
    const out = html({ problem: "5 agents actifs au plus." });
    expect(out).toContain("5 agents actifs au plus.");
    expect(out).toContain('role="alert"');
  });

  it("bouton de création désactivé pendant l'envoi", () => {
    const button = /<button[^>]*data-testid="agent-create"[^>]*>/.exec(
      html({ pending: true }),
    )?.[0];
    expect(button).toContain("disabled");
    const idle = /<button[^>]*data-testid="agent-create"[^>]*>/.exec(
      html(),
    )?.[0];
    expect(idle).not.toContain("disabled");
  });
});

describe("ordre de préférence (premier choix / secours)", () => {
  const two = () => [
    row({ id: 2, name: "REVERB", priority: 10 }),
    row({ id: 1, name: "atlas", priority: 20 }),
  ];

  it("le premier agent actif est le premier choix, les suivants le secours", () => {
    const t = text(html({ agents: two() }));
    expect(t.indexOf("REVERB")).toBeLessThan(t.indexOf("atlas"));
    expect(t).toContain("Premier choix");
    expect(t).toContain("Secours");
    expect(t.split("Premier choix").length - 1).toBe(1);
  });

  it("un agent révoqué n'a pas de rang et ne compte pas dans l'ordre", () => {
    const out = html({
      agents: [
        row({ id: 2, name: "REVERB", priority: 10 }),
        row({ id: 3, name: "ancien", priority: 15, revoked_at: ago(1000) }),
        row({ id: 1, name: "atlas", priority: 20 }),
      ],
    });
    expect(out).not.toContain('data-testid="agent-up-3"');
    expect(out).not.toContain('data-testid="agent-down-3"');
    expect(out).not.toContain('data-testid="agent-rank-3"');
    expect(out).toContain('data-testid="agent-rank-2"');
    expect(out).toContain('data-testid="agent-rank-1"');
  });

  it("monter est désactivé pour le premier, descendre pour le dernier", () => {
    const out = html({ agents: two() });
    const button = (id: string) =>
      new RegExp(`<button[^>]*data-testid="${id}"[^>]*>`).exec(out)?.[0];
    expect(button("agent-up-2")).toContain("disabled");
    expect(button("agent-down-2")).not.toContain("disabled");
    expect(button("agent-up-1")).not.toContain("disabled");
    expect(button("agent-down-1")).toContain("disabled");
  });

  it("un seul agent : pas de notion de secours, aucun bouton d'ordre", () => {
    const out = html({ agents: [row({ id: 1 })] });
    expect(out).not.toContain('data-testid="agent-up-1"');
    expect(text(out)).not.toContain("Secours");
  });

  it("explique la règle de repli", () => {
    expect(text(html({ agents: two() }))).toContain(
      "Le secours ne travaille que si le premier choix est éteint ou occupé",
    );
  });
});
