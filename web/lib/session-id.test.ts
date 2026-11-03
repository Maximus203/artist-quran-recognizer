import { describe, expect, it } from "vitest";
import { isSessionId } from "./session-id";

describe("isSessionId", () => {
  it("accepte un UUID de session", () => {
    expect(isSessionId("d2fecf55-f7af-44d8-9c06-c4a15e2f3e4f")).toBe(true);
  });
  it("refuse tout ce qui pourrait sortir du chemin d'une session", () => {
    for (const bad of [
      "",
      "../../api/stats",
      "..%2F..%2Fapi",
      "d2fecf55-f7af-44d8-9c06-c4a15e2f3e4f/../x",
      "D2FECF55-F7AF-44D8-9C06-C4A15E2F3E4F ",
      "<script>",
      null,
      undefined,
      42,
    ])
      expect(isSessionId(bad)).toBe(false);
  });
});
