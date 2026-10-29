import { NextResponse, type NextRequest } from "next/server";
import {
  LIMITS,
  callerKey,
  classify,
  crossSiteMutation,
  liveConnectSources,
  newNonce,
  securityHeaders,
  tooLarge,
  type Family,
} from "./lib/http-security";
import { pseudonymize } from "./lib/audit";
import { log } from "./lib/log";
import { HitLimiter } from "./lib/rate-limit";

/**
 * Premier maillon de chaque requête (Next 16 : `proxy.ts`, ex-`middleware.ts`) :
 *  - identifiant de requête (`x-request-id`) transmis aux routes et rendu à l'appelant ;
 *  - refus d'une modification inter-sites faite avec le cookie de connexion (CSRF) ;
 *  - taille maximale du corps JSON (les envois de fichiers sont bornés par leur route) ;
 *  - limitation de débit par famille de route, par adresse et par compte (429 + `Retry-After`) ;
 *  - en-têtes de sécurité et CSP à nonce.
 * L'authentification, l'hôte autorisé et l'autorisation par ressource restent dans `route-guard`.
 */
const TRUST_PROXY = process.env.AQR_TRUST_PROXY === "1";
const LIVE_SOURCES = liveConnectSources(process.env.AQR_LIVE_URL);
const DEV = process.env.NODE_ENV !== "production";

const GLOBAL = Symbol.for("aqr.proxy-limiters");
type Limiters = Map<Family, HitLimiter>;
function limiters(): Limiters {
  const holder = globalThis as { [GLOBAL]?: Limiters };
  if (!holder[GLOBAL]) {
    const map: Limiters = new Map();
    for (const [family, { max, windowMs }] of Object.entries(LIMITS))
      map.set(family as Family, new HitLimiter(max, windowMs));
    holder[GLOBAL] = map;
  }
  return holder[GLOBAL];
}

function clientIp(request: NextRequest): string {
  if (!TRUST_PROXY) return "local";
  const last = request.headers.get("x-forwarded-for")?.split(",").pop()?.trim();
  return last && /^[0-9a-f:.]{3,45}$/i.test(last) ? last : "unknown";
}

function secure(request: NextRequest): boolean {
  if (request.nextUrl.protocol === "https:") return true;
  return (
    TRUST_PROXY &&
    request.headers.get("x-forwarded-proto")?.split(",").pop()?.trim() ===
      "https"
  );
}

function refuse(
  status: number,
  error: string,
  code: string,
  headers: Record<string, string> = {},
): NextResponse {
  return NextResponse.json(
    { error, code },
    {
      status,
      headers: { "Cache-Control": "private, no-store", ...headers },
    },
  );
}

export function proxy(request: NextRequest): NextResponse {
  const requestId = crypto.randomUUID();
  const { pathname } = request.nextUrl;
  const family = classify(request.method, pathname);
  const isApi = pathname.startsWith("/api/") || pathname === "/mcp";
  const decorate = (response: NextResponse, nonce?: string): NextResponse => {
    response.headers.set("X-Request-Id", requestId);
    for (const [name, value] of Object.entries(
      securityHeaders({
        nonce: nonce ?? newNonce(),
        dev: DEV,
        connect: LIVE_SOURCES,
        secure: secure(request),
      }),
    ))
      response.headers.set(name, value);
    return response;
  };

  if (crossSiteMutation(request.method, request.headers)) {
    log.event(
      "security",
      "cross_site_refused",
      { rid: requestId, path: pathname },
      "warn",
    );
    return decorate(refuse(403, "Requête inter-sites refusée.", "cross_site"));
  }
  if (tooLarge(request.method, family, request.headers.get("content-length"))) {
    log.event(
      "security",
      "payload_too_large",
      { rid: requestId, family, path: pathname },
      "warn",
    );
    return decorate(
      refuse(413, "Le corps de la requête est trop gros.", "payload_too_large"),
    );
  }

  // Débit : par adresse, et par compte quand la requête en porte un (cookie ou jeton, en empreinte).
  const caller = callerKey(request.headers, clientIp(request));
  const limiter = limiters().get(family) as HitLimiter;
  const keys = [
    `ip:${caller.ip}`,
    ...(caller.account ? [`acct:${caller.account}`] : []),
  ];
  for (const key of keys) {
    const verdict = limiter.hit(`${family}:${key}`);
    if (!verdict.allowed) {
      log.event(
        "ratelimit",
        "rate_limited",
        {
          rid: requestId,
          family,
          ip: pseudonymize(caller.ip),
          retry_after_s: verdict.retryAfterS,
        },
        "warn",
      );
      return decorate(
        refuse(
          429,
          `Trop de requêtes : réessaie dans ${verdict.retryAfterS} s.`,
          "rate_limited",
          { "Retry-After": String(verdict.retryAfterS) },
        ),
      );
    }
  }

  const nonce = newNonce();
  const forwarded = new Headers(request.headers);
  forwarded.set("x-request-id", requestId);
  forwarded.set("x-nonce", nonce);
  // Next lit le nonce dans le CSP de la requête pour marquer ses propres scripts.
  if (!isApi)
    forwarded.set(
      "content-security-policy",
      securityHeaders({ nonce, dev: DEV, connect: LIVE_SOURCES })[
        "Content-Security-Policy"
      ],
    );
  return decorate(
    NextResponse.next({ request: { headers: forwarded } }),
    nonce,
  );
}

export const config = {
  matcher: [
    // Tout, sauf les fichiers statiques compilés et l'icône.
    "/((?!_next/static|_next/image|favicon.ico|icon.svg).*)",
  ],
};
