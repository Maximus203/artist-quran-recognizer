"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import type { ApiSession } from "@/lib/api-types";
import { formatBytesFr, formatClockLength } from "@/lib/format";
import {
  buildRow,
  engineLabel,
  formatListDate,
  isVideoSession,
} from "@/lib/session-list";
import { Icon, SessionGlyph, type IconName } from "./icons";
import { FavButton, NameEditor, ScopeBadge, useDismiss } from "./session-bits";

export type RowActions = {
  onFavorite: (s: ApiSession) => void;
  onRename: (s: ApiSession, name: string | null) => void | Promise<void>;
  onVisibility: (s: ApiSession, visibility: "global" | "private") => void;
  onArchive: (s: ApiSession, archived: boolean) => void;
  onDelete: (s: ApiSession) => void;
};

type Props = {
  session: ApiSession;
  now: number;
  selected: boolean;
  onSelect: (selected: boolean) => void;
  actions: RowActions;
  archivedScope: boolean;
};

const ownerLabel = (s: ApiSession): string =>
  s.mine ? "Moi" : (s.owner?.username ?? "Avant les comptes");

/** Une session dans la liste complète : ligne de tableau sur grand écran, carte sur téléphone. */
export function SessionListRow({
  session: s,
  now,
  selected,
  onSelect,
  actions,
  archivedScope,
}: Props) {
  const row = buildRow(s, now);
  const video = isVideoSession(s);
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState<null | "global" | "delete">(null);
  const [renaming, setRenaming] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  useDismiss(
    menu,
    () => {
      setMenu(false);
      setConfirm(null);
    },
    menuRef,
    moreRef,
  );
  const close = () => {
    setMenu(false);
    setConfirm(null);
  };
  const duration = s.audio_duration_s
    ? formatClockLength(s.audio_duration_s)
    : "—";
  const size = formatBytesFr(s.size_bytes);
  const engine = engineLabel(s.engine ?? s.asr) || "—";
  const when = formatListDate(s.created_at, now);
  const fullDate = new Date(s.created_at).toLocaleString("fr-FR");
  const scope = <ScopeBadge visibility={s.visibility} />;

  const item = (
    icon: IconName,
    label: string,
    run: () => void,
    extra?: { danger?: boolean; testid?: string },
  ) => (
    <button
      type="button"
      role="menuitem"
      className={`menu-item${extra?.danger ? " menu-item--danger" : ""}`}
      data-testid={extra?.testid}
      onClick={run}
    >
      <Icon name={icon} />
      {label}
    </button>
  );

  return (
    <li
      className="srow"
      data-testid="session-item"
      data-id={s.id}
      data-state={row.glyph}
      data-sel={selected}
      data-unread={row.unread ? "true" : undefined}
    >
      <span className="chk">
        <label className="check">
          <input
            type="checkbox"
            checked={selected}
            aria-label={`Sélectionner « ${s.name} »`}
            onChange={(event) => onSelect(event.target.checked)}
          />
        </label>
      </span>
      <span className="sg">
        <SessionGlyph
          state={row.glyph}
          rank={row.rank}
          progress={row.progress}
        />
      </span>
      {renaming ? (
        <div className="sname">
          <NameEditor
            initial={s.name}
            className="input"
            onCancel={() => setRenaming(false)}
            onSubmit={(value) => {
              setRenaming(false);
              void actions.onRename(s, value === "" ? null : value);
            }}
          />
        </div>
      ) : (
        <Link
          className="sname"
          href={`/?session=${s.id}`}
          data-testid="open-session"
        >
          <b>
            {s.visibility === "private" ? (
              <>
                <Icon name="lock" className="i-lock-inline" />
                <span className="sr">Privée · </span>
              </>
            ) : null}
            {s.name}
            {row.unread ? (
              <>
                <span className="unread" aria-hidden="true" />
                <span className="sr"> Non lue</span>
              </>
            ) : null}
          </b>
          <span className="sstat">{row.status}</span>
          {s.content_label ? (
            <span className="sdet" data-testid="content-label">
              Contenu détecté : <b>{s.content_label}</b>
            </span>
          ) : null}
        </Link>
      )}
      <span className="smeta">
        <span className="ic">
          <Icon name={video ? "video" : "audio"} />
          <span className="sr">{video ? "Vidéo" : "Audio"}</span>
          <span className="mono">{duration}</span>
        </span>
        <span className="ic mono">{size}</span>
        <span>{engine}</span>
        {s.mine ? null : (
          <span className="ic">
            <Icon name="user" />
            {ownerLabel(s)}
          </span>
        )}
        {scope}
        <span className="mono" title={fullDate}>
          {when}
        </span>
      </span>
      <span className="sown">
        {s.mine ? (
          <span className="muted">Moi</span>
        ) : (
          <span title={`Propriétaire : ${ownerLabel(s)}`}>{ownerLabel(s)}</span>
        )}
      </span>
      <span className="sscope">{scope}</span>
      <span className="sdur">
        <span className="sr">Durée : </span>
        {duration}
      </span>
      <span className="ssize">
        <span className="sr">Taille : </span>
        {size}
      </span>
      <span className="seng">{engine}</span>
      <span className="sdate" title={fullDate}>
        {when}
      </span>
      <FavButton
        favorite={s.favorite}
        name={s.name}
        onToggle={() => actions.onFavorite(s)}
      />
      <button
        ref={moreRef}
        type="button"
        className="more"
        data-testid="row-more"
        aria-haspopup="menu"
        aria-expanded={menu}
        aria-label={`Actions pour « ${s.name} »`}
        onClick={() => setMenu((v) => !v)}
      >
        <Icon name="more" />
      </button>
      {row.glyph === "running" ? (
        <span className="sbar" aria-hidden="true">
          <i
            style={
              row.progress === null
                ? undefined
                : ({
                    "--p": `${Math.round(row.progress * 100)}%`,
                  } as React.CSSProperties)
            }
          />
        </span>
      ) : null}
      {menu ? (
        <div
          ref={menuRef}
          className="rowmenu"
          role="menu"
          aria-label={`Actions pour « ${s.name} »`}
        >
          {confirm === "global" ? (
            <div style={{ padding: 8, display: "grid", gap: 8 }}>
              <p className="banner">
                <small>
                  Tout le monde pourra écouter cet audio et voir ses résultats.
                  Tu pourras le repasser en privé à tout moment.
                </small>
              </p>
              <div className="btnrow">
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  onClick={() => {
                    close();
                    actions.onVisibility(s, "global");
                  }}
                >
                  Rendre global
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={close}
                >
                  Annuler
                </button>
              </div>
            </div>
          ) : confirm === "delete" ? (
            <div style={{ padding: 8, display: "grid", gap: 8 }}>
              <p className="banner">
                <small>
                  L’audio, l’analyse et les signalements seront effacés ({size}{" "}
                  libérés). Cette action est irréversible.
                </small>
              </p>
              <div className="btnrow">
                <button
                  type="button"
                  className="btn btn--danger btn--sm"
                  data-testid="confirm-delete"
                  onClick={() => {
                    close();
                    actions.onDelete(s);
                  }}
                >
                  Supprimer
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={close}
                >
                  Annuler
                </button>
              </div>
            </div>
          ) : (
            <>
              <Link
                role="menuitem"
                className="menu-item"
                href={`/?session=${s.id}`}
              >
                <Icon name="wave" />
                Ouvrir
              </Link>
              {s.can_edit
                ? item("edit", "Renommer", () => {
                    close();
                    setRenaming(true);
                  })
                : null}
              {item(
                "star",
                s.favorite ? "Retirer des favoris" : "Ajouter aux favoris",
                () => {
                  close();
                  actions.onFavorite(s);
                },
              )}
              {s.can_edit
                ? s.visibility === "global"
                  ? item("lock", "Rendre privé", () => {
                      close();
                      actions.onVisibility(s, "private");
                    })
                  : item("globe", "Rendre global", () => setConfirm("global"))
                : null}
              {archivedScope || s.archived_at
                ? item("undo", "Restaurer", () => {
                    close();
                    actions.onArchive(s, false);
                  })
                : item("archive", "Archiver", () => {
                    close();
                    actions.onArchive(s, true);
                  })}
              {(archivedScope || s.archived_at) && s.can_edit
                ? item("trash", "Supprimer…", () => setConfirm("delete"), {
                    danger: true,
                    testid: "row-delete",
                  })
                : null}
            </>
          )}
        </div>
      ) : null}
    </li>
  );
}
