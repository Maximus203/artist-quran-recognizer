import { describe, expect, it } from "vitest";
import { queueNoticeLines } from "./queue-notice-text";

const wait = (position: number, eta = "estimation indisponible") => ({
  kind: "analysis" as const,
  state: "queued" as const,
  position,
  position_label: `${position}e dans la file`,
  eta_label: eta,
});

describe("pastille de la file", () => {
  it("rien à dire : aucune ligne", () => {
    expect(queueNoticeLines(null)).toEqual([]);
    expect(queueNoticeLines({ mine: [], message: null })).toEqual([]);
  });
  it("attente avec estimation", () => {
    expect(
      queueNoticeLines({
        mine: [wait(3, "environ 12 min")],
        message: "Le système est occupé : une génération est en cours.",
      }),
    ).toEqual([
      "Votre analyse : 3e dans la file · environ 12 min",
      "Le système est occupé : une génération est en cours.",
    ]);
  });
  it("sans historique, l'estimation est dite indisponible", () => {
    expect(queueNoticeLines({ mine: [wait(1)], message: null })).toEqual([
      "Votre analyse : 1e dans la file · estimation indisponible",
    ]);
  });
  it("son propre job en cours, et le système occupé par d'autres", () => {
    expect(
      queueNoticeLines({
        mine: [
          {
            kind: "video",
            state: "running",
            position: null,
            position_label: null,
            eta_label: "estimation indisponible",
          },
        ],
        message: null,
      }),
    ).toEqual(["Votre export vidéo est en cours."]);
    expect(
      queueNoticeLines({
        mine: [],
        message: "Le système est occupé : une génération est en attente.",
      }),
    ).toEqual(["Le système est occupé : une génération est en attente."]);
  });
});
