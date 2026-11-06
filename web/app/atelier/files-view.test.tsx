import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FilesView, type FileRowView, type FilesViewProps } from "./files-view";

const MIO = 1024 ** 2;
const row = (over: Partial<FileRowView> = {}): FileRowView => ({
  id: "v1",
  session_id: "s1",
  session_name: "Sourate Yusuf",
  owner_name: "Awa",
  mine: true,
  name: "yusuf.mp4",
  bytes: 300 * MIO,
  created_at: "2026-11-03T14:00:00.000Z",
  download_url: "/api/sessions/s1/videos/v1?download=1",
  ...over,
});
const props = (over: Partial<FilesViewProps> = {}): FilesViewProps => ({
  scope: "mine",
  files: [row()],
  quota: {
    used_bytes: 500 * MIO,
    limit_bytes: 2 * 1024 ** 3,
    audio_bytes: 200 * MIO,
    video_bytes: 300 * MIO,
  },
  busyId: null,
  problem: "",
  onDelete: vi.fn(),
  ...over,
});
const html = (over: Partial<FilesViewProps> = {}) =>
  renderToStaticMarkup(<FilesView {...props(over)} />);
const text = (markup: string) =>
  markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("page Fichiers", () => {
  it("chaque fichier a son téléchargement, sa session et sa taille", () => {
    const out = html();
    expect(out).toContain('href="/api/sessions/s1/videos/v1?download=1"');
    expect(out).toContain('href="/?session=s1"');
    expect(text(out)).toContain("Sourate Yusuf");
    expect(text(out)).toContain("300 Mo");
    expect(out).toContain('data-testid="file-delete-v1"');
  });

  it("la jauge dit l'espace utilisé sur 2 Go et sépare audio et vidéos", () => {
    const out = text(html());
    expect(out).toContain("500 Mo");
    expect(out).toContain("2,0 Go");
    expect(out).toContain("Audio envoyé");
    expect(out).toContain("Vidéos exportées");
  });

  it("l'utilisateur ordinaire ne voit pas de colonne propriétaire ; l'administrateur oui", () => {
    expect(html()).not.toContain('data-testid="file-owner-v1"');
    const admin = html({ scope: "all" });
    expect(admin).toContain('data-testid="file-owner-v1"');
    expect(text(admin)).toContain("Awa");
    expect(text(admin)).toContain("Tous les comptes");
  });

  it("sans fichier : explique d'où ils viennent", () => {
    const out = text(html({ files: [] }));
    expect(out).toContain("Aucun fichier");
  });

  it("chargement : pas de liste", () => {
    expect(html({ files: null })).toContain("Chargement");
  });

  it("espace plein : le message dit de supprimer pour libérer de la place", () => {
    const out = text(
      html({
        quota: {
          used_bytes: 2 * 1024 ** 3,
          limit_bytes: 2 * 1024 ** 3,
          audio_bytes: 1024 ** 3,
          video_bytes: 1024 ** 3,
        },
      }),
    );
    expect(out).toContain("Espace plein");
  });

  it("le fichier en cours de suppression est désactivé", () => {
    expect(html({ busyId: "v1" })).toMatch(
      /data-testid="file-delete-v1"[^>]*disabled|disabled[^>]*data-testid="file-delete-v1"/,
    );
  });
});
