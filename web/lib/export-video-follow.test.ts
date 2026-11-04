import { describe, expect, it, vi } from "vitest";
import { ApiError } from "./api-client";
import { followJob, type FollowDeps } from "./export-video-follow";
import type { ServerJob } from "./export-video-jobs-client";

/**
 * Suivre le rendu d'un export. Le rendu tourne sur le serveur : une coupure de réseau ne l'arrête pas. La page
 * le DIT (recette QA, m5 : « 17 % — Tu peux quitter cette page » restait affiché sans un mot sur la coupure) et
 * rattrape l'avancement toute seule au retour du réseau.
 */

const job = (state: ServerJob["state"], filesDone = 0): ServerJob =>
  ({
    id: "j".repeat(32),
    state,
    files_done: filesDone,
    files_total: 1,
    downloads: [],
    error: null,
  }) as unknown as ServerJob;

function setup(
  results: Array<ServerJob | Error>,
  overrides: Partial<FollowDeps> = {},
) {
  const queue = [...results];
  const events: string[] = [];
  const deps: FollowDeps = {
    fetchJob: async () => {
      const next = queue.shift();
      if (!next) throw new Error("plus de réponse prévue");
      if (next instanceof Error) throw next;
      return next;
    },
    sleep: vi.fn(async () => undefined),
    alive: () => true,
    onJob: (j) => events.push(`job:${j.state}`),
    onConnection: (online) => events.push(online ? "en ligne" : "coupée"),
    interval: 10,
    ...overrides,
  };
  return { deps, events };
}

const offline = () => new ApiError("Connexion impossible.", 0);

describe("suivre un rendu", () => {
  it("rend le job terminé, après avoir relevé chaque avancement", async () => {
    const { deps, events } = setup([
      job("running"),
      job("running"),
      job("done"),
    ]);
    const last = await followJob(deps);
    expect(last?.state).toBe("done");
    expect(events).toEqual(["job:running", "job:running", "job:done"]);
    expect(deps.sleep).toHaveBeenCalledTimes(2);
  });

  it("une coupure de réseau est annoncée UNE fois, et le retour du réseau aussi", async () => {
    const { deps, events } = setup([
      job("running"),
      offline(),
      offline(),
      offline(),
      job("running"),
      job("done"),
    ]);
    await followJob(deps);
    expect(events).toEqual([
      "job:running",
      "coupée",
      "en ligne",
      "job:running",
      "job:done",
    ]);
  });

  it("un serveur qui répond 5xx compte comme une coupure (le rendu continue, on réessaie)", async () => {
    const { deps, events } = setup([
      new ApiError("Erreur du serveur.", 503),
      job("done"),
    ]);
    await followJob(deps);
    expect(events).toEqual(["coupée", "en ligne", "job:done"]);
  });

  it("une autre erreur (ex. 404) est réessayée sans fausse annonce de coupure", async () => {
    const { deps, events } = setup([
      new ApiError("Introuvable.", 404),
      job("done"),
    ]);
    await followJob(deps);
    expect(events).toEqual(["job:done"]);
  });

  it("un job échoué est rendu tel quel, avec son message", async () => {
    const failed = { ...job("failed"), error: "Plus de mémoire." } as ServerJob;
    const { deps } = setup([failed]);
    expect((await followJob(deps))?.error).toBe("Plus de mémoire.");
  });

  it("la page est quittée pendant une coupure : la boucle s'arrête sans rien annoncer de plus", async () => {
    let alive = true;
    const { deps, events } = setup([offline(), offline()], {
      alive: () => alive,
      sleep: vi.fn(async () => {
        alive = false;
      }),
    });
    expect(await followJob(deps)).toBeNull();
    expect(events).toEqual(["coupée"]);
  });

  it("la page est quittée pendant une réponse : on ne met rien à jour", async () => {
    let alive = true;
    const { deps, events } = setup([job("running")], {
      fetchJob: async () => {
        alive = false;
        return job("running");
      },
      alive: () => alive,
    });
    expect(await followJob(deps)).toBeNull();
    expect(events).toEqual([]);
  });
});
