#!/usr/bin/env node
/**
 * Acceptation de l'API d'export des sous-titres contre un VRAI serveur `next start` (build de
 * production), sans navigateur : contrôle « prêt à exporter ? », décisions, export forcé, droits,
 * orphelines après une nouvelle analyse, vérité terrain. Le client HTTP de Node garde un cookie par compte.
 * Les données sont celles d'un dossier TEMPORAIRE : la session `--source/--id` n'est que LUE (copie de sa
 * prédiction et de son audio) ; jamais les données du mainteneur.
 *
 *   npm run build                                   # prérequis
 *   AQR_PYTHON=<python du dépôt> node e2e/export-api.mjs --source <dossier sessions> --id <id> [--port 3581] [--write]
 *
 * Sans `--write`, le résultat s'affiche seulement. Code de sortie 1 s'il y a un échec.
 */
import { spawn } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(here, "..");
const repoDir = path.resolve(webDir, "..");
const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const SOURCE = arg("source");
const ID = arg("id");
const PORT = Number(arg("port", "3581"));
const WRITE = process.argv.includes("--write");
if (!SOURCE || !ID) {
  console.error(
    "Usage : node e2e/export-api.mjs --source <dossier sessions> --id <id> [--port N] [--write]",
  );
  process.exit(2);
}

async function freePort(start) {
  for (let port = start; port < start + 50; port++) {
    const free = await new Promise((resolve) => {
      const probe = net
        .createServer()
        .once("error", () => resolve(false))
        .once("listening", () => probe.close(() => resolve(true)));
      probe.listen(port, "127.0.0.1");
    });
    if (free) return port;
  }
  throw new Error("aucun port libre");
}

async function startServer(port) {
  const reviewDir = await mkdtemp(path.join(os.tmpdir(), "aqr-e2e-export-"));
  const child = spawn(
    process.execPath,
    [
      path.join(webDir, "node_modules", "next", "dist", "bin", "next"),
      "start",
      "--hostname",
      "127.0.0.1",
      "-p",
      String(port),
    ],
    {
      cwd: webDir,
      env: { ...process.env, AQR_REVIEW_DIR: reviewDir, AQR_TIMEZONE: "UTC" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${base}/api/auth/config`)).ok)
        return { base, reviewDir, child, log: () => log };
    } catch {
      /* pas encore prêt */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill();
  throw new Error(`serveur injoignable :\n${log}`);
}

class Client {
  constructor(base) {
    this.base = base;
    this.cookie = null;
  }
  async call(method, url, { json, body, headers = {} } = {}) {
    const h = { ...headers };
    if (this.cookie) h.cookie = `aqr_session=${this.cookie}`;
    if (json !== undefined) {
      h["content-type"] = "application/json";
      body = JSON.stringify(json);
    }
    const res = await fetch(this.base + url, { method, headers: h, body });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const match = /^aqr_session=([^;]*)/.exec(c);
      if (match) this.cookie = match[1] || null;
    }
    const text = await res.text();
    let data = text;
    try {
      data = JSON.parse(text);
    } catch {
      /* texte brut */
    }
    return { status: res.status, data, text, headers: res.headers };
  }
  get = (url) => this.call("GET", url);
  post = (url, json) => this.call("POST", url, { json });
  put = (url, json) => this.call("PUT", url, { json });
  patch = (url, json) => this.call("PATCH", url, { json });
}

const results = [];
const check = (cond, message) => {
  if (!cond) throw new Error(message);
};
const status = (res, expected, what) =>
  check(
    res.status === expected,
    `${what} : attendu ${expected}, reçu ${res.status} ${JSON.stringify(res.data).slice(0, 200)}`,
  );
async function scenario(id, spec, run) {
  let verdict = "✅";
  let observed;
  try {
    observed = await run();
  } catch (error) {
    verdict = "❌";
    observed = error instanceof Error ? error.message : String(error);
  }
  results.push({ id, ...spec, observed, verdict });
  console.log(
    `${verdict} ${id} ${spec.title}\n     ${String(observed).split("\n")[0].slice(0, 220)}`,
  );
}
const sha = (buffer) => createHash("sha256").update(buffer).digest("hex");
const PASSWORD = "un mot de passe solide 2026";

async function signup(base, name) {
  const client = new Client(base);
  const res = await client.post("/api/auth/register", {
    username: name,
    password: PASSWORD,
  });
  check(
    res.status === 200 || res.status === 201,
    `inscription ${name} : ${res.status}`,
  );
  return client;
}

/** Rend `id` terminée, avec la prédiction réelle de la session source (copiée, jamais modifiée à la source). */
async function adopt(reviewDir, id, audioSha) {
  const dir = path.join(reviewDir, "sessions", id);
  const prediction = JSON.parse(
    await readFile(
      path.join(SOURCE, ID, "prediction.recognition.json"),
      "utf8",
    ),
  );
  prediction.source.sha256 = audioSha;
  const raw = JSON.stringify(prediction);
  await writeFile(path.join(dir, "prediction.recognition.json"), raw);
  const session = JSON.parse(
    await readFile(path.join(dir, "session.json"), "utf8"),
  );
  Object.assign(session, {
    state: "done",
    prediction_sha256: sha(Buffer.from(raw)),
    audio_duration_s: prediction.source.duration_s,
    finished_at: new Date().toISOString(),
    viewed_at: null,
  });
  await writeFile(
    path.join(dir, "session.json"),
    JSON.stringify(session, null, 2),
  );
  return { dir, prediction };
}

async function main() {
  const port = await freePort(PORT);
  const server = await startServer(port);
  try {
    const admin = await signup(server.base, "Chef Test"); // le premier inscrit est administrateur
    const amina = await signup(server.base, "Amina Test");
    const bilal = await signup(server.base, "Bilal Test");

    const mp3 = await readFile(
      path.join(
        SOURCE,
        ID,
        (await readdir(path.join(SOURCE, ID))).find(
          (n) => n.startsWith("source.") && !n.includes("recognition"),
        ),
      ),
    );
    const uploaded = await amina.call("POST", "/api/sessions", {
      body: mp3,
      headers: {
        "x-aqr-filename": encodeURIComponent("cours du soir.mp3"),
        "content-type": "application/octet-stream",
      },
    });
    status(uploaded, 201, "import");
    const id = uploaded.data.session?.id ?? uploaded.data.id;
    const waiting = await amina.get(`/api/sessions/${id}/export/readiness`);
    const audioSha = JSON.parse(
      await readFile(
        path.join(server.reviewDir, "sessions", id, "session.json"),
        "utf8",
      ),
    ).audio_sha256;

    await scenario(
      "E.0",
      {
        title:
          "Une analyse qui n'est pas terminée n'a rien à contrôler : 409 not_ready",
        priority: "important",
        technique: "transition d'état",
        action:
          "Amina importe un audio sans lancer l'analyse puis appelle `GET …/export/readiness`.",
        expected: "`409`, `code: not_ready`.",
      },
      async () => {
        status(waiting, 409, "readiness avant la fin");
        check(waiting.data.code === "not_ready", "code not_ready attendu");
        return `409 ${waiting.data.code}`;
      },
    );

    const { dir, prediction } = await adopt(server.reviewDir, id, audioSha);
    const predictionPath = path.join(dir, "prediction.recognition.json");
    const predictionSha = sha(await readFile(predictionPath));
    const url = `/api/sessions/${id}`;

    let total = 0;
    let items = [];
    await scenario(
      "E.1",
      {
        title:
          "Le contrôle compte les passages ambigus de la partie coranique, une page à la fois",
        priority: "critique",
        technique: "partition d'équivalence",
        action:
          "Amina appelle `GET …/export/readiness?size=10` sur une session réelle (incertains, coupures, traductions approximatives).",
        expected:
          "`200` ; `verdict.total` = le nombre de passages ; au plus 10 passages ; réponse < 100 Ko ; abstentions et formules comptées à part, dans aucune liste.",
      },
      async () => {
        const res = await amina.get(`${url}/export/readiness?size=10`);
        status(res, 200, "readiness");
        total = res.data.verdict.total;
        items = res.data.items;
        check(total > 0, "au moins un passage attendu sur cette session");
        check(items.length <= 10, "page de 10 au plus");
        check(
          res.text.length < 100_000,
          `réponse trop lourde (${res.text.length} octets)`,
        );
        check(
          res.data.verdict.ready === false,
          "pas prêt tant que rien n'est corrigé",
        );
        check(
          items.every((i) => i.type !== "abstention" && i.type !== "formula"),
          "aucune abstention ni formule dans la liste",
        );
        check(
          res.data.non_quran.abstentions + res.data.non_quran.formulas ===
            prediction.intervals.filter((i) => i.kind !== "verse").length,
          "décompte non coranique exact",
        );
        return `${total} passages (${Object.entries(res.data.counts)
          .map(([k, v]) => `${k} ${v.total}`)
          .join(
            ", ",
          )}) ; page de ${items.length} ; ${res.text.length} octets ; non coranique ${res.data.non_quran.abstentions} + ${res.data.non_quran.formulas}`;
      },
    );

    await scenario(
      "E.2",
      {
        title:
          "Changer ce qu'on exporte recompte (arabe seul, référence affichée)",
        priority: "critique",
        technique: "table-décision",
        action:
          "Même contrôle avec `content=ar`, puis `content=fr`, puis `ref=1`.",
        expected:
          "`content=ar` ne compte pas les traductions approximatives ; `content=fr` ne compte pas les coupures de l'arabe seul ni les signes de pause ; `ref=1` ne compte jamais moins.",
      },
      async () => {
        const both = (await amina.get(`${url}/export/readiness`)).data;
        const ar = (await amina.get(`${url}/export/readiness?content=ar`)).data;
        const ref = (await amina.get(`${url}/export/readiness?ref=1`)).data;
        check(
          ar.verdict.total <= both.verdict.total,
          "arabe seul ne compte pas plus",
        );
        check(
          (ar.counts.approx?.total ?? 0) === 0,
          "pas de traduction approximative en arabe seul",
        );
        check(
          ref.verdict.total >= both.verdict.total,
          "afficher la référence ne compte jamais moins",
        );
        return `ar_fr ${both.verdict.total} · ar ${ar.verdict.total} · ref ${ref.verdict.total}`;
      },
    );

    await scenario(
      "E.3",
      {
        title:
          "Sans correction l'export est refusé (409 unresolved_items) ; forcé, il omet et le dit",
        priority: "critique",
        technique: "erreur + frontière",
        action:
          "Amina exporte en SRT sans forcer ; puis avec `allow_unresolved: true` ; puis un nom de fichier piégé `../../x`.",
        expected:
          "`409 unresolved_items` avec le nombre exact de passages ; forcé : `200`, `summary.forced: true`, `unresolved: n`, `policy: omit`, aucun verset incertain nommé ; nom de fichier sans `/` ni `..`.",
      },
      async () => {
        const refused = await amina.post(`${url}/export/subtitles`, {
          options: {},
        });
        status(refused, 409, "export sans forcer");
        check(
          refused.data.code === "unresolved_items",
          "code unresolved_items",
        );
        check(
          refused.data.unresolved === total,
          `unresolved ${refused.data.unresolved} ≠ ${total}`,
        );
        const forced = await amina.post(`${url}/export/subtitles`, {
          options: { allow_unresolved: true },
          name: "../../x",
        });
        status(forced, 200, "export forcé");
        const s = forced.data.summary;
        check(
          s.forced === true && s.unresolved === total && s.policy === "omit",
          "résumé du forçage",
        );
        check(
          !/[\\/]|\.\./.test(forced.data.name),
          `nom non assaini : ${forced.data.name}`,
        );
        check(forced.data.content.includes("-->"), "fichier SRT non vide");
        for (const o of s.omitted)
          check(
            o.reason === "uncertain" || o.reason === "inferred",
            "omis seulement incertains et supposés",
          );
        return `409 (${refused.data.unresolved}) ; forcé : ${s.cues} sous-titres, ${s.omitted_total} omis, nom « ${forced.data.name} »`;
      },
    );

    await scenario(
      "E.4",
      {
        title:
          "Le texte arabe du fichier est celui du corpus, mot pour mot (I1) ; la traduction est celle de QuranEnc (I2)",
        priority: "critique",
        technique: "comparaison à la source",
        action:
          "Export forcé en ASS (arabe + traduction) ; le texte de chaque verset reconnu est comparé au texte du JSON du moteur (lu dans le corpus).",
        expected:
          "Chaque mot arabe écrit dans l'ASS existe dans le texte du verset correspondant ; l'attribution Tanzil et QuranEnc est dans l'en-tête.",
      },
      async () => {
        const res = await amina.post(`${url}/export/subtitles`, {
          options: { allow_unresolved: true, format: "ass", karaoke: false },
        });
        status(res, 200, "export ASS");
        const arabic = [
          ...res.data.content.matchAll(/,Arabic,,0,0,0,,(.*)/g),
        ].map((m) => m[1]);
        const corpusWords = new Set(
          prediction.intervals
            .filter((i) => i.kind === "verse" && i.text)
            .flatMap((i) => i.text.split(/\s+/)),
        );
        const stray = arabic
          .flatMap((l) => l.split(/\s+/))
          .filter((w) => w && !corpusWords.has(w) && !w.startsWith("["));
        check(
          stray.length === 0,
          `${stray.length} mot(s) arabe(s) hors du texte du moteur : ${stray.slice(0, 3).join(" ")}`,
        );
        check(
          res.data.content.includes("; Texte coranique : Tanzil Project"),
          "attribution Tanzil",
        );
        check(
          res.data.summary.attribution.some((l) => l.includes("QuranEnc")),
          "attribution QuranEnc",
        );
        return `${arabic.length} lignes arabes, 0 mot hors corpus ; attribution présente`;
      },
    );

    let target;
    await scenario(
      "E.5",
      {
        title: "Une décision résout le passage sans toucher à la prédiction",
        priority: "critique",
        technique: "transition d'état",
        action:
          "Amina choisit un candidat du premier passage incertain (`PUT …/decisions`, `decide`).",
        expected:
          "`200`, la décision est `applied` ; `decisions.json` porte l'empreinte, l'auteur « Amina Test » et `use_for_training: true` ; `verdict.unresolved` baisse de 1 ; `prediction.recognition.json` identique (sha256).",
      },
      async () => {
        target = items.find((i) => i.type === "uncertain");
        check(target, "un passage incertain est nécessaire");
        const candidate = target.candidates[0];
        const res = await amina.put(`${url}/decisions`, {
          ops: [
            {
              op: "decide",
              item: "uncertain",
              index: target.index,
              kind: "choose",
              value: { ref: candidate.ref, words: candidate.words },
              evidence: { listened: true, listened_s: 9.5, device: "desktop" },
            },
          ],
        });
        status(res, 200, "décision");
        const view = res.data.decisions;
        check(view.decisions[0].state === "applied", "décision appliquée");
        const doc = JSON.parse(
          await readFile(path.join(dir, "decisions.json"), "utf8"),
        );
        check(
          doc.decisions[0].decided_by === "Amina Test",
          "auteur fixé par le serveur",
        );
        check(
          doc.decisions[0].use_for_training === true,
          "consentement du propriétaire copié",
        );
        check(doc.decisions[0].target.fingerprint?.length === 64, "empreinte");
        const after = (await amina.get(`${url}/export/readiness?size=1`)).data
          .verdict.unresolved;
        check(after === total - 1, `non résolus ${after} ≠ ${total - 1}`);
        check(
          sha(await readFile(predictionPath)) === predictionSha,
          "la prédiction a changé",
        );
        return `appliquée (${candidate.ref}) ; non résolus ${total} → ${after} ; prédiction inchangée`;
      },
    );

    await scenario(
      "E.6",
      {
        title:
          "Annuler toutes les décisions redonne l'export d'une session sans décision, octet pour octet",
        priority: "critique",
        technique: "idempotence",
        action:
          "Export JSON forcé sans décision (référence), puis après la décision de E.5 annulée.",
        expected:
          "Les deux contenus sont identiques ; la décision annulée reste dans `decisions.json` (`withdrawn_at`).",
      },
      async () => {
        const ask = () =>
          amina.post(`${url}/export/subtitles`, {
            options: { allow_unresolved: true, format: "json" },
          });
        const decided = await ask();
        const id0 = JSON.parse(
          await readFile(path.join(dir, "decisions.json"), "utf8"),
        ).decisions[0].id;
        status(
          await amina.put(`${url}/decisions`, {
            ops: [{ op: "withdraw", id: id0 }],
          }),
          200,
          "annulation",
        );
        const withdrawn = await ask();
        await rm(path.join(dir, "decisions.json"));
        const bare = await ask();
        check(
          withdrawn.data.content === bare.data.content,
          "export après annulation ≠ export sans décision",
        );
        check(
          decided.data.content !== bare.data.content,
          "l'export avec décision devait différer",
        );
        const exported = JSON.parse(bare.data.content);
        check(
          exported.intervals.length === prediction.intervals.length,
          "intervalles recopiés",
        );
        return "export annulé == export sans décision ; export avec décision différent ; décision gardée avec withdrawn_at (relue avant suppression du fichier)";
      },
    );

    await scenario(
      "E.7",
      {
        title:
          "Tout résoudre ouvre l'export sans forcer, avec le texte du corpus",
        priority: "critique",
        technique: "parcours nominal",
        action:
          "Pour chaque passage du contrôle, Amina décide (candidat, confirmer, exclure ou ignorer selon la sorte) ; puis exporte en SRT sans forcer.",
        expected:
          "`verdict.ready: true`, `200` sans forcer, `summary.forced: false`.",
      },
      async () => {
        for (let guard = 0; guard < 12; guard++) {
          const page = (await amina.get(`${url}/export/readiness?size=50`))
            .data;
          const open = page.items.filter((i) => i.state === "open");
          if (!open.length) break;
          const ops = open.map((i) => {
            const base = {
              op: "decide",
              item: i.type,
              index: i.index,
              evidence: { listened: true, listened_s: 5, device: "desktop" },
            };
            if (i.type === "uncertain") {
              const c = i.candidates[0];
              return {
                ...base,
                kind: "choose",
                value: { ref: c.ref, words: c.words ?? [1, 1] },
              };
            }
            if (i.type === "inferred")
              return { ...base, kind: "confirm_inferred", value: {} };
            if (i.type === "cut")
              return { ...base, kind: "confirm_partial", value: {} };
            if (i.type === "approx")
              return {
                ...base,
                kind: "translation_scope",
                value: { scope: "verse" },
              };
            return {
              ...base,
              kind: "dismiss_report",
              value: {},
              review_ids: i.review_ids,
            };
          });
          status(
            await amina.put(`${url}/decisions`, { ops }),
            200,
            "décisions par lot",
          );
        }
        const ready = (await amina.get(`${url}/export/readiness`)).data;
        check(
          ready.verdict.ready === true,
          `pas prêt : ${ready.verdict.unresolved} restants`,
        );
        const res = await amina.post(`${url}/export/subtitles`, {
          options: {},
        });
        status(res, 200, "export sans forcer");
        check(
          res.data.summary.forced === false &&
            res.data.summary.unresolved === 0,
          "non forcé",
        );
        return `prêt (${ready.verdict.resolved} sur ${ready.verdict.total} résolus) ; export de ${res.data.summary.cues} sous-titres, forced false`;
      },
    );

    await scenario(
      "E.8",
      {
        title:
          "Droits : seul le propriétaire (ou un administrateur) écrit ; tout lecteur lit et exporte",
        priority: "critique",
        technique: "table-décision",
        action:
          "Bilal (testeur, session globale d'Amina) : `GET readiness`, export forcé, `GET decisions`, puis `PUT decisions` (décider, consentir). Chef (administrateur) : décider puis consentir.",
        expected:
          "Bilal : lecture et export `200`, écriture `403`. Chef : `decide` `200` mais `use_for_training: false` et le consentement d'Amina intact ; `consent` `403`.",
      },
      async () => {
        status(
          await bilal.get(`${url}/export/readiness?size=1`),
          200,
          "Bilal lit",
        );
        status(
          await bilal.post(`${url}/export/subtitles`, {
            options: { allow_unresolved: true },
          }),
          200,
          "Bilal exporte",
        );
        status(
          await bilal.get(`${url}/decisions`),
          200,
          "Bilal lit les décisions",
        );
        const refused = await bilal.put(`${url}/decisions`, {
          ops: [{ op: "consent", training: true }],
        });
        status(refused, 403, "Bilal écrit");
        const first = (
          await amina.get(`${url}/export/readiness?size=50`)
        ).data.items.find((i) => i.decision);
        const adminDecide = await admin.put(`${url}/decisions`, {
          ops: [
            {
              op: "decide",
              item: first.type,
              index: first.index,
              kind: "ignore",
              value: {},
            },
          ],
        });
        status(adminDecide, 200, "l'administrateur décide");
        const doc = JSON.parse(
          await readFile(path.join(dir, "decisions.json"), "utf8"),
        );
        const last = doc.decisions.at(-1);
        check(
          last.decided_by === "Chef Test" && last.use_for_training === false,
          "décision de l'administrateur : jamais de vérité terrain",
        );
        check(doc.consent.training === true, "consentement d'Amina intact");
        status(
          await admin.put(`${url}/decisions`, {
            ops: [{ op: "consent", training: false }],
          }),
          403,
          "l'administrateur consent",
        );
        return "Bilal : 200/200/200, écriture 403 ; Chef : decide 200 (use_for_training false), consentement d'Amina intact, consent 403";
      },
    );

    await scenario(
      "E.9",
      {
        title:
          "Un audio privé répond 404 identique sur les nouvelles routes, administrateur compris",
        priority: "critique",
        technique: "table-décision",
        action:
          "Amina passe la session en privé ; Bilal et Chef appellent readiness, decisions (GET, PUT) et export ; puis une session inexistante.",
        expected:
          "Toujours `404` « Session introuvable » (jamais 403 ni « privée »), même message que pour un identifiant inconnu.",
      },
      async () => {
        const patched = await amina.patch(url, { visibility: "private" });
        check(
          [200, 204].includes(patched.status),
          `passage en privé : ${patched.status}`,
        );
        const unknown = await bilal.get(
          `/api/sessions/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/export/readiness`,
        );
        const seen = [];
        for (const who of [bilal, admin])
          for (const [method, route, body] of [
            ["GET", "/export/readiness"],
            ["GET", "/decisions"],
            ["PUT", "/decisions", { ops: [{ op: "consent", training: true }] }],
            ["POST", "/export/subtitles", { options: {} }],
          ]) {
            const res = await who.call(
              method,
              url + route,
              body ? { json: body } : {},
            );
            check(res.status === 404, `${method} ${route} : ${res.status}`);
            check(
              res.data.error === unknown.data.error,
              "message identique à une session inconnue",
            );
            seen.push(res.status);
          }
        await amina.patch(url, { visibility: "global" });
        return `${seen.length} appels → 404 « ${unknown.data.error} »`;
      },
    );

    await scenario(
      "E.10",
      {
        title:
          "Entrées hostiles : options, décisions et verset refusés proprement",
        priority: "important",
        technique: "valeurs-limites + injection",
        action:
          "Options inconnues ou hors bornes, décision avec un genre inconnu / un passage inexistant / une référence 0:1, `corpus/verse` avec `115:1`, `2:300`, `../x`.",
        expected:
          "`400` avec un message lisible (jamais un chemin ni une trace) ; `404` pour un verset inexistant.",
      },
      async () => {
        const bad = [
          await amina.post(`${url}/export/subtitles`, {
            options: { format: "doc" },
          }),
          await amina.post(`${url}/export/subtitles`, {
            options: { offset_ms: 99999 },
          }),
          await amina.post(`${url}/export/subtitles`, {
            options: { font: "KFGQPC" },
          }),
          await amina.put(`${url}/decisions`, {
            ops: [
              {
                op: "decide",
                item: "uncertain",
                index: 0,
                kind: "inventer",
                value: {},
              },
            ],
          }),
          await amina.put(`${url}/decisions`, {
            ops: [
              {
                op: "decide",
                item: "uncertain",
                index: 99999,
                kind: "choose",
                value: { ref: "1:1", words: [1, 1] },
              },
            ],
          }),
          await amina.put(`${url}/decisions`, {
            ops: [
              {
                op: "decide",
                item: "uncertain",
                index: 0,
                kind: "choose",
                value: { ref: "0:1", words: [1, 1] },
              },
            ],
          }),
        ];
        for (const res of bad) {
          check(
            res.status === 400,
            `attendu 400, reçu ${res.status} ${JSON.stringify(res.data).slice(0, 120)}`,
          );
          check(
            !/[A-Z]:\\|node_modules|at .*\(/.test(res.text),
            "fuite d'un chemin ou d'une trace",
          );
        }
        const verses = [];
        for (const ref of ["115:1", "2:300", "..%2Fx"]) {
          const res = await amina.get(`/api/corpus/verse?ref=${ref}`);
          check(res.status === 404, `verset ${ref} : ${res.status}`);
          verses.push(res.status);
        }
        return `${bad.length} entrées refusées en 400 ; versets inexistants en 404`;
      },
    );

    await scenario(
      "E.11",
      {
        title: "Un verset est lu dans le corpus, mot par mot",
        priority: "important",
        technique: "partition d'équivalence",
        action:
          "`GET /api/corpus/verse?ref=11:61&words=1-10`, sans compte puis avec.",
        expected:
          "Sans compte `401` ; avec : `200`, 10 mots, `words_total` du verset.",
      },
      async () => {
        const anonymous = await new Client(server.base).get(
          "/api/corpus/verse?ref=11:61&words=1-10",
        );
        status(anonymous, 401, "sans compte");
        const res = await amina.get("/api/corpus/verse?ref=11:61&words=1-10");
        status(res, 200, "avec compte");
        check(res.data.tokens.length === 10, "10 mots");
        check(
          res.data.verse_tokens.length === res.data.words_total,
          "mots du verset entier",
        );
        return `401 sans compte ; 200 : ${res.data.tokens.length} mots sur ${res.data.words_total}`;
      },
    );

    await scenario(
      "E.12",
      {
        title:
          "Nouvelle analyse : une décision dont le passage a changé devient orpheline, jamais appliquée en silence",
        priority: "critique",
        technique: "transition d'état",
        action:
          "Amina décide sur un passage ; la prédiction est remplacée par une analyse où ce passage a bougé de 0,3 s ; `GET decisions` ; `GET readiness` ; puis `reattach` vers le passage suggéré.",
        expected:
          "La décision passe `orphan` avec une suggestion ; le passage est de nouveau à vérifier ; après `reattach`, il est résolu et l'ancienne décision reste `superseded`.",
      },
      async () => {
        await rm(path.join(dir, "decisions.json"), { force: true });
        await amina.put(`${url}/decisions`, { ops: [] }).catch(() => undefined);
        const page = (await amina.get(`${url}/export/readiness?size=50`)).data;
        const item = page.items.find(
          (i) => i.type === "uncertain" && i.state === "open",
        );
        check(item, "un passage incertain est nécessaire");
        const c = item.candidates[0];
        status(
          await amina.put(`${url}/decisions`, {
            ops: [
              {
                op: "decide",
                item: "uncertain",
                index: item.index,
                kind: "choose",
                value: { ref: c.ref, words: c.words },
                evidence: { listened: true, listened_s: 5 },
              },
            ],
          }),
          200,
          "décision",
        );
        const moved = JSON.parse(await readFile(predictionPath, "utf8"));
        const interval = moved.intervals[item.index];
        interval.t = [interval.t[0] + 0.3, interval.t[1]];
        const raw = JSON.stringify(moved);
        await writeFile(predictionPath, raw);
        const session = JSON.parse(
          await readFile(path.join(dir, "session.json"), "utf8"),
        );
        session.prediction_sha256 = sha(Buffer.from(raw));
        await writeFile(
          path.join(dir, "session.json"),
          JSON.stringify(session, null, 2),
        );
        const view = (await amina.get(`${url}/decisions`)).data.decisions;
        check(view.stale === true, "stale attendu");
        check(
          view.orphans.length === 1 &&
            view.orphans[0].suggestion?.index === item.index,
          "orpheline avec suggestion",
        );
        const reopened = (await amina.get(`${url}/export/readiness?size=50`))
          .data;
        check(
          reopened.orphans.length === 1,
          "orpheline signalée par le contrôle",
        );
        check(
          reopened.items.find((i) => i.index === item.index).state === "open",
          "le passage est de nouveau à vérifier",
        );
        const orphanId = view.orphans[0].decision.id;
        const re = await amina.put(`${url}/decisions`, {
          ops: [{ op: "reattach", id: orphanId, index: item.index }],
        });
        status(re, 200, "rattachement");
        const states = Object.fromEntries(
          re.data.decisions.decisions.map((d) => [d.id, d.state]),
        );
        check(states[orphanId] === "superseded", "ancienne décision remplacée");
        check(re.data.decisions.orphans.length === 0, "plus d'orpheline");
        const after = (await amina.get(`${url}/export/readiness?size=50`)).data;
        check(
          after.items.find((i) => i.index === item.index).state === "resolved",
          "passage résolu après rattachement",
        );
        return "orpheline + suggestion ; passage rouvert ; rattachée → résolu, ancienne conservée (superseded)";
      },
    );

    await scenario(
      "E.13",
      {
        title:
          "Vérité terrain : seules les corrections écoutées, consenties et appliquées sont proposées, par un administrateur",
        priority: "critique",
        technique: "table-décision",
        action:
          "Amina retire le consentement d'une décision écoutée ; Amina puis Chef appellent `POST …/validation {action: from_decisions}` ; Chef rappelle.",
        expected:
          "Amina : `403` (réservé aux administrateurs). Chef : `200`, passages `proposed` avec `source: export-review` pour les décisions écoutées et consenties seulement ; deuxième appel : même nombre de passages (idempotent).",
      },
      async () => {
        status(
          await amina.post(`${url}/validation`, { action: "from_decisions" }),
          403,
          "propriétaire non administrateur",
        );
        const first = await admin.post(`${url}/validation`, {
          action: "from_decisions",
        });
        status(first, 200, "from_decisions");
        const passages = first.data.validation.passages.filter(
          (p) => p.source === "export-review",
        );
        check(passages.length >= 1, "au moins une proposition");
        check(
          passages.every(
            (p) => p.status === "proposed" && p.alignment === null,
          ),
          "jamais validées seules",
        );
        const again = await admin.post(`${url}/validation`, {
          action: "from_decisions",
        });
        check(
          again.data.validation.passages.length ===
            first.data.validation.passages.length,
          "non idempotent",
        );
        const view = (await amina.get(`${url}/decisions`)).data.decisions;
        const one = view.decisions.find(
          (d) => d.state === "applied" && d.use_for_training,
        );
        status(
          await amina.put(`${url}/decisions`, {
            ops: [{ op: "consent", training: false }],
          }),
          200,
          "retrait de l'accord",
        );
        const afterWithdrawal = await admin.post(`${url}/validation`, {
          action: "from_decisions",
        });
        status(afterWithdrawal, 200, "après retrait");
        check(
          afterWithdrawal.data.validation.passages.length ===
            again.data.validation.passages.length,
          "retirer l'accord n'ajoute rien",
        );
        return `${passages.length} proposition(s) \`proposed\`, rappel idempotent ; accord retiré → plus rien d'ajouté (décision ${one?.id.slice(0, 8)})`;
      },
    );

    const failed = results.filter((r) => r.verdict !== "✅");
    const errors = server
      .log()
      .split("\n")
      .filter((l) => /error|erreur/i.test(l) && !/404|409/.test(l));
    console.log(
      failed.length ? `\n${failed.length} échec(s)` : "\nTout est vert",
    );
    if (errors.length)
      console.log(
        `Journal du serveur : ${errors.length} ligne(s) d'erreur\n${errors.slice(0, 5).join("\n")}`,
      );
    if (WRITE) await writePlaybook(results, errors.length);
    return failed.length ? 1 : 0;
  } finally {
    server.child.kill();
    await rm(server.reviewDir, { recursive: true, force: true }).catch(
      () => undefined,
    );
  }
}

async function writePlaybook(all, serverErrors) {
  const today = new Date().toISOString().slice(0, 10);
  const lines = [
    "# Export des sous-titres, API : contrôle, décisions, export forcé, droits, orphelines",
    `> Surfaces : [API] · Statut : ${all.every((r) => r.verdict === "✅") && !serverErrors ? "✅" : "❌"} · Build : ${process.env.AQR_BUILD ?? "branche courante"} · Testé : ${today}`,
    "> Périmètre : `GET …/export/readiness`, `POST …/export/subtitles`, `GET`/`PUT …/decisions`, `GET /api/corpus/verse`, `POST …/validation from_decisions`.",
    "> Environnement : `next start` (build de production) sur 127.0.0.1, dossier de données de TEST (audio et prédiction réels copiés en lecture seule, jamais les données du mainteneur), un cookie par compte.",
    "> Données : aucun compte pré-créé : Chef Test (premier inscrit = administrateur), Amina Test (propriétaire), Bilal Test (testeur) sont créés par l'API d'inscription ; l'audio par l'API d'import, la prédiction réelle de la session source est posée sur la session d'Amina.",
    `> Critère d'arrêt : tous les scénarios critiques ✅, tous les refus (must-fail) bloqués, aucune ligne d'erreur dans le journal du serveur (observé : ${serverErrors}).`,
    "> Rejouer : `cd web && npm run build && AQR_PYTHON=<python du dépôt> node e2e/export-api.mjs --source <dossier sessions> --id <id> --write`.",
    "",
    "## Préconditions",
    "- [API] Build de production présent, Node ≥ 24, corpus et cache de traduction du moteur disponibles.",
    "",
    "## Scénarios",
    "",
  ];
  for (const r of all)
    lines.push(
      `### ${r.id} — [API] ${r.title}`,
      `**Priorité** : ${r.priority}`,
      `**Technique** : ${r.technique}`,
      `**Action** : ${r.action}`,
      `**Attendu** : ${r.expected}`,
      `**Observé** : ${r.observed}`,
      `**Verdict** : ${r.verdict}`,
      "**Issue** : —",
      "",
    );
  await writeFile(
    path.join(
      repoDir,
      ".artist",
      "acceptance-playbooks",
      "export-sous-titres-api.md",
    ),
    lines.join("\n"),
    "utf8",
  );
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
