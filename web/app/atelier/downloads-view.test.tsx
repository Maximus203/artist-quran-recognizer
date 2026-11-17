import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
  DownloadFileItem,
  DownloadGroup,
  DownloadJobItem,
} from "@/lib/downloads";
import { DownloadsView, type DownloadsViewProps } from "./downloads-view";

const MIO = 1024 ** 2;
const file = (over: Partial<DownloadFileItem> = {}): DownloadFileItem => ({
  kind: "file",
  id: "v1",
  name: "yusuf.mp4",
  bytes: 300 * MIO,
  created_at: "2026-11-03T14:00:00.000Z",
  launcher_name: "Awa",
  download_url: "/api/sessions/s1/videos/v1?download=1",
  can_delete: true,
  ...over,
});
const job = (over: Partial<DownloadJobItem> = {}): DownloadJobItem => ({
  kind: "job",
  id: "j1",
  state: "queued",
  progress: "En attente",
  ratio: 0,
  files_done: 0,
  files_total: null,
  error: null,
  created_at: "2026-11-03T14:05:00.000Z",
  launcher_name: "Awa",
  can_cancel: true,
  downloads: [],
  ...over,
});
const group = (
  items: DownloadGroup["items"],
  over: Partial<DownloadGroup> = {},
): DownloadGroup => ({
  session_id: "s1",
  session_name: "Sourate Yusuf",
  owner_name: "Awa",
  mine: true,
  active: 0,
  items,
  ...over,
});
const props = (over: Partial<DownloadsViewProps> = {}): DownloadsViewProps => ({
  scope: "mine",
  groups: [group([file()])],
  quota: {
    used_bytes: 500 * MIO,
    limit_bytes: 2 * 1024 ** 3,
    audio_bytes: 200 * MIO,
    video_bytes: 300 * MIO,
  },
  busyId: null,
  problem: "",
  onDelete: vi.fn(),
  onCancel: vi.fn(),
  ...over,
});
const html = (over: Partial<DownloadsViewProps> = {}) =>
  renderToStaticMarkup(<DownloadsView {...props(over)} />);
const text = (markup: string) =>
  markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("page Téléchargements : fichiers prêts", () => {
  it("chaque fichier a son téléchargement, sa génération et sa taille", () => {
    const out = html();
    expect(out).toContain('href="/api/sessions/s1/videos/v1?download=1"');
    expect(out).toContain('href="/?session=s1"');
    expect(text(out)).toContain("Sourate Yusuf");
    expect(text(out)).toContain("300 Mo");
    expect(text(out)).toContain("Prêt");
    expect(out).toContain('data-testid="dl-delete-v1"');
  });

  it("supprimer n'est pas proposé quand le fichier n'est pas à soi", () => {
    const out = html({ groups: [group([file({ can_delete: false })])] });
    expect(out).not.toContain('data-testid="dl-delete-v1"');
    expect(out).toContain('data-testid="dl-download-v1"');
  });

  it("plusieurs exports d'un même son sont regroupés dans un seul bloc repliable", () => {
    const out = html({
      groups: [group([file(), file({ id: "v2", name: "yusuf-2.mp4" })])],
    });
    expect(out.match(/<details/g)).toHaveLength(1);
    expect(out).toContain('data-testid="dl-group-s1"');
    expect(text(out)).toContain("2 vidéos");
  });
});

describe("page Téléchargements : exports en file", () => {
  it("en attente : le dit, et propose d'annuler", () => {
    const out = html({ groups: [group([job()], { active: 1 })] });
    expect(text(out)).toContain("En attente");
    expect(out).toContain('data-testid="dl-cancel-j1"');
  });

  it("en cours : pourcentage, texte d'avancement et barre accessible", () => {
    const out = html({
      groups: [
        group(
          [
            job({
              state: "running",
              ratio: 0.64,
              progress: "Vidéo 2/5 : rendu 64 %",
            }),
          ],
          { active: 1 },
        ),
      ],
    });
    expect(text(out)).toContain("En cours");
    expect(text(out)).toContain("Vidéo 2/5 : rendu 64 %");
    expect(out).toMatch(/role="progressbar"[^>]*aria-valuenow="64"/);
    expect(text(out)).toContain("1 en cours");
  });

  it("échec : le message en français est affiché, sans bouton d'annulation", () => {
    const out = html({
      groups: [
        group([
          job({
            state: "failed",
            error: "Aucune vidéo produite.",
            can_cancel: false,
          }),
        ]),
      ],
    });
    expect(text(out)).toContain("Échec");
    expect(text(out)).toContain("Aucune vidéo produite.");
    expect(out).not.toContain('data-testid="dl-cancel-j1"');
  });

  it("terminé mais non gardé : chaque vidéo se télécharge depuis la file", () => {
    const out = html({
      groups: [
        group([
          job({
            state: "done",
            can_cancel: false,
            downloads: [
              {
                name: "a.mp4",
                url: "/api/sessions/s1/export/video/jobs/j1/file",
              },
              {
                name: "b.mp4",
                url: "/api/sessions/s1/export/video/jobs/j1/file?index=1",
              },
            ],
          }),
        ]),
      ],
    });
    expect(out).toContain('href="/api/sessions/s1/export/video/jobs/j1/file"');
    expect(out).toContain("file?index=1");
    expect(text(out)).toContain("Prêt");
  });

  it("l'export en cours d'annulation est désactivé", () => {
    expect(html({ groups: [group([job()])], busyId: "j1" })).toMatch(
      /data-testid="dl-cancel-j1"[^>]*disabled|disabled[^>]*data-testid="dl-cancel-j1"/,
    );
  });
});

describe("page Téléchargements : rôles, états et espace", () => {
  it("l'utilisateur ordinaire ne voit pas qui a lancé quoi ; l'administrateur oui, avec le propriétaire", () => {
    const g = group([file()], { mine: false, owner_name: "Moussa" });
    const user = html({ groups: [g] });
    expect(text(user)).toContain("Moussa");
    const admin = html({ scope: "all", groups: [g] });
    expect(admin).toContain('data-testid="dl-launcher-v1"');
    expect(text(admin)).toContain("Tous les comptes");
    expect(user).not.toContain('data-testid="dl-launcher-v1"');
  });

  it("sans rien : explique d'où viennent les téléchargements", () => {
    expect(text(html({ groups: [] }))).toContain("Aucun téléchargement");
  });

  it("chargement : pas de liste", () => {
    expect(html({ groups: null })).toContain("Chargement");
  });

  it("la jauge dit l'espace utilisé sur 2 Go et sépare audio et vidéos", () => {
    const out = text(html());
    expect(out).toContain("500 Mo");
    expect(out).toContain("2,0 Go");
    expect(out).toContain("Audio envoyé");
    expect(out).toContain("Vidéos exportées");
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
      /data-testid="dl-delete-v1"[^>]*disabled|disabled[^>]*data-testid="dl-delete-v1"/,
    );
  });
});
