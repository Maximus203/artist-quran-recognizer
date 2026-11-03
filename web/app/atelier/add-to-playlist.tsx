"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import { formatClockLength } from "@/lib/format";
import { useFocusTrap } from "./hooks";
import { Icon } from "./icons";

type Row = { id: number; name: string; count: number; duration_s: number };
type Added = { added: number; skipped: number } | null;

/** Phrase de confirmation : combien d'audios sont entrés, combien étaient déjà là ou invisibles. */
export function addedMessage(name: string, added: Added): string {
  const n = added?.added ?? 0;
  const skipped = added?.skipped ?? 0;
  const base = `${n} audio${n > 1 ? "s" : ""} ajouté${n > 1 ? "s" : ""} à « ${name} »`;
  return skipped > 0
    ? `${base} · ${skipped} déjà présent${skipped > 1 ? "s" : ""} ou indisponible${skipped > 1 ? "s" : ""}`
    : base;
}

/**
 * « Ajouter à une playlist » : choisir une playlist existante, ou en créer une avec ces audios. Ne contient que des
 * audios que le compte voit (le serveur ignore le reste et le dit).
 */
export function AddToPlaylistDialog({
  ids,
  onClose,
  onDone,
}: {
  ids: readonly string[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  useFocusTrap(panel, true, onClose);

  useEffect(() => {
    api<{ items: Row[] }>("/api/playlists")
      .then((data) => setRows(data.items))
      .catch(() => setRows([]));
  }, []);

  const run = async (task: () => Promise<{ name: string; added: Added }>) => {
    if (busy) return;
    setBusy(true);
    setProblem("");
    try {
      const result = await task();
      onDone(addedMessage(result.name, result.added));
      onClose();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Ajout impossible.");
      setBusy(false);
    }
  };

  const addTo = (row: Row) =>
    run(async () => ({
      name: row.name,
      added: await api<Added>(`/api/playlists/${row.id}/items`, {
        method: "POST",
        json: { session_ids: ids },
      }),
    }));
  const createWith = () => {
    if (!name.trim()) {
      setProblem("Écris le nom de la nouvelle playlist.");
      return;
    }
    return run(async () => {
      const made = await api<{
        playlist: { name: string };
        added: Added;
      }>("/api/playlists", {
        method: "POST",
        json: { name, session_ids: ids },
      });
      return { name: made.playlist.name, added: made.added };
    });
  };

  return (
    <>
      <div className="sheet-scrim" aria-hidden="true" onClick={onClose} />
      <div
        ref={panel}
        className="pl-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Ajouter à une playlist"
        data-testid="playlist-dialog"
        tabIndex={-1}
      >
        <div className="pl-dialog-head">
          <h2>Ajouter à une playlist</h2>
          <button
            type="button"
            className="btn btn--ghost btn--icon btn--sm"
            aria-label="Fermer"
            onClick={onClose}
          >
            <Icon name="x" />
          </button>
        </div>
        <p className="mini">
          {ids.length} audio{ids.length > 1 ? "s" : ""} à ajouter.
        </p>
        {rows === null ? (
          <p className="mini" role="status">
            Chargement…
          </p>
        ) : rows.length === 0 ? (
          <p className="mini">Tu n’as pas encore de playlist : crée-en une.</p>
        ) : (
          <ul className="pl-pick" aria-label="Tes playlists">
            {rows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  className="pl-pick-btn"
                  disabled={busy}
                  data-testid={`playlist-pick-${row.id}`}
                  onClick={() => void addTo(row)}
                >
                  <b>{row.name}</b>
                  <small>
                    {row.count} audio{row.count > 1 ? "s" : ""} ·{" "}
                    {formatClockLength(row.duration_s)}
                  </small>
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="pl-new"
          onSubmit={(event) => {
            event.preventDefault();
            void createWith();
          }}
        >
          <input
            className="input"
            value={name}
            maxLength={60}
            placeholder="Nouvelle playlist"
            aria-label="Nom de la nouvelle playlist"
            data-testid="playlist-new-name"
            onChange={(event) => setName(event.target.value)}
          />
          <button
            type="submit"
            className="btn btn--primary btn--sm"
            disabled={busy}
            data-testid="playlist-new-create"
          >
            Créer et ajouter
          </button>
        </form>
        {problem ? (
          <p className="notice notice--error" role="alert">
            {problem}
          </p>
        ) : null}
      </div>
    </>
  );
}
