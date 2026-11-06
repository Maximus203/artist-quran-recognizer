import Link from "next/link";
import { formatBytesFr, formatRelative } from "@/lib/format";
import { storageState } from "@/lib/storage-meter";
import { Icon } from "./icons";

/**
 * Fichiers téléchargeables gardés sur le serveur (vidéos exportées) : les télécharger, les supprimer pour
 * libérer de l'espace. Composant d'AFFICHAGE : les appels réseau vivent dans `FilesPane`.
 */
export type FileRowView = {
  id: string;
  session_id: string;
  session_name: string;
  owner_name: string | null;
  mine: boolean;
  name: string;
  bytes: number;
  created_at: string;
  download_url: string;
};

export type FilesQuotaView = {
  used_bytes: number;
  limit_bytes: number | null;
  audio_bytes: number;
  video_bytes: number;
};

export type FilesViewProps = {
  /** `all` : l'administrateur voit les fichiers de tous les comptes. */
  scope: "mine" | "all";
  /** `null` : chargement en cours. */
  files: FileRowView[] | null;
  quota: FilesQuotaView | null;
  /** Fichier dont la suppression est en cours. */
  busyId: string | null;
  problem: string;
  onDelete: (file: FileRowView) => void;
};

export function FilesView({
  scope,
  files,
  quota,
  busyId,
  problem,
  onDelete,
}: FilesViewProps) {
  const all = scope === "all";
  const space = quota
    ? storageState({
        used_bytes: quota.used_bytes,
        limit_bytes: quota.limit_bytes,
      })
    : null;
  return (
    <section
      style={{ display: "grid", gap: "var(--sp-5)" }}
      data-testid="files-pane"
    >
      {quota ? (
        <div
          className="card meter-card"
          data-state={space?.state}
          data-testid="files-meter"
        >
          <div className="meter-head">
            <div>
              <p className="eyebrow">Mon espace</p>
              <p className="big">
                {formatBytesFr(quota.used_bytes)}{" "}
                <small>
                  {quota.limit_bytes
                    ? `sur ${formatBytesFr(quota.limit_bytes)}`
                    : "utilisés"}
                </small>
              </p>
            </div>
          </div>
          {quota.limit_bytes ? (
            <div
              className="meter"
              role="meter"
              aria-label="Espace utilisé"
              aria-valuemin={0}
              aria-valuemax={quota.limit_bytes}
              aria-valuenow={Math.min(quota.used_bytes, quota.limit_bytes)}
              aria-valuetext={`${formatBytesFr(quota.used_bytes)} utilisés sur ${formatBytesFr(quota.limit_bytes)}`}
            >
              <span
                className="m aud"
                style={
                  {
                    "--w": `${(quota.audio_bytes / quota.limit_bytes) * 100}%`,
                  } as React.CSSProperties
                }
              />
              <span
                className="m vid"
                style={
                  {
                    "--w": `${(quota.video_bytes / quota.limit_bytes) * 100}%`,
                  } as React.CSSProperties
                }
              />
              <span className="tick" aria-hidden="true" />
            </div>
          ) : null}
          <ul className="meter-legend" aria-label="Légende du stockage">
            <li>
              <span>
                Audio envoyé ·{" "}
                <b className="mono">{formatBytesFr(quota.audio_bytes)}</b>
              </span>
            </li>
            <li>
              <span>
                Vidéos exportées ·{" "}
                <b className="mono">{formatBytesFr(quota.video_bytes)}</b>
              </span>
            </li>
          </ul>
          {space?.state === "full" ? (
            <p className="notice notice--error" role="alert">
              Espace plein : tu ne peux plus envoyer d’audio ni garder de
              nouvelles vidéos. Supprime des fichiers ci-dessous pour libérer de
              la place.
            </p>
          ) : space?.state === "warn" ? (
            <p className="notice notice--warn" role="status">
              Espace presque plein. Supprime les vidéos dont tu n’as plus
              besoin.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="card setgroup" aria-labelledby="h-files">
        <header>
          <h2 id="h-files">{all ? "Tous les comptes" : "Mes fichiers"}</h2>
          <p>
            Les vidéos exportées gardées sur le serveur, les plus lourdes
            d’abord. Les supprimer libère de l’espace tout de suite.
            {all
              ? " En tant qu’administrateur, tu vois ceux de tous les comptes."
              : ""}
          </p>
        </header>
        {problem ? (
          <p className="notice notice--error" role="alert">
            {problem}
          </p>
        ) : null}
        {files === null ? (
          <p className="mini" role="status">
            Chargement…
          </p>
        ) : files.length === 0 ? (
          <p className="mini">
            Aucun fichier gardé pour le moment. Les vidéos que tu exportes
            depuis une récitation apparaissent ici.
          </p>
        ) : (
          <ul className="api-tokens">
            {files.map((file) => (
              <li key={file.id} data-state="active">
                <div>
                  <b>{file.name}</b>
                  <br />
                  <small>
                    <Link
                      href={`/?session=${file.session_id}`}
                      data-testid={`file-session-${file.id}`}
                    >
                      {file.session_name}
                    </Link>{" "}
                    · <span className="mono">{formatBytesFr(file.bytes)}</span>{" "}
                    · {formatRelative(file.created_at, Date.now())}
                    {all ? (
                      <>
                        {" "}
                        ·{" "}
                        <span data-testid={`file-owner-${file.id}`}>
                          {file.owner_name ?? "sans compte"}
                        </span>
                      </>
                    ) : null}
                  </small>
                </div>
                <div style={{ display: "flex", gap: "var(--sp-2)" }}>
                  <a
                    className="btn btn--secondary btn--sm"
                    href={file.download_url}
                    download
                    data-testid={`file-download-${file.id}`}
                  >
                    <Icon name="download" />
                    Télécharger
                  </a>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    data-testid={`file-delete-${file.id}`}
                    disabled={busyId === file.id}
                    onClick={() => onDelete(file)}
                  >
                    <Icon name="trash" />
                    Supprimer
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
