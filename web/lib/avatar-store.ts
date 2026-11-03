import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { AVATAR } from "./avatar-config";
import { avatarHash } from "./avatar-image";
import type { Db } from "./db";
import { matchesEtag } from "./http-cache";
import { reviewRoot } from "./store";

/**
 * Dépôt des photos de profil (couche données). Les octets vivent sur le disque de la machine,
 * hors Git et JAMAIS dans `public/` : `<AQR_REVIEW_DIR>/avatars/<id utilisateur>.jpg`. La base
 * (`users.avatar_hash`) dit s'il y a une photo et en porte l'empreinte, qui sert de version de cache.
 */
export function avatarDir(): string {
  return path.join(/* turbopackIgnore: true */ reviewRoot(), "avatars");
}

/** Chemin de la photo d'un compte ; l'identifiant doit être un entier positif (aucune traversée possible). */
export function avatarFile(userId: number): string {
  if (!Number.isSafeInteger(userId) || userId <= 0)
    throw new Error("identifiant de compte invalide");
  return path.join(avatarDir(), `${userId}.${AVATAR.extension}`);
}

/** Un seul changement de photo à la fois par compte : le fichier et l'empreinte restent d'accord. */
const queues = new Map<number, Promise<unknown>>();
function serialized<T>(userId: number, work: () => Promise<T>): Promise<T> {
  const previous = queues.get(userId) ?? Promise.resolve();
  const next = previous.then(work, work);
  const tail = next.catch(() => undefined);
  queues.set(userId, tail);
  void tail.then(() => {
    if (queues.get(userId) === tail) queues.delete(userId);
  });
  return next;
}

/**
 * Enregistre la photo (JPEG déjà réencodé) : fichier temporaire puis renommage atomique, puis
 * empreinte en base. Renvoie l'empreinte (= nouvelle version).
 */
export function storeAvatar(
  db: Db,
  userId: number,
  jpeg: Uint8Array,
  now = new Date().toISOString(),
): Promise<string> {
  return serialized(userId, async () => {
    const target = avatarFile(userId);
    const hash = avatarHash(jpeg);
    await mkdir(path.dirname(target), { recursive: true });
    const temp = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, jpeg, { flag: "wx" });
      await rename(temp, target);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
    db.prepare(
      "UPDATE users SET avatar_hash = ?, avatar_updated_at = ? WHERE id = ?",
    ).run(hash, now, userId);
    return hash;
  });
}

/** Retire la photo : l'empreinte d'abord (la route répond aussitôt 404), puis le fichier. Idempotent. */
export function clearAvatar(db: Db, userId: number): Promise<void> {
  return serialized(userId, async () => {
    db.prepare(
      "UPDATE users SET avatar_hash = NULL, avatar_updated_at = ? WHERE id = ?",
    ).run(new Date().toISOString(), userId);
    await rm(avatarFile(userId), { force: true });
  });
}

/** Octets de la photo, ou `null` s'il n'y en a pas (ou plus) sur le disque. */
export async function readAvatar(userId: number): Promise<Buffer | null> {
  try {
    return await readFile(avatarFile(userId));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export function avatarHashOf(db: Db, userId: number): string | null {
  const row = db
    .prepare("SELECT avatar_hash FROM users WHERE id = ?")
    .get(userId) as { avatar_hash: string | null } | undefined;
  return row?.avatar_hash ?? null;
}

export type AvatarServing =
  | { status: 404 }
  | { status: 304; etag: string; cacheControl: string }
  | { status: 200; etag: string; cacheControl: string };

const IMMUTABLE = "private, max-age=31536000, immutable";
const REVALIDATE = "private, no-cache";

/**
 * Décision de cache d'une réponse d'image (fonction pure). L'adresse de l'image porte sa version
 * (`?v=<empreinte>`) : quand elle est la bonne, l'image ne changera jamais à cette adresse et le
 * navigateur la garde un an ; sans version, ou avec une ancienne, il revalide à chaque fois
 * (`If-None-Match` → 304). Changer de photo change l'empreinte, donc l'adresse : cache invalidé.
 */
export function avatarServing(
  currentHash: string | null,
  requestedVersion: string | null,
  ifNoneMatch: string | null,
): AvatarServing {
  if (!currentHash) return { status: 404 };
  const etag = `"${currentHash}"`;
  const cacheControl =
    requestedVersion === currentHash ? IMMUTABLE : REVALIDATE;
  return matchesEtag(ifNoneMatch, etag)
    ? { status: 304, etag, cacheControl }
    : { status: 200, etag, cacheControl };
}
