import { randomUUID } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { sessionDir } from "./store";

/**
 * Vidéos déjà fabriquées pour un enregistrement, gardées sur le serveur : `<session>/videos/<uuid>.mp4`
 * et `<uuid>.json` (nom, clé des réglages, résumé). La clé (empreinte du contenu et des réglages, calculée
 * par le navigateur) permet de ne pas refaire une vidéo identique ; le dossier fait partie de la session :
 * il compte dans l'espace utilisé et part avec elle.
 */
export type VideoRecord = {
  id: string;
  name: string;
  key: string;
  label: string;
  bytes: number;
  created_at: string;
};
export type VideoMeta = { key: string; label: string; name: string };

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Au plus ce nombre de vidéos gardées par enregistrement (au-delà, la vidéo est rendue mais pas gardée). */
export const MAX_VIDEOS_PER_SESSION = 40;
const KEY_MAX = 128;
const TEXT_MAX = 200;
const META_HEADER_MAX = 2048;

const dirOf = (sessionId: string) => path.join(sessionDir(sessionId), "videos");

/** En-tête `x-aqr-meta` (JSON encodé en URI) ; `null` s'il manque ou n'est pas sûr. */
export function parseVideoMeta(header: string | null): VideoMeta | null {
  if (!header || header.length > META_HEADER_MAX) return null;
  try {
    const raw = JSON.parse(decodeURIComponent(header)) as Record<
      string,
      unknown
    >;
    const key = typeof raw.key === "string" ? raw.key : "";
    const label = typeof raw.label === "string" ? raw.label : "";
    const name = typeof raw.name === "string" ? raw.name : "";
    if (!key || key.length > KEY_MAX || !name) return null;
    if (label.length > TEXT_MAX || name.length > TEXT_MAX) return null;
    return { key, label, name };
  } catch {
    return null;
  }
}

export async function saveVideo(
  sessionId: string,
  input: VideoMeta & { bytes: Buffer },
): Promise<VideoRecord> {
  const dir = dirOf(sessionId);
  await mkdir(dir, { recursive: true });
  const id = randomUUID();
  const record: VideoRecord = {
    id,
    name: input.name,
    key: input.key,
    label: input.label,
    bytes: input.bytes.length,
    created_at: new Date().toISOString(),
  };
  // La vidéo d'abord, puis la fiche : une fiche sans vidéo n'existe jamais (écriture atomique).
  await writeFile(path.join(dir, `${id}.mp4.tmp`), input.bytes);
  await rename(path.join(dir, `${id}.mp4.tmp`), path.join(dir, `${id}.mp4`));
  await writeFile(path.join(dir, `${id}.json`), JSON.stringify(record));
  return record;
}

export async function listVideos(sessionId: string): Promise<VideoRecord[]> {
  const dir = dirOf(sessionId);
  const names = await readdir(dir).catch(() => [] as string[]);
  const records: VideoRecord[] = [];
  for (const name of names) {
    const id = name.endsWith(".json") ? name.slice(0, -5) : "";
    if (!ID.test(id)) continue;
    try {
      const record = JSON.parse(
        await readFile(path.join(dir, name), "utf8"),
      ) as VideoRecord;
      const file = await stat(path.join(dir, `${id}.mp4`));
      records.push({ ...record, id, bytes: file.size });
    } catch {
      /* fiche illisible ou vidéo absente : ignorée */
    }
  }
  return records.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** Chemin et taille du MP4, ou `null` (identifiant invalide ou vidéo absente). */
export async function videoFile(
  sessionId: string,
  id: string,
): Promise<{ path: string; bytes: number; record: VideoRecord | null } | null> {
  if (!ID.test(id)) return null;
  const file = path.join(dirOf(sessionId), `${id}.mp4`);
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return null;
  const record = await readFile(
    path.join(dirOf(sessionId), `${id}.json`),
    "utf8",
  )
    .then((text) => JSON.parse(text) as VideoRecord)
    .catch(() => null);
  return { path: file, bytes: info.size, record };
}

export async function deleteVideo(
  sessionId: string,
  id: string,
): Promise<boolean> {
  if (!ID.test(id)) return false;
  const dir = dirOf(sessionId);
  const exists = await stat(path.join(dir, `${id}.mp4`)).catch(() => null);
  await rm(path.join(dir, `${id}.mp4`), { force: true });
  await rm(path.join(dir, `${id}.json`), { force: true });
  return exists !== null;
}

/** `bytes=a-b` (une seule plage) → [début, fin] bornés à la taille, ou `null` (plage illisible). */
export function parseRange(
  header: string,
  size: number,
): [number, number] | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === "" && match[2] === "")) return null;
  let start: number;
  let end: number;
  if (match[1] === "") {
    const tail = Number(match[2]);
    start = Math.max(0, size - tail);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  return start <= end && start < size ? [start, end] : null;
}
