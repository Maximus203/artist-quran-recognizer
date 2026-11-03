import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const mocks = vi.hoisted(() => ({ sessionDir: vi.fn() }));
vi.mock("./store", () => ({ sessionDir: mocks.sessionDir }));

import {
  deleteVideo,
  listVideos,
  parseRange,
  parseVideoMeta,
  saveVideo,
  videoFile,
} from "./video-library";

describe("bibliothèque de vidéos d'une session", () => {
  beforeEach(async () => {
    mocks.sessionDir.mockReturnValue(
      await mkdtemp(path.join(os.tmpdir(), "aqr-lib-")),
    );
  });

  it("enregistre une vidéo, la liste (la plus récente d'abord) et la relit", async () => {
    const a = await saveVideo("s1", {
      name: "a.mp4",
      key: "k1",
      label: "Vertical · 1080p",
      bytes: Buffer.from("aaaa"),
    });
    await new Promise((r) => setTimeout(r, 5));
    const b = await saveVideo("s1", {
      name: "b.mp4",
      key: "k2",
      label: "Carré",
      bytes: Buffer.from("bb"),
    });
    const list = await listVideos("s1");
    expect(list.map((v) => v.id)).toEqual([b.id, a.id]);
    expect(list[1]).toMatchObject({ name: "a.mp4", key: "k1", bytes: 4 });
    const file = await videoFile("s1", a.id);
    expect(file?.bytes).toBe(4);
  });

  it("supprime la vidéo et ses métadonnées ; une seconde suppression dit non", async () => {
    const v = await saveVideo("s1", {
      name: "a.mp4",
      key: "k",
      label: "",
      bytes: Buffer.from("x"),
    });
    expect(await deleteVideo("s1", v.id)).toBe(true);
    expect(await listVideos("s1")).toEqual([]);
    expect(await readdir(path.join(mocks.sessionDir("s1"), "videos"))).toEqual(
      [],
    );
    expect(await deleteVideo("s1", v.id)).toBe(false);
  });

  it("refuse un identifiant qui n'est pas un UUID (aucun chemin construit)", async () => {
    expect(await videoFile("s1", "../../etc/passwd")).toBeNull();
    expect(await deleteVideo("s1", "../x")).toBe(false);
  });

  it("une session sans vidéo donne une liste vide", async () => {
    expect(await listVideos("s1")).toEqual([]);
  });

  it("ignore une métadonnée sans fichier vidéo", async () => {
    const v = await saveVideo("s1", {
      name: "a.mp4",
      key: "k",
      label: "",
      bytes: Buffer.from("x"),
    });
    const { rm } = await import("node:fs/promises");
    await rm(path.join(mocks.sessionDir("s1"), "videos", `${v.id}.mp4`));
    expect(await listVideos("s1")).toEqual([]);
  });
});

describe("parseVideoMeta", () => {
  const encode = (o: unknown) => encodeURIComponent(JSON.stringify(o));
  it("lit l'en-tête d'un client", () => {
    expect(
      parseVideoMeta(encode({ key: "abc", label: "Vertical", name: "x.mp4" })),
    ).toEqual({ key: "abc", label: "Vertical", name: "x.mp4" });
  });
  it("rejette l'absent, l'illisible et l'énorme", () => {
    expect(parseVideoMeta(null)).toBeNull();
    expect(parseVideoMeta("%%%")).toBeNull();
    expect(parseVideoMeta(encode({ key: "", label: "", name: "" }))).toBeNull();
    expect(
      parseVideoMeta(encode({ key: "a".repeat(500), label: "", name: "x" })),
    ).toBeNull();
  });
});

describe("parseRange", () => {
  it("lit début-fin, début- et -fin, bornés à la taille", () => {
    expect(parseRange("bytes=0-9", 100)).toEqual([0, 9]);
    expect(parseRange("bytes=90-", 100)).toEqual([90, 99]);
    expect(parseRange("bytes=-10", 100)).toEqual([90, 99]);
    expect(parseRange("bytes=50-500", 100)).toEqual([50, 99]);
  });
  it("rejette ce qui est illisible ou hors du fichier", () => {
    expect(parseRange("bytes=-", 100)).toBeNull();
    expect(parseRange("bytes=200-300", 100)).toBeNull();
    expect(parseRange("bytes=9-3", 100)).toBeNull();
    expect(parseRange("items=0-1", 100)).toBeNull();
  });
});
