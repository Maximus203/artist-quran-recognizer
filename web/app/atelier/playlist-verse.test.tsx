import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  INTERVAL_3_LEGACY,
  INTERVAL_4_LEGACY,
  TRANSLATION_LEGACY,
} from "../../lib/__fixtures__/hud-11-61";
import type { Interval } from "../../lib/recognition";
import { PlaylistVerse } from "./playlist-verse";

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");

const intervals: Interval[] = [INTERVAL_3_LEGACY, INTERVAL_4_LEGACY];
const at = (item: Interval, offset = 0.5) => (item.t ? item.t[0] : 0) + offset;
const render = (over: Partial<Parameters<typeof PlaylistVerse>[0]> = {}) =>
  renderToStaticMarkup(
    <PlaylistVerse
      status="ready"
      intervals={intervals}
      time={at(INTERVAL_3_LEGACY)}
      playing
      offsetMs={0}
      {...over}
    />,
  );

describe("traduction du lecteur de playlist", () => {
  it("montre la traduction du verset entendu, avec sa source", () => {
    const out = render();
    expect(out).toContain('data-testid="pl-verse"');
    expect(out).toContain('data-testid="translation-text"');
    expect(text(out)).toContain(TRANSLATION_LEGACY.text.slice(0, 20));
    expect(text(out)).toContain(TRANSLATION_LEGACY.translation_id);
  });

  it("le texte arabe vient du résultat (corpus), pas d'ailleurs", () => {
    const first = INTERVAL_3_LEGACY.kind === "verse" ? INTERVAL_3_LEGACY : null;
    expect(text(render())).toContain((first?.text ?? "").trim().slice(0, 12));
  });

  it("suit la lecture : un autre instant, un autre verset", () => {
    const one = render({ time: at(INTERVAL_3_LEGACY) });
    const two = render({ time: at(INTERVAL_4_LEGACY) });
    expect(one).toContain("data-ref=");
    expect(one).not.toBe(two);
  });

  it("hors de tout verset : la zone reste là, sans message d'erreur", () => {
    const out = render({ time: 9999 });
    expect(out).toContain('data-testid="pl-verse"');
    expect(out).not.toContain('data-testid="translation-text"');
    expect(text(out)).not.toContain("impossible");
  });

  it("chargement et échec sont dits clairement", () => {
    expect(text(render({ status: "loading", intervals: [] }))).toContain(
      "Chargement de la traduction",
    );
    expect(text(render({ status: "error", intervals: [] }))).toContain(
      "La traduction n’a pas pu être chargée",
    );
  });
});
