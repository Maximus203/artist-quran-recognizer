"use client";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";

/** Fermeture d'une fenêtre flottante : clic dehors et Échap (le focus revient au déclencheur). */
export function useDismiss(
  open: boolean,
  onClose: () => void,
  container: React.RefObject<HTMLElement | null>,
  returnTo?: React.RefObject<HTMLElement | null>,
) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) close.current();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      close.current();
      returnTo?.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, container, returnTo]);
}

/** Portée d'une session : le privé se voit (cadenas, contour encre), le global est le cas normal. */
export function ScopeBadge({
  visibility,
}: {
  visibility: "global" | "private";
}) {
  return visibility === "private" ? (
    <span
      className="badge badge--private"
      data-testid="scope-badge"
      data-scope="private"
    >
      <Icon name="lock" />
      Privé
    </span>
  ) : (
    <span
      className="badge badge--global"
      data-testid="scope-badge"
      data-scope="global"
    >
      <Icon name="globe" />
      Global
    </span>
  );
}

/** Étoile de favori : 44×44, `aria-pressed`, libellé qui dit l'action. */
export function FavButton({
  favorite,
  name,
  onToggle,
}: {
  favorite: boolean;
  /** Nom de la session, pour un libellé précis dans une liste. */
  name?: string;
  onToggle: () => void;
}) {
  const [pop, setPop] = useState(false);
  const label = favorite ? "Retirer des favoris" : "Ajouter aux favoris";
  return (
    <button
      type="button"
      className={`fav${pop ? " pop" : ""}`}
      data-testid="favorite"
      aria-pressed={favorite}
      aria-label={name ? `${label} : ${name}` : label}
      data-tip={label}
      onClick={() => {
        setPop(true);
        setTimeout(() => setPop(false), 260);
        onToggle();
      }}
    >
      <Icon name="star" />
    </button>
  );
}

/** Champ de renommage : Entrée valide, Échap annule, la perte de focus valide si le texte a changé. */
export function NameEditor({
  initial,
  className,
  onSubmit,
  onCancel,
}: {
  initial: string;
  className?: string;
  /** Texte nettoyé ; chaîne vide = retour au nom par défaut. */
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    const clean = value.replace(/\s+/g, " ").trim();
    if (save && clean !== initial) onSubmit(clean);
    else onCancel();
  };
  return (
    <div className="title-edit" data-testid="name-editor">
      <input
        ref={input}
        className={className ?? "title-input"}
        value={value}
        maxLength={120}
        aria-label="Nom de la session"
        data-testid="name-input"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            finish(true);
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            finish(false);
          }
        }}
        onBlur={() => finish(true)}
      />
      <button
        type="button"
        className="btn btn--secondary btn--sm"
        // mousedown : valider avant que la perte de focus du champ ne le fasse
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => finish(true)}
      >
        Valider
      </button>
      <span className="hint-keys">Entrée valider · Échap annuler</span>
    </div>
  );
}

/** Titre renommable (double-clic ou crayon) pour le propriétaire ; texte simple pour les autres. */
export function InlineName({
  name,
  canEdit,
  onRename,
}: {
  name: string;
  canEdit: boolean;
  /** `null` = rétablir le nom par défaut. */
  onRename: (name: string | null) => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const pencil = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  if (editing)
    return (
      <NameEditor
        initial={name}
        onCancel={() => {
          setEditing(false);
          setTimeout(() => (pencil.current ?? heading.current)?.focus(), 0);
        }}
        onSubmit={(value) => {
          setEditing(false);
          void onRename(value === "" ? null : value);
          setTimeout(() => (pencil.current ?? heading.current)?.focus(), 0);
        }}
      />
    );
  return (
    <div className={`title-row${canEdit ? "" : " is-readonly"}`}>
      <h1
        ref={heading}
        tabIndex={-1}
        data-testid="session-title"
        title={canEdit ? "Double-clic pour renommer" : undefined}
        onDoubleClick={canEdit ? () => setEditing(true) : undefined}
      >
        {name}
      </h1>
      {canEdit ? (
        <button
          ref={pencil}
          type="button"
          className="rename-btn"
          data-testid="rename"
          aria-label="Renommer la session"
          data-tip="Renommer"
          onClick={() => setEditing(true)}
        >
          <Icon name="edit" />
        </button>
      ) : null}
    </div>
  );
}
