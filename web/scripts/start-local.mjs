#!/usr/bin/env node
/**
 * Lance l'atelier en production (`npm run start`). Sans AQR_ACCESS_TOKEN, déclare le mode « poste local »
 * (AQR_LOCAL_ONLY=1, seule la boucle locale est servie, aucun jeton) ; avec lui, accès public : toutes les
 * variables de docs/SECRETS-ET-CONFIGURATION.md sont alors exigées. Arguments transmis à `next start`.
 *   npm run start -- -p 3100
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const next = createRequire(import.meta.url).resolve("next/dist/bin/next");
const child = spawn(
  process.execPath,
  [next, "start", "--hostname", "127.0.0.1", ...process.argv.slice(2)],
  {
    stdio: "inherit",
    env: process.env.AQR_ACCESS_TOKEN
      ? process.env
      : { ...process.env, AQR_LOCAL_ONLY: "1" },
  },
);
child.on("exit", (code) => process.exit(code ?? 1));
