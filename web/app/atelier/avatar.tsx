"use client";
import { useEffect, useRef, useState } from "react";
import { avatarUrl } from "@/lib/avatar-config";
import { avatarInitial, avatarTone } from "@/lib/avatar-tone";
import { useShell } from "./shell";

/** Ce qu'il faut savoir d'une personne pour l'afficher (jamais d'e-mail). */
export type AvatarPerson = {
  id: number;
  username: string;
  avatar_version: string | null;
};

const SIZES = { sm: 24, md: 32, lg: 56 } as const;
export type AvatarSize = keyof typeof SIZES;

/**
 * Avatar rond : la photo du compte (image réencodée par le serveur, chargée paresseusement, dimensions
 * fixées donc aucun saut de mise en page) ou, sans photo, l'initiale du pseudo sur une couleur
 * stable dérivée du pseudo (jetons `--av-*`). Si l'image ne se charge pas, l'initiale reste.
 *
 * Décoratif par défaut (`alt=""`, caché aux lecteurs d'écran) parce que le pseudo est toujours écrit
 * à côté ; `label` en fait une image nommée quand il n'y a pas de texte voisin.
 */
export function Avatar({
  person,
  size = "sm",
  label,
  eager = false,
}: {
  person: AvatarPerson;
  size?: AvatarSize;
  label?: string;
  eager?: boolean;
}) {
  const px = SIZES[size];
  const [failed, setFailed] = useState(false);
  const image = useRef<HTMLImageElement>(null);
  const version = person.avatar_version;
  useEffect(() => setFailed(false), [person.id, version]);
  // Erreur survenue avant l'hydratation : l'événement a déjà eu lieu, on relit l'état de l'image.
  useEffect(() => {
    const el = image.current;
    if (el && el.complete && el.naturalWidth === 0) setFailed(true);
  }, [person.id, version]);
  const showPhoto = version !== null && !failed;
  return (
    <span
      className={`av av--${size}`}
      data-i={avatarInitial(person.username)}
      data-tone={avatarTone(person.username)}
      data-photo={showPhoto ? "yes" : "no"}
      {...(label
        ? { role: "img", "aria-label": label }
        : { "aria-hidden": true as const })}
    >
      {showPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element -- JPEG 256 px déjà réencodé, servi par notre route authentifiée
        <img
          ref={image}
          src={avatarUrl(person.id, version)}
          alt=""
          width={px}
          height={px}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
        />
      ) : null}
    </span>
  );
}

/** Avatar + pseudo sur une ligne : « qui a importé cet audio ». */
export function PersonChip({
  person,
  me = false,
  size = "sm",
  testId,
}: {
  person: AvatarPerson;
  me?: boolean;
  size?: AvatarSize;
  testId?: string;
}) {
  return (
    <span className="who-chip" data-testid={testId}>
      <Avatar person={person} size={size} />
      <span className="nm" title={person.username}>
        {person.username}
      </span>
      {me ? <span className="sr"> (toi)</span> : null}
    </span>
  );
}

/**
 * Propriétaire d'une session tel que l'API le sert. Pour MON compte, la photo affichée est celle de
 * l'interface (elle change à l'instant du téléversement, sans attendre le prochain rechargement de
 * la liste).
 */
export function useOwnerPerson(
  owner: AvatarPerson | null | undefined,
): AvatarPerson | null {
  const { user } = useShell();
  if (!owner) return null;
  return owner.id === user.id
    ? { ...owner, avatar_version: user.avatar_version }
    : owner;
}
