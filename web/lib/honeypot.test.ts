import { describe, expect, it } from "vitest";
import {
  DECOY_FIELD,
  FORM_TOKEN_FIELD,
  MIN_FILL_MS,
  checkForm,
  isTrapPath,
  issueFormToken,
} from "./honeypot";

describe("routes pièges", () => {
  it.each([
    "/admin",
    "/admin/login",
    "/wp-admin",
    "/wp-admin/setup-config.php",
    "/wp-login.php",
    "/xmlrpc.php",
    "/.env",
    "/.env.production",
    "/.git/config",
    "/.aws/credentials",
    "/api/debug",
    "/api/debug/vars",
    "/phpmyadmin",
    "/server-status",
    "/actuator/env",
  ])("%s est un piège", (path) => {
    expect(isTrapPath(path)).toBe(true);
  });

  it.each([
    "/",
    "/login",
    "/register",
    "/sessions",
    "/api/admin/users", // vraie route d'administration : jamais un piège
    "/api/sessions",
    "/administration-des-sessions", // ne commence pas par « /admin/ »
    "/docs/admin",
    "/direct",
  ])("%s n'en est pas un", (path) => {
    expect(isTrapPath(path)).toBe(false);
  });

  it("la casse et les barres finales ne contournent pas le piège", () => {
    expect(isTrapPath("/ADMIN")).toBe(true);
    expect(isTrapPath("/admin/")).toBe(true);
    expect(isTrapPath("/Wp-Admin")).toBe(true);
  });
});

describe("formulaire leurre", () => {
  const secret = "cle-de-test-pour-les-formulaires";
  const t0 = Date.UTC(2026, 9, 30, 10, 0, 0);

  it("un humain : champ leurre vide, délai raisonnable → accepté", () => {
    const token = issueFormToken(t0, secret);
    expect(
      checkForm(
        { [DECOY_FIELD]: "", [FORM_TOKEN_FIELD]: token },
        t0 + 6_000,
        secret,
      ),
    ).toEqual({ ok: true });
  });

  it("champ leurre rempli → robot", () => {
    const token = issueFormToken(t0, secret);
    expect(
      checkForm(
        { [DECOY_FIELD]: "http://spam.example", [FORM_TOKEN_FIELD]: token },
        t0 + 8_000,
        secret,
      ),
    ).toEqual({ ok: false, reason: "decoy_filled" });
  });

  it(`formulaire rendu puis envoyé en moins de ${MIN_FILL_MS / 1000} s → robot`, () => {
    const token = issueFormToken(t0, secret);
    expect(checkForm({ [FORM_TOKEN_FIELD]: token }, t0 + 400, secret)).toEqual({
      ok: false,
      reason: "too_fast",
    });
    expect(
      checkForm({ [FORM_TOKEN_FIELD]: token }, t0 + MIN_FILL_MS, secret),
    ).toEqual({
      ok: true,
    });
  });

  it("jeton falsifié, périmé ou d'une autre clé : pas de verdict de robot (une vieille page n'est pas bloquée)", () => {
    const token = issueFormToken(t0, secret);
    expect(
      checkForm({ [FORM_TOKEN_FIELD]: token }, t0 + 3 * 3_600_000, secret),
    ).toEqual({
      ok: true,
    });
    expect(
      checkForm({ [FORM_TOKEN_FIELD]: `${t0}.0000` }, t0 + 100, secret),
    ).toEqual({
      ok: true,
    });
    expect(
      checkForm({ [FORM_TOKEN_FIELD]: token }, t0 + 100, "autre-cle"),
    ).toEqual({
      ok: true,
    });
  });

  it("sans champ ni jeton (client d'API, agent) : pas un piège", () => {
    expect(checkForm({}, t0, secret)).toEqual({ ok: true });
  });

  it("un jeton dont l'horodatage est falsifié n'est pas reconnu comme valide", () => {
    const forged = `${t0 - 60_000}.${issueFormToken(t0, secret).split(".")[1]}`;
    expect(checkForm({ [FORM_TOKEN_FIELD]: forged }, t0 + 100, secret)).toEqual(
      { ok: true },
    );
  });
});
