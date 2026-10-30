import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACCESS_COOKIE,
  accessTtlSeconds,
  hasAccessCredential,
  isLocalRequest,
  issueAccessCookie,
  parseAllowedHosts,
  verifyToken,
} from "./local-request";
describe("frontière locale", () => {
  it("accepte la requête de l'atelier", () => {
    expect(
      isLocalRequest(
        new Request("http://127.0.0.1:3097/api/sessions", {
          method: "POST",
          headers: { origin: "http://127.0.0.1:3097" },
        }),
        true,
      ),
    ).toBe(true);
    expect(
      isLocalRequest(
        new Request("http://localhost:3098/api/sessions", {
          method: "POST",
          headers: { origin: "http://127.0.0.1:3098" },
        }),
        true,
      ),
    ).toBe(true);
  });
  it("refuse une page tierce et un hôte rebinding", () => {
    expect(
      isLocalRequest(
        new Request("http://127.0.0.1:3097/api/sessions", {
          method: "POST",
          headers: { origin: "https://example.org" },
        }),
        true,
      ),
    ).toBe(false);
    expect(
      isLocalRequest(
        new Request("http://localhost:3098/api/sessions", {
          method: "POST",
          headers: { origin: "http://127.0.0.1:3099" },
        }),
        true,
      ),
    ).toBe(false);
    expect(
      isLocalRequest(new Request("http://attacker.test:3097/api/sessions")),
    ).toBe(false);
  });
});

describe("en-tête Host (DNS rebinding)", () => {
  // Le serveur lie 127.0.0.1 : l'URL reconstruite par Next porte cet hôte quoi que le client
  // annonce. Seul l'en-tête Host dit à quel nom le navigateur a cru parler.
  const get = (host: string | null, extra: Record<string, string> = {}) =>
    new Request("http://127.0.0.1:3097/api/sessions", {
      headers: { ...(host === null ? {} : { host }), ...extra },
    });
  it("refuse un nom de domaine qui résout vers la boucle locale", () => {
    expect(isLocalRequest(get("evil.example:3097"))).toBe(false);
    expect(isLocalRequest(get("evil.example"))).toBe(false);
    expect(isLocalRequest(get("127.0.0.1.evil.example:3097"))).toBe(false);
    expect(isLocalRequest(get("localhost.evil.example"))).toBe(false);
  });
  it("accepte les trois noms de la boucle locale, avec ou sans port", () => {
    for (const host of [
      "127.0.0.1:3097",
      "localhost:3097",
      "[::1]:3097",
      "LOCALHOST:3097",
      "127.0.0.1",
    ])
      expect(isLocalRequest(get(host))).toBe(true);
  });
  it("refuse aussi les écritures sous un Host étranger, même avec une origine locale", () => {
    expect(
      isLocalRequest(
        new Request("http://127.0.0.1:3097/api/sessions", {
          method: "POST",
          headers: {
            host: "evil.example:3097",
            origin: "http://127.0.0.1:3097",
          },
        }),
        true,
      ),
    ).toBe(false);
  });
  it("refuse un X-Forwarded-Host étranger", () => {
    expect(
      isLocalRequest(
        get("127.0.0.1:3097", { "x-forwarded-host": "evil.example" }),
      ),
    ).toBe(false);
    expect(
      isLocalRequest(
        get("127.0.0.1:3097", { "x-forwarded-host": "localhost:3097" }),
      ),
    ).toBe(true);
  });
  it("refuse un Host mal formé ou ambigu", () => {
    for (const host of [
      "",
      "evil.example:3097, 127.0.0.1",
      "a b",
      "127.0.0.1:abc",
      "@evil",
    ])
      expect(isLocalRequest(get(host))).toBe(false);
  });
  it("sans en-tête Host (appel interne), la vérification de l'URL reste seule", () => {
    expect(isLocalRequest(get(null))).toBe(true);
    expect(
      isLocalRequest(new Request("http://attacker.test:3097/api/sessions")),
    ).toBe(false);
  });
  it("mode distant : le Host doit être un hôte autorisé ET l'URL aussi", () => {
    vi.stubEnv("AQR_ALLOWED_HOSTS", "atelier.exemple.test");
    vi.stubEnv("AQR_ACCESS_TOKEN", "s3cret-token-value-0123456789");
    const remote = (host: string) =>
      new Request("http://atelier.exemple.test/api/sessions", {
        headers: { host, "x-aqr-token": "s3cret-token-value-0123456789" },
      });
    expect(isLocalRequest(remote("atelier.exemple.test"))).toBe(true);
    expect(isLocalRequest(remote("evil.example"))).toBe(false);
    vi.unstubAllEnvs();
  });
});

const TOKEN = "s3cret-token-value-0123456789";
const post = (url: string, headers: Record<string, string> = {}) =>
  new Request(url, { method: "POST", headers });

describe("mode test distant (désactivé par défaut)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("refuse un hôte distant sans configuration", () => {
    expect(isLocalRequest(new Request("http://lab.example:3097/api/x"))).toBe(
      false,
    );
  });

  it("n'ajoute aucun hôte quand AQR_ALLOWED_HOSTS est vide", () => {
    vi.stubEnv("AQR_ALLOWED_HOSTS", " , ");
    expect(parseAllowedHosts(process.env.AQR_ALLOWED_HOSTS)).toEqual([]);
    expect(isLocalRequest(new Request("http://lab.example/api/x"))).toBe(false);
  });

  it("normalise la liste d'hôtes (casse, espaces, port retiré)", () => {
    expect(parseAllowedHosts(" Lab.Example , 10.0.0.5:3097,")).toEqual([
      "lab.example",
      "10.0.0.5",
    ]);
  });

  it("refuse un hôte autorisé tant qu'aucun jeton n'est configuré", () => {
    vi.stubEnv("AQR_ALLOWED_HOSTS", "lab.example");
    expect(isLocalRequest(new Request("http://lab.example/api/x"))).toBe(false);
  });

  it("accepte un hôte autorisé avec le jeton en en-tête", () => {
    vi.stubEnv("AQR_ALLOWED_HOSTS", "lab.example");
    vi.stubEnv("AQR_ACCESS_TOKEN", TOKEN);
    const ok = new Request("http://lab.example/api/x", {
      headers: { "x-aqr-token": TOKEN },
    });
    expect(isLocalRequest(ok)).toBe(true);
    const bearer = new Request("http://lab.example/api/x", {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(isLocalRequest(bearer)).toBe(true);
  });

  it("refuse jeton absent, faux ou de longueur différente", () => {
    vi.stubEnv("AQR_ALLOWED_HOSTS", "lab.example");
    vi.stubEnv("AQR_ACCESS_TOKEN", TOKEN);
    expect(isLocalRequest(new Request("http://lab.example/api/x"))).toBe(false);
    for (const bad of [
      "x",
      TOKEN.slice(0, -1),
      TOKEN + "a",
      "z".repeat(TOKEN.length),
    ])
      expect(
        isLocalRequest(
          new Request("http://lab.example/api/x", {
            headers: { "x-aqr-token": bad },
          }),
        ),
      ).toBe(false);
  });

  it("un hôte non listé reste refusé même avec le bon jeton", () => {
    vi.stubEnv("AQR_ALLOWED_HOSTS", "lab.example");
    vi.stubEnv("AQR_ACCESS_TOKEN", TOKEN);
    expect(
      isLocalRequest(
        new Request("http://evil.example/api/x", {
          headers: { "x-aqr-token": TOKEN },
        }),
      ),
    ).toBe(false);
  });

  it("le jeton protège aussi le loopback une fois configuré", () => {
    vi.stubEnv("AQR_ACCESS_TOKEN", TOKEN);
    expect(isLocalRequest(new Request("http://127.0.0.1:3097/api/x"))).toBe(
      false,
    );
    expect(
      isLocalRequest(
        new Request("http://127.0.0.1:3097/api/x", {
          headers: { "x-aqr-token": TOKEN },
        }),
      ),
    ).toBe(true);
  });

  it("mutation distante : l'origine doit être l'hôte autorisé (même port, même protocole)", () => {
    vi.stubEnv("AQR_ALLOWED_HOSTS", "lab.example");
    vi.stubEnv("AQR_ACCESS_TOKEN", TOKEN);
    const h = { "x-aqr-token": TOKEN };
    expect(
      isLocalRequest(
        post("https://lab.example/api/sessions", {
          ...h,
          origin: "https://lab.example",
        }),
        true,
      ),
    ).toBe(true);
    for (const origin of [
      "https://evil.example",
      "http://lab.example",
      "https://lab.example:8443",
    ])
      expect(
        isLocalRequest(
          post("https://lab.example/api/sessions", { ...h, origin }),
          true,
        ),
      ).toBe(false);
  });
});

describe("cookie d'accès à durée limitée", () => {
  const NOW = 1_700_000_000_000;
  afterEach(() => vi.unstubAllEnvs());
  const withCookie = (value: string) =>
    new Request("http://127.0.0.1:3097/api/x", {
      headers: { cookie: `${ACCESS_COOKIE}=${value}` },
    });

  it("TTL par défaut 3600 s, AQR_ACCESS_TTL_S l'ajuste, valeur invalide ignorée", () => {
    expect(accessTtlSeconds(undefined)).toBe(3600);
    expect(accessTtlSeconds("120")).toBe(120);
    for (const bad of ["0", "-5", "abc", "1e99", ""])
      expect(accessTtlSeconds(bad)).toBe(3600);
  });

  it("émet puis accepte un cookie avant expiration", () => {
    vi.stubEnv("AQR_ACCESS_TOKEN", TOKEN);
    const cookie = issueAccessCookie(TOKEN, 60, NOW);
    expect(isLocalRequest(withCookie(cookie), false, NOW + 59_000)).toBe(true);
  });

  it("refuse un cookie expiré", () => {
    vi.stubEnv("AQR_ACCESS_TOKEN", TOKEN);
    const cookie = issueAccessCookie(TOKEN, 60, NOW);
    expect(isLocalRequest(withCookie(cookie), false, NOW + 61_000)).toBe(false);
  });

  it("refuse un cookie falsifié (expiration rallongée, autre jeton)", () => {
    vi.stubEnv("AQR_ACCESS_TOKEN", TOKEN);
    const cookie = issueAccessCookie(TOKEN, 60, NOW);
    const sig = cookie.split(".")[1];
    const forged = `${NOW + 10_000_000}.${sig}`;
    const other = issueAccessCookie("autre-jeton", 60, NOW);
    for (const value of [forged, other, "garbage", "1.2.3", ""])
      expect(isLocalRequest(withCookie(value), false, NOW + 1000)).toBe(false);
  });

  it("hasAccessCredential : libre sans jeton configuré, sinon exige un justificatif", () => {
    const bare = new Request("http://localhost/");
    expect(hasAccessCredential(bare)).toBe(true);
    vi.stubEnv("AQR_ACCESS_TOKEN", TOKEN);
    expect(hasAccessCredential(bare)).toBe(false);
    const cookie = issueAccessCookie(TOKEN, 60, NOW);
    expect(hasAccessCredential(withCookie(cookie), NOW + 1000)).toBe(true);
  });

  it("verifyToken : rejette le vide et l'absent", () => {
    expect(verifyToken(TOKEN, TOKEN)).toBe(true);
    expect(verifyToken("", TOKEN)).toBe(false);
    expect(verifyToken(TOKEN, "")).toBe(false);
    expect(verifyToken(null, TOKEN)).toBe(false);
  });
});

describe("origine publique (tunnel) : AQR_PUBLIC_ORIGIN", () => {
  afterEach(() => vi.unstubAllEnvs());
  // Derrière un tunnel, Next voit `http://127.0.0.1:<port>` alors que le navigateur est en `https://`
  // sur l'adresse publique : sans cette variable, toute écriture distante est refusée (403).
  const PUBLIC = "https://lab.example";
  const remote = (
    origin: string | null,
    headers: Record<string, string> = {},
  ) =>
    post("http://127.0.0.1:3097/api/auth/login", {
      host: "lab.example",
      "x-aqr-token": TOKEN,
      ...(origin === null ? {} : { origin }),
      ...headers,
    });

  it("accepte l'écriture dont l'origine est l'adresse publique configurée", () => {
    vi.stubEnv("AQR_ACCESS_TOKEN", TOKEN);
    vi.stubEnv("AQR_PUBLIC_ORIGIN", `${PUBLIC}/`);
    expect(isLocalRequest(remote(PUBLIC), true)).toBe(true);
  });

  it("l'hôte public est accepté aussi en lecture, avec le jeton", () => {
    vi.stubEnv("AQR_ACCESS_TOKEN", TOKEN);
    vi.stubEnv("AQR_PUBLIC_ORIGIN", PUBLIC);
    expect(isLocalRequest(remote(null))).toBe(true);
  });

  it("refuse toute autre origine, même avec la variable", () => {
    vi.stubEnv("AQR_ACCESS_TOKEN", TOKEN);
    vi.stubEnv("AQR_PUBLIC_ORIGIN", PUBLIC);
    for (const origin of [
      "https://evil.example",
      "http://lab.example",
      "https://lab.example:8443",
      "https://sub.lab.example",
    ])
      expect(isLocalRequest(remote(origin), true)).toBe(false);
  });

  it("sans la variable, la même écriture reste refusée", () => {
    vi.stubEnv("AQR_ACCESS_TOKEN", TOKEN);
    vi.stubEnv("AQR_ALLOWED_HOSTS", "lab.example");
    expect(isLocalRequest(remote(PUBLIC), true)).toBe(false);
  });

  it("sans jeton, la variable est ignorée (boucle locale seulement)", () => {
    vi.stubEnv("AQR_PUBLIC_ORIGIN", PUBLIC);
    expect(isLocalRequest(remote(PUBLIC), true)).toBe(false);
  });

  it("une valeur mal formée ferme la porte (refus, jamais de repli)", () => {
    vi.stubEnv("AQR_ACCESS_TOKEN", TOKEN);
    for (const value of [
      "lab.example",
      "https://lab.example/atelier",
      "ftp://lab.example",
      "https://lab.example?x=1",
    ]) {
      vi.stubEnv("AQR_PUBLIC_ORIGIN", value);
      expect(isLocalRequest(remote(PUBLIC), true)).toBe(false);
    }
  });
});

describe("serveur lié à toutes les interfaces (conteneur) : AQR_SERVER_HOST", () => {
  afterEach(() => vi.unstubAllEnvs());
  // Dans un conteneur, Next écoute sur 0.0.0.0 pour que le reverse proxy l'atteigne : l'URL qu'il
  // reconstruit porte alors `0.0.0.0`. Le nom d'hôte réel reste celui des en-têtes Host / X-Forwarded-Host.
  const PUBLIC = "https://lab.example";
  const behindProxy = (headers: Record<string, string> = {}) =>
    new Request("http://0.0.0.0:3000/api/auth/login", {
      headers: { host: "lab.example", "x-aqr-token": TOKEN, ...headers },
    });
  const configure = (bound?: string) => {
    vi.stubEnv("AQR_ACCESS_TOKEN", TOKEN);
    vi.stubEnv("AQR_PUBLIC_ORIGIN", PUBLIC);
    if (bound !== undefined) vi.stubEnv("AQR_SERVER_HOST", bound);
  };

  it("accepte l'URL d'écoute déclarée quand l'hôte annoncé est l'hôte public", () => {
    configure("0.0.0.0");
    expect(isLocalRequest(behindProxy())).toBe(true);
  });

  it("sans la déclaration, l'URL en 0.0.0.0 reste refusée (comportement historique)", () => {
    configure();
    expect(isLocalRequest(behindProxy())).toBe(false);
  });

  it("l'URL d'écoute ne dispense ni du jeton ni de l'hôte annoncé", () => {
    configure("0.0.0.0");
    expect(isLocalRequest(behindProxy({ "x-aqr-token": "faux" }))).toBe(false);
    expect(isLocalRequest(behindProxy({ host: "evil.example" }))).toBe(false);
    expect(
      isLocalRequest(behindProxy({ "x-forwarded-host": "evil.example" })),
    ).toBe(false);
  });

  it("0.0.0.0 n'est jamais accepté comme nom d'hôte ANNONCÉ (attaque « 0.0.0.0 day »)", () => {
    configure("0.0.0.0");
    expect(isLocalRequest(behindProxy({ host: "0.0.0.0:3000" }))).toBe(false);
  });

  it("seules les adresses génériques sont acceptées comme valeur", () => {
    for (const value of ["evil.example", "10.0.0.5", "127.0.0.1.evil"]) {
      vi.unstubAllEnvs();
      configure(value);
      expect(isLocalRequest(behindProxy())).toBe(false);
    }
  });
});
