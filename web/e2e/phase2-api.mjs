#!/usr/bin/env node
/**
 * Acceptation de bout en bout de la phase 2 (comptes, partage, préférences) contre un VRAI serveur
 * `next start`, sans navigateur : le client HTTP de Node garde les cookies de chaque testeur.
 * Il lance deux serveurs sur un dossier de données de TEST (jamais les données réelles) :
 *   A (inscription ouverte, sans quota)  — le parcours normal et le partage ;
 *   B (inscription sur code, quota 100 Ko, 3 inscriptions/h) — code d'invitation, quota, débit.
 * et écrit les deux playbooks d'acceptation avec ce qui a été observé.
 *
 *   npm run build                                    # prérequis
 *   node e2e/phase2-api.mjs --source <dossier sessions réel> --ids <id1,id2> [--port 3571] [--write]
 *
 * `--source` n'est que LU : les sessions listées sont copiées dans un dossier temporaire.
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
const IDS = (arg("ids", "") ?? "").split(",").filter(Boolean);
const PORT = Number(arg("port", "3571"));
const WRITE = process.argv.includes("--write");
/** `--engine` : lance AUSSI une vraie analyse (modèles réels : AQR_PYTHON, AQR_MODELS_DIR, AQR_CORPUS_DIR…). */
const WITH_ENGINE = process.argv.includes("--engine");
if (!SOURCE || IDS.length === 0) {
  console.error(
    "Usage : node e2e/phase2-api.mjs --source <dossier sessions> --ids <id,id> [--port N] [--write]",
  );
  process.exit(2);
}

// ── Serveurs ──────────────────────────────────────────────────────────────────────────────────
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

async function startServer(label, port, env) {
  const reviewDir = await mkdtemp(path.join(os.tmpdir(), `aqr-e2e-${label}-`));
  if (env.__fixtures) {
    await mkdir(path.join(reviewDir, "sessions"), { recursive: true });
    for (const id of IDS)
      await cp(path.join(SOURCE, id), path.join(reviewDir, "sessions", id), {
        recursive: true,
      });
  }
  const { __fixtures, ...rest } = env;
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
      env: {
        ...process.env,
        AQR_REVIEW_DIR: reviewDir,
        AQR_TIMEZONE: "UTC",
        ...rest,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(`${base}/api/auth/config`);
      if (res.ok) return { base, reviewDir, child, log: () => log };
    } catch {
      /* pas encore prêt */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill();
  throw new Error(`serveur ${label} injoignable :\n${log}`);
}

// ── Client HTTP avec cookie ───────────────────────────────────────────────────────────────────
class Client {
  constructor(base) {
    this.base = base;
    this.cookie = null;
  }
  async call(
    method,
    url,
    { json, body, headers = {}, anonymous = false } = {},
  ) {
    const h = { ...headers };
    if (this.cookie && !anonymous) h.cookie = `aqr_session=${this.cookie}`;
    if (json !== undefined) {
      h["content-type"] = "application/json";
      body = JSON.stringify(json);
    }
    const res = await fetch(this.base + url, {
      method,
      headers: h,
      body,
      redirect: "manual",
    });
    const setCookie = res.headers.getSetCookie?.() ?? [];
    for (const c of setCookie) {
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
    return { status: res.status, data, text, headers: res.headers, setCookie };
  }
  get = (url, o) => this.call("GET", url, o);
  post = (url, json, o) => this.call("POST", url, { json, ...o });
  patch = (url, json, o) => this.call("PATCH", url, { json, ...o });
  put = (url, json, o) => this.call("PUT", url, { json, ...o });
  del = (url, o) => this.call("DELETE", url, o);
  async upload(name, bytes, query = "", headers = {}) {
    return this.call("POST", `/api/sessions${query}`, {
      body: bytes,
      headers: {
        "x-aqr-filename": encodeURIComponent(name),
        "content-type": "application/octet-stream",
        ...headers,
      },
    });
  }
}

function wav(seconds, rate = 16000) {
  const samples = Math.floor(seconds * rate);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++)
    data.writeInt16LE(Math.round(200 * Math.sin(i / 20)), i * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

// ── Scénarios ─────────────────────────────────────────────────────────────────────────────────
const results = [];
const check = (cond, message) => {
  if (!cond) throw new Error(message);
};
const status = (res, expected, what) =>
  check(
    res.status === expected,
    `${what} : attendu ${expected}, reçu ${res.status} ${JSON.stringify(res.data).slice(0, 160)}`,
  );

async function scenario(playbook, id, spec, run) {
  let verdict = "✅";
  let observed;
  try {
    observed = await run();
  } catch (error) {
    verdict = "❌";
    observed = error instanceof Error ? error.message : String(error);
  }
  results.push({ playbook, id, ...spec, observed, verdict });
  console.log(
    `${verdict} ${id} ${spec.title}\n     ${String(observed).split("\n")[0].slice(0, 200)}`,
  );
}

const PASSWORD = "un mot de passe solide 2026";
const ROUTES_OF_A_SESSION = (id) => [
  ["GET", `/api/sessions/${id}`],
  ["PATCH", `/api/sessions/${id}`, { name: "piraté" }],
  ["DELETE", `/api/sessions/${id}`],
  ["GET", `/api/sessions/${id}/audio`],
  ["GET", `/api/sessions/${id}/peaks`],
  ["GET", `/api/sessions/${id}/export`],
  ["GET", `/api/sessions/${id}/bundle`],
  ["GET", `/api/sessions/${id}/review`],
  ["PUT", `/api/sessions/${id}/review`, {}],
  ["POST", `/api/sessions/${id}/run`, {}],
  ["DELETE", `/api/sessions/${id}/run`],
  ["POST", `/api/sessions/${id}/viewed`, {}],
  ["PUT", `/api/sessions/${id}/favorite`, {}],
  ["DELETE", `/api/sessions/${id}/favorite`],
  ["GET", `/api/sessions/${id}/validation`],
  ["POST", `/api/sessions/${id}/validation`, { action: "propose" }],
];

async function main() {
  const A = await startServer("A", await freePort(PORT), {
    __fixtures: true,
    AQR_SIGNUP: "open",
    AQR_REGISTER_PER_HOUR: "100",
  });
  const B = await startServer("B", await freePort(PORT + 1), {
    AQR_SIGNUP: "code",
    AQR_SIGNUP_CODE: "sesame-2026",
    AQR_USER_QUOTA_BYTES: "100000",
    AQR_REGISTER_PER_HOUR: "4",
  });
  const docsIndex = path.join(repoDir, "docs", "docs-index.json");
  let createdDocsIndex = false;
  try {
    await readFile(docsIndex);
  } catch {
    await writeFile(
      docsIndex,
      JSON.stringify([
        {
          slug: "architecture",
          title: "Architecture",
          section: "Technique",
          file: "docs/ARCHITECTURE.md",
        },
      ]),
    );
    createdDocsIndex = true;
  }

  const cherif = new Client(A.base);
  const awa = new Client(A.base);
  const bou = new Client(A.base);
  const anon = new Client(A.base);
  const state = {};

  try {
    // ════════════════════════════ Playbook 1 : parcours normal ════════════════════════════════
    const P1 = "phase2-parcours-normal";
    await scenario(
      P1,
      "N.1",
      {
        priority: "critique",
        technique: "nominal",
        surface: "API",
        title:
          "Avant tout compte : la configuration est publique, le reste exige une connexion",
        action:
          "`GET /api/auth/config` sans cookie, puis `GET /api/sessions`, `GET /api/me`, `GET /api/stats`, `GET /api/docs` sans cookie.",
        expected:
          'La configuration répond `200 { signup: "open", setup_required: true }` ; toutes les autres routes `401 { code: "unauthenticated" }`.',
      },
      async () => {
        const config = await anon.get("/api/auth/config");
        status(config, 200, "config");
        check(
          config.data.signup === "open" && config.data.setup_required === true,
          `config inattendue ${JSON.stringify(config.data)}`,
        );
        const codes = [];
        for (const url of [
          "/api/sessions",
          "/api/me",
          "/api/stats",
          "/api/docs",
          "/api/me/preferences",
          "/api/me/stats",
        ]) {
          const res = await anon.get(url);
          check(
            res.status === 401 && res.data.code === "unauthenticated",
            `${url} → ${res.status}`,
          );
          codes.push(`${url} 401`);
        }
        return `config 200 (setup_required) ; ${codes.join(", ")}`;
      },
    );

    await scenario(
      P1,
      "N.2",
      {
        priority: "critique",
        technique: "nominal",
        surface: "API",
        title: "Le premier compte est administrateur, le cookie est durci",
        action:
          '`POST /api/auth/register { username: "Cherif", password }` puis `GET /api/me`.',
        expected:
          '`201 { user }` avec `role: "admin"` ; `Set-Cookie: aqr_session` `HttpOnly` `SameSite=Lax` `Path=/` (pas `Secure` en HTTP) ; `/api/me` renvoie l\'utilisateur, les préférences par défaut et `quota.limit_bytes: null`. La réponse ne contient ni empreinte ni jeton.',
      },
      async () => {
        const res = await cherif.post("/api/auth/register", {
          username: "Cherif",
          password: PASSWORD,
        });
        status(res, 201, "inscription");
        check(
          res.data.user.role === "admin",
          "le premier compte devrait être administrateur",
        );
        const cookie = res.setCookie.find((c) => c.startsWith("aqr_session="));
        check(
          cookie &&
            /HttpOnly/.test(cookie) &&
            /SameSite=Lax/.test(cookie) &&
            /Path=\//.test(cookie) &&
            !/Secure/.test(cookie),
          `cookie : ${cookie}`,
        );
        check(
          !/password|hash|scrypt/i.test(res.text),
          "la réponse fuit une empreinte",
        );
        const me = await cherif.get("/api/me");
        status(me, 200, "me");
        check(
          me.data.preferences.theme === "system" &&
            me.data.quota.limit_bytes === null,
          `me : ${JSON.stringify(me.data)}`,
        );
        state.cherifId = res.data.user.id;
        return `201 admin (id ${res.data.user.id}), cookie HttpOnly+Lax+Path=/ sans Secure ; /api/me : thème « system », quota illimité`;
      },
    );

    await scenario(
      P1,
      "N.3",
      {
        priority: "critique",
        technique: "nominal",
        surface: "API",
        title:
          "Les sessions déjà sur le disque sont importées : globales, sans propriétaire, nommées lisiblement",
        action:
          "Cherif liste `GET /api/sessions?limit=100` (le dossier de test contient 2 sessions d'avant les comptes).",
        expected:
          '2 sessions, `visibility: "global"`, `owner: null`, `mine: false`, `can_edit: true` (administrateur), `unread: false`, `content_label` calculé depuis le résultat, `name_source: "auto"`, `pid` absent.',
      },
      async () => {
        const res = await cherif.get("/api/sessions?limit=100");
        status(res, 200, "liste");
        check(
          res.data.total === IDS.length && res.data.items.length === IDS.length,
          `total ${res.data.total}`,
        );
        for (const item of res.data.items) {
          check(
            item.visibility === "global" &&
              item.owner === null &&
              item.mine === false &&
              item.can_edit === true &&
              item.unread === false &&
              item.name_source === "auto" &&
              !("pid" in item),
            `item ${item.id} : ${JSON.stringify({ v: item.visibility, o: item.owner, e: item.can_edit, u: item.unread })}`,
          );
          check(
            typeof item.content_label === "string" &&
              item.content_label.length > 0,
            `pas d'étiquette pour ${item.id}`,
          );
        }
        state.legacy = res.data.items.map((i) => i.id);
        return res.data.items
          .map((i) => `« ${i.name} » [${i.content_label}]`)
          .join(" ; ");
      },
    );

    await scenario(
      P1,
      "N.4",
      {
        priority: "critique",
        technique: "nominal",
        surface: "API",
        title: "Un deuxième testeur s'inscrit : simple utilisateur",
        action:
          "`POST /api/auth/register` pour « Awa » puis « Bou » (clients distincts).",
        expected:
          '`201`, `role: "user"` ; chacun a son propre cookie ; `GET /api/admin/users` répond `403` pour eux.',
      },
      async () => {
        const a = await awa.post("/api/auth/register", {
          username: "Awa",
          password: PASSWORD,
        });
        const b = await bou.post("/api/auth/register", {
          username: "Bou",
          password: PASSWORD,
        });
        status(a, 201, "Awa");
        status(b, 201, "Bou");
        check(
          a.data.user.role === "user" && b.data.user.role === "user",
          "rôles",
        );
        check(awa.cookie !== bou.cookie, "cookies identiques");
        const admin = await awa.get("/api/admin/users");
        status(admin, 403, "admin pour un utilisateur");
        state.awaId = a.data.user.id;
        state.bouId = b.data.user.id;
        return `Awa (id ${a.data.user.id}) et Bou (id ${b.data.user.id}) : role user ; /api/admin/users → 403`;
      },
    );

    await scenario(
      P1,
      "N.5",
      {
        priority: "critique",
        technique: "nominal",
        surface: "API",
        title: "Import global par défaut, avec un nom par défaut intelligent",
        action:
          "Awa envoie en flux `Surah_Yusuf__--_Mishary [dQw4w9WgXcQ] 2026-10-20T17-58-52-469.wav` sans paramètre.",
        expected:
          '`201`, `visibility: "global"`, `owner.username: "Awa"`, `mine: true`, `can_edit: true`, `name: "Surah Yusuf - Mishary"`, `name_source: "auto"`, `original_name` = nom envoyé, `size_bytes` = taille envoyée.',
      },
      async () => {
        const bytes = wav(2);
        const res = await awa.upload(
          "Surah_Yusuf__--_Mishary [dQw4w9WgXcQ] 2026-10-20T17-58-52-469.wav",
          bytes,
        );
        status(res, 201, "import");
        const s = res.data;
        check(
          s.visibility === "global" &&
            s.owner?.username === "Awa" &&
            s.mine &&
            s.can_edit,
          `droits : ${JSON.stringify({ v: s.visibility, o: s.owner })}`,
        );
        check(
          s.name === "Surah Yusuf - Mishary" && s.name_source === "auto",
          `nom « ${s.name} »`,
        );
        check(
          s.size_bytes === bytes.length &&
            s.original_name.startsWith("Surah_Yusuf"),
          "taille / nom d'origine",
        );
        state.awaGlobal = s.id;
        return `nom « ${s.name} », ${s.size_bytes} octets, global, propriétaire ${s.owner.username}`;
      },
    );

    await scenario(
      P1,
      "N.6",
      {
        priority: "critique",
        technique: "partition-équivalence",
        surface: "API",
        title:
          "Import privé avec un nom choisi ; enregistrement micro horodaté",
        action:
          "Awa envoie `?visibility=private&name=Mon secret`, puis un fichier `2026-10-22T17-51-03-120.webm` avec `x-aqr-source-kind: microphone`.",
        expected:
          'Le privé garde `name: "Mon secret"`, `name_source: "user"`, `visibility: "private"`. L\'enregistrement micro est nommé « Enregistrement du … à hh:mm » (UTC ici).',
      },
      async () => {
        const priv = await awa.upload(
          "secret.wav",
          wav(3),
          "?visibility=private&name=" + encodeURIComponent("Mon secret"),
        );
        status(priv, 201, "import privé");
        check(
          priv.data.name === "Mon secret" &&
            priv.data.name_source === "user" &&
            priv.data.visibility === "private",
          JSON.stringify(priv.data.name),
        );
        const mic = await awa
          .upload(
            "2026-10-22T17-51-03-120.webm",
            Buffer.concat([Buffer.from("1a45dfa3", "hex"), Buffer.alloc(2000)]),
            "?visibility=private",
            { "x-aqr-source-kind": "microphone" },
          )
          .catch((e) => ({ status: 0, data: String(e) }));
        state.awaPrivate = priv.data.id;
        // Un faux WebM peut être refusé par la sonde : on contrôle alors l'autre moitié (nom micro) avec un WAV.
        const micName =
          mic.status === 201
            ? mic.data.name
            : (
                await awa.upload("rec.wav", wav(1), "?visibility=private", {
                  "x-aqr-source-kind": "microphone",
                })
              ).data.name;
        check(
          /^Enregistrement du \d{1,2} \S+ à \d\d:\d\d$/.test(micName),
          `nom micro « ${micName} »`,
        );
        return `privé « ${priv.data.name} » (name_source user) ; micro « ${micName} »`;
      },
    );

    await scenario(
      P1,
      "N.7",
      {
        priority: "critique",
        technique: "table-décision",
        surface: "API",
        title: "Le privé d'Awa est invisible aux autres, le global est partagé",
        action:
          "Cherif (administrateur) et Bou listent (`scope=all`, `scope=shared`) et cherchent « secret » ; Cherif ouvre la session privée d'Awa.",
        expected:
          "Le global d'Awa apparaît dans `all` et `shared` de Cherif et Bou ; le privé n'apparaît ni dans la liste, ni dans la recherche, ni dans les compteurs ; l'ouvrir donne `404 Session introuvable`.",
      },
      async () => {
        for (const [who, name] of [
          [cherif, "Cherif"],
          [bou, "Bou"],
        ]) {
          const all = await who.get("/api/sessions?scope=all&limit=100");
          const shared = await who.get("/api/sessions?scope=shared&limit=100");
          check(
            all.data.items.some((i) => i.id === state.awaGlobal) &&
              shared.data.items.some((i) => i.id === state.awaGlobal),
            `${name} ne voit pas le global`,
          );
          check(
            !all.data.items.some((i) => i.id === state.awaPrivate),
            `${name} voit le privé`,
          );
          const search = await who.get("/api/sessions?q=secret");
          check(
            search.data.total === 0,
            `${name} trouve le privé par recherche`,
          );
          const open = await who.get(`/api/sessions/${state.awaPrivate}`);
          check(
            open.status === 404 && open.data.error === "Session introuvable",
            `${name} ouvre le privé : ${open.status}`,
          );
          const mine = await who.get("/api/sessions?scope=mine");
          check(
            mine.data.items.every((i) => i.mine),
            `${name} : « mine » contient des sessions d'autrui`,
          );
        }
        const awaList = await awa.get("/api/sessions?scope=mine&limit=100");
        check(
          awaList.data.items.some((i) => i.id === state.awaPrivate),
          "Awa ne voit pas son propre privé",
        );
        return "global partagé (all + shared) pour Cherif et Bou ; privé : absent des listes, de la recherche et du total, 404 à l'ouverture ; Awa le voit dans « mine »";
      },
    );

    await scenario(
      P1,
      "N.8",
      {
        priority: "critique",
        technique: "transition-état",
        surface: "API",
        title:
          "Les préférences sont enregistrées côté serveur et survivent à la reconnexion",
        action:
          'Awa `PATCH /api/me/preferences { theme: "dark", visibleSpanSeconds: 30, leftPanelOpen: false, volume: 0.4 }`, se déconnecte, se reconnecte, relit.',
        expected:
          "Après reconnexion les 4 valeurs sont là, les autres clés ont leur défaut, `updated_at` ne porte que les 4 clés choisies ; l'ancien cookie, révoqué, donne `401` ; un autre compte garde les défauts.",
      },
      async () => {
        const patch = await awa.patch("/api/me/preferences", {
          theme: "dark",
          visibleSpanSeconds: 30,
          leftPanelOpen: false,
          volume: 0.4,
        });
        status(patch, 200, "PATCH");
        const oldCookie = awa.cookie;
        status(await awa.post("/api/auth/logout", {}), 204, "logout");
        const stale = await anon.get("/api/me", {
          headers: { cookie: `aqr_session=${oldCookie}` },
          anonymous: true,
        });
        check(stale.status === 401, `ancien cookie → ${stale.status}`);
        const login = await awa.post("/api/auth/login", {
          username: "awa",
          password: PASSWORD,
        }); // casse différente
        status(login, 200, "login");
        const prefs = await awa.get("/api/me/preferences");
        const p = prefs.data.preferences;
        check(
          p.theme === "dark" &&
            p.visibleSpanSeconds === 30 &&
            p.leftPanelOpen === false &&
            p.volume === 0.4,
          JSON.stringify(p),
        );
        check(
          p.followPlayback === true &&
            p.rightPanelOpen === null &&
            p.arabicFont === null,
          "défauts altérés",
        );
        check(
          Object.keys(prefs.data.updated_at).sort().join() ===
            "leftPanelOpen,theme,visibleSpanSeconds,volume",
          `updated_at : ${Object.keys(prefs.data.updated_at)}`,
        );
        const other = await bou.get("/api/me/preferences");
        check(
          other.data.preferences.theme === "system",
          "les préférences fuient vers un autre compte",
        );
        return "4 clés conservées après déconnexion/reconnexion (pseudonyme insensible à la casse), 4 horodatages, ancien jeton révoqué (401), Bou inchangé";
      },
    );

    await scenario(
      P1,
      "N.9",
      {
        priority: "critique",
        technique: "valeurs-limites",
        surface: "API",
        title:
          "Pagination par curseur : toutes les pages, sans doublon ni trou, dans chaque tri",
        action:
          "Awa importe 6 petits fichiers (durées 1 à 6 s) puis parcourt `GET /api/sessions?scope=all&limit=3&sort=…` page par page (`recent`, `oldest`, `name`, `duration`, `size`).",
        expected:
          "Pour chaque tri la concaténation des pages égale la liste complète (`limit=100`), sans doublon ; `next_cursor` vaut `null` à la dernière page ; `total` constant ; `limit=3` ne renvoie jamais plus de 3 éléments.",
      },
      async () => {
        for (let i = 1; i <= 6; i++)
          status(
            await awa.upload(`essai_${i}.wav`, wav(i)),
            201,
            `import ${i}`,
          );
        const lines = [];
        for (const sort of ["recent", "oldest", "name", "duration", "size"]) {
          const full = (
            await awa.get(`/api/sessions?scope=all&limit=100&sort=${sort}`)
          ).data;
          const seen = [];
          let cursor = null;
          let pages = 0;
          do {
            const page = (
              await awa.get(
                `/api/sessions?scope=all&limit=3&sort=${sort}${cursor ? `&cursor=${cursor}` : ""}`,
              )
            ).data;
            check(
              page.items.length <= 3 && page.total === full.total,
              `${sort} page ${pages} : ${page.items.length} / total ${page.total}`,
            );
            seen.push(...page.items.map((i) => i.id));
            cursor = page.next_cursor;
            pages += 1;
          } while (cursor && pages < 20);
          check(new Set(seen).size === seen.length, `${sort} : doublons`);
          check(
            seen.join() === full.items.map((i) => i.id).join(),
            `${sort} : ordre différent de la liste complète`,
          );
          lines.push(`${sort} ${pages} pages/${seen.length}`);
        }
        const last = await awa.get("/api/sessions?limit=1000");
        check(last.status === 400, `limit=1000 → ${last.status}`);
        return `${lines.join(" · ")} ; limit=1000 → 400`;
      },
    );

    await scenario(
      P1,
      "N.10",
      {
        priority: "normal",
        technique: "nominal",
        surface: "API",
        title: "Renommer, favori, archiver, retrouver",
        action:
          "Awa renomme le global (`PATCH name`), le met en favori (`PUT …/favorite`), l'archive, cherche par nom ; `name: null` rétablit le nom par défaut.",
        expected:
          "Nom `user` retrouvé par `q` ; `scope=favorites` le liste ; archivé il sort de `all` et entre dans `scope=archived` ; `counts.scopes` suit ; `name: null` → nom dérivé du fichier, `name_source: \"auto\"`. Le favori d'Awa n'est pas celui de Bou.",
      },
      async () => {
        const id = state.awaGlobal;
        const renamed = await awa.patch(`/api/sessions/${id}`, {
          name: "  Ma  récitation   préférée ",
        });
        status(renamed, 200, "renommer");
        check(
          renamed.data.session.name === "Ma récitation préférée" &&
            renamed.data.session.name_source === "user",
          renamed.data.session.name,
        );
        check(
          (await awa.get("/api/sessions?q=recitation preferee")).data.total ===
            1,
          "recherche sans accents",
        );
        status(
          await awa.put(`/api/sessions/${id}/favorite`, {}),
          200,
          "favori",
        );
        const fav = (await awa.get("/api/sessions?scope=favorites")).data;
        check(
          fav.items.length === 1 &&
            fav.items[0].favorite === true &&
            fav.counts.scopes.favorites === 1,
          "favoris",
        );
        check(
          (await bou.get("/api/sessions?scope=favorites")).data.items.length ===
            0,
          "favori d'Awa visible de Bou",
        );
        status(
          await awa.patch(`/api/sessions/${id}`, { archived: true }),
          200,
          "archiver",
        );
        check(
          !(await awa.get("/api/sessions?scope=all&limit=100")).data.items.some(
            (i) => i.id === id,
          ),
          "archivé encore dans all",
        );
        const arch = (await awa.get("/api/sessions?scope=archived")).data;
        check(
          arch.items.some((i) => i.id === id) &&
            arch.counts.scopes.archived >= 1,
          "pas dans archived",
        );
        status(
          await awa.patch(`/api/sessions/${id}`, { archived: false }),
          200,
          "désarchiver",
        );
        const reset = await awa.patch(`/api/sessions/${id}`, { name: null });
        check(
          reset.data.session.name === "Surah Yusuf - Mishary" &&
            reset.data.session.name_source === "auto",
          `reset « ${reset.data.session.name} »`,
        );
        status(
          await awa.del(`/api/sessions/${id}/favorite`),
          200,
          "retirer favori",
        );
        return "renommé « Ma récitation préférée », trouvé sans accents, favori propre à Awa, archivé puis désarchivé, nom par défaut rétabli";
      },
    );

    await scenario(
      P1,
      "N.11",
      {
        priority: "normal",
        technique: "transition-état",
        surface: "API",
        title: "« Non lu » : propre à l'utilisateur ; ouvrir est idempotent",
        action:
          "Cherif liste `state=unread`, appelle `POST …/viewed` sur une session d'avant les comptes puis sur une session prête ; Awa importe un résultat joint (JSON `aqr.recognition/1` du même audio).",
        expected:
          "`unread` faux pour les sessions sans propriétaire ; `viewed` sur une session non terminée ne change rien (`viewed_at: null`) ; un résultat joint à l'import n'est pas « non lu » ; `counts.states.unread` = 0.",
      },
      async () => {
        const list = (await cherif.get("/api/sessions?state=unread")).data;
        check(
          list.total === 0 && list.counts.states.unread === 0,
          "non lus inattendus",
        );
        const ready = await awa.post(
          `/api/sessions/${state.awaGlobal}/viewed`,
          {},
        );
        status(ready, 200, "viewed (prête)");
        check(
          ready.data.viewed_at === null &&
            ready.data.unread === false &&
            ready.data.state === "ready",
          JSON.stringify(ready.data),
        );
        const legacy = await cherif.post(
          `/api/sessions/${state.legacy[0]}/viewed`,
          {},
        );
        status(legacy, 200, "viewed (ancienne)");
        const again = await cherif.post(
          `/api/sessions/${state.legacy[0]}/viewed`,
          {},
        );
        check(
          again.data.viewed_at === legacy.data.viewed_at,
          "viewed_at non idempotent",
        );
        const pred = await readFile(
          path.join(
            A.reviewDir,
            "sessions",
            IDS[0],
            "prediction.recognition.json",
          ),
        );
        const audio = await readFile(
          path.join(
            A.reviewDir,
            "sessions",
            IDS[0],
            `source${(await readdir(path.join(A.reviewDir, "sessions", IDS[0]))).find((f) => f.startsWith("source.") && !f.includes("recognition")).slice(6)}`,
          ),
        );
        const form = new FormData();
        form.append("audio", new Blob([audio]), "importe.webm");
        form.append("result", new Blob([pred]), "result.json");
        const imported = await awa.call("POST", "/api/sessions", {
          body: form,
        });
        status(imported, 201, "import avec résultat");
        check(
          imported.data.state === "done" &&
            imported.data.unread === false &&
            typeof imported.data.viewed_at === "string",
          `résultat joint : unread=${imported.data.unread}`,
        );
        check(
          typeof imported.data.content_label === "string",
          "étiquette de contenu absente après import avec résultat",
        );
        state.imported = imported.data.id;
        return `viewed sur « prête » sans effet ; idempotent (${legacy.data.viewed_at}) ; résultat joint importé « ${imported.data.content_label} » : déjà vu`;
      },
    );

    await scenario(
      P1,
      "N.12",
      {
        priority: "normal",
        technique: "nominal",
        surface: "API",
        title: "Supprimer sa session ; statistiques personnelles et globales",
        action:
          "Awa supprime l'import avec résultat puis lit `GET /api/me/stats` ; Bou lit `GET /api/stats` et `GET /api/me/stats`.",
        expected:
          "`204` puis `404` ; l'espace d'Awa baisse ; `/api/stats` de Bou ne compte pas le privé d'Awa et porte `disk` et `totals` ; `tests: 0` (aucune analyse lancée par l'atelier) ; la liste de Bou ne contient plus la session.",
      },
      async () => {
        const before = (await awa.get("/api/me/stats")).data;
        status(
          await awa.del(`/api/sessions/${state.imported}?force=1`),
          204,
          "suppression",
        );
        status(
          await awa.get(`/api/sessions/${state.imported}`),
          404,
          "après suppression",
        );
        const after = (await awa.get("/api/me/stats")).data;
        check(
          after.storage.used_bytes < before.storage.used_bytes &&
            after.tests === 0,
          `stockage ${before.storage.used_bytes} → ${after.storage.used_bytes}`,
        );
        const stats = (await bou.get("/api/stats")).data;
        const bouTotal = (await bou.get("/api/sessions?scope=all&limit=100"))
          .data.total;
        check(
          stats.totals.sessions === bouTotal,
          `totaux ${stats.totals.sessions} ≠ ${bouTotal}`,
        );
        check(
          typeof stats.disk.used_bytes === "number" &&
            stats.disk.used_bytes > 0 &&
            Array.isArray(stats.engines),
          "disk / engines",
        );
        return `espace d'Awa ${before.storage.used_bytes} → ${after.storage.used_bytes} octets ; /api/stats de Bou : ${stats.totals.sessions} sessions visibles, disque ${stats.disk.used_bytes} octets, libre ${stats.disk.free_bytes ?? "inconnu"}`;
      },
    );

    await scenario(
      P1,
      "N.13",
      {
        priority: "normal",
        technique: "nominal",
        surface: "API",
        title: "Documentation servie aux testeurs connectés",
        action:
          "`GET /api/docs` puis `GET /api/docs/<slug>` du premier document de `docs/docs-index.json`.",
        expected:
          "Index sans chemin de fichier (`file` absent) ; contenu en `text/markdown` ; `401` sans connexion.",
      },
      async () => {
        status(await anon.get("/api/docs"), 401, "docs anonyme");
        const index = await bou.get("/api/docs");
        status(index, 200, "index");
        check(
          index.data.docs.length >= 1 &&
            index.data.docs.every((d) => !("file" in d) && d.slug && d.title),
          `index ${JSON.stringify(index.data).slice(0, 200)}`,
        );
        const first = index.data.docs[0];
        const doc = await bou.get(`/api/docs/${first.slug}`);
        status(doc, 200, "document");
        check(
          /text\/markdown/.test(doc.headers.get("content-type")) &&
            doc.text.length > 100,
          "type / contenu",
        );
        return `${index.data.docs.length} document(s) listé(s) sans chemin ; /${first.slug} en text/markdown (${doc.text.length} caractères)`;
      },
    );

    if (WITH_ENGINE)
      await scenario(
        P1,
        "N.14",
        {
          priority: "critique",
          technique: "transition-état",
          surface: "API",
          title:
            "Vraie analyse (moteur réel) : étiquette de contenu, « non lu » du seul propriétaire, journal des tests",
          action:
            "Awa envoie en flux l'audio d'une session de référence avec `?autorun=1` (global, enregistrement micro), attend la fin de la cascade réelle, puis Bou et Awa ouvrent le résultat.",
          expected:
            "`state: done` ; `content_label` calculé (« Ar-Rahman 55:1–4 ») ; `unread: true` pour Awa seule (Bou : `false`, et son ouverture ne change rien pour Awa) ; `POST …/viewed` d'Awa l'efface ; `GET /api/me/stats` : `tests: 1`, RTF et moteur renseignés ; `GET /api/stats` compte l'analyse ; journal du serveur sans erreur.",
        },
        async () => {
          const dir = path.join(A.reviewDir, "sessions", IDS[0]);
          const file = (await readdir(dir)).find(
            (f) => f.startsWith("source.") && !f.includes("recognition"),
          );
          const audio = await readFile(path.join(dir, file));
          const up = await awa.upload(
            "micro essai.webm",
            audio,
            "?autorun=1&visibility=global",
            { "x-aqr-source-kind": "microphone" },
          );
          status(up, 201, "import avec analyse");
          check(
            ["running", "queued"].includes(up.data.state),
            `état après import : ${up.data.state} ${up.data.autorun_error ?? ""}`,
          );
          const id = up.data.id;
          const t0 = Date.now();
          let seen;
          while (Date.now() - t0 < 330_000) {
            seen = (await awa.get(`/api/sessions/${id}`)).data.session;
            if (["done", "failed", "cancelled"].includes(seen.state)) break;
            await new Promise((r) => setTimeout(r, 4000));
          }
          const seconds = Math.round((Date.now() - t0) / 1000);
          check(
            seen.state === "done",
            `fin d'analyse : ${seen.state} ${seen.error ?? ""} après ${seconds} s`,
          );
          // La requête qui constate la fin peut elle-même l'adopter : on contrôle ce qu'elle répond ET ce qui suit.
          check(
            seen.unread === true && seen.content_label === "Ar-Rahman 55:1–4",
            `à la fin : unread=${seen.unread} label=${seen.content_label}`,
          );
          const again = (await awa.get(`/api/sessions/${id}`)).data.session;
          check(
            again.unread === true &&
              again.engine &&
              again.duration_s > 0 &&
              again.audio_duration_s > 0,
            `relecture : ${JSON.stringify({ u: again.unread, e: again.engine, d: again.duration_s })}`,
          );
          const bouSees = (await bou.get(`/api/sessions/${id}`)).data.session;
          check(
            bouSees.unread === false && bouSees.visibility === "global",
            "Bou voit un point « non lu »",
          );
          check(
            (await awa.get("/api/sessions?state=unread")).data.total === 1 &&
              (await bou.get("/api/sessions?state=unread")).data.total === 0,
            "liste non lue",
          );
          await bou.post(`/api/sessions/${id}/viewed`, {});
          check(
            (await awa.get(`/api/sessions/${id}`)).data.session.unread === true,
            "l'ouverture de Bou a effacé le point d'Awa",
          );
          const opened = await awa.post(`/api/sessions/${id}/viewed`, {});
          check(
            opened.data.unread === false &&
              typeof opened.data.viewed_at === "string",
            "l'ouverture d'Awa n'efface pas son point",
          );
          const mine = (await awa.get("/api/me/stats")).data;
          check(
            mine.tests === 1 &&
              mine.rtf_mean > 0 &&
              mine.by_engine[0]?.engine === again.engine,
            JSON.stringify(mine),
          );
          const machine = (await bou.get("/api/stats")).data;
          check(
            machine.engines.some((e) => e.analyses >= 1),
            "GET /api/stats ne compte pas l'analyse",
          );
          return `fin en ${seconds} s (moteur ${again.engine}, ${again.audio_duration_s} s d'audio en ${again.duration_s} s) ; « ${seen.content_label} » ; non lu pour Awa seule, effacé par SON ouverture ; /api/me/stats : tests ${mine.tests}, RTF moyen ${mine.rtf_mean.toFixed(2)}`;
        },
      );

    // ════════════════════════════ Playbook 2 : partage et préférences ═════════════════════════
    const P2 = "phase2-partage-et-preferences";
    await scenario(
      P2,
      "S.1",
      {
        priority: "critique",
        technique: "table-décision",
        surface: "API",
        title:
          "Un audio privé répond 404 sur TOUTES les routes, pour tout autre compte (administrateur compris)",
        action:
          "Bou et Cherif (administrateur) appellent les 16 routes de session (lecture, audio, forme d'onde, export, ZIP, revue, lancer, annuler, lu, favori, vérité terrain, renommer, supprimer) sur le privé d'Awa ; puis ajoutent son id à une action groupée.",
        expected:
          "Chaque appel : `404`, message « Session introuvable », jamais `403` ; l'action groupée répond `not_found` ; la session reste intacte (nom inchangé, présente).",
      },
      async () => {
        const lines = [];
        for (const [who, name] of [
          [bou, "Bou"],
          [cherif, "Cherif"],
        ]) {
          let n = 0;
          for (const [method, url, json] of ROUTES_OF_A_SESSION(
            state.awaPrivate,
          )) {
            const res = await who.call(method, url, { json });
            check(
              res.status === 404,
              `${name} ${method} ${url} → ${res.status}`,
            );
            n += 1;
          }
          const bulk = await who.post("/api/sessions/bulk", {
            ids: [state.awaPrivate],
            action: "archive",
          });
          check(
            bulk.data.results[0].status === "not_found" &&
              bulk.data.applied === 0,
            `bulk ${JSON.stringify(bulk.data)}`,
          );
          lines.push(`${name} : ${n} routes + bulk → 404`);
        }
        const intact = await awa.get(`/api/sessions/${state.awaPrivate}`);
        check(
          intact.status === 200 &&
            intact.data.session.name === "Mon secret" &&
            intact.data.session.archived_at === null,
          "le privé a été modifié",
        );
        return `${lines.join(" ; ")} ; session intacte pour Awa`;
      },
    );

    await scenario(
      P2,
      "S.2",
      {
        priority: "critique",
        technique: "table-décision",
        surface: "API",
        title:
          "Global : lisible par tous, modifiable par son propriétaire ou un administrateur seulement",
        action:
          "Bou (testeur) tente de renommer, changer la portée, archiver, supprimer, lancer et annuler le global d'Awa ; puis le lit, l'écoute, le met en favori. Cherif (administrateur) le renomme.",
        expected:
          "Bou : `403` pour renommer/portée/archiver/supprimer/lancer/annuler ; `200` pour lire, forme d'onde (200 ou 503 selon ffmpeg), export, favori. Cherif : `200` sur le renommage ; Awa le voit renommé.",
      },
      async () => {
        const id = state.awaGlobal;
        const denied = [];
        for (const [method, url, json] of [
          ["PATCH", `/api/sessions/${id}`, { name: "piraté" }],
          ["PATCH", `/api/sessions/${id}`, { visibility: "private" }],
          ["PATCH", `/api/sessions/${id}`, { archived: true }],
          ["DELETE", `/api/sessions/${id}`],
          ["POST", `/api/sessions/${id}/run`, {}],
          ["DELETE", `/api/sessions/${id}/run`],
        ]) {
          const res = await bou.call(method, url, { json });
          check(
            res.status === 403 && res.data.code === "forbidden",
            `Bou ${method} ${url} → ${res.status}`,
          );
          denied.push(`${method} ${url.split(`/${id}`)[1] || "/"} 403`);
        }
        for (const url of [
          `/api/sessions/${id}`,
          `/api/sessions/${id}/export`,
          `/api/sessions/${id}/review`,
        ])
          status(await bou.get(url), 200, `Bou lit ${url}`);
        const peaks = await bou.get(`/api/sessions/${id}/peaks`);
        check([200, 503].includes(peaks.status), `peaks → ${peaks.status}`);
        status(
          await bou.put(`/api/sessions/${id}/favorite`, {}),
          200,
          "favori de Bou",
        );
        const admin = await cherif.patch(`/api/sessions/${id}`, {
          name: "Renommé par l'administrateur",
        });
        status(admin, 200, "administrateur");
        check(
          (await awa.get(`/api/sessions/${id}`)).data.session.name ===
            "Renommé par l'administrateur",
          "Awa ne voit pas le renommage",
        );
        await awa.patch(`/api/sessions/${id}`, { name: null });
        return `Bou : ${denied.length} refus 403 (${denied.slice(0, 3).join(", ")}…) ; lecture/export/revue 200, peaks ${peaks.status}, favori 200 ; administrateur renomme (200)`;
      },
    );

    await scenario(
      P2,
      "S.3",
      {
        priority: "critique",
        technique: "erreur",
        surface: "API",
        title:
          "Signalements : l'auteur est le compte, non falsifiable ; on ne touche pas au signalement d'un autre",
        action:
          'Sur une session d\'avant les comptes, Bou crée un signalement en envoyant `tester: "Usurpateur"` ; Awa tente de le modifier puis de le supprimer ; Cherif (administrateur) le modifie.',
        expected:
          'Le signalement de Bou porte `tester: "Bou"` ; la tentative d\'Awa renvoie son `id` dans `rejected` et n\'a aucun effet ; Cherif le modifie : `tester` reste « Bou », `updated_by: "Cherif"`.',
      },
      async () => {
        const sid = state.legacy[0];
        const session = (await bou.get(`/api/sessions/${sid}`)).data.session;
        const ann = (id, start, who) => ({
          id,
          mode: "point",
          start_s: start,
          end_s: null,
          tags: ["wrong_verse"],
          type: "other",
          description: "",
          expected_ref: null,
          target_index: null,
          status: "draft",
          tester: who,
          updated_by: "Cherif",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        const base = {
          schema: "aqr.review/2",
          session_id: sid,
          audio_sha256: session.audio_sha256,
          prediction_sha256: session.prediction_sha256,
          deleted_ids: [],
        };
        const annId = crypto.randomUUID();
        const created = await bou.put(`/api/sessions/${sid}/review`, {
          ...base,
          annotations: [ann(annId, 1, "Usurpateur")],
          updated_at: new Date().toISOString(),
        });
        status(created, 200, "création");
        const mine = created.data.review.annotations.find(
          (a) => a.id === annId,
        );
        check(
          mine.tester === "Bou" && mine.updated_by === undefined,
          `auteur « ${mine.tester} », updated_by ${mine.updated_by}`,
        );
        const hijack = await awa.put(`/api/sessions/${sid}/review`, {
          ...base,
          annotations: [
            {
              ...ann(annId, 2, "Awa"),
              description: "piraté",
              updated_at: new Date(Date.now() + 1000).toISOString(),
            },
          ],
          deleted_ids: [annId],
          updated_at: new Date().toISOString(),
        });
        status(hijack, 200, "tentative d'Awa");
        check(
          hijack.data.rejected.includes(annId),
          `rejected ${JSON.stringify(hijack.data.rejected)}`,
        );
        const after = hijack.data.review.annotations.find(
          (a) => a.id === annId,
        );
        check(
          after && after.description === "" && after.start_s === 1,
          "le signalement de Bou a été altéré ou supprimé",
        );
        const admin = await cherif.put(`/api/sessions/${sid}/review`, {
          ...base,
          annotations: [
            {
              ...ann(annId, 1, "xx"),
              description: "relu",
              updated_at: new Date(Date.now() + 2000).toISOString(),
            },
          ],
          updated_at: new Date().toISOString(),
        });
        const relu = admin.data.review.annotations.find((a) => a.id === annId);
        check(
          relu.tester === "Bou" &&
            relu.updated_by === "Cherif" &&
            relu.description === "relu",
          JSON.stringify(relu),
        );
        return `auteur forcé à « Bou » malgré « Usurpateur » ; Awa : rejected [${annId.slice(0, 8)}…], signalement intact ; administrateur : tester Bou, updated_by Cherif`;
      },
    );

    await scenario(
      P2,
      "S.4",
      {
        priority: "critique",
        technique: "table-décision",
        surface: "API",
        title:
          "Vérité terrain réservée aux administrateurs (remplace ?relecteur=1)",
        action:
          "Awa (propriétaire de l'une de ses sessions globales), Bou puis Cherif appellent `GET` et `POST …/validation`, avec et sans `?relecteur=1`.",
        expected:
          "Testeurs : `403` « réservée aux administrateurs » (même propriétaire, même avec `?relecteur=1`) ; administrateur : `GET 200`.",
      },
      async () => {
        for (const [who, name] of [
          [awa, "Awa"],
          [bou, "Bou"],
        ]) {
          for (const url of [
            `/api/sessions/${state.awaGlobal}/validation`,
            `/api/sessions/${state.awaGlobal}/validation?relecteur=1`,
          ]) {
            const get = await who.get(url);
            check(
              get.status === 403 && /administrateurs/.test(get.data.error),
              `${name} GET ${url} → ${get.status}`,
            );
          }
          for (const action of [
            { action: "propose" },
            { action: "manifest", reviewed_by: "rel-01" },
          ]) {
            const post = await who.post(
              `/api/sessions/${state.awaGlobal}/validation`,
              action,
            );
            check(
              post.status === 403,
              `${name} POST ${action.action} → ${post.status}`,
            );
          }
        }
        const ok = await cherif.get(
          `/api/sessions/${state.legacy[0]}/validation`,
        );
        status(ok, 200, "administrateur");
        return "Awa et Bou : GET/POST (propose, manifest) → 403 « réservée aux administrateurs », avec ou sans ?relecteur=1 ; Cherif : GET 200";
      },
    );

    await scenario(
      P2,
      "S.5",
      {
        priority: "critique",
        technique: "erreur",
        surface: "API",
        title:
          "Préférences : schéma strict, rien d'écrit en cas de refus, fusion partielle",
        action:
          "Bou envoie une clé inconnue, un thème invalide, une taille arabe hors pas, un volume > 1, un corps illisible, puis une mise à jour valide partielle, `null` pour une clé automatique, et `DELETE ?key=`.",
        expected:
          "Chaque corps invalide : `400` et AUCUNE clé écrite (même les valides du même corps) ; le valide fusionne sans toucher aux autres clés ; `DELETE ?key=theme` ne remet que `theme` ; `DELETE ?key=inconnue` → `400`.",
      },
      async () => {
        const bad = [
          { nope: 1 },
          { theme: "fluo" },
          { arabicSize: 30 },
          { volume: 1.5 },
          { theme: "dark", __extra: true },
          { sessionsFilter: { scope: "tout" } },
          { playbackRate: 99 },
          { visibleSpanSeconds: 45 },
        ];
        for (const body of bad) {
          const res = await bou.patch("/api/me/preferences", body);
          check(res.status === 400, `${JSON.stringify(body)} → ${res.status}`);
        }
        const garbage = await bou.call("PATCH", "/api/me/preferences", {
          body: "{pas du json",
          headers: { "content-type": "application/json" },
        });
        check(garbage.status === 400, `corps illisible → ${garbage.status}`);
        const untouched = (await bou.get("/api/me/preferences")).data;
        check(
          Object.keys(untouched.updated_at).length === 0,
          `des clés ont été écrites malgré les refus : ${Object.keys(untouched.updated_at)}`,
        );
        const ok = await bou.put("/api/me/preferences", {
          theme: "light",
          arabicSize: 48,
          arabicFont: "amiri-quran",
        });
        status(ok, 200, "PUT valide");
        const merged = await bou.patch("/api/me/preferences", {
          arabicSize: null,
          translation: false,
        });
        check(
          merged.data.preferences.theme === "light" &&
            merged.data.preferences.arabicSize === null &&
            merged.data.preferences.arabicFont === "amiri-quran" &&
            merged.data.preferences.translation === false,
          JSON.stringify(merged.data.preferences),
        );
        const one = await bou.del("/api/me/preferences?key=theme");
        check(
          one.data.preferences.theme === "system" &&
            one.data.preferences.translation === false,
          "reset d'une clé",
        );
        status(
          await bou.del("/api/me/preferences?key=inconnue"),
          400,
          "reset clé inconnue",
        );
        return `${bad.length} corps invalides + 1 illisible → 400 sans écriture ; fusion partielle correcte ; DELETE ?key remet une seule clé`;
      },
    );

    await scenario(
      P2,
      "S.6",
      {
        priority: "critique",
        technique: "erreur",
        surface: "API",
        title:
          "Authentification : refus propres, messages génériques, verrouillage progressif",
        action:
          "Inscriptions invalides (mot de passe court, e-mail comme pseudonyme, doublon de casse) ; connexions erronées (mauvais mot de passe, pseudonyme inconnu) ; 5 échecs de suite sur un compte jetable puis le bon mot de passe ; jeton forgé ; Origin étrangère.",
        expected:
          "`400` avec `field` ; `409` sur le doublon ; mauvais mot de passe et pseudonyme inconnu ont EXACTEMENT le même `401` ; après 5 échecs `429` avec `Retry-After`, même avec le bon mot de passe ; un jeton aléatoire ou une injection dans le cookie → `401` ; un `Origin` étranger sur une mutation → `403`.",
      },
      async () => {
        const weak = await anon.post(
          "/api/auth/register",
          { username: "Zed", password: "court" },
          { anonymous: true },
        );
        check(
          weak.status === 400 && weak.data.field === "password",
          `mdp court → ${weak.status}`,
        );
        const mail = await anon.post(
          "/api/auth/register",
          { username: "zed@exemple.fr", password: PASSWORD },
          { anonymous: true },
        );
        check(
          mail.status === 400 && mail.data.field === "username",
          `e-mail → ${mail.status}`,
        );
        const dup = await anon.post(
          "/api/auth/register",
          { username: "CHERIF", password: PASSWORD },
          { anonymous: true },
        );
        check(dup.status === 409, `doublon → ${dup.status}`);
        const wrong = await anon.post(
          "/api/auth/login",
          { username: "Cherif", password: "faux faux faux faux" },
          { anonymous: true },
        );
        const unknown = await anon.post(
          "/api/auth/login",
          { username: "Fantome", password: "faux faux faux faux" },
          { anonymous: true },
        );
        check(
          wrong.status === 401 &&
            unknown.status === 401 &&
            JSON.stringify(wrong.data) === JSON.stringify(unknown.data),
          "messages différents (énumération possible)",
        );
        const jetable = new Client(A.base);
        status(
          await jetable.post("/api/auth/register", {
            username: "Jetable",
            password: PASSWORD,
          }),
          201,
          "compte jetable",
        );
        await jetable.post("/api/auth/logout", {});
        let last;
        for (let i = 0; i < 5; i++)
          last = await anon.post(
            "/api/auth/login",
            { username: "Jetable", password: "faux faux faux faux" },
            { anonymous: true },
          );
        const locked = await anon.post(
          "/api/auth/login",
          { username: "Jetable", password: PASSWORD },
          { anonymous: true },
        );
        check(
          locked.status === 429 &&
            Number(locked.headers.get("retry-after")) > 0 &&
            /Trop d'essais/.test(locked.data.error),
          `verrouillage → ${locked.status} ${locked.headers.get("retry-after")}`,
        );
        const forged = new Client(A.base);
        forged.cookie = "A".repeat(43);
        status(await forged.get("/api/me"), 401, "jeton forgé");
        forged.cookie = "'; DROP TABLE users;--";
        status(await forged.get("/api/me"), 401, "injection");
        const csrf = await anon.call("POST", "/api/auth/login", {
          json: { username: "Cherif", password: PASSWORD },
          headers: { origin: "http://evil.example" },
          anonymous: true,
        });
        check(csrf.status === 403, `Origin étranger → ${csrf.status}`);
        return `court 400, e-mail 400, doublon de casse 409 ; mêmes 401 (inconnu = faux mdp) ; 5 échecs → 429 Retry-After ${locked.headers.get("retry-after")} s même avec le bon mot de passe ; jeton forgé/injection 401 ; Origin étrangère 403`;
      },
    );

    await scenario(
      P2,
      "S.7",
      {
        priority: "critique",
        technique: "table-décision",
        surface: "API",
        title:
          "Administration : promouvoir, désactiver, jamais le dernier administrateur",
        action:
          "Cherif liste les comptes, promeut Bou, désactive Awa (qui a une connexion ouverte), tente de retirer successivement le rôle de Cherif puis de Bou.",
        expected:
          "Liste avec usage ; la connexion d'Awa meurt (`401`) et elle ne peut plus se connecter ; rétrograder le dernier administrateur actif → `409 last_admin` ; un utilisateur ordinaire ne peut rien (`403`).",
      },
      async () => {
        const list = await cherif.get("/api/admin/users");
        status(list, 200, "liste");
        check(
          list.data.users.length >= 3 &&
            list.data.users.every((u) => typeof u.sessions === "number"),
          "liste incomplète",
        );
        const promoted = await cherif.patch(`/api/admin/users/${state.bouId}`, {
          role: "admin",
        });
        check(promoted.data.user.role === "admin", "promotion");
        const disabled = await cherif.patch(`/api/admin/users/${state.awaId}`, {
          disabled: true,
        });
        check(disabled.data.disabled === true, "désactivation");
        status(
          await awa.get("/api/me"),
          401,
          "connexion d'Awa après désactivation",
        );
        const relogin = await anon.post(
          "/api/auth/login",
          { username: "Awa", password: PASSWORD },
          { anonymous: true },
        );
        check(relogin.status === 401, `reconnexion d'Awa → ${relogin.status}`);
        status(
          await cherif.patch(`/api/admin/users/${state.cherifId}`, {
            role: "user",
          }),
          200,
          "Cherif cède (Bou est admin)",
        );
        const last = await bou.patch(`/api/admin/users/${state.bouId}`, {
          role: "user",
        });
        check(
          last.status === 409 && last.data.code === "last_admin",
          `dernier administrateur → ${last.status}`,
        );
        const refused = await cherif.get("/api/admin/users");
        status(refused, 403, "Cherif n'est plus administrateur");
        status(
          await cherif.patch(`/api/admin/users/${state.bouId}`, {
            disabled: true,
          }),
          403,
          "sans droit",
        );
        await bou.patch(`/api/admin/users/${state.cherifId}`, {
          role: "admin",
        });
        await bou.patch(`/api/admin/users/${state.awaId}`, { disabled: false });
        return "liste avec usage ; Bou promu ; Awa désactivée (jeton mort, reconnexion 401) puis réactivée ; dernier administrateur protégé (409 last_admin) ; ex-administrateur : 403";
      },
    );

    await scenario(
      P2,
      "S.8",
      {
        priority: "normal",
        technique: "erreur",
        surface: "API",
        title: "Entrées de liste et d'import hostiles",
        action:
          "Paramètres invalides (`scope`, `sort`, `state`, `engine`, `from`), curseur forgé, injection SQL dans `q`, import avec `visibility=secret`, nom de 200 caractères, extension interdite, import sans connexion.",
        expected:
          "`400` avec un message lisible pour chaque paramètre invalide ; `q` piégé : `200`, aucune ligne, la liste reste intacte ; import invalide : `400`, rien d'écrit ; import anonyme `401`.",
      },
      async () => {
        for (const qs of [
          "scope=tout",
          "sort=x",
          "state=perdu",
          "engine=gpt",
          "from=hier",
          "limit=0",
          "cursor=zzz",
          "cursor=" +
            Buffer.from('{"sort":"name","value":"a","id":"b"}').toString(
              "base64url",
            ),
        ])
          status(await bou.get(`/api/sessions?${qs}`), 400, qs);
        const before = (await bou.get("/api/sessions?limit=100")).data.total;
        for (const q of [
          "' OR 1=1 --",
          "a'); DROP TABLE session_meta;--",
          "%",
          "_",
        ]) {
          const res = await bou.get(`/api/sessions?q=${encodeURIComponent(q)}`);
          // « % » et « _ » sont des caractères ordinaires (pas des jokers SQL) : ils ne trouvent que
          // les noms qui les contiennent, jamais toute la liste.
          const literal = q === "_" || q === "%";
          check(
            res.status === 200 &&
              (literal ? res.data.total < before : res.data.total === 0),
            `q=${q} → ${res.status}/${res.data.total} sur ${before}`,
          );
        }
        check(
          (await bou.get("/api/sessions?limit=100")).data.total === before,
          "la liste a changé",
        );
        const count = async () =>
          (await readdir(path.join(A.reviewDir, "sessions"))).length;
        const dirs = await count();
        status(
          await bou.upload("a.wav", wav(1), "?visibility=secret"),
          400,
          "visibilité invalide",
        );
        status(
          await bou.upload("a.wav", wav(1), "?name=" + "x".repeat(200)),
          400,
          "nom trop long",
        );
        status(await bou.upload("a.txt", Buffer.from("x")), 400, "extension");
        status(await anon.upload("a.wav", wav(1)), 401, "import anonyme");
        check((await count()) === dirs, "un import refusé a laissé un dossier");
        return "8 paramètres invalides → 400 ; q piégé → 200 sans résultat, liste intacte ; imports invalides → 400/401, aucun dossier laissé";
      },
    );

    await scenario(
      P2,
      "S.9",
      {
        priority: "normal",
        technique: "erreur",
        surface: "API",
        title: "Documentation : liste blanche stricte",
        action:
          "`GET /api/docs/<slug>` avec des slugs hors index, des traversées (`..`, `%2e%2e`, `%2f`), un chemin de fichier réel (`AGENTS`, `AGENTS.md`).",
        expected:
          "`404` pour tout ce qui n'est pas dans `docs/docs-index.json` (ou la redirection `308` que Next applique lui-même à un segment `..` avant d'atteindre la route) ; jamais le contenu d'un fichier non listé.",
      },
      async () => {
        const tried = [
          "inconnu",
          "..",
          "%2e%2e",
          "..%2f..%2fAGENTS",
          "AGENTS",
          "AGENTS.md",
          "architecture.md",
          "ARCHITECTURE",
          "a".repeat(100),
          "web%2fREADME",
        ];
        for (const slug of tried) {
          const res = await bou.get(`/api/docs/${slug}`);
          // 404, ou 308 quand Next normalise lui-même un segment « .. » : jamais 200 ni un contenu.
          check(
            [404, 308].includes(res.status) && !/Invariants/.test(res.text),
            `${slug} → ${res.status}`,
          );
        }
        return `${tried.length} slugs hostiles → 404 (ou 308 de normalisation de Next pour « .. »), aucun contenu`;
      },
    );

    // ════════════════════════════ Serveur B : code d'invitation, quota, débit ═════════════════
    const cb = new Client(B.base);
    const cb2 = new Client(B.base);
    await scenario(
      P2,
      "S.10",
      {
        priority: "critique",
        technique: "table-décision",
        surface: "API",
        title:
          "Inscription sur code d'invitation, et limite d'inscriptions par heure",
        action:
          "Serveur B (`AQR_SIGNUP=code`, 4 inscriptions/heure) : inscription sans code, avec un mauvais code, avec le bon, puis une 5ᵉ tentative.",
        expected:
          "`403` (champ `code`) sans code ou avec un mauvais ; `201` avec le bon (le premier compte est administrateur même en mode code) ; au-delà de 4 tentatives dans l'heure, `429` avec `Retry-After`.",
      },
      async () => {
        const none = await cb.post("/api/auth/register", {
          username: "Premier",
          password: PASSWORD,
        });
        const wrong = await cb.post("/api/auth/register", {
          username: "Premier",
          password: PASSWORD,
          code: "faux",
        });
        check(
          none.status === 403 &&
            none.data.field === "code" &&
            wrong.status === 403,
          `sans code ${none.status} / mauvais ${wrong.status}`,
        );
        const config = await new Client(B.base).get("/api/auth/config");
        check(
          config.data.signup === "code" && config.data.setup_required === true,
          "config B",
        );
        const first = await cb.post("/api/auth/register", {
          username: "Premier",
          password: PASSWORD,
          code: "sesame-2026",
        });
        status(first, 201, "bon code");
        check(first.data.user.role === "admin", "premier = admin");
        const second = await cb2.post("/api/auth/register", {
          username: "Second",
          password: PASSWORD,
          code: "sesame-2026",
        });
        status(second, 201, "second");
        const limited = await new Client(B.base).post("/api/auth/register", {
          username: "Troisieme",
          password: PASSWORD,
          code: "sesame-2026",
        });
        check(
          limited.status === 429 &&
            Number(limited.headers.get("retry-after")) > 0,
          `5ᵉ tentative → ${limited.status}`,
        );
        return "sans code 403, mauvais code 403, bon code 201 (admin) puis 201 ; 5ᵉ tentative de l'heure → 429 + Retry-After";
      },
    );

    await scenario(
      P2,
      "S.11",
      {
        priority: "critique",
        technique: "valeurs-limites",
        surface: "API",
        title:
          "Quota par utilisateur : 413 clair, rien de conservé, quota par compte",
        action:
          "Serveur B (quota 100 000 octets) : « Premier » importe 60 000 octets (accepté), puis 60 000 de plus (flux), puis 60 000 en formulaire ; « Second » importe 60 000 octets.",
        expected:
          "Le 2ᵉ et le 3ᵉ : `413` « Quota atteint : tu utilises … sur … », aucune session ni dossier ajouté ; `GET /api/me` donne `used_bytes` et `limit_bytes`; « Second » n'est pas affecté par le quota de « Premier » ; supprimer libère l'espace.",
      },
      async () => {
        const body = wav((60000 - 44) / 2 / 16000);
        check(body.length === 60000, `taille fixture ${body.length}`);
        const one = await cb.upload("un.wav", body);
        status(one, 201, "premier import");
        const dirs = async () =>
          (await readdir(path.join(B.reviewDir, "sessions"))).length;
        const before = await dirs();
        const two = await cb.upload("deux.wav", body);
        check(
          two.status === 413 &&
            /Quota atteint/.test(two.data.error) &&
            /Mo|octets|Ko/.test(two.data.error),
          `flux → ${two.status} ${two.data.error}`,
        );
        const form = new FormData();
        form.append("audio", new Blob([body]), "trois.wav");
        const three = await cb.call("POST", "/api/sessions", { body: form });
        check(three.status === 413, `formulaire → ${three.status}`);
        check(
          (await dirs()) === before,
          "un import refusé a laissé un dossier",
        );
        const me = await cb.get("/api/me");
        check(
          me.data.quota.limit_bytes === 100000 &&
            me.data.quota.used_bytes === 60000,
          JSON.stringify(me.data.quota),
        );
        status(await cb2.upload("autre.wav", body), 201, "quota de Second");
        status(
          await cb.del(`/api/sessions/${one.data.id}`),
          204,
          "suppression",
        );
        status(await cb.upload("deux.wav", body), 201, "après libération");
        const stats = (await cb.get("/api/me/stats")).data;
        check(
          stats.storage.limit_bytes === 100000 &&
            stats.storage.remaining_bytes === 40000,
          JSON.stringify(stats.storage),
        );
        return `413 « ${two.data.error} » (flux et formulaire), dossiers inchangés (${before}) ; quota par compte ; libéré par la suppression ; /api/me/stats : restant ${stats.storage.remaining_bytes} octets`;
      },
    );

    await scenario(
      P2,
      "S.12",
      {
        priority: "normal",
        technique: "partition-équivalence",
        surface: "API",
        title: "Action groupée : chaque identifiant est contrôlé séparément",
        action:
          "Bou (administrateur, serveur A) envoie dans une même requête : une session qui est à lui, une d'Awa (globale), le privé d'Awa et un identifiant inexistant, pour `archive` ; puis un testeur ordinaire (compte neuf) vise le global d'Awa.",
        expected:
          "`results` par id : `ok` pour les siennes et la globale d'Awa (Bou est administrateur), `not_found` pour le privé et l'inconnu ; 101 identifiants ou une action inconnue → `400`.",
      },
      async () => {
        const mineBou = (await bou.upload("bou.wav", wav(1))).data.id;
        const res = await bou.post("/api/sessions/bulk", {
          ids: [
            mineBou,
            state.awaGlobal,
            state.awaPrivate,
            crypto.randomUUID(),
          ],
          action: "archive",
        });
        status(res, 200, "bulk");
        const by = Object.fromEntries(
          res.data.results.map((r) => [r.id, r.status]),
        );
        check(
          by[mineBou] === "ok" &&
            by[state.awaGlobal] === "ok" &&
            by[state.awaPrivate] === "not_found" &&
            res.data.applied === 2,
          JSON.stringify(res.data),
        );
        await bou.post("/api/sessions/bulk", {
          ids: [mineBou, state.awaGlobal],
          action: "unarchive",
        });
        status(
          await bou.post("/api/sessions/bulk", {
            ids: Array.from({ length: 101 }, () => crypto.randomUUID()),
            action: "archive",
          }),
          400,
          "101 ids",
        );
        status(
          await bou.post("/api/sessions/bulk", {
            ids: [mineBou],
            action: "supprimer",
          }),
          400,
          "action inconnue",
        );
        status(
          await bou.post("/api/sessions/bulk", {
            ids: [mineBou],
            action: "set_visibility",
          }),
          400,
          "visibilité absente",
        );
        const demoted = new Client(A.base);
        await demoted.post("/api/auth/register", {
          username: "Simple",
          password: PASSWORD,
        });
        const forbidden = await demoted.post("/api/sessions/bulk", {
          ids: [state.awaGlobal],
          action: "archive",
        });
        check(
          forbidden.data.results[0].status === "forbidden",
          JSON.stringify(forbidden.data),
        );
        return "ok / ok / not_found / not_found (2 appliquées) ; 101 ids, action inconnue, visibilité manquante → 400 ; testeur ordinaire sur un global d'autrui → forbidden";
      },
    );

    await scenario(
      P2,
      "S.13",
      {
        priority: "normal",
        technique: "nominal",
        surface: "API",
        title:
          "Déconnexion : le jeton est révoqué côté serveur ; changement de mot de passe",
        action:
          "Bou change son mot de passe depuis une connexion tout en ayant une 2ᵉ connexion ouverte ; puis se déconnecte.",
        expected:
          "Mauvais mot de passe actuel → `401` ; bon → `204` ; la 2ᵉ connexion est révoquée (`401`), la courante reste valable ; l'ancien mot de passe ne marche plus ; après `logout`, le cookie copié ne marche plus.",
      },
      async () => {
        const second = new Client(A.base);
        status(
          await second.post("/api/auth/login", {
            username: "Bou",
            password: PASSWORD,
          }),
          200,
          "2ᵉ connexion",
        );
        status(
          await bou.post("/api/me/password", {
            current: "pas le bon mot de passe",
            next: "nouveau mot de passe 2026",
          }),
          401,
          "mauvais mot de passe actuel",
        );
        status(
          await bou.post("/api/me/password", {
            current: PASSWORD,
            next: "court",
          }),
          400,
          "nouveau trop court",
        );
        status(
          await bou.post("/api/me/password", {
            current: PASSWORD,
            next: "nouveau mot de passe 2026",
          }),
          204,
          "changement",
        );
        status(await second.get("/api/me"), 401, "2ᵉ connexion révoquée");
        status(await bou.get("/api/me"), 200, "connexion courante");
        check(
          (
            await anon.post(
              "/api/auth/login",
              { username: "Bou", password: PASSWORD },
              { anonymous: true },
            )
          ).status === 401,
          "ancien mot de passe accepté",
        );
        const copy = bou.cookie;
        status(await bou.post("/api/auth/logout", {}), 204, "logout");
        const replay = await anon.get("/api/me", {
          headers: { cookie: `aqr_session=${copy}` },
          anonymous: true,
        });
        check(replay.status === 401, `cookie copié rejoué → ${replay.status}`);
        return "mauvais actuel 401, trop court 400, changement 204 ; 2ᵉ connexion révoquée ; ancien mot de passe refusé ; cookie copié après logout → 401";
      },
    );
  } finally {
    A.child.kill();
    B.child.kill();
    if (createdDocsIndex) await rm(docsIndex, { force: true });
    await new Promise((r) => setTimeout(r, 800));
    const errors = (A.log() + B.log())
      .split("\n")
      .filter((l) => /ERROR|Unhandled|TypeError|SqliteError/.test(l));
    console.log(
      errors.length
        ? `\nJournal serveur — lignes d'erreur :\n${errors.slice(0, 15).join("\n")}`
        : "\nJournal serveur : aucune erreur.",
    );
    results.serverErrors = errors;
    await rm(A.reviewDir, { recursive: true, force: true }).catch(
      () => undefined,
    );
    await rm(B.reviewDir, { recursive: true, force: true }).catch(
      () => undefined,
    );
  }

  const failed = results.filter((r) => r.verdict === "❌");
  console.log(
    `\n${results.length - failed.length}/${results.length} scénarios ✅`,
  );
  if (WRITE) await writePlaybooks(results);
  process.exit(failed.length || results.serverErrors?.length ? 1 : 0);
}

// ── Écriture des playbooks ────────────────────────────────────────────────────────────────────
const TITLES = {
  "phase2-parcours-normal": {
    title:
      "Phase 2 — parcours normal : inscription, import global/privé, préférences, liste paginée",
    perimetre:
      "Comptes (inscription, connexion, déconnexion), import (global, privé, nom par défaut), liste paginée par curseur, favoris/archives/renommage, préférences persistées, non lu, statistiques, documentation.",
  },
  "phase2-partage-et-preferences": {
    title:
      "Phase 2 — partage, autorisations et préférences : refus, isolation, quota, débit",
    perimetre:
      "Isolation du privé (16 routes), droits propriétaire/administrateur, attribution des signalements, vérité terrain admin, préférences strictes, authentification hostile, administration, code d'invitation, quota et débit.",
  },
};

async function writePlaybooks(all) {
  const sha = await new Promise((resolve) => {
    const git = spawn("git", ["rev-parse", "--short", "HEAD"], {
      cwd: repoDir,
    });
    let out = "";
    git.stdout.on("data", (d) => (out += d));
    git.on("close", () => resolve(out.trim() || "—"));
  });
  const day = new Date().toISOString().slice(0, 10);
  for (const [key, meta] of Object.entries(TITLES)) {
    const mine = all.filter((r) => r.playbook === key);
    const lines = [
      `# ${meta.title}`,
      `> Surfaces : [API] · Statut : ${mine.every((r) => r.verdict === "✅") ? "✅" : "❌"} · Build : feat/comptes-et-partage @${sha} · Testé : ${day}`,
      `> Périmètre : ${meta.perimetre}`,
      "> Environnement : `next start` (build de production) sur 127.0.0.1, dossier de données de TEST (copie de 2 sessions réelles en lecture seule, jamais les données de Cherif), client HTTP avec un cookie par testeur ; serveur A (inscription ouverte) et serveur B (code d'invitation, quota 100 000 octets, 4 inscriptions/heure).",
      "> Données : aucun compte pré-créé — les comptes (Cherif = premier = administrateur, Awa, Bou…) sont créés par l'API d'inscription, les audios par l'API d'import.",
      "> Critère d'arrêt : tous les scénarios critiques ✅, tous les refus (must-fail) bloqués, aucune ligne d'erreur dans le journal du serveur.",
      "> Rejouer : `cd web && npm run build && node e2e/phase2-api.mjs --source <dossier sessions> --ids <id1,id2> --engine --write` (écrit ce fichier ; `--engine` lance aussi une vraie analyse, avec `AQR_PYTHON`, `AQR_MODELS_DIR`, `AQR_CORPUS_DIR` posés).",
      "",
      "## Préconditions",
      "- [API] Build de production présent (`npm run build`), Node ≥ 24 (`node:sqlite`).",
      "- [API] Dossier de données vide de comptes ; deux sessions d'avant les comptes copiées dans `sessions/`.",
      "",
      "## Scénarios",
      "",
    ];
    for (const r of mine)
      lines.push(
        `### ${r.id} — [${r.surface}] ${r.title}`,
        `**Priorité** : ${r.priority}`,
        `**Technique** : ${r.technique}`,
        `**Action** : ${r.action}`,
        `**Attendu** : ${r.expected}`,
        `**Observé** : ${String(r.observed).replace(/\n/g, " ")}`,
        `**Verdict** : ${r.verdict}`,
        "**Issue** : —",
        "",
      );
    const file = path.join(
      repoDir,
      ".artist",
      "acceptance-playbooks",
      `${key}.md`,
    );
    await writeFile(file, lines.join("\n"), "utf8");
    console.log(`écrit : ${file}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
