import { describe, expect, it } from "vitest";
import { applyRefresh, refreshLimit } from "./session-feed";

const row = (id: string, v = 0) => ({ id, v });

describe("refreshLimit", () => {
  it("relit au moins la première page, et au plus ce que l'API permet", () => {
    expect(refreshLimit(0, 20)).toBe(20);
    expect(refreshLimit(12, 20)).toBe(20);
    expect(refreshLimit(60, 20)).toBe(60);
    expect(refreshLimit(400, 20)).toBe(100);
  });
});

describe("applyRefresh", () => {
  it("tout ce qui est chargé tient dans la relecture : elle remplace la liste (nouveautés, retraits)", () => {
    const out = applyRefresh(
      [row("a"), row("b")],
      [row("n"), row("a", 1)],
      20,
      null,
      "cur-old",
    );
    expect(out.items).toEqual([row("n"), row("a", 1)]);
    expect(out.nextCursor).toBeNull();
  });

  it("plus de lignes chargées que relues : la tête est rafraîchie, la queue gardée, le curseur d'origine conservé", () => {
    const current = Array.from({ length: 5 }, (_, i) => row(`s${i}`));
    const fresh = [row("s0", 9), row("s1", 9)];
    const out = applyRefresh(current, fresh, 2, "cur-fresh", "cur-old");
    expect(out.items.map((r) => r.id)).toEqual(["s0", "s1", "s2", "s3", "s4"]);
    expect(out.items[0]).toEqual(row("s0", 9));
    expect(out.nextCursor).toBe("cur-old");
  });

  it("la queue ne doublonne pas une ligne remontée dans la tête ; une ligne relue puis absente a disparu", () => {
    const current = [row("a"), row("b"), row("c"), row("d")];
    const out = applyRefresh(current, [row("c", 5), row("a")], 2, "x", "old");
    // b était dans la tête relue et n'y est plus : retirée ou archivée. c remonte, d reste en queue.
    expect(out.items.map((r) => r.id)).toEqual(["c", "a", "d"]);
  });
});
