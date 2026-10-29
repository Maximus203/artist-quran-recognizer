#!/usr/bin/env node
/**
 * Lance l'atelier en production sur ce poste, pour soi seul : déclare le mode « poste local »
 * (AQR_LOCAL_ONLY=1, seule la boucle locale est servie, aucun jeton). Arguments transmis à `next start`.
 *   npm run start:local -- -p 3100
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const next = createRequire(import.meta.url).resolve("next/dist/bin/next");
const child = spawn(
  process.execPath,
  [next, "start", "--hostname", "127.0.0.1", ...process.argv.slice(2)],
  { stdio: "inherit", env: { ...process.env, AQR_LOCAL_ONLY: "1" } },
);
child.on("exit", (code) => process.exit(code ?? 1));
