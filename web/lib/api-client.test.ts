import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, loginUrl } from "./api-client";

const respond = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

afterEach(() => vi.unstubAllGlobals());

describe("loginUrl", () => {
  it("renvoie vers la connexion en gardant la page demandée", () => {
    expect(loginUrl("/sessions", "?q=a")).toBe("/login?next=%2Fsessions%3Fq%3Da");
  });
  it("n'emporte pas la page de connexion elle-même", () => {
    expect(loginUrl("/login", "")).toBe("/login");
    expect(loginUrl("/register", "")).toBe("/login");
  });
});

describe("api", () => {
  it("renvoie le JSON d'une réponse réussie, et rien pour un 204", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(respond(200, { a: 1 })));
    await expect(api("/x")).resolves.toEqual({ a: 1 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(respond(204)));
    await expect(api("/x")).resolves.toBeUndefined();
  });

  it("transforme une erreur serveur en ApiError lisible (statut, code, champ)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        respond(409, { error: "Pseudonyme déjà pris.", field: "username" }),
      ),
    );
    const error = await api("/x").catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(409);
    expect(error.field).toBe("username");
    expect(error.message).toBe("Pseudonyme déjà pris.");
  });

  it("une réponse d'erreur sans JSON reste lisible", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("boom", { status: 500 })));
    const error = await api("/x").catch((e) => e);
    expect(error.status).toBe(500);
    expect(error.message).toMatch(/serveur/i);
  });

  it("réseau coupé : ApiError de statut 0 avec un message clair", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const error = await api("/x").catch((e) => e);
    expect(error.status).toBe(0);
    expect(error.message).toMatch(/réseau|connexion/i);
  });

  it("401 « unauthenticated » : redirige vers la connexion", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { pathname: "/sessions", search: "", assign });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        respond(401, { error: "Connexion requise.", code: "unauthenticated" }),
      ),
    );
    const error = await api("/x").catch((e) => e);
    expect(error.status).toBe(401);
    expect(assign).toHaveBeenCalledWith("/login?next=%2Fsessions");
  });

  it("un 401 de connexion (mauvais mot de passe) ne redirige pas", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { pathname: "/login", search: "", assign });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(respond(401, { error: "Identifiants incorrects.", code: "bad_credentials" })),
    );
    const error = await api("/api/auth/login", { method: "POST" }).catch((e) => e);
    expect(error.code).toBe("bad_credentials");
    expect(assign).not.toHaveBeenCalled();
  });

  it("envoie un corps JSON avec le bon en-tête", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(200, {}));
    vi.stubGlobal("fetch", fetchMock);
    await api("/x", { method: "PATCH", json: { a: 1 } });
    const init = fetchMock.mock.calls[0][1];
    expect(init.method).toBe("PATCH");
    expect(init.body).toBe('{"a":1}');
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
  });
});
