import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  FREE_SPEECH_FILE,
  readFreeSpeech,
  setFreeSpeechReview,
} from "./free-speech-store";
import { sessionDir } from "./store";

const ID = "00000000-0000-4000-8000-0000000000f1";
const doc = {
  schema: "aqr.free-speech/1",
  source: { recognition_sha256: "0".repeat(64) },
  engine: { transcriber: "a", translator: "b" },
  items: [
    {
      index: 2,
      t: [1, 5],
      status: "translated",
      transcript_ar: "اليوم نتحدث عن الصبر",
      translation_fr: "Aujourd'hui nous parlons de la patience.",
      confidence: 0.9,
      language: "ar",
      review: "pending",
    },
    { index: 4, t: [6, 9], status: "withheld", reason: "quran_like" },
  ],
};

let root = "";
const previous = process.env.AQR_REVIEW_DIR;
const file = () => path.join(sessionDir(ID), FREE_SPEECH_FILE);

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "aqr-free-"));
  process.env.AQR_REVIEW_DIR = root;
  await mkdir(sessionDir(ID), { recursive: true });
});
afterEach(async () => {
  if (previous === undefined) delete process.env.AQR_REVIEW_DIR;
  else process.env.AQR_REVIEW_DIR = previous;
  await rm(root, { recursive: true, force: true });
});

describe("parole libre d'une session", () => {
  it("absente : null", async () => {
    expect(await readFreeSpeech(ID)).toBeNull();
  });

  it("illisible ou invalide : null, jamais une erreur ni un doute affiché", async () => {
    await writeFile(file(), "pas du json");
    expect(await readFreeSpeech(ID)).toBeNull();
    await writeFile(file(), JSON.stringify({ ...doc, schema: "x" }));
    expect(await readFreeSpeech(ID)).toBeNull();
  });

  it("valide un passage traduit et garde le fichier valide", async () => {
    await writeFile(file(), JSON.stringify(doc));
    expect(await setFreeSpeechReview(ID, 2, "approved")).toBe("ok");
    const read = await readFreeSpeech(ID);
    expect(read?.items[0]).toMatchObject({ index: 2, review: "approved" });
    expect(JSON.parse(await readFile(file(), "utf8")).items[1]).toEqual(
      doc.items[1],
    );
  });

  it("un passage retenu n'a rien à relire", async () => {
    await writeFile(file(), JSON.stringify(doc));
    expect(await setFreeSpeechReview(ID, 4, "approved")).toBe("not_translated");
  });

  it("un rang inconnu ou un fichier absent : introuvable", async () => {
    expect(await setFreeSpeechReview(ID, 2, "approved")).toBe("missing");
    await writeFile(file(), JSON.stringify(doc));
    expect(await setFreeSpeechReview(ID, 99, "approved")).toBe("missing");
  });
});
