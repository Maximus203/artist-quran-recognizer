"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import type {
  DownloadFileItem,
  DownloadGroup,
  DownloadJobItem,
} from "@/lib/downloads";
import { nextDownloadsPoll } from "@/lib/downloads-poll";
import { formatBytesFr } from "@/lib/format";
import { DownloadsView, type DownloadsQuotaView } from "./downloads-view";

type Listing = {
  scope: "mine" | "all";
  groups: DownloadGroup[];
  active: number;
  quota: DownloadsQuotaView;
};

/**
 * Page « Téléchargements » : charge la liste, la rafraîchit tant qu'un export avance (il continue sur le
 * serveur même si l'on quitte la page), supprime un fichier ou annule un export à la fois.
 */
export function DownloadsPane() {
  const [listing, setListing] = useState<Listing | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [problem, setProblem] = useState("");
  const active = useRef<number | null>(null);

  const load = useCallback(async () => {
    const next = await api<Listing>("/api/downloads");
    active.current = next.active;
    setListing(next);
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        await load();
        if (!stopped) setProblem("");
      } catch (error) {
        if (!stopped)
          setProblem(
            error instanceof Error ? error.message : "Chargement impossible.",
          );
      }
      if (!stopped)
        timer = setTimeout(
          tick,
          nextDownloadsPoll(
            active.current,
            document.visibilityState === "visible",
          ),
        );
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [load]);

  const act = async (id: string, run: () => Promise<unknown>, fail: string) => {
    setProblem("");
    setBusyId(id);
    try {
      await run();
      await load();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : fail);
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (file: DownloadFileItem, group: DownloadGroup) => {
    if (
      !window.confirm(
        `Supprimer « ${file.name} » (${formatBytesFr(file.bytes)}) ? Cette vidéo ne pourra plus être téléchargée depuis le serveur.`,
      )
    )
      return;
    await act(
      file.id,
      () =>
        api(`/api/sessions/${group.session_id}/videos/${file.id}`, {
          method: "DELETE",
        }),
      "Suppression impossible.",
    );
  };

  const cancel = async (job: DownloadJobItem, group: DownloadGroup) => {
    await act(
      job.id,
      () =>
        api(`/api/sessions/${group.session_id}/export/video/jobs/${job.id}`, {
          method: "DELETE",
        }),
      "Annulation impossible.",
    );
  };

  return (
    <div
      className="page"
      style={{ maxWidth: 820 }}
      data-testid="downloads-page"
    >
      <div className="pg-title">
        <div>
          <h1>Téléchargements</h1>
          <p>Tes exports vidéo : leur avancement, puis leur téléchargement.</p>
        </div>
      </div>
      <DownloadsView
        scope={listing?.scope ?? "mine"}
        groups={listing?.groups ?? null}
        quota={listing?.quota ?? null}
        busyId={busyId}
        problem={problem}
        onDelete={(file, group) => void remove(file, group)}
        onCancel={(job, group) => void cancel(job, group)}
      />
    </div>
  );
}
