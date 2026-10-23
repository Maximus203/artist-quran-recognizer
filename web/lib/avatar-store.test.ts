import {
  mkdtempSync,
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publicUser } from "./auth-response";
import { avatarUrl } from "./avatar-config";
import {
  avatarFile,
  avatarServing,
  clearAvatar,
  readAvatar,
  storeAvatar,
} from "./avatar-store";
import { openDatabase, type Db } from "./db";
import { createUser, getUser } from "./users";

let dir: string;
let db: Db;
let awaId: number;
let moussaId: number;
const JPEG_A = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
const JPEG_B = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9, 0xff, 0xd9]);

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "aqr-avatar-store-"));
  vi.stubEnv("AQR_REVIEW_DIR", dir);
  db = openDatabase(":memory:");
  awaId = createUser(db, { username: "Awa", passwordHash: "h" }).id;
  moussaId = createUser(db, { username: "Moussa", passwordHash: "h" }).id;
});
afterEach(() => {
  db.close();
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("stockage de la photo de profil", () => {
  it("un compte neuf n'a pas de photo : version nulle côté API", () => {
    const user = getUser(db, awaId)!;
    expect(user.avatar_hash).toBeNull();
    expect(publicUser(user).avatar_version).toBeNull();
  });

  it("écrit le fichier sous AQR_REVIEW_DIR/avatars/<id>.jpg et note l'empreinte", async () => {
    const hash = await storeAvatar(db, awaId, JPEG_A);
    const file = path.join(dir, "avatars", `${awaId}.jpg`);
    expect(avatarFile(awaId)).toBe(file);
    expect(readFileSync(file).equals(JPEG_A)).toBe(true);
    const user = getUser(db, awaId)!;
    expect(user.avatar_hash).toBe(hash);
    expect(publicUser(user).avatar_version).toBe(hash);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("une nouvelle photo remplace l'ancienne et change la version (cache invalidé)", async () => {
    const first = await storeAvatar(db, awaId, JPEG_A);
    const second = await storeAvatar(db, awaId, JPEG_B);
    expect(second).not.toBe(first);
    expect((await readAvatar(awaId))!.equals(JPEG_B)).toBe(true);
    expect(avatarUrl(awaId, first)).not.toBe(avatarUrl(awaId, second));
    expect(readdirSync(path.join(dir, "avatars"))).toEqual([`${awaId}.jpg`]);
  });

  it("chaque compte garde sa propre photo", async () => {
    await storeAvatar(db, awaId, JPEG_A);
    await storeAvatar(db, moussaId, JPEG_B);
    expect((await readAvatar(awaId))!.equals(JPEG_A)).toBe(true);
    expect((await readAvatar(moussaId))!.equals(JPEG_B)).toBe(true);
  });

  it("retirer la photo supprime le fichier et remet la version à nul (idempotent)", async () => {
    await storeAvatar(db, awaId, JPEG_A);
    await clearAvatar(db, awaId);
    expect(existsSync(avatarFile(awaId))).toBe(false);
    expect(getUser(db, awaId)!.avatar_hash).toBeNull();
    expect(await readAvatar(awaId)).toBeNull();
    await expect(clearAvatar(db, awaId)).resolves.toBeUndefined();
  });

  it("n'écrit jamais ailleurs que dans le dossier des photos, quel que soit l'identifiant reçu", async () => {
    for (const bad of [1.5, -1, Number.NaN, "../x" as unknown as number])
      expect(() => avatarFile(bad)).toThrow();
  });

  it("ne laisse aucun fichier temporaire derrière lui", async () => {
    await storeAvatar(db, awaId, JPEG_A);
    await storeAvatar(db, awaId, JPEG_B);
    expect(
      readdirSync(path.join(dir, "avatars")).every((f) => f.endsWith(".jpg")),
    ).toBe(true);
  });
});

describe("avatarServing : cache par empreinte", () => {
  const hash = "0123456789abcdef";

  it("404 sans photo", () => {
    expect(avatarServing(null, null, null)).toEqual({ status: 404 });
  });

  it("200 avec un ETag fort et un cache court tant que la version demandée n'est pas la bonne", () => {
    const r = avatarServing(hash, null, null);
    expect(r).toMatchObject({ status: 200, etag: `"${hash}"` });
    expect((r as { cacheControl: string }).cacheControl).toBe(
      "private, no-cache",
    );
  });

  it("200 avec un cache immuable quand ?v correspond à l'empreinte courante", () => {
    const r = avatarServing(hash, hash, null);
    expect((r as { cacheControl: string }).cacheControl).toMatch(/immutable/);
    expect((r as { cacheControl: string }).cacheControl).toMatch(/^private/);
  });

  it("une ancienne version demandée n'est PAS mise en cache durablement", () => {
    const r = avatarServing(hash, "ffffffffffffffff", null);
    expect((r as { cacheControl: string }).cacheControl).toBe(
      "private, no-cache",
    );
  });

  it("304 si If-None-Match désigne l'empreinte courante, 200 sinon", () => {
    expect(avatarServing(hash, null, `"${hash}"`)).toMatchObject({
      status: 304,
    });
    expect(avatarServing(hash, null, `W/"${hash}"`)).toMatchObject({
      status: 304,
    });
    expect(avatarServing(hash, null, `"autre"`)).toMatchObject({ status: 200 });
  });
});
