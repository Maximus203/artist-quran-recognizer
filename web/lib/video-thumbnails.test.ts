import { mkdtemp, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EXPORT_VIDEO_CONFIG } from "./export-video-config";
import {
  ensureThumbnails,
  parseThumbnailQuery,
  thumbnailArgs,
  thumbnailFile,
} from "./video-thumbnails";

const T = EXPORT_VIDEO_CONFIG.thumbnails;
let root = "";
beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "aqr-thumbs-"));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("paramètres des imagettes", () => {
  it("applique les défauts", () => {
    expect(parseThumbnailQuery(new URLSearchParams())).toEqual({
      ok: true,
      count: T.defaultCount,
      width: T.defaultWidth,
    });
  });
  it("accepte des valeurs dans les bornes", () => {
    expect(
      parseThumbnailQuery(new URLSearchParams("count=12&width=64")),
    ).toEqual({ ok: true, count: 12, width: 64 });
  });
  it("refuse ce qui sort des bornes ou n'est pas un entier", () => {
    for (const q of [
      "count=0",
      `count=${T.maxCount + 1}`,
      "count=3.5",
      "count=abc",
      `width=${T.minWidth - 1}`,
      `width=${T.maxWidth + 1}`,
    ])
      expect(parseThumbnailQuery(new URLSearchParams(q)).ok).toBe(false);
  });
});

describe("commande ffmpeg", () => {
  it("prend count images régulières, à la largeur demandée, sur une planche", () => {
    const args = thumbnailArgs("in.mp4", "out.jpg", {
      count: 10,
      width: 96,
      duration: 50,
    });
    expect(args).toContain("-frames:v");
    const vf = args[args.indexOf("-vf") + 1];
    expect(vf).toContain("fps=0.200000");
    expect(vf).toContain("scale=96:-2");
    expect(vf).toContain("tile=10x1");
    expect(args.at(-1)).toBe("out.jpg");
    // Pas d'option qui viendrait de l'utilisateur hors des nombres validés.
    expect(args.every((a) => !a.includes(";"))).toBe(true);
  });
  it("sur un long enregistrement, ne décode que les images clés (rapide)", () => {
    const long = thumbnailArgs("in.mp4", "o.jpg", {
      count: 40,
      width: 96,
      duration: 3080,
    });
    expect(long.slice(0, long.indexOf("-i"))).toContain("nokey");
    const short = thumbnailArgs("in.mp4", "o.jpg", {
      count: 40,
      width: 96,
      duration: 41.5,
    });
    expect(short).not.toContain("nokey");
  });
});

describe("cache sur disque", () => {
  it("range la planche dans les fichiers dérivés de la session", () => {
    expect(thumbnailFile("/s/abc", 40, 96)).toBe(
      path.join("/s/abc", "listening", "thumbs-40x96.jpg"),
    );
  });
  it("ne relance ffmpeg que si la planche manque ou est plus ancienne que la source", async () => {
    const dir = path.join(root, "session");
    const source = path.join(root, "source.mp4");
    await writeFile(source, "video");
    let calls = 0;
    const run = async (args: string[]) => {
      calls += 1;
      await writeFile(args.at(-1) as string, "jpg");
    };
    const opts = { count: 4, width: 64, duration: 10 };
    const first = await ensureThumbnails(dir, source, opts, run);
    await ensureThumbnails(dir, source, opts, run);
    expect(calls).toBe(1);
    expect((await stat(first)).size).toBe(3);
    // Source plus récente : on régénère.
    const later = new Date(Date.now() + 60_000);
    await utimes(source, later, later);
    await ensureThumbnails(dir, source, opts, run);
    expect(calls).toBe(2);
  });
  it("garde au plus quelques planches par session : les plus anciennes partent", async () => {
    const dir = path.join(root, "cap");
    const source = path.join(root, "source.mp4");
    const run = async (args: string[]) => {
      await writeFile(args.at(-1) as string, "jpg");
    };
    for (const count of [2, 3, 4, 5, 6])
      await ensureThumbnails(dir, source, { count, width: 64, duration: 10 }, run);
    const left = (await readdir(path.join(dir, "listening"))).filter((f) =>
      f.startsWith("thumbs-"),
    );
    expect(left.length).toBe(T.keepPerSession);
    expect(left).toContain("thumbs-6x64.jpg");
    expect(left).not.toContain("thumbs-2x64.jpg");
  });
  it("un échec de ffmpeg ne laisse aucune planche à moitié écrite", async () => {
    const dir = path.join(root, "fail");
    const source = path.join(root, "source.mp4");
    const run = async (args: string[]) => {
      await writeFile(args.at(-1) as string, "partiel");
      throw new Error("ffmpeg a échoué");
    };
    await expect(
      ensureThumbnails(dir, source, { count: 2, width: 64, duration: 10 }, run),
    ).rejects.toThrow("ffmpeg");
    await expect(stat(thumbnailFile(dir, 2, 64))).rejects.toThrow();
  });
});
