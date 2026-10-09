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
