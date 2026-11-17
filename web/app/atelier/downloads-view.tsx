import Link from "next/link";
import type {
  DownloadFileItem,
  DownloadGroup,
  DownloadJobItem,
} from "@/lib/downloads";
import { formatBytesFr, formatRelative } from "@/lib/format";
import { storageState } from "@/lib/storage-meter";
import { Icon } from "./icons";

/**
 * Page « Téléchargements » : tout ce qui se télécharge, regroupé par génération. Les vidéos prêtes (gardées
 * sur le serveur) et les exports de la file (en attente, en cours, échoués) y sont côte à côte, avec leur
 * statut. Composant d'AFFICHAGE : les appels réseau et l'actualisation vivent dans `DownloadsPane`.
 */
export type DownloadsQuotaView = {
  used_bytes: number;
  limit_bytes: number | null;
  audio_bytes: number;
  video_bytes: number;
};

export type DownloadsViewProps = {
  /** `all` : l'administrateur voit les générations et les exports de tous les comptes. */
  scope: "mine" | "all";
  /** `null` : chargement en cours. */
  groups: DownloadGroup[] | null;
  quota: DownloadsQuotaView | null;
  /** Fichier ou export dont l'action (suppression, annulation) est en cours. */
  busyId: string | null;
  problem: string;
  onDelete: (file: DownloadFileItem, group: DownloadGroup) => void;
  onCancel: (job: DownloadJobItem, group: DownloadGroup) => void;
};

const percentOf = (ratio: number) =>
  Math.max(0, Math.min(100, Math.round(ratio * 100)));

const plural = (n: number, one: string, many: string) =>
  `${n} ${n > 1 ? many : one}`;

function JobStatus({ job }: { job: DownloadJobItem }) {
  if (job.state === "queued")
    return <span className="badge badge--outline">En attente</span>;
  if (job.state === "running")
    return (
      <span className="badge badge--ink">
        En cours · {percentOf(job.ratio)} %
      </span>
    );
  if (job.state === "done")
    return <span className="badge badge--ok">Prêt</span>;
  return <span className="badge badge--danger">Échec</span>;
}

function JobRow({
  job,
  all,
  busy,
  onCancel,
}: {
  job: DownloadJobItem;
  all: boolean;
  busy: boolean;
  onCancel: () => void;
}) {
  const running = job.state === "running";
  return (
    <li
      data-state={job.state === "failed" ? "revoked" : "active"}
      data-testid={`dl-job-${job.id}`}
      data-job-state={job.state}
      className="dl-row"
    >
      <div className="dl-main">
        <b>Export vidéo</b> <JobStatus job={job} />
        <br />
        <small>
          {formatRelative(job.created_at, Date.now())}
          {all ? (
            <>
              {" "}
              ·{" "}
              <span data-testid={`dl-launcher-${job.id}`}>
                {job.launcher_name ?? "compte supprimé"}
              </span>
            </>
          ) : null}
          {running ? ` · ${job.progress}` : ""}
        </small>
        {running ? (
          <div
            className="dl-bar"
            role="progressbar"
            aria-label="Avancement de l’export"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percentOf(job.ratio)}
            style={{ "--w": `${percentOf(job.ratio)}%` } as React.CSSProperties}
          >
            <i />
          </div>
        ) : null}
        {job.state === "failed" && job.error ? (
          <p className="notice notice--error" role="alert">
            {job.error}
          </p>
        ) : null}
      </div>
      <div className="dl-actions">
        {job.state === "done"
          ? job.downloads.map((download) => (
              <a
                key={download.url}
                className="btn btn--secondary btn--sm"
                href={download.url}
                download
              >
                <Icon name="download" />
                {download.name}
              </a>
            ))
          : null}
        {job.can_cancel ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            data-testid={`dl-cancel-${job.id}`}
            disabled={busy}
            onClick={onCancel}
          >
            <Icon name="x" />
            Annuler
          </button>
        ) : null}
      </div>
    </li>
  );
}

function FileRow({
  file,
  all,
  busy,
  onDelete,
}: {
  file: DownloadFileItem;
  all: boolean;
  busy: boolean;
  onDelete: () => void;
}) {
  return (
    <li
      data-state="active"
      data-testid={`dl-file-${file.id}`}
      className="dl-row"
    >
      <div className="dl-main">
        <b>{file.name}</b> <span className="badge badge--ok">Prêt</span>
        <br />
        <small>
          <span className="mono">{formatBytesFr(file.bytes)}</span> ·{" "}
          {formatRelative(file.created_at, Date.now())}
          {all ? (
            <>
              {" "}
              ·{" "}
              <span data-testid={`dl-launcher-${file.id}`}>
                {file.launcher_name ?? "sans compte"}
              </span>
            </>
          ) : null}
        </small>
      </div>
      <div className="dl-actions">
        <a
          className="btn btn--secondary btn--sm"
          href={file.download_url}
          download
          data-testid={`dl-download-${file.id}`}
        >
          <Icon name="download" />
          Télécharger
        </a>
        {file.can_delete ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            data-testid={`dl-delete-${file.id}`}
            disabled={busy}
            onClick={onDelete}
          >
            <Icon name="trash" />
            Supprimer
          </button>
        ) : null}
      </div>
    </li>
  );
}

function GroupBlock({
  group,
  all,
  busyId,
  onDelete,
  onCancel,
}: { group: DownloadGroup; all: boolean } & Pick<
  DownloadsViewProps,
  "busyId" | "onDelete" | "onCancel"
>) {
  const files = group.items.filter(
    (item): item is DownloadFileItem => item.kind === "file",
  ).length;
  return (
    <details
      className="card dl-group"
      open
      data-testid={`dl-group-${group.session_id}`}
    >
      <summary className="dl-summary">
        <span className="dl-title">{group.session_name}</span>
        <span className="dl-counts">
          {group.active > 0 ? (
            <span className="badge badge--ink">{group.active} en cours</span>
          ) : null}
          {files > 0 ? (
            <span className="badge badge--plain">
              {plural(files, "vidéo", "vidéos")}
            </span>
          ) : null}
        </span>
      </summary>
      <p className="mini">
        <Link
          href={`/?session=${group.session_id}`}
          data-testid={`dl-session-${group.session_id}`}
        >
          Ouvrir la récitation
        </Link>
        {!group.mine && group.owner_name ? ` · de ${group.owner_name}` : ""}
      </p>
      <ul className="api-tokens">
        {group.items.map((item) =>
          item.kind === "job" ? (
            <JobRow
              key={`j-${item.id}`}
              job={item}
              all={all}
              busy={busyId === item.id}
              onCancel={() => onCancel(item, group)}
            />
          ) : (
            <FileRow
              key={`f-${item.id}`}
              file={item}
              all={all}
              busy={busyId === item.id}
              onDelete={() => onDelete(item, group)}
            />
          ),
        )}
      </ul>
    </details>
  );
}

export function DownloadsView({
  scope,
  groups,
  quota,
  busyId,
  problem,
  onDelete,
  onCancel,
}: DownloadsViewProps) {
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
      data-testid="downloads-pane"
    >
      {quota ? (
        <div
          className="card meter-card"
          data-state={space?.state}
          data-testid="downloads-meter"
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

      <div style={{ display: "grid", gap: "var(--sp-4)" }}>
        <header>
          <h2 id="h-downloads" className="dl-h">
            {all ? "Tous les comptes" : "Mes téléchargements"}
          </h2>
          <p className="mini">
            Les exports vidéo en attente, en cours ou prêts, regroupés par
            récitation. Un export continue sur le serveur même si tu quittes la
            page. Les supprimer libère de l’espace tout de suite.
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
        {groups === null ? (
          <p className="mini" role="status">
            Chargement…
          </p>
        ) : groups.length === 0 ? (
          <p className="mini">
            Aucun téléchargement pour le moment. Les vidéos que tu exportes
            depuis une récitation apparaissent ici, avec leur avancement.
          </p>
        ) : (
          groups.map((group) => (
            <GroupBlock
              key={group.session_id}
              group={group}
              all={all}
              busyId={busyId}
              onDelete={onDelete}
              onCancel={onCancel}
            />
          ))
        )}
      </div>
    </section>
  );
}
