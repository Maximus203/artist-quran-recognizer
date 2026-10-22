import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  defaultFontsDir,
  fontAvailability,
  fontsDir,
  resolveFontFile,
  serveFont,
} from "./font-files";

let dir: string;
const saved: Record<string, string | undefined> = {};
const ENV = ["AQR_FONTS_DIR", "AQR_ACCESS_TOKEN", "AQR_ALLOWED_HOSTS"];
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "aqr-fonts-"));
  for (const key of ENV) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  process.env.AQR_FONTS_DIR = dir;
});
afterEach(async () => {
  for (const key of ENV)
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  await rm(dir, { recursive: true, force: true });
});

const request = (name: string, host = "127.0.0.1", headers = {}) =>
  new Request(`http://${host}:3100/api/fonts/${name}`, { headers });

describe("dossier des polices sous licence (AQR_FONTS_DIR)", () => {
  it("a un défaut explicite, hors du dossier de revue", () => {
    expect(defaultFontsDir("win32", "C:\\Users\\a", {})).toBe(
      path.join("C:\\Users\\a", "AppData", "Local", "aqr-fonts"),
    );
    expect(defaultFontsDir("linux", "/home/u", {})).toBe(
      path.join("/home/u", ".local", "share", "aqr-fonts"),
    );
    expect(defaultFontsDir("linux", "/home/u", { XDG_DATA_HOME: "/x/d" })).toBe(
      path.join("/x/d", "aqr-fonts"),
    );
  });
  it("AQR_FONTS_DIR l'emporte", () => {
    expect(fontsDir()).toBe(path.resolve(dir));
  });
});

describe("resolveFontFile (liste blanche stricte)", () => {
  it("n'accepte que les noms connus", () => {
    expect(resolveFontFile("kfgqpc-hafs-v30")).toBe(
      path.join(path.resolve(dir), "KFGQPC-Hafs-V30.ttf"),
    );
  });
  it("refuse tout le reste, traversée de chemin comprise", () => {
    for (const bad of [
      "",
      "inconnue",
      "../KFGQPC-Hafs-V30.ttf",
      "..%2F..%2Fsecret",
      "kfgqpc-hafs-v30/../../x",
      "KFGQPC-Hafs-V30.ttf",
      "KFGQPC-HAFS-V30",
      "kfgqpc-hafs-v30.ttf",
      "C:\\Windows\\win.ini",
      "kfgqpc-hafs-v30\0",
    ])
      expect(resolveFontFile(bad)).toBeNull();
  });
});

describe("fontAvailability", () => {
  it("signale l'absence du fichier", async () => {
    expect(await fontAvailability()).toEqual([
      { id: "kfgqpc-hafs", available: false },
    ]);
  });
  it("signale sa présence", async () => {
    await writeFile(path.join(dir, "KFGQPC-Hafs-V30.ttf"), "fonte");
    expect(await fontAvailability()).toEqual([
      { id: "kfgqpc-hafs", available: true },
    ]);
  });
});

describe("serveFont", () => {
  it("sert le fichier à la boucle locale, sans le mettre en cache partagé", async () => {
    await writeFile(path.join(dir, "KFGQPC-Hafs-V30.ttf"), "fonte");
    const response = await serveFont(request("kfgqpc-hafs-v30"), "kfgqpc-hafs-v30");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("font/ttf");
    expect(response.headers.get("cache-control")).toMatch(/private/);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.text()).toBe("fonte");
  });
  it("répond 404 si le fichier n'est pas installé", async () => {
    const response = await serveFont(request("kfgqpc-hafs-v30"), "kfgqpc-hafs-v30");
    expect(response.status).toBe(404);
  });
  it("répond 404 pour un nom hors liste blanche", async () => {
    await writeFile(path.join(dir, "secret.ttf"), "x");
    const response = await serveFont(request("secret"), "secret");
    expect(response.status).toBe(404);
  });
  it("refuse une machine distante, même avec jeton et hôte autorisé (pas de redistribution)", async () => {
    await writeFile(path.join(dir, "KFGQPC-Hafs-V30.ttf"), "fonte");
    process.env.AQR_ACCESS_TOKEN = "t".repeat(32);
    process.env.AQR_ALLOWED_HOSTS = "atelier.exemple.test";
    const response = await serveFont(
      request("kfgqpc-hafs-v30", "atelier.exemple.test", {
        "x-aqr-token": "t".repeat(32),
      }),
      "kfgqpc-hafs-v30",
    );
    expect(response.status).toBe(403);
  });
  it("refuse un hôte non local sans jeton", async () => {
    await writeFile(path.join(dir, "KFGQPC-Hafs-V30.ttf"), "fonte");
    const response = await serveFont(
      request("kfgqpc-hafs-v30", "192.168.1.20"),
      "kfgqpc-hafs-v30",
    );
    expect(response.status).toBe(403);
  });
});
