import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  SVG_BYTES,
  jpegHeaderOnly,
  makePng,
  pngHeaderOnly,
  webpHeaderOnly,
} from "./__fixtures__/avatar-images";
import { AVATAR } from "./avatar-config";
import {
  EncoderUnavailable,
  ImageCorrupt,
  ffmpegEncoder,
  prepareAvatar,
  sniffImage,
  type AvatarEncoder,
} from "./avatar-image";

const ffmpeg = process.env.AQR_FFMPEG || "ffmpeg";
const hasFfmpeg = spawnSync(ffmpeg, ["-version"]).status === 0;
const withFfmpeg = hasFfmpeg ? describe : describe.skip;
/** L'orientation EXIF des JPEG n'est lue par ffmpeg qu'à partir de la 7.1 (versions « git » : supposées récentes). */
const ffmpegVersion = /version n?(\d+)\.(\d+)/.exec(
  hasFfmpeg ? String(spawnSync(ffmpeg, ["-version"]).stdout) : "",
);
const readsExifOrientation =
  !ffmpegVersion ||
  Number(ffmpegVersion[1]) > 7 ||
  (Number(ffmpegVersion[1]) === 7 && Number(ffmpegVersion[2]) >= 1);
const orientationIt = readsExifOrientation ? it : it.skip;

describe("sniffImage : le type se lit dans le contenu", () => {
  it("reconnaît un PNG et ses dimensions", () => {
    const result = sniffImage(makePng(120, 80));
    expect(result).toEqual({
      ok: true,
      image: { kind: "png", width: 120, height: 80 },
    });
  });

  it("reconnaît un JPEG (SOF0) et un WebP étendu", () => {
    expect(sniffImage(jpegHeaderOnly(300, 200))).toEqual({
      ok: true,
      image: { kind: "jpeg", width: 300, height: 200 },
    });
    expect(sniffImage(webpHeaderOnly(640, 480))).toEqual({
      ok: true,
      image: { kind: "webp", width: 640, height: 480 },
    });
  });

  it("refuse un SVG, même s'il se présente comme une image", () => {
    expect(sniffImage(SVG_BYTES)).toMatchObject({ ok: false, reason: "format" });
  });

  it("refuse un GIF, du HTML, un exécutable et un fichier vide", () => {
    for (const bytes of [
      Buffer.from("GIF89a\x01\x00\x01\x00", "latin1"),
      Buffer.from("<html><body>x</body></html>"),
      Buffer.from("MZ\x90\x00", "latin1"),
      Buffer.alloc(0),
    ])
      expect(sniffImage(bytes)).toMatchObject({ ok: false, reason: "format" });
  });

  it("refuse un en-tête tronqué ou incohérent (corrompu)", () => {
    const png = makePng(64, 64);
    expect(sniffImage(png.subarray(0, 20))).toMatchObject({
      ok: false,
      reason: "corrupt",
    });
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff]))).toMatchObject({
      ok: false,
      reason: "corrupt",
    });
    expect(
      sniffImage(
        Buffer.concat([Buffer.from("RIFF\0\0\0\0WEBP", "latin1")]),
      ),
    ).toMatchObject({ ok: false, reason: "corrupt" });
  });

  it("refuse les dimensions démesurées (bombe de décompression) et trop petites", () => {
    expect(sniffImage(pngHeaderOnly(60000, 60000))).toMatchObject({
      ok: false,
      reason: "dimensions",
    });
    expect(sniffImage(jpegHeaderOnly(9000, 100))).toMatchObject({
      ok: false,
      reason: "dimensions",
    });
    expect(sniffImage(makePng(10, 10))).toMatchObject({
      ok: false,
      reason: "too_small",
    });
  });
});

/** Réencodeur factice : permet de tester les règles sans ffmpeg. */
const fakeEncoder = (
  out: Uint8Array = Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
): AvatarEncoder => ({ encode: async () => out });

describe("prepareAvatar : règles avant tout réencodage", () => {
  it("refuse un corps vide (400)", async () => {
    const r = await prepareAvatar(Buffer.alloc(0), fakeEncoder());
    expect(r).toMatchObject({ ok: false, status: 400, code: "empty" });
  });

  it("refuse un fichier trop gros avant de le lire (413)", async () => {
    const big = Buffer.alloc(AVATAR.maxBytes + 1, 1);
    const r = await prepareAvatar(big, fakeEncoder());
    expect(r).toMatchObject({ ok: false, status: 413, code: "too_large" });
  });

  it("refuse un SVG et tout format inconnu (415), sans appeler le réencodeur", async () => {
    let called = 0;
    const encoder: AvatarEncoder = {
      encode: async () => {
        called += 1;
        return Buffer.alloc(1);
      },
    };
    const r = await prepareAvatar(SVG_BYTES, encoder);
    expect(r).toMatchObject({ ok: false, status: 415, code: "format" });
    expect(called).toBe(0);
  });

  it("traduit une image que le réencodeur ne sait pas décoder en 422", async () => {
    const encoder: AvatarEncoder = {
      encode: async () => {
        throw new ImageCorrupt();
      },
    };
    const r = await prepareAvatar(makePng(64, 64), encoder);
    expect(r).toMatchObject({ ok: false, status: 422, code: "corrupt" });
  });

  it("traduit un réencodeur absent en 503", async () => {
    const encoder: AvatarEncoder = {
      encode: async () => {
        throw new EncoderUnavailable();
      },
    };
    const r = await prepareAvatar(makePng(64, 64), encoder);
    expect(r).toMatchObject({ ok: false, status: 503, code: "unavailable" });
  });

  it("refuse une sortie qui n'est pas un JPEG (garde de sortie)", async () => {
    const r = await prepareAvatar(
      makePng(64, 64),
      fakeEncoder(Buffer.from("<svg/>")),
    );
    expect(r).toMatchObject({ ok: false, status: 422 });
  });

  it("renvoie le JPEG et une empreinte stable (même contenu, même version)", async () => {
    const a = await prepareAvatar(makePng(64, 64), fakeEncoder());
    const b = await prepareAvatar(makePng(64, 64), fakeEncoder());
    const c = await prepareAvatar(
      makePng(64, 64),
      fakeEncoder(Buffer.from([0xff, 0xd8, 0x01, 0xff, 0xd9])),
    );
    if (!a.ok || !b.ok || !c.ok) throw new Error("attendu : ok");
    expect(a.hash).toBe(b.hash);
    expect(a.hash).not.toBe(c.hash);
    expect(a.hash).toMatch(/^[0-9a-f]{16}$/);
  });
});

withFfmpeg("réencodage réel par ffmpeg", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "aqr-avatar-img-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const make = (name: string, args: string[]): Buffer => {
    const file = path.join(dir, name);
    execFileSync(ffmpeg, ["-v", "error", "-y", ...args, file]);
    return readFileSync(file);
  };
  const jpegInfo = (jpeg: Uint8Array) => {
    const sniffed = sniffImage(jpeg);
    if (!sniffed.ok) throw new Error("sortie illisible");
    return sniffed.image;
  };
  const pixel = (jpeg: Uint8Array, x: number, y: number): number[] => {
    const out = spawnSync(
      ffmpeg,
      [
        "-v", "error", "-f", "image2pipe", "-c:v", "mjpeg", "-i", "pipe:0",
        "-vf", `format=rgb24,crop=1:1:${x}:${y}`, "-f", "rawvideo", "pipe:1",
      ], // prettier-ignore
      { input: Buffer.from(jpeg) },
    );
    return [...out.stdout];
  };

  it("réencode un PNG rectangulaire en JPEG carré 256×256", async () => {
    const source = make("wide.png", [
      "-f", "lavfi", "-i", "testsrc=size=640x360:rate=1", "-frames:v", "1",
    ]); // prettier-ignore
    const r = await prepareAvatar(source);
    if (!r.ok) throw new Error(r.message);
    expect(jpegInfo(r.jpeg)).toEqual({
      kind: "jpeg",
      width: AVATAR.size,
      height: AVATAR.size,
    });
    expect(r.jpeg.length).toBeLessThan(AVATAR.maxBytes);
  });

  it("réencode un JPEG portrait et un WebP", async () => {
    const jpeg = make("tall.jpg", [
      "-f", "lavfi", "-i", "testsrc=size=300x700:rate=1", "-frames:v", "1",
    ]); // prettier-ignore
    const a = await prepareAvatar(jpeg);
    if (!a.ok) throw new Error(a.message);
    expect(jpegInfo(a.jpeg).width).toBe(AVATAR.size);
    const webp = make("pic.webp", [
      "-f", "lavfi", "-i", "testsrc=size=400x400:rate=1", "-frames:v", "1",
    ]); // prettier-ignore
    const b = await prepareAvatar(webp);
    if (!b.ok) throw new Error(b.message);
    expect(jpegInfo(b.jpeg).height).toBe(AVATAR.size);
  });

  it("retire les métadonnées (EXIF, commentaires) de la source", async () => {
    const source = make("meta.jpg", [
      "-f", "lavfi", "-i", "testsrc=size=200x200:rate=1", "-frames:v", "1",
      "-metadata", "comment=GPS-48.85-2.35-secret", "-metadata", "artist=Awa",
    ]); // prettier-ignore
    const r = await prepareAvatar(source);
    if (!r.ok) throw new Error(r.message);
    const text = Buffer.from(r.jpeg).toString("latin1");
    expect(text).not.toContain("secret");
    expect(text).not.toContain("Awa");
    expect(text).not.toContain("Exif");
    expect(text).not.toContain("Lavc");
  });

  orientationIt("applique l'orientation EXIF d'une photo de téléphone avant de retirer les métadonnées", async () => {
    // 200×100 : moitié gauche rouge, moitié droite bleue ; EXIF « orientation 6 » = à tourner d'un
    // quart de tour horaire pour s'afficher droit → rouge en HAUT, bleu en BAS.
    const plain = make("half.jpg", [
      "-f", "lavfi", "-i",
      "color=c=red:s=200x100,drawbox=x=100:y=0:w=100:h=100:color=blue:t=fill",
      "-frames:v", "1",
    ]); // prettier-ignore
    const exif = Buffer.from([
      0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // APP1 « Exif »
      0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // TIFF big-endian, IFD0 à 8
      0x00, 0x01, // une entrée
      0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x06, 0x00, 0x00, // orientation = 6
      0x00, 0x00, 0x00, 0x00,
    ]); // prettier-ignore
    const rotated = Buffer.concat([plain.subarray(0, 2), exif, plain.subarray(2)]);
    const r = await prepareAvatar(rotated);
    if (!r.ok) throw new Error(r.message);
    const [topR, , topB] = pixel(r.jpeg, 128, 10);
    const [botR, , botB] = pixel(r.jpeg, 128, 245);
    expect(topR).toBeGreaterThan(200);
    expect(topB).toBeLessThan(80);
    expect(botB).toBeGreaterThan(200);
    expect(botR).toBeLessThan(80);
  });

  it("aplatit la transparence sur un fond clair (pas de coin noir)", async () => {
    const r = await prepareAvatar(makePng(100, 100, [0, 0, 0, 0]));
    if (!r.ok) throw new Error(r.message);
    const [red, green, blue] = pixel(r.jpeg, 2, 2);
    expect(Math.min(red, green, blue)).toBeGreaterThan(230);
  });

  it("un PNG tronqué ou corrompu donne 422, jamais un 500", async () => {
    const png = makePng(80, 80);
    const broken = Buffer.concat([
      png.subarray(0, 60),
      Buffer.alloc(40, 0x55),
    ]);
    const r = await prepareAvatar(broken);
    expect(r).toMatchObject({ ok: false, status: 422 });
  });

  it("un JPEG qui cache un SVG à la fin est réencodé : la charge utile disparaît", async () => {
    const jpeg = make("poly.jpg", [
      "-f", "lavfi", "-i", "testsrc=size=128x128:rate=1", "-frames:v", "1",
    ]); // prettier-ignore
    const polyglot = Buffer.concat([jpeg, SVG_BYTES]);
    const r = await prepareAvatar(polyglot);
    if (!r.ok) throw new Error(r.message);
    expect(Buffer.from(r.jpeg).toString("latin1")).not.toContain("<script>");
  });

  it("n'ouvre jamais autre chose que l'image reçue (pas de lecture de fichier local)", async () => {
    // Une « image » dont le contenu est une liste de lecture qui désigne un fichier local.
    const playlist = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff]),
      Buffer.from("\n#EXTM3U\nfile:///etc/passwd\n"),
    ]);
    const r = await prepareAvatar(playlist);
    expect(r.ok).toBe(false);
  });

  it("ffmpegEncoder lève ImageCorrupt sur un flux illisible", async () => {
    await expect(
      ffmpegEncoder.encode(Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]), "png"),
    ).rejects.toBeInstanceOf(ImageCorrupt);
  });
});
