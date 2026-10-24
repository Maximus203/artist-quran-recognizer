import { describe, expect, it } from "vitest";
import {
  LIVE_ERRORS,
  classifyError,
  micErrorKey,
  serviceErrorKey,
} from "./live-errors";

const secure = { secure: true, hasApi: true };

describe("micErrorKey", () => {
  it("traduit les erreurs réelles de getUserMedia", () => {
    expect(micErrorKey({ name: "NotAllowedError" }, secure)).toBe("denied");
    expect(micErrorKey({ name: "NotFoundError" }, secure)).toBe("nomic");
    expect(micErrorKey({ name: "NotReadableError" }, secure)).toBe("micbusy");
    expect(micErrorKey({ name: "Autre" }, secure)).toBe("unsupported");
  });
  it("une page non sécurisée passe avant tout (http sur le réseau local)", () => {
    expect(
      micErrorKey(
        { name: "NotAllowedError" },
        { secure: false, hasApi: false },
      ),
    ).toBe("insecure");
  });
  it("sans l'API de capture : navigateur incompatible", () => {
    expect(micErrorKey(null, { secure: true, hasApi: false })).toBe(
      "unsupported",
    );
  });
});

describe("serviceErrorKey et classifyError", () => {
  it("relie les codes du service à un écran", () => {
    expect(serviceErrorKey("server_busy")).toBe("server_busy");
    expect(serviceErrorKey("too_many_streams")).toBe("too_many_streams");
    expect(serviceErrorKey("token_expired")).toBe("token");
    expect(serviceErrorKey("token_replayed")).toBe("token");
    expect(serviceErrorKey("unauthenticated")).toBe("signin");
    expect(serviceErrorKey("session_expired")).toBe("expired");
    expect(serviceErrorKey("inconnu")).toBe("internal");
  });
  it("avant READY toute erreur est un échec de départ ; ensuite certaines closent, d'autres se reprennent", () => {
    expect(classifyError("server_busy", false)).toBe("start_failure");
    expect(classifyError("idle_timeout", true)).toBe("retry_link");
    expect(classifyError("token_expired", true)).toBe("retry_link");
    expect(classifyError("silence_too_long", true)).toBe("terminal");
    expect(classifyError("server_busy", true)).toBe("terminal");
    expect(classifyError("bad_message", true)).toBe("terminal");
  });
});

describe("textes", () => {
  it("chaque erreur dit la cause, l'impact et quoi faire, sans code brut ni émoji", () => {
    for (const [key, text] of Object.entries(LIVE_ERRORS)) {
      expect(text.title.length, key).toBeGreaterThan(10);
      expect(text.cause.length, key).toBeGreaterThan(20);
      expect(text.impact.length, key).toBeGreaterThan(10);
      expect(text.todo.length, key).toBeGreaterThan(10);
      expect(JSON.stringify(text), key).not.toMatch(
        /[A-Z_]{6,}|[\u{1F300}-\u{1FAFF}]/u,
      );
      expect(JSON.stringify(text), key).not.toMatch(
        /AQR_|\.env|exception|undefined/i,
      );
    }
  });
});
