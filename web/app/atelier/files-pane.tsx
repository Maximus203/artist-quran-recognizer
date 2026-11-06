"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { formatBytesFr } from "@/lib/format";
import { FilesView, type FileRowView, type FilesQuotaView } from "./files-view";

type Listing = {
  scope: "mine" | "all";
  files: FileRowView[];
  quota: FilesQuotaView;
};

/** Page « Fichiers » : charge l'inventaire et supprime un fichier à la fois (puis recharge l'espace). */
export function FilesPane() {
  const [listing, setListing] = useState<Listing | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [problem, setProblem] = useState("");

  const load = useCallback(async () => {
    setListing(await api<Listing>("/api/files"));
  }, []);
  useEffect(() => {
    load().catch((error) =>
      setProblem(
        error instanceof Error ? error.message : "Chargement impossible.",
      ),
    );
  }, [load]);

  const remove = async (file: FileRowView) => {
    if (
      !window.confirm(
        `Supprimer « ${file.name} » (${formatBytesFr(file.bytes)}) ? Cette vidéo ne pourra plus être téléchargée depuis le serveur.`,
      )
    )
      return;
    setProblem("");
    setBusyId(file.id);
    try {
      await api(`/api/sessions/${file.session_id}/videos/${file.id}`, {
        method: "DELETE",
      });
      await load();
    } catch (error) {
      setProblem(
        error instanceof Error ? error.message : "Suppression impossible.",
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="page" style={{ maxWidth: 820 }} data-testid="files-page">
      <div className="pg-title">
        <div>
          <h1>Fichiers</h1>
          <p>Tout ce qui est téléchargeable et gardé sur le serveur.</p>
        </div>
      </div>
      <FilesView
        scope={listing?.scope ?? "mine"}
        files={listing?.files ?? null}
        quota={listing?.quota ?? null}
        busyId={busyId}
        problem={problem}
        onDelete={(file) => void remove(file)}
      />
    </div>
  );
}
