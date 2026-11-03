import { describe, expect, it, vi } from "vitest";
import {
  fetchJobBackgroundVideo,
  jobBackgroundVideoUrl,
} from "./export-video-job-clip";

/** La page de rendu (navigateur sans interface du serveur) va chercher la vidéo de fond du job. */
const ok = (bytes: string) =>
  vi.fn(async () => new Response(bytes, { status: 200 }));

describe("vidéo de fond d'un job, côté page de rendu", () => {
  it("l'adresse est propre au job et à la session", () => {
    expect(jobBackgroundVideoUrl("s1", "j1")).toBe(
      "/api/sessions/s1/export/video/jobs/j1/background-video",
    );
  });

  it("rend un fichier nommé par l'identité de la vidéo : un même fond redonne la même clé de réutilisation", async () => {
    const file = await fetchJobBackgroundVideo(
      "s1",
      "j1",
      "abc123",
      ok("images"),
    );
    expect(file.name).toBe("abc123");
    expect(file.type).toBe("video/mp4");
    expect(file.lastModified).toBe(0);
    expect(await file.text()).toBe("images");
    const again = await fetchJobBackgroundVideo(
      "s1",
      "j1",
      "abc123",
      ok("images"),
    );
    expect([again.name, again.size, again.lastModified]).toEqual([
      file.name,
      file.size,
      file.lastModified,
    ]);
  });

  it("garde le cookie du rendu : même origine, jamais d'adresse extérieure", async () => {
    const fetcher = ok("x");
    await fetchJobBackgroundVideo("s1", "j1", "id", fetcher);
    const [url, init] = fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url.startsWith("/api/")).toBe(true);
    expect(init?.credentials).toBe("same-origin");
  });

  it("une vidéo retirée ou expirée pendant l'attente : une erreur qui l'explique", async () => {
    const gone = vi.fn(async () => new Response("{}", { status: 404 }));
    await expect(
      fetchJobBackgroundVideo("s1", "j1", "id", gone),
    ).rejects.toThrow(/vidéo de fond.*(retirée|expiré)/i);
  });

  it("un échec réseau est expliqué, sans trace technique", async () => {
    const down = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(
      fetchJobBackgroundVideo("s1", "j1", "id", down),
    ).rejects.toThrow(/vidéo de fond/i);
  });

  it("une réponse vide n'est pas une vidéo", async () => {
    await expect(
      fetchJobBackgroundVideo("s1", "j1", "id", ok("")),
    ).rejects.toThrow(/vide/i);
  });
});
