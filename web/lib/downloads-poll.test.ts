import { describe, expect, it } from "vitest";
import {
  DOWNLOADS_POLL_BUSY_MS,
  DOWNLOADS_POLL_IDLE_MS,
  nextDownloadsPoll,
} from "./downloads-poll";

describe("rythme d'actualisation de la page Téléchargements", () => {
  it("rapide tant qu'un export est actif, lent sinon", () => {
    expect(nextDownloadsPoll(2, true)).toBe(DOWNLOADS_POLL_BUSY_MS);
    expect(nextDownloadsPoll(0, true)).toBe(DOWNLOADS_POLL_IDLE_MS);
  });

  it("n'interroge pas le serveur quand l'onglet est caché", () => {
    expect(nextDownloadsPoll(3, false)).toBe(DOWNLOADS_POLL_IDLE_MS);
  });

  it("avant la première réponse (inconnu), reste en rythme lent", () => {
    expect(nextDownloadsPoll(null, true)).toBe(DOWNLOADS_POLL_IDLE_MS);
  });

  it("le rythme rapide est plus court que le lent", () => {
    expect(DOWNLOADS_POLL_BUSY_MS).toBeLessThan(DOWNLOADS_POLL_IDLE_MS);
  });
});
