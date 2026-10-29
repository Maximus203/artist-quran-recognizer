#!/usr/bin/env node
// Rapport des journaux : erreurs RÉCURRENTES (qui reviennent depuis des jours) et intégrité de la
// chaîne d'audit. À lancer chaque jour (cron, tâche planifiée) : « node scripts/log-report.mjs [dossier] ».
// Code de sortie : 0 = rien à signaler, 1 = avertissements récurrents, 2 = erreurs récurrentes ou
// chaîne d'audit rompue. Aucune dépendance : Node seulement.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const link = (prev, body) =>
  createHash("sha256")
    .update(prev + body)
    .digest("hex")
    .slice(0, 16);
const FILE =
  /^(app|security|access|queue)-(\d{4}-\d{2}-\d{2})(?:\.(\d+))?\.log$/;

/** Même règle que `verifyChain` de lib/log-files.ts (un test vérifie qu'elles s'accordent). */
export function verifyChain(text) {
  const rows = text.split("\n").filter((r) => r.trim() !== "");
  let prev;
  for (let i = 0; i < rows.length; i++) {
    let entry;
    try {
      entry = JSON.parse(rows[i]);
    } catch {
      return { ok: false, badLine: i + 1 };
    }
    const { hash, ...rest } = entry;
    if (typeof hash !== "string" || typeof rest.prev !== "string")
      return { ok: false, badLine: i + 1 };
    if (prev !== undefined && rest.prev !== prev)
      return { ok: false, badLine: i + 1 };
    if (link(rest.prev, JSON.stringify(rest)) !== hash)
      return { ok: false, badLine: i + 1 };
    prev = hash;
  }
  return { ok: true, lines: rows.length };
}

/** Message normalisé : identifiants et nombres remplacés, pour regrouper « la même erreur ». */
export function signature(entry) {
  const msg = String(entry.msg ?? "")
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      "<id>",
    )
    .replace(/\d+/g, "#");
  return `${entry.scope ?? "?"} · ${msg}`;
}

export function summarize(dir, { minDays = 3, minCount = 3 } = {}) {
  const groups = new Map();
  const chain = [];
  if (!existsSync(dir))
    return { groups: [], chain, recurring: [], missing: true };
  const names = readdirSync(dir)
    .filter((n) => FILE.test(n))
    .sort();
  for (const name of names) {
    const text = readFileSync(path.join(dir, name), "utf8");
    if (name.startsWith("security-"))
      chain.push({ file: name, ...verifyChain(text) });
    for (const row of text.split("\n")) {
      if (!row.trim()) continue;
      let entry;
      try {
        entry = JSON.parse(row);
      } catch {
        continue;
      }
      if (entry.level !== "warn" && entry.level !== "error") continue;
      if (entry.scope === "access") continue; // les refus d'accès se lisent dans le flux « access »
      const key = signature(entry);
      const day = String(entry.ts ?? "").slice(0, 10);
      const group = groups.get(key) ?? {
        signature: key,
        level: entry.level,
        count: 0,
        first: entry.ts,
        last: entry.ts,
        days: new Set(),
      };
      group.count += 1;
      group.last = entry.ts;
      if (entry.level === "error") group.level = "error";
      group.days.add(day);
      groups.set(key, group);
    }
  }
  const list = [...groups.values()]
    .map((g) => ({ ...g, days: g.days.size }))
    .sort((a, b) =>
      a.level === b.level ? b.count - a.count : a.level === "error" ? -1 : 1,
    );
  const recurring = list.filter(
    (g) => g.days >= minDays && g.count >= minCount,
  );
  return { groups: list, chain, recurring, missing: false };
}

export function render(result) {
  if (result.missing) return "Aucun dossier de journaux trouvé.\n";
  const lines = [];
  const broken = result.chain.filter((c) => !c.ok);
  lines.push(
    broken.length
      ? `⚠ Chaîne d'audit ROMPUE : ${broken.map((c) => `${c.file} ligne ${c.badLine}`).join(", ")}`
      : `Chaîne d'audit : intacte (${result.chain.length} fichier(s)).`,
  );
  if (result.recurring.length === 0)
    lines.push("Aucune erreur ou avertissement récurrent.");
  else {
    lines.push(
      `Récurrents (au moins 3 jours distincts et 3 occurrences) : ${result.recurring.length}`,
    );
    for (const g of result.recurring)
      lines.push(
        `  [${g.level}] ${g.count}× sur ${g.days} jour(s), du ${g.first} au ${g.last} : ${g.signature}`,
      );
  }
  const others = result.groups
    .filter((g) => !result.recurring.includes(g))
    .slice(0, 10);
  if (others.length) {
    lines.push("Autres (les 10 plus fréquents) :");
    for (const g of others)
      lines.push(`  [${g.level}] ${g.count}× : ${g.signature}`);
  }
  return lines.join("\n") + "\n";
}

export function exitCode(result) {
  if (result.chain.some((c) => !c.ok)) return 2;
  if (result.recurring.some((g) => g.level === "error")) return 2;
  return result.recurring.length ? 1 : 0;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const dir = path.resolve(
    process.argv[2] ??
      process.env.AQR_LOG_DIR ??
      path.join(process.env.AQR_REVIEW_DIR ?? ".", "logs"),
  );
  const result = summarize(dir);
  process.stdout.write(render(result));
  process.exit(exitCode(result));
}
