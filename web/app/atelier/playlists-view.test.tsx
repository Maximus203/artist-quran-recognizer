import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  PlaylistsView,
  type PlaylistRowView,
  type PlaylistsViewProps,
} from "./playlists-view";

const row = (over: Partial<PlaylistRowView> = {}): PlaylistRowView => ({
  id: 3,
  name: "Sourate Yusuf",
  count: 4,
  duration_s: 3725,
  updated_at: "2026-11-03T14:00:00.000Z",
  ...over,
});
const props = (over: Partial<PlaylistsViewProps> = {}): PlaylistsViewProps => ({
  playlists: [row()],
  name: "",
  pending: false,
  problem: "",
  onName: vi.fn(),
  onCreate: vi.fn(),
  onDelete: vi.fn(),
  ...over,
});
const html = (over: Partial<PlaylistsViewProps> = {}) =>
  renderToStaticMarkup(<PlaylistsView {...props(over)} />);
const text = (markup: string) =>
  markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("liste des playlists", () => {
  it("chaque playlist ouvre son lecteur et dit combien d'audios et quelle durée", () => {
    const out = html();
    expect(out).toContain('href="/playlists/3"');
    expect(text(out)).toContain("Sourate Yusuf");
    expect(text(out)).toContain("4 audios");
    expect(text(out)).toContain("1:02:05");
    expect(out).toContain('data-testid="playlist-delete-3"');
  });

  it("sans playlist : un message qui dit comment en créer", () => {
    expect(text(html({ playlists: [] }))).toContain("Aucune playlist");
  });

  it("chargement : aucune ligne, pas de message d'absence", () => {
    const out = html({ playlists: null });
    expect(text(out)).not.toContain("Aucune playlist");
    expect(out).not.toContain("playlist-delete-");
  });

  it("le formulaire de création est toujours là, et désactivé pendant l'envoi", () => {
    expect(html()).toContain('data-testid="playlist-name"');
    const sending = html({ pending: true });
    const tag = /<button(?=[^>]*data-testid="playlist-create")[^>]*>/.exec(
      sending,
    )?.[0];
    expect(tag).toContain("disabled");
  });

  it("un problème s'affiche en alerte", () => {
    expect(html({ problem: "Nom trop long." })).toContain("Nom trop long.");
  });
});
