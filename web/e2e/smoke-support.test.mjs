import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CHROMIUM,
  decide,
  findMissingResources,
  isStrict,
  recognizedSegments,
  sessionVerdict,
  waitForSession,
} from "./smoke-support.mjs";

const WEB = "/repo/web";
const present = new Set([
  "/data/s112.wav",
  DEFAULT_CHROMIUM,
  `${WEB}/.next/BUILD_ID`,
]);

async function missingFor({
  env = {},
  files = present,
  executable = () => true,
  preflight = async () => [],
} = {}) {
  return findMissingResources({
    env: { AQR_SMOKE_AUDIO: "/data/s112.wav", ...env },
    webDir: WEB,
    exists: (p) => files.has(p),
    canExecute: executable,
    preflight,
  });
}

describe("isStrict", () => {
  it.each([
    ["1", true],
    ["true", true],
    ["YES", true],
    [" on ", true],
    ["0", false],
    ["", false],
    ["no", false],
    [undefined, false],
  ])("AQR_SMOKE_STRICT=%j -> %s", (value, expected) => {
    expect(isStrict({ AQR_SMOKE_STRICT: value })).toBe(expected);
  });
});

describe("findMissingResources", () => {
  it("ne signale rien quand tout est présent", async () => {
    expect(await missingFor()).toEqual([]);
  });

  it("nomme l'audio absent (variable non définie ou fichier introuvable)", async () => {
    const unset = await missingFor({ env: { AQR_SMOKE_AUDIO: "" } });
    expect(unset).toEqual([
      expect.objectContaining({
        resource: "audio",
        reason: expect.stringContaining("AQR_SMOKE_AUDIO absent"),
      }),
    ]);
    const gone = await missingFor({ env: { AQR_SMOKE_AUDIO: "/nope.wav" } });
    expect(gone).toEqual([
      expect.objectContaining({
        resource: "audio",
        reason: expect.stringContaining("/nope.wav introuvable"),
      }),
    ]);
  });

  it("nomme Chromium absent ou non exécutable, y compris un chemin personnalisé", async () => {
    const absent = await missingFor({
      files: new Set(["/data/s112.wav", `${WEB}/.next/BUILD_ID`]),
    });
    expect(absent.map((m) => m.resource)).toEqual(["chromium"]);
    expect(absent[0].reason).toContain(DEFAULT_CHROMIUM);
    const custom = await missingFor({
      env: { AQR_SMOKE_CHROMIUM: "/opt/x/chrome" },
    });
    expect(custom[0].reason).toContain("/opt/x/chrome");
    const notExec = await missingFor({ executable: () => false });
    expect(notExec.map((m) => m.resource)).toEqual(["chromium"]);
  });

  it("exige le build Next sauf pour un serveur distant", async () => {
    const files = new Set(["/data/s112.wav", DEFAULT_CHROMIUM]);
    expect((await missingFor({ files })).map((m) => m.resource)).toEqual([
      "web-build",
    ]);
    expect(
      await missingFor({ files, env: { AQR_SMOKE_URL: "http://vm:3097" } }),
    ).toEqual([]);
  });

  it("ajoute ce que Python signale (ffmpeg, modèles, corpus) et demande le bon périmètre", async () => {
    const preflight = vi.fn(async () => [
      {
        resource: "corpus",
        reason: "checksum invalide pour quran-uthmani.txt",
      },
    ]);
    const missing = await missingFor({ preflight });
    expect(preflight).toHaveBeenCalledWith(["ffmpeg", "models", "corpus"]);
    expect(missing).toEqual([
      {
        resource: "corpus",
        reason: "checksum invalide pour quran-uthmani.txt",
      },
    ]);
    const remote = vi.fn(async () => []);
    await missingFor({ preflight: remote, env: { AQR_SMOKE_URL: "http://x" } });
    expect(remote).toHaveBeenCalledWith(["corpus"]);
  });

  it("signale Python inutilisable au lieu de planter", async () => {
    const missing = await missingFor({
      env: { AQR_PYTHON: "/bin/nope" },
      preflight: async () => {
        throw new Error("spawn /bin/nope ENOENT");
      },
    });
    expect(missing).toEqual([
      {
        resource: "python",
        reason: expect.stringMatching(/\/bin\/nope.*inutilisable.*ENOENT/),
      },
    ]);
  });
});

describe("decide", () => {
  const missing = [
    { resource: "audio", reason: "AQR_SMOKE_AUDIO absent" },
    { resource: "chromium", reason: "Chromium introuvable" },
  ];

  it("lance quand rien ne manque", () => {
    expect(decide({ strict: true, missing: [] }).action).toBe("run");
  });

  it("strict : échec code 2 avec toutes les raisons", () => {
    const d = decide({ strict: true, missing });
    expect(d).toMatchObject({ action: "fail", exitCode: 2 });
    expect(d.message).toContain("FAIL browser-smoke");
    expect(d.message).toContain("audio : AQR_SMOKE_AUDIO absent");
    expect(d.message).toContain("chromium : Chromium introuvable");
  });

  it("non strict : skip code 0, mais jamais muet", () => {
    const d = decide({ strict: false, missing });
    expect(d).toMatchObject({ action: "skip", exitCode: 0 });
    expect(d.message).toContain("NON EXÉCUTÉ");
    expect(d.message).toContain("audio : AQR_SMOKE_AUDIO absent");
    expect(d.message).toContain("AQR_SMOKE_STRICT=1");
  });

  it("scénario réel : strict sans audio ni Chromium => code 2", async () => {
    const found = await findMissingResources({
      env: { AQR_SMOKE_STRICT: "1" },
      webDir: WEB,
      exists: () => false,
      canExecute: () => false,
      preflight: async () => [],
    });
    const d = decide({
      strict: isStrict({ AQR_SMOKE_STRICT: "1" }),
      missing: found,
    });
    expect(d.exitCode).toBe(2);
    expect(d.message).toContain("AQR_SMOKE_AUDIO absent");
  });
});

describe("sessionVerdict", () => {
  const detail = (state, extra = {}, result = { intervals: [] }) => ({
    session: { state, error: null, ...extra },
    result,
  });

  it("failed : message avec l'erreur de la session", () => {
    expect(
      sessionVerdict(detail("failed", { error: "Le modèle est introuvable" })),
    ).toEqual({
      kind: "failed",
      message: "session en échec : Le modèle est introuvable",
    });
    expect(sessionVerdict(detail("failed")).message).toContain("sans message");
  });

  it("cancelled, done sans résultat, réponse sans session => failed", () => {
    expect(sessionVerdict(detail("cancelled")).kind).toBe("failed");
    expect(sessionVerdict(detail("done", {}, null)).kind).toBe("failed");
    expect(sessionVerdict({}).kind).toBe("failed");
  });

  it("running/ready => pending ; done avec résultat => done", () => {
    expect(sessionVerdict(detail("running")).kind).toBe("pending");
    expect(sessionVerdict(detail("ready")).kind).toBe("pending");
    expect(sessionVerdict(detail("done")).kind).toBe("done");
  });
});

describe("waitForSession", () => {
  const clock = () => {
    let t = 0;
    return {
      now: () => t,
      sleep: vi.fn(async (ms) => {
        t += ms;
      }),
    };
  };

  it("lève immédiatement sur une session failed, sans attendre le délai", async () => {
    const { now, sleep } = clock();
    const fetchDetail = vi.fn(async () => ({
      session: { state: "failed", error: "modèle manquant" },
      result: null,
    }));
    await expect(
      waitForSession({ fetchDetail, timeoutMs: 900_000, now, sleep }),
    ).rejects.toThrow(/session en échec : modèle manquant/);
    expect(fetchDetail).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("détecte l'échec survenu en cours de route (running puis failed)", async () => {
    const { now, sleep } = clock();
    const states = ["running", "running", "failed"];
    const fetchDetail = async () => ({
      session: { state: states.shift(), error: "mort du processus" },
      result: null,
    });
    await expect(
      waitForSession({
        fetchDetail,
        timeoutMs: 900_000,
        intervalMs: 1000,
        now,
        sleep,
      }),
    ).rejects.toThrow(/mort du processus/);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("rend le détail dès que la session est done", async () => {
    const { now, sleep } = clock();
    const states = ["running", "done"];
    const fetchDetail = async () => ({
      session: { state: states.shift() },
      result: { intervals: [] },
    });
    const detail = await waitForSession({
      fetchDetail,
      timeoutMs: 10_000,
      now,
      sleep,
    });
    expect(detail.session.state).toBe("done");
  });

  it("lève au délai avec le dernier état", async () => {
    const { now, sleep } = clock();
    const fetchDetail = async () => ({
      session: { state: "running" },
      result: null,
    });
    await expect(
      waitForSession({
        fetchDetail,
        timeoutMs: 5000,
        intervalMs: 2000,
        now,
        sleep,
      }),
    ).rejects.toThrow(/délai dépassé \(5 s\).*état running/);
  });
});

describe("recognizedSegments", () => {
  const verse = (over) => ({
    kind: "verse",
    ref: "112:1",
    status: "recognized",
    text: "نص",
    ...over,
  });

  it("ne garde que les versets RECOGNIZED de la sourate, jamais un incertain ni un déduit", () => {
    const result = {
      intervals: [
        { kind: "abstention", reason: "silence" },
        verse({ status: "uncertain", text: null }),
        verse({ status: "inferred" }),
        verse({ ref: "113:1" }),
        verse({ text: "" }),
        verse({ ref: "112:2" }),
        verse({ ref: "112:3" }),
      ],
    };
    expect(
      recognizedSegments(result, 112).map((s) => [s.index, s.interval.ref]),
    ).toEqual([
      [5, "112:2"],
      [6, "112:3"],
    ]);
  });

  it("rend une liste vide sans verset RECOGNIZED exploitable", () => {
    expect(
      recognizedSegments({ intervals: [verse({ status: "inferred" })] }, 112),
    ).toEqual([]);
    expect(recognizedSegments(null, 112)).toEqual([]);
  });
});
