#!/usr/bin/env node
/**
 * Contrôle des en-têtes de sécurité d'une adresse (équivalent local de securityheaders.com, sans envoi
 * de l'adresse à un tiers). Usage : node web/scripts/check-headers.mjs https://atelier.exemple.org
 * Code retour : 0 conforme, 1 écart, 2 adresse injoignable. Ne demande aucune connexion : il contrôle
 * ce que n'importe quel visiteur reçoit.
 */
const PAGES = ["/login", "/api/auth/config", "/api/sessions"];

/** Écarts d'un jeu d'en-têtes. `https` = la page est servie en TLS (HSTS attendu). */
export function evaluateHeaders(headers, { https }) {
  const get = (name) =>
    headers.get?.(name) ?? headers[name.toLowerCase()] ?? null;
  const problems = [];
  const need = (name, test, why) => {
    const value = get(name);
    if (value === null) problems.push(`${name} absent : ${why}`);
    else if (test && !test(value))
      problems.push(`${name} « ${value} » : ${why}`);
  };
  const csp = get("content-security-policy");
  if (csp === null) problems.push("Content-Security-Policy absent");
  else {
    const script = /script-src([^;]*)/.exec(csp)?.[1] ?? "";
    if (!/'nonce-[A-Za-z0-9+/=_-]{8,}'/.test(script))
      problems.push("CSP : script-src sans nonce");
    if (/'unsafe-inline'|'unsafe-eval'/.test(script))
      problems.push("CSP : script-src autorise unsafe-inline ou unsafe-eval");
    if (!/frame-ancestors 'none'/.test(csp))
      problems.push("CSP : frame-ancestors 'none' manquant");
    if (!/object-src 'none'/.test(csp))
      problems.push("CSP : object-src 'none' manquant");
    if (!/base-uri/.test(csp)) problems.push("CSP : base-uri manquant");
    if (/default-src[^;]*\*/.test(csp))
      problems.push("CSP : default-src ouvert à tout (*)");
  }
  need(
    "x-content-type-options",
    (v) => v.toLowerCase() === "nosniff",
    "doit valoir nosniff",
  );
  need(
    "x-frame-options",
    (v) => /^(deny|sameorigin)$/i.test(v),
    "doit valoir DENY",
  );
  need(
    "referrer-policy",
    (v) => !/unsafe-url|no-referrer-when-downgrade/i.test(v),
    "trop permissif",
  );
  need(
    "permissions-policy",
    null,
    "restreindre caméra, géolocalisation, paiement…",
  );
  need("cross-origin-opener-policy", null, "isoler la fenêtre");
  need(
    "cross-origin-resource-policy",
    null,
    "limiter l'inclusion par d'autres sites",
  );
  if (https)
    need(
      "strict-transport-security",
      (v) =>
        /max-age=(\d+)/.test(v) &&
        Number(/max-age=(\d+)/.exec(v)[1]) >= 15552000,
      "au moins 180 jours (15552000 s)",
    );
  if (get("x-powered-by"))
    problems.push(
      `X-Powered-By expose la technologie (${get("x-powered-by")})`,
    );
  const server = get("server");
  if (server && /\d/.test(server))
    problems.push(`Server expose une version (${server})`);
  return problems;
}

async function main() {
  const base = process.argv[2];
  if (!base) {
    console.error("Usage : node check-headers.mjs <adresse>");
    return 2;
  }
  const https = base.startsWith("https://");
  let failed = false;
  for (const page of PAGES) {
    let response;
    try {
      response = await fetch(new URL(page, base), { redirect: "manual" });
    } catch (error) {
      console.error(`Injoignable : ${base} (${error.message})`);
      return 2;
    }
    const problems = evaluateHeaders(response.headers, { https });
    console.log(
      `${problems.length ? "ÉCART" : "OK   "} ${page} (HTTP ${response.status})`,
    );
    for (const problem of problems) console.log(`       - ${problem}`);
    if (problems.length) failed = true;
  }
  if (!https)
    console.log(
      "Adresse en HTTP : HSTS non contrôlé (il n'a de sens qu'en HTTPS).",
    );
  return failed ? 1 : 0;
}

if (
  import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` ||
  process.argv[1]?.endsWith("check-headers.mjs")
) {
  main().then((code) => process.exit(code));
}
