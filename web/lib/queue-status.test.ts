import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "./db";
import {
  describeWait,
  ordinalFr,
  queueMessage,
  queueStatusFor,
  type QueueSources,
} from "./queue-status";
import { createMeta, type NewMeta } from "./session-index";
import { createUser } from "./users";

let db: Db;
let a: number;
let b: number;
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function add(n: number, owner: number, extra: Partial<NewMeta> = {}) {
  createMeta(db, {
    id: id(n),
    ownerId: owner,
    name: `Titre ${n}`,
    nameSource: "auto",
    originalName: `fichier${n}.mp3`,
    sourceKind: "file",
    visibility: "private",
    createdAt: new Date(Date.UTC(2026, 9, 1, 0, n)).toISOString(),
    sizeBytes: 1000,
    ...extra,
  });
}
const sources = (over: Partial<QueueSources> = {}): QueueSources => ({
  now: Date.UTC(2026, 9, 2),
  concurrency: 1,
  queue: null,
  videoJobs: [],
  ...over,
});

beforeEach(() => {
  db = openDatabase(":memory:");
  a = createUser(db, { username: "Awa", passwordHash: "x" }).id;
  b = createUser(db, { username: "Bakary", passwordHash: "x" }).id;
});

describe("file visible, en privé", () => {
  it("B voit « occupé » quand A a une génération privée : ni titre, ni nom, ni identifiant", () => {
    add(1, a, { name: "Récitation secrète de Awa", state: "running" });
    add(2, a, { name: "Deuxième secret", state: "queued" });
    const status = queueStatusFor(db, { id: b, role: "user" }, sources());
    expect(status.mine).toEqual([]);
    expect(status.others).toEqual({ running: 1, waiting: 1, shared: [] });
    expect(status.message).toBe(
      "Le système est occupé : une génération est en cours et une autre est en attente.",
    );
    expect(Object.keys(status.others).sort()).toEqual([
      "running",
      "shared",
      "waiting",
    ]);
    const wire = JSON.stringify(status);
    for (const forbidden of [
      "secrète",
      "secret",
      "Awa",
      id(1),
      id(2),
      "fichier1",
      "fichier2",
      "owner",
      "user",
    ])
      expect(wire).not.toContain(forbidden);
  });

  it("une génération publique d'un autre compte est visible de tous, avec son titre", () => {
    add(1, a, {
      name: "Sourate publique",
      visibility: "global",
      state: "running",
    });
    const status = queueStatusFor(db, { id: b, role: "user" }, sources());
    expect(status.others.shared).toEqual([
      {
        session_id: id(1),
        name: "Sourate publique",
        kind: "analysis",
        state: "running",
      },
    ]);
  });

  it("pour son propre job : position, état et estimation indisponible sans historique", () => {
    add(1, a, { state: "running" });
    add(2, a, { state: "queued" });
    add(3, b, { state: "queued" });
    const q = { active: [id(1)], waiting: [id(2), id(3)] };
    const status = queueStatusFor(
      db,
      { id: b, role: "user" },
      sources({ queue: q }),
    );
    expect(status.mine).toHaveLength(1);
    expect(status.mine[0]).toMatchObject({
      session_id: id(3),
      kind: "analysis",
      state: "queued",
      position: 2,
      position_label: "2e dans la file",
      eta_s: null,
      eta_label: "estimation indisponible",
    });
    // A, de son côté, voit ses deux jobs et seulement le compte de celui de B.
    const mine = queueStatusFor(
      db,
      { id: a, role: "user" },
      sources({ queue: q }),
    );
    expect(mine.mine.map((m) => [m.state, m.position])).toEqual([
      ["running", null],
      ["queued", 1],
    ]);
    expect(mine.others).toEqual({ running: 0, waiting: 1, shared: [] });
  });

  it("un export vidéo occupe la même pile et reste privé comme une analyse", () => {
    add(1, a, { state: "queued" }); // session de A
    add(2, b, { state: "ready" }); // session de B, exportée en vidéo
    const status = queueStatusFor(
      db,
      { id: b, role: "user" },
      sources({
        queue: { active: ["video:aaaa"], waiting: [id(1), "video:bbbb"] },
        videoJobs: [
          { key: "video:aaaa", sessionId: id(1), userId: a, state: "running" },
          { key: "video:bbbb", sessionId: id(2), userId: b, state: "queued" },
        ],
      }),
    );
    expect(status.others).toMatchObject({ running: 1, waiting: 1, shared: [] });
    expect(status.mine).toEqual([
      expect.objectContaining({ kind: "video", state: "queued", position: 2 }),
    ]);
    expect(JSON.stringify(status)).not.toContain("video:");
  });

  it("l'attente derrière un export vidéo n'a pas d'estimation (durée du rendu inconnue)", () => {
    add(1, b, { state: "queued" });
    const status = queueStatusFor(
      db,
      { id: b, role: "user" },
      sources({
        queue: { active: ["video:aaaa"], waiting: [id(1)] },
        videoJobs: [
          { key: "video:aaaa", sessionId: id(9), userId: a, state: "running" },
        ],
      }),
    );
    expect(status.mine[0].eta_s).toBeNull();
    expect(status.mine[0].eta_label).toBe("estimation indisponible");
  });

  it("file vide ou seulement à soi : aucun message « occupé »", () => {
    add(1, b, { state: "running" });
    const status = queueStatusFor(
      db,
      { id: b, role: "user" },
      sources({ queue: { active: [id(1)], waiting: [] } }),
    );
    expect(status.message).toBeNull();
    expect(status.others).toEqual({ running: 0, waiting: 0, shared: [] });
  });
});

describe("textes", () => {
  it("ordinaux français", () => {
    expect([1, 2, 3, 11, 21].map(ordinalFr)).toEqual([
      "1re",
      "2e",
      "3e",
      "11e",
      "21e",
    ]);
  });
  it("durée d'attente lisible, ou indisponible", () => {
    expect(describeWait(null)).toBe("estimation indisponible");
    expect(describeWait(20)).toBe("moins d'une minute");
    expect(describeWait(12 * 60 + 10)).toBe("environ 12 min");
    expect(describeWait(3 * 3600 + 5 * 60)).toBe("environ 3 h 05");
  });
  it("accord du message selon les nombres", () => {
    expect(queueMessage({ running: 2, waiting: 3 })).toBe(
      "Le système est occupé : 2 générations sont en cours et 3 autres sont en attente.",
    );
    expect(queueMessage({ running: 0, waiting: 1 })).toBe(
      "Le système est occupé : une génération est en attente.",
    );
    expect(queueMessage({ running: 0, waiting: 0 })).toBeNull();
  });
});
