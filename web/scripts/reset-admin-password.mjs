#!/usr/bin/env node
/**
 * Réinitialise le mot de passe d'un compte de l'atelier quand l'accès est perdu (poste local).
 * Pose un mot de passe temporaire, révoque toutes les connexions du compte et lève son verrou de connexion.
 * L'atelier ne stocke que l'empreinte : l'ancien mot de passe ne peut pas être relu, il est remplacé.
 *
 *   node scripts/reset-admin-password.mjs            # compte « Admin »
 *   node scripts/reset-admin-password.mjs Cherif     # autre compte
 *
 * Base : `AQR_DB_PATH`, sinon `<AQR_REVIEW_DIR>/aqr.sqlite`, sinon le dossier par défaut de la machine.
 * Arrêter le serveur avant, pour éviter qu'il n'écrive en même temps.
 */
import { createHash, randomBytes, randomInt, scrypt } from "node:crypto";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");

const username = process.argv[2] ?? "Admin";

const defaultDir =
  process.platform === "win32"
    ? path.join(os.homedir(), "AppData", "Local", "aqr-review")
    : path.join(
        process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"),
        "aqr-review",
      );
const dbPath = path.resolve(
  process.env.AQR_DB_PATH ||
    path.join(process.env.AQR_REVIEW_DIR || defaultDir, "aqr.sqlite"),
);
if (!existsSync(dbPath)) {
  console.error(`Base introuvable : ${dbPath}`);
  process.exit(1);
}

// Mêmes règles que lib/users.ts (usernameKey) et lib/passwords.ts (scrypt N=2^17, r=8, p=1).
const usernameKey = (name) =>
  name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
const SCRYPT = { N: 2 ** 17, r: 8, p: 1 };
const derive = (password, salt) =>
  new Promise((resolve, reject) =>
    scrypt(
      password.normalize("NFKC"),
      salt,
      32,
      { ...SCRYPT, maxmem: 160 * SCRYPT.N * SCRYPT.r + 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );
const hashPassword = async (password) => {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
};

// Même alphabet et même format que generateTemporaryPassword (lib/auth.ts).
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const group = () =>
  Array.from({ length: 5 }, () => ALPHABET[randomInt(ALPHABET.length)]).join(
    "",
  );
const temporary = [group(), group(), group(), group()].join("-");

const db = new DatabaseSync(dbPath);
let user;
try {
  user = db
    .prepare("SELECT id, username, role FROM users WHERE username_key = ?")
    .get(usernameKey(username));
} catch (error) {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((t) => t.name);
  console.error(`Lecture impossible dans ${dbPath} : ${error.message}`);
  console.error(`Tables trouvées : ${tables.join(", ") || "aucune"}`);
  process.exit(1);
}
if (!user) {
  console.error(`Aucun compte « ${username} » dans ${dbPath}.`);
  console.error(
    "Comptes présents : " +
      db
        .prepare("SELECT username, role FROM users ORDER BY id")
        .all()
        .map((u) => `${u.username} (${u.role})`)
        .join(", "),
  );
  process.exit(1);
}

const hash = await hashPassword(temporary);
// Clé de verrouillage « login-account » : sha256(scope \0 clé), voir lib/failure-store.ts.
const lockKey = createHash("sha256")
  .update(`login-account\0login-account:${usernameKey(user.username)}`)
  .digest("hex");

db.exec("BEGIN");
try {
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
    hash,
    user.id,
  );
  const revoked = db
    .prepare("DELETE FROM auth_sessions WHERE user_id = ?")
    .run(user.id).changes;
  db.prepare("DELETE FROM auth_failures WHERE key_hash = ?").run(lockKey);
  db.exec("COMMIT");
  console.log(`Compte : ${user.username} (${user.role})`);
  console.log(`Connexions révoquées : ${revoked}`);
  console.log(`Mot de passe temporaire : ${temporary}`);
  console.log(
    "Connecte-toi avec ce mot de passe, puis change-le dans Compte > Sécurité.",
  );
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
} finally {
  db.close();
}
