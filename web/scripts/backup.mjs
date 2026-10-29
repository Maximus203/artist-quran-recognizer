#!/usr/bin/env node
/**
 * Sauvegarde, vérification et restauration des données de l'atelier (section 15 de
 * docs/SECURITE-PRE-DEPLOIEMENT.md). Une sauvegarde est un dossier `aqr-AAAAMMJJTHHMMSSZ/` :
 *   aqr.sqlite     instantané cohérent de la base (VACUUM INTO : pas de copie à chaud d'un fichier WAL)
 *   sessions/      audios, prédictions et décisions
 *   avatars/       photos de profil
 *   manifest.json  taille et empreinte SHA-256 de chaque fichier, nombre de lignes de chaque table
 * Les journaux ne sont pas sauvegardés (ils ont leur propre rétention, cf. docs/DIAGNOSTIC-PRODUCTION.md).
 * Le dossier est ensuite copié ailleurs, chiffré, par restic (règle 3-2-1, docs/INFRASTRUCTURE.md).
 *
 *   node web/scripts/backup.mjs backup  --root <données> --out <dossier> [--keep 14]
 *   node web/scripts/backup.mjs verify  <sauvegarde>
 *   node web/scripts/backup.mjs restore <sauvegarde> --target <dossier vide>
 * Code retour : 0 réussi, 1 sauvegarde ou restauration invalide, 2 usage.
 */
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const DATA_DIRS = ["sessions", "avatars"];
const SKIP = /\.(tmp|partial|lock)$/i;

const sha256 = (file) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

function walk(root, current = root) {
  const out = [];
  if (!existsSync(current)) return out;
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) out.push(...walk(root, full));
    else if (entry.isFile() && !SKIP.test(entry.name))
      out.push(path.relative(root, full).split(path.sep).join("/"));
  }
  return out.sort();
}

function tableCounts(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all();
    return Object.fromEntries(
      tables.map(({ name }) => [
        name,
        db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get().n,
      ]),
    );
  } finally {
    db.close();
  }
}

const stamp = (date) =>
  date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");

/** Crée une sauvegarde de `root` dans `out` ; rend son dossier. */
export function createBackup({
  root,
  out,
  dbFile = path.join(root, "aqr.sqlite"),
  now = new Date(),
}) {
  if (!existsSync(dbFile)) throw new Error(`Base introuvable : ${dbFile}`);
  const dir = path.join(out, `aqr-${stamp(now)}`);
  if (existsSync(dir)) throw new Error(`La sauvegarde existe déjà : ${dir}`);
  mkdirSync(dir, { recursive: true });
  const target = path.join(dir, "aqr.sqlite");
  const db = new DatabaseSync(dbFile);
  try {
    db.exec("PRAGMA busy_timeout = 10000");
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }
  for (const name of DATA_DIRS) {
    const source = path.join(root, name);
    if (existsSync(source))
      cpSync(source, path.join(dir, name), {
        recursive: true,
        filter: (file) => !SKIP.test(file),
      });
  }
  const files = [
    "aqr.sqlite",
    ...DATA_DIRS.flatMap((n) => walk(dir, path.join(dir, n))),
  ]
    .filter((f, i, all) => all.indexOf(f) === i)
    .map((file) => ({
      path: file,
      size: statSync(path.join(dir, file)).size,
      sha256: sha256(path.join(dir, file)),
    }));
  const manifest = {
    createdAt: now.toISOString(),
    files,
    tables: tableCounts(target),
  };
  writeFileSync(
    path.join(dir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  return {
    dir,
    files: files.length,
    bytes: files.reduce((n, f) => n + f.size, 0),
  };
}

/** Contrôle une sauvegarde ou un dossier restauré : empreintes, intégrité SQLite, lignes par table. */
export function verifyBackup(dir) {
  const problems = [];
  const manifestFile = path.join(dir, "manifest.json");
  if (!existsSync(manifestFile))
    return { ok: false, problems: ["manifest.json absent"] };
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  for (const file of manifest.files) {
    const full = path.join(dir, file.path);
    if (!existsSync(full)) problems.push(`manquant : ${file.path}`);
    else if (sha256(full) !== file.sha256)
      problems.push(`altéré : ${file.path}`);
  }
  const known = new Set(manifest.files.map((f) => f.path));
  for (const name of DATA_DIRS)
    for (const file of walk(dir, path.join(dir, name)))
      if (!known.has(file)) problems.push(`en trop : ${file}`);
  const dbFile = path.join(dir, "aqr.sqlite");
  if (existsSync(dbFile)) {
    let db = null;
    try {
      db = new DatabaseSync(dbFile, { readOnly: true });
      const check = db.prepare("PRAGMA integrity_check").get();
      db.close();
      db = null;
      if (Object.values(check)[0] !== "ok")
        problems.push("la base échoue à integrity_check");
      const counts = tableCounts(dbFile);
      for (const [table, n] of Object.entries(manifest.tables))
        if (counts[table] !== n)
          problems.push(
            `table ${table} : ${counts[table]} lignes au lieu de ${n}`,
          );
    } catch (error) {
      try {
        db?.close();
      } catch {
        // déjà fermée
      }
      problems.push(`base illisible : ${error.message}`);
    }
  }
  return { ok: problems.length === 0, problems, manifest };
}

/** Restaure une sauvegarde vérifiée dans un dossier VIDE (refuse d'écraser quoi que ce soit). */
export function restoreBackup({ backup, target }) {
  const before = verifyBackup(backup);
  if (!before.ok)
    throw new Error(`Sauvegarde invalide : ${before.problems.join(" ; ")}`);
  if (existsSync(target) && readdirSync(target).length > 0)
    throw new Error(`Le dossier cible n'est pas vide : ${target}`);
  mkdirSync(target, { recursive: true });
  cpSync(backup, target, { recursive: true });
  const after = verifyBackup(target);
  if (!after.ok)
    throw new Error(`Restauration invalide : ${after.problems.join(" ; ")}`);
  return { dir: target, files: before.manifest.files.length };
}

/** Garde les `keep` sauvegardes les plus récentes de `out` ; rend celles supprimées. */
export function pruneBackups(out, keep) {
  if (!existsSync(out)) return [];
  const all = readdirSync(out, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^aqr-\d{8}T\d{6}Z$/.test(e.name))
    .map((e) => e.name)
    .sort();
  const doomed = all.slice(0, Math.max(0, all.length - keep));
  for (const name of doomed)
    rmSync(path.join(out, name), { recursive: true, force: true });
  return doomed;
}

function option(args, name) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

function main(args) {
  const [command, first] = args;
  try {
    if (command === "backup") {
      const root = option(args, "root");
      const out = option(args, "out");
      if (!root || !out) return usage();
      const made = createBackup({ root, out });
      const check = verifyBackup(made.dir);
      console.log(
        `Sauvegarde ${made.dir} : ${made.files} fichiers, ${made.bytes} octets, ${check.ok ? "vérifiée" : "INVALIDE"}`,
      );
      if (!check.ok) {
        for (const p of check.problems) console.log(` - ${p}`);
        return 1;
      }
      const keep = Number(option(args, "keep") ?? 0);
      if (keep > 0) {
        const removed = pruneBackups(out, keep);
        if (removed.length)
          console.log(`Anciennes supprimées : ${removed.length}`);
      }
      return 0;
    }
    if (command === "verify" && first) {
      const result = verifyBackup(first);
      console.log(result.ok ? "Sauvegarde valide." : "Sauvegarde INVALIDE :");
      for (const p of result.problems) console.log(` - ${p}`);
      return result.ok ? 0 : 1;
    }
    if (command === "restore" && first) {
      const target = option(args, "target");
      if (!target) return usage();
      const done = restoreBackup({ backup: first, target });
      console.log(
        `Restauré dans ${done.dir} (${done.files} fichiers), vérifié.`,
      );
      return 0;
    }
  } catch (error) {
    console.error(error.message);
    return 1;
  }
  return usage();
}

function usage() {
  console.error(
    "Usage : backup.mjs backup --root <données> --out <dossier> [--keep N] | verify <dossier> | restore <dossier> --target <dossier vide>",
  );
  return 2;
}

if (process.argv[1]?.endsWith("backup.mjs"))
  process.exit(main(process.argv.slice(2)));
