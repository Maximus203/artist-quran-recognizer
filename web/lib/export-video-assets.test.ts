import { describe, expect, it } from "vitest";
import { loadClipVideo, type ClipDeps } from "./export-video-assets";

/** Faux élément vidéo : charge ses métadonnées (ou échoue) quand on lui donne une source. */
class FakeVideo extends EventTarget {
  muted = false;
  defaultMuted = false;
  playsInline = false;
  preload = "";
  duration = 0;
  videoWidth = 0;
  videoHeight = 0;
  readyState = 0;
  removed: string[] = [];
  loaded = false;
  private outcome: "ok" | "error" | "never" = "ok";
  private _src = "";

  constructor(
    private readonly meta: {
      duration: number;
      width: number;
      height: number;
    } | null,
    outcome: "ok" | "error" | "never" = "ok",
  ) {
    super();
    this.outcome = outcome;
  }
  get src() {
    return this._src;
  }
  set src(value: string) {
    this._src = value;
    if (this.outcome === "never") return;
    queueMicrotask(() => {
      if (this.outcome === "error" || !this.meta) {
        this.dispatchEvent(new Event("error"));
        return;
      }
      this.duration = this.meta.duration;
      this.videoWidth = this.meta.width;
      this.videoHeight = this.meta.height;
      this.readyState = 1;
      this.dispatchEvent(new Event("loadedmetadata"));
    });
  }
  removeAttribute(name: string) {
    this.removed.push(name);
  }
  load() {
    this.loaded = true;
  }
}

function deps(video: FakeVideo): ClipDeps & {
  revoked: string[];
  created: Blob[];
} {
  const revoked: string[] = [];
  const created: Blob[] = [];
  return {
    createVideo: () => video as unknown as HTMLVideoElement,
    createObjectUrl: (blob) => {
      created.push(blob);
      return "blob:fond-1";
    },
    revokeObjectUrl: (url) => revoked.push(url),
    timeoutMs: 50,
    revoked,
    created,
  };
}

const file = new Blob(["x"], { type: "video/mp4" }) as File;

describe("loadClipVideo : la vidéo de fond choisie", () => {
  it("la charge MUETTE, lisible sur place, et lit sa durée", async () => {
    const video = new FakeVideo({ duration: 12.5, width: 1280, height: 720 });
    const d = deps(video);
    const clip = await loadClipVideo(file, d);
    expect(clip).not.toBeNull();
    expect(clip!.video.muted).toBe(true);
    expect(video.defaultMuted).toBe(true);
    expect(video.playsInline).toBe(true);
    expect(video.src).toBe("blob:fond-1");
    expect(clip!.duration).toBe(12.5);
    expect(d.created).toHaveLength(1);
  });

  it("libère le fichier à la fermeture", async () => {
    const video = new FakeVideo({ duration: 4, width: 640, height: 360 });
    const d = deps(video);
    const clip = await loadClipVideo(file, d);
    clip!.close();
    expect(d.revoked).toEqual(["blob:fond-1"]);
    expect(video.removed).toContain("src");
  });

  it("une vidéo illisible : null, fichier libéré", async () => {
    const video = new FakeVideo(null, "error");
    const d = deps(video);
    expect(await loadClipVideo(file, d)).toBeNull();
    expect(d.revoked).toEqual(["blob:fond-1"]);
  });

  it("une durée nulle, infinie ou absente : pas un fond", async () => {
    for (const duration of [0, Number.NaN, Infinity]) {
      const video = new FakeVideo({ duration, width: 640, height: 360 });
      const d = deps(video);
      expect(await loadClipVideo(file, d)).toBeNull();
      expect(d.revoked).toEqual(["blob:fond-1"]);
    }
  });

  it("un fichier sans image (son seul) : pas un fond", async () => {
    const video = new FakeVideo({ duration: 30, width: 0, height: 0 });
    expect(await loadClipVideo(file, deps(video))).toBeNull();
  });

  it("un fichier qui ne répond jamais : abandon au délai, sans bloquer l'export", async () => {
    const video = new FakeVideo(
      { duration: 5, width: 640, height: 360 },
      "never",
    );
    const d = deps(video);
    expect(await loadClipVideo(file, d)).toBeNull();
    expect(d.revoked).toEqual(["blob:fond-1"]);
  });
});
