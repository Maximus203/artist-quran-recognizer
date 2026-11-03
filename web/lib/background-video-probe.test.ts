import { describe, expect, it, vi } from "vitest";
import {
  captureFilmFrames,
  ProbeError,
  readVideoFacts,
  type ProbeDeps,
} from "./background-video-probe";

/**
 * Lecture des faits d'une vidéo par le navigateur de l'appareil (durée, taille) et vignettes de la bande « film ».
 * Un faux élément `<video>` rejoue les événements d'un vrai : métadonnées, erreur, durée infinie des WebM
 * enregistrés, déplacements.
 */
type Fake = EventTarget & {
  duration: number;
  videoWidth: number;
  videoHeight: number;
  currentTime: number;
  preload: string;
  muted: boolean;
  playsInline: boolean;
  src: string;
  removeAttribute: (name: string) => void;
  load: () => void;
};

function fakeVideo(script: {
  metadata?:
    | { duration: number; width: number; height: number }
    | "error"
    | "never";
  /** Après `currentTime = 1e101` : la durée devient celle-ci (ou reste infinie). */
  settleTo?: number;
  /** Instants de déplacement qui n'aboutissent jamais. */
  stuckAt?: (t: number) => boolean;
}): Fake {
  const target = new EventTarget() as Fake;
  target.duration = Number.NaN;
  target.videoWidth = 0;
  target.videoHeight = 0;
  let time = 0;
  target.preload = "";
  target.muted = false;
  target.playsInline = false;
  target.removeAttribute = () => undefined;
  target.load = () => undefined;
  let source = "";
  Object.defineProperty(target, "src", {
    get: () => source,
    set: (value: string) => {
      source = value;
      const meta = script.metadata ?? "never";
      queueMicrotask(() => {
        if (meta === "error") target.dispatchEvent(new Event("error"));
        else if (meta !== "never") {
          target.duration = meta.duration;
          target.videoWidth = meta.width;
          target.videoHeight = meta.height;
          target.dispatchEvent(new Event("loadedmetadata"));
        }
      });
    },
  });
  Object.defineProperty(target, "currentTime", {
    get: () => time,
    set: (value: number) => {
      time = value;
      if (value >= 1e100 && script.settleTo !== undefined) {
        queueMicrotask(() => {
          target.duration = script.settleTo as number;
          target.dispatchEvent(new Event("durationchange"));
          target.dispatchEvent(new Event("seeked"));
        });
        return;
      }
      if (script.stuckAt?.(value)) return;
      queueMicrotask(() => target.dispatchEvent(new Event("seeked")));
    },
  });
  return target;
}

const deps = (video: Fake, over: Partial<ProbeDeps> = {}) => {
  const revoke = vi.fn();
  const made: ProbeDeps = {
    createVideo: () => video as unknown as HTMLVideoElement,
    createObjectUrl: () => "blob:fake",
    revokeObjectUrl: revoke,
    timeoutMs: 40,
    ...over,
  };
  return { made, revoke };
};
const blob = new Blob(["x"]);

describe("lire la durée et la taille d'une vidéo choisie", () => {
  it("rend la durée, la largeur et la hauteur", async () => {
    const { made } = deps(
      fakeVideo({ metadata: { duration: 12.5, width: 1920, height: 1080 } }),
    );
    expect(await readVideoFacts(blob, made)).toEqual({
      duration: 12.5,
      width: 1920,
      height: 1080,
    });
  });

  it("la lit muette et sans la charger en entier : métadonnées seulement", async () => {
    const video = fakeVideo({
      metadata: { duration: 5, width: 640, height: 360 },
    });
    const { made } = deps(video);
    await readVideoFacts(blob, made);
    expect(video.muted).toBe(true);
    expect(video.preload).toBe("metadata");
  });

  it("un son seul (aucune image) : « no_video »", async () => {
    const { made } = deps(
      fakeVideo({ metadata: { duration: 30, width: 0, height: 0 } }),
    );
    await expect(readVideoFacts(blob, made)).rejects.toMatchObject({
      name: "ProbeError",
      code: "no_video",
    });
  });

  it("un fichier que le navigateur ne lit pas : « unreadable »", async () => {
    const { made } = deps(fakeVideo({ metadata: "error" }));
    await expect(readVideoFacts(blob, made)).rejects.toMatchObject({
      code: "unreadable",
    });
  });

  it("des métadonnées qui n'arrivent jamais : « unreadable » après le délai, sans rester suspendu", async () => {
    const { made } = deps(fakeVideo({ metadata: "never" }));
    await expect(readVideoFacts(blob, made)).rejects.toBeInstanceOf(ProbeError);
  });

  it("une durée nulle : « no_duration »", async () => {
    const { made } = deps(
      fakeVideo({ metadata: { duration: 0, width: 640, height: 360 } }),
    );
    await expect(readVideoFacts(blob, made)).rejects.toMatchObject({
      code: "no_duration",
    });
  });

  it("une durée infinie (WebM enregistré) : le navigateur la calcule en allant à la fin", async () => {
    const { made } = deps(
      fakeVideo({
        metadata: {
          duration: Number.POSITIVE_INFINITY,
          width: 640,
          height: 360,
        },
        settleTo: 8.2,
      }),
    );
    expect((await readVideoFacts(blob, made)).duration).toBe(8.2);
  });

  it("une durée infinie qui ne se résout pas : « no_duration »", async () => {
    const { made } = deps(
      fakeVideo({
        metadata: {
          duration: Number.POSITIVE_INFINITY,
          width: 640,
          height: 360,
        },
      }),
    );
    await expect(readVideoFacts(blob, made)).rejects.toMatchObject({
      code: "no_duration",
    });
  });

  it("libère toujours le fichier : succès comme échec", async () => {
    for (const metadata of [
      { duration: 5, width: 640, height: 360 },
      "error",
      "never",
    ] as const) {
      const { made, revoke } = deps(fakeVideo({ metadata }));
      await readVideoFacts(blob, made).catch(() => undefined);
      expect(revoke).toHaveBeenCalledWith("blob:fake");
    }
  });
});

describe("vignettes de la bande « film »", () => {
  const canvasDeps = (video: Fake, over: Partial<ProbeDeps> = {}) => {
    const drawn: number[] = [];
    const base = deps(video, over);
    let counter = 0;
    return {
      drawn,
      revoke: base.revoke,
      made: {
        ...base.made,
        createCanvas: () => ({
          width: 0,
          height: 0,
          getContext: () => ({
            drawImage: () => drawn.push(video.currentTime),
          }),
          toDataURL: () => `data:image/jpeg;frame-${counter++}`,
        }),
      } as unknown as ProbeDeps,
    };
  };

  it("prend N images à intervalles réguliers, dans l'ordre, au milieu de chaque case", async () => {
    const video = fakeVideo({
      metadata: { duration: 100, width: 1280, height: 720 },
    });
    const { made, drawn } = canvasDeps(video);
    const frames = await captureFilmFrames(blob, 4, { deps: made });
    expect(frames).toHaveLength(4);
    expect(drawn).toEqual([12.5, 37.5, 62.5, 87.5]);
    expect(frames.every((f) => f?.startsWith("data:image/jpeg"))).toBe(true);
  });

  it("rend chaque image dès qu'elle est prête (remplissage progressif)", async () => {
    const video = fakeVideo({
      metadata: { duration: 40, width: 640, height: 360 },
    });
    const { made } = canvasDeps(video);
    const seen: number[] = [];
    await captureFilmFrames(blob, 3, {
      deps: made,
      onFrame: (index) => seen.push(index),
    });
    expect(seen).toEqual([0, 1, 2]);
  });

  it("un déplacement qui n'aboutit pas laisse une case vide et ne bloque pas les suivantes", async () => {
    const video = fakeVideo({
      metadata: { duration: 40, width: 640, height: 360 },
      stuckAt: (t) => t === 15,
    });
    const { made } = canvasDeps(video, { timeoutMs: 20 });
    const frames = await captureFilmFrames(blob, 4, { deps: made });
    expect(frames.map((f) => f === null)).toEqual([false, true, false, false]);
  });

  it("une vidéo illisible : aucune vignette, pas d'erreur (la bande reste hachurée)", async () => {
    const { made } = canvasDeps(fakeVideo({ metadata: "error" }));
    expect(await captureFilmFrames(blob, 3, { deps: made })).toEqual([
      null,
      null,
      null,
    ]);
  });

  it("s'arrête dès que l'utilisateur change de vidéo, et libère le fichier", async () => {
    const video = fakeVideo({
      metadata: { duration: 40, width: 640, height: 360 },
    });
    const { made, drawn, revoke } = canvasDeps(video);
    const controller = new AbortController();
    await captureFilmFrames(blob, 6, {
      deps: made,
      signal: controller.signal,
      onFrame: (index) => {
        if (index === 1) controller.abort();
      },
    });
    expect(drawn.length).toBeLessThan(6);
    expect(revoke).toHaveBeenCalledWith("blob:fake");
  });
});
