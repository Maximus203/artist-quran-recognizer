import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseBody } from "./body";

const schema = z
  .object({ name: z.string().max(5), n: z.number().int().optional() })
  .strict();
const post = (body: unknown, raw = false) =>
  new Request("http://127.0.0.1/api/x", {
    method: "POST",
    body: raw ? String(body) : JSON.stringify(body),
  });

describe("parseBody (corps JSON validé par un schéma strict)", () => {
  it("accepte un corps conforme", async () => {
    const result = await parseBody(
      post({ name: "ok", n: 3 }),
      schema,
      "{ name }",
    );
    expect(result).toEqual({ ok: true, data: { name: "ok", n: 3 } });
  });

  it("refuse un champ inconnu sans le répéter", async () => {
    const result = await parseBody(
      post({ name: "ok", admin: true }),
      schema,
      "{ name }",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(400);
    const body = await result.response.json();
    expect(body.code).toBe("invalid");
    expect(JSON.stringify(body)).not.toContain("admin");
  });

  it("refuse un mauvais type, un dépassement et dit quel champ", async () => {
    for (const bad of [
      { name: 3 },
      { name: "trop long" },
      { name: "ok", n: 1.5 },
    ]) {
      const result = await parseBody(post(bad), schema, "{ name }");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const body = await result.response.json();
        expect(body.field).toBe(Object.keys(bad).length === 2 ? "n" : "name");
        expect(body.error).toMatch(/Corps invalide/);
      }
    }
  });

  it("refuse un corps absent, illisible ou qui n'est pas un objet", async () => {
    for (const request of [
      post("", true),
      post("{pas json", true),
      post([1, 2]),
      post("null"),
    ]) {
      const result = await parseBody(request, schema, "{ name }");
      expect(result.ok).toBe(false);
    }
  });

  it("ne renvoie jamais la valeur reçue (mot de passe compris)", async () => {
    const secret = z.object({ password: z.string().min(12) }).strict();
    const result = await parseBody(
      post({ password: "court" }),
      secret,
      "{ password }",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(await result.response.text()).not.toContain("court");
  });
});
