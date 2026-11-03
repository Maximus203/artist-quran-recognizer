import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createBackup,
  pruneBackups,
  restoreBackup,
  verifyBackup,
} from "../scripts/backup.mjs";

/**
 * Sauvegarde et RESTAURATION réelles (section 15) : vraie base SQLite en mode WAL avec des écritures
 * en cours, vrais fichiers, restauration dans un dossier neuf, puis vérification des empreintes, de
 * l'intégrité et du nombre de lignes. Une sauvegarde dont on n'a pas restauré le contenu n'est pas une
 * sauvegarde.
 */
let root = "";
let out = "";
let db: DatabaseSync;
beforeEach(() => {
  const base = mkdtempSync(path.join(os.tmpdir(), "aqr-backup-"));
  root = path.join(base, "data");
  out = path.join(base, "backups");
  mkdirSync(path.join(root, "sessions", "s1"), { recursive: true });
  mkdirSync(path.join(root, "avatars"), { recursive: true });
  mkdirSync(path.join(root, "logs"), { recursive: true });
  writeFileSync(path.join(root, "sessions", "s1", "source.mp3"), "audio-1");
  writeFileSync(path.join(root, "sessions", "s1", "upload.tmp"), "partiel");
  writeFileSync(path.join(root, "avatars", "1.jpg"), "photo");
  writeFileSync(path.join(root, "logs", "app.log"), "journal");
  db = new DatabaseSync(path.join(root, "aqr.sqlite"));
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");
  db.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY, owner INTEGER)");
  db.exec("INSERT INTO users (name) VALUES ('awa'), ('bakary'), ('cheikh')");
  db.exec("INSERT INTO sessions VALUES ('s1', 1), ('s2', 2)");
});
afterEach(() => {
  db.close();
  rmSync(path.dirname(root), { recursive: true, force: true });
});

describe("sauvegarde", () => {
  it("copie la base (même ouverte, en WAL), les sessions et les avatars, pas les journaux ni les fichiers partiels", () => {
    const made = createBackup({ root, out });
    expect(readdirSync(made.dir).sort()).toEqual([
      "aqr.sqlite",
      "avatars",
      "manifest.json",
      "sessions",
    ]);
    const files = JSON.parse(
      readFileSync(path.join(made.dir, "manifest.json"), "utf8"),
    ).files.map((f: { path: string }) => f.path);
    expect(files).toContain("sessions/s1/source.mp3");
    expect(files).not.toContain("sessions/s1/upload.tmp");
    expect(files.some((f: string) => f.startsWith("logs"))).toBe(false);
    expect(verifyBackup(made.dir).ok).toBe(true);
  });

  it("la restauration redonne les mêmes lignes et les mêmes fichiers", () => {
    const made = createBackup({ root, out });
    db.exec("INSERT INTO users (name) VALUES ('après la sauvegarde')");
    const target = path.join(path.dirname(root), "restored");
    restoreBackup({ backup: made.dir, target });
    const restored = new DatabaseSync(path.join(target, "aqr.sqlite"), {
      readOnly: true,
    });
    expect(
      restored.prepare("SELECT COUNT(*) AS n FROM users").get(),
    ).toMatchObject({ n: 3 }); // l'état au moment de la sauvegarde, pas celui d'après
    expect(
      restored.prepare("SELECT name FROM users ORDER BY id").all(),
    ).toEqual([{ name: "awa" }, { name: "bakary" }, { name: "cheikh" }]);
    restored.close();
    expect(
      readFileSync(path.join(target, "sessions", "s1", "source.mp3"), "utf8"),
    ).toBe("audio-1");
    expect(verifyBackup(target).ok).toBe(true);
  });

  it("une sauvegarde altérée, incomplète ou avec un fichier en trop est refusée", () => {
    const made = createBackup({ root, out });
    const file = path.join(made.dir, "sessions", "s1", "source.mp3");
    writeFileSync(file, "audio-ALTÉRÉ");
    expect(verifyBackup(made.dir).problems.join()).toMatch(/altéré/);
    rmSync(file);
    expect(verifyBackup(made.dir).problems.join()).toMatch(/manquant/);
    writeFileSync(path.join(made.dir, "avatars", "intrus.jpg"), "x");
    expect(verifyBackup(made.dir).problems.join()).toMatch(/en trop/);
    expect(() =>
      restoreBackup({
        backup: made.dir,
        target: path.join(path.dirname(root), "r"),
      }),
    ).toThrow(/invalide/);
  });

  it("une base corrompue est détectée", () => {
    const made = createBackup({ root, out });
    const dbCopy = path.join(made.dir, "aqr.sqlite");
    const bytes = readFileSync(dbCopy);
    writeFileSync(
      dbCopy,
      Buffer.concat([
        bytes.subarray(0, 100),
        Buffer.alloc(bytes.length - 100, 7),
      ]),
    );
    expect(verifyBackup(made.dir).ok).toBe(false);
  });

  it("la restauration refuse d'écraser un dossier non vide", () => {
    const made = createBackup({ root, out });
    const target = path.join(path.dirname(root), "occupe");
    mkdirSync(target);
    writeFileSync(path.join(target, "important.txt"), "ne pas écraser");
    expect(() => restoreBackup({ backup: made.dir, target })).toThrow(
      /pas vide/,
    );
    expect(readFileSync(path.join(target, "important.txt"), "utf8")).toBe(
      "ne pas écraser",
    );
  });

  it("deux sauvegardes à la même seconde ne s'écrasent pas, et la rétention garde les N plus récentes", () => {
    const t = (s: number) => new Date(Date.UTC(2026, 9, 29, 12, 0, s));
    createBackup({ root, out, now: t(1) });
    expect(() => createBackup({ root, out, now: t(1) })).toThrow(/existe déjà/);
    createBackup({ root, out, now: t(2) });
    createBackup({ root, out, now: t(3) });
    const removed = pruneBackups(out, 2);
    expect(removed).toEqual(["aqr-20261029T120001Z"]);
    expect(readdirSync(out)).toHaveLength(2);
  });
});
