"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { PlaylistsView, type PlaylistRowView } from "./playlists-view";

/** Page « Playlists » : charge la liste, crée (puis ouvre) et supprime. */
export function PlaylistsPane() {
  const router = useRouter();
  const [playlists, setPlaylists] = useState<PlaylistRowView[] | null>(null);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState("");

  const load = useCallback(async () => {
    const data = await api<{ items: PlaylistRowView[] }>("/api/playlists");
    setPlaylists(data.items);
  }, []);
  useEffect(() => {
    load().catch(() => setPlaylists([]));
  }, [load]);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setProblem("");
    if (!name.trim()) {
      setProblem("Écris le nom de la playlist.");
      return;
    }
    setPending(true);
    try {
      const made = await api<{ playlist: { id: number } }>("/api/playlists", {
        method: "POST",
        json: { name },
      });
      router.push(`/playlists/${made.playlist.id}`);
    } catch (error) {
      setProblem(
        error instanceof Error ? error.message : "Création impossible.",
      );
      setPending(false);
    }
  };

  const remove = async (playlist: PlaylistRowView) => {
    if (
      !window.confirm(
        `Supprimer la playlist « ${playlist.name} » ? Les audios restent dans tes sessions.`,
      )
    )
      return;
    setProblem("");
    try {
      await api(`/api/playlists/${playlist.id}`, { method: "DELETE" });
      await load();
    } catch (error) {
      setProblem(
        error instanceof Error ? error.message : "Suppression impossible.",
      );
    }
  };

  return (
    <div
      className="page"
      style={{ maxWidth: 820 }}
      data-testid="playlists-page"
    >
      <div className="pg-title">
        <div>
          <h1>Playlists</h1>
          <p>Des audios regroupés, à écouter à la suite.</p>
        </div>
      </div>
      <PlaylistsView
        playlists={playlists}
        name={name}
        pending={pending}
        problem={problem}
        onName={setName}
        onCreate={(event) => void create(event)}
        onDelete={(playlist) => void remove(playlist)}
      />
    </div>
  );
}
