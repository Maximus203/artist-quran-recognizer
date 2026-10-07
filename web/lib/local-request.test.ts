import { describe, expect, it } from "vitest";
import { isLocalRequest } from "./local-request";
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
      isLocalRequest(new Request("http://attacker.test:3097/api/sessions")),
    ).toBe(false);
  });
});
