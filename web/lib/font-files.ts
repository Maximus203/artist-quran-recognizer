import { readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isLocalRequest } from "./local-request";
import type { QuranFontId } from "./quran-fonts";

/**
 * Polices sous licence « tous droits réservés », servies depuis un dossier HORS du dépôt
 * (`AQR_FONTS_DIR`) et jamais depuis `public/`. Liste blanche stricte de noms (aucun chemin n'est
 * construit à partir de la requête) et boucle locale seulement : même avec un jeton d'accès et un
 * hôte autorisé, une machine distante ne reçoit jamais le fichier (ce serait une redistribution).
 */
type LocalFont = { id: QuranFontId; file: string };

const LOCAL_FONTS: Readonly<Record<string, LocalFont>> = {
  "kfgqpc-hafs-v30": { id: "kfgqpc-hafs", file: "KFGQPC-Hafs-V30.ttf" },
};
const LOOPBACK_HOSTS = ["127.0.0.1", "localhost", "[::1]"];

/** Défaut explicite et documenté (README) : `<données utilisateur>/aqr-fonts`, jamais le dossier de revue. */
export function defaultFontsDir(
  platform: NodeJS.Platform,
  home: string,
  env: Record<string, string | undefined>,
): string {
  if (platform === "win32")
    return path.join(home, "AppData", "Local", "aqr-fonts");
  const base = env.XDG_DATA_HOME || path.join(home, ".local", "share");
  return path.join(base, "aqr-fonts");
}

export function fontsDir(): string {
  return path.resolve(
    /* turbopackIgnore: true */ process.env.AQR_FONTS_DIR ||
      defaultFontsDir(process.platform, os.homedir(), process.env),
  );
}

/** Chemin du fichier pour un nom de la liste blanche ; null pour tout le reste. */
export function resolveFontFile(name: string): string | null {
  if (!Object.hasOwn(LOCAL_FONTS, name)) return null;
  return path.join(fontsDir(), LOCAL_FONTS[name].file);
}

/** Présence des polices locales (pour griser l'option côté interface). */
export async function fontAvailability(): Promise<
  { id: QuranFontId; available: boolean }[]
> {
  return Promise.all(
    Object.values(LOCAL_FONTS).map(async ({ id, file }) => ({
      id,
      available: await stat(path.join(fontsDir(), file)).then(
        (info) => info.isFile(),
        () => false,
      ),
    })),
  );
}

const json = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export async function serveFont(
  request: Request,
  name: string,
): Promise<Response> {
  if (
    !LOOPBACK_HOSTS.includes(new URL(request.url).hostname) ||
    !isLocalRequest(request)
  )
    return json(403, "Police réservée à l’usage local");
  const file = resolveFontFile(name);
  if (!file) return json(404, "Police inconnue");
  try {
    const data = await readFile(file);
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": "font/ttf",
        "Content-Length": String(data.byteLength),
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return json(404, "Police non installée");
  }
}
