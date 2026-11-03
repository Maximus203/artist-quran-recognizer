import Link from "next/link";
import { formatClockLength } from "@/lib/format";
import { Icon } from "./icons";

/**
 * Les playlists du compte : créer, ouvrir, supprimer. Composant d'AFFICHAGE : les appels réseau vivent dans
 * `PlaylistsPane`.
 */
export type PlaylistRowView = {
  id: number;
  name: string;
  /** Audios lisibles (ceux que le compte voit). */
  count: number;
  duration_s: number;
  updated_at: string;
};

export type PlaylistsViewProps = {
  /** `null` : chargement en cours. */
  playlists: PlaylistRowView[] | null;
  name: string;
  pending: boolean;
  problem: string;
  onName: (value: string) => void;
  onCreate: (event: React.FormEvent) => void;
  onDelete: (playlist: PlaylistRowView) => void;
};

export function PlaylistsView(props: PlaylistsViewProps) {
  const { playlists, pending, problem } = props;
  return (
    <section
      style={{ display: "grid", gap: "var(--sp-5)" }}
      aria-labelledby="h-playlists"
      data-testid="playlists-pane"
    >
      <div className="card setgroup" aria-labelledby="g-playlists">
        <header>
          <h2 id="g-playlists">Nouvelle playlist</h2>
          <p>
            Regroupe des audios pour les écouter à la suite, en boucle ou dans
            un ordre aléatoire. Ajoute-les depuis la liste des sessions.
          </p>
        </header>
        <form
          className="srow2"
          style={{ gridTemplateColumns: "1fr auto", alignItems: "end" }}
          onSubmit={props.onCreate}
        >
          <label className="field">
            <span>Nom</span>
            <input
              className="input"
              value={props.name}
              maxLength={60}
              placeholder="Ex. Sourate Yusuf, révision du soir"
              data-testid="playlist-name"
              onChange={(event) => props.onName(event.target.value)}
            />
          </label>
          <button
            type="submit"
            className="btn btn--primary"
            disabled={pending}
            data-testid="playlist-create"
          >
            {pending ? "Création…" : "Créer"}
          </button>
        </form>
        {problem ? (
          <p className="notice notice--error" role="alert">
            {problem}
          </p>
        ) : null}
      </div>

      <div className="card setgroup" aria-labelledby="h-playlists">
        <header>
          <h2 id="h-playlists">Mes playlists</h2>
        </header>
        {playlists === null ? (
          <p className="mini" role="status">
            Chargement…
          </p>
        ) : playlists.length === 0 ? (
          <p className="mini">
            Aucune playlist pour le moment. Crée-en une ci-dessus, puis ajoute
            des audios depuis la page Récitations.
          </p>
        ) : (
          <ul className="api-tokens">
            {playlists.map((playlist) => (
              <li key={playlist.id} data-state="active">
                <div>
                  <Link
                    href={`/playlists/${playlist.id}`}
                    data-testid={`playlist-open-${playlist.id}`}
                  >
                    <b>{playlist.name}</b>
                  </Link>
                  <br />
                  <small>
                    {playlist.count} audio{playlist.count > 1 ? "s" : ""} ·{" "}
                    {formatClockLength(playlist.duration_s)}
                  </small>
                </div>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  data-testid={`playlist-delete-${playlist.id}`}
                  onClick={() => props.onDelete(playlist)}
                >
                  <Icon name="trash" />
                  Supprimer
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
