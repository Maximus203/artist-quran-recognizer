import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { describePassage } from "../../lib/passage";
import {
  INTERVAL_3_LEGACY,
  INTERVAL_4,
  TRANSLATION_LEGACY,
} from "../../lib/__fixtures__/hud-11-61";
import { LiveArabic, LiveTranslation } from "./live-text";

const verse = describePassage(INTERVAL_4);
if (verse.type !== "verse" || !verse.live || !verse.translation)
  throw new Error("fixture : verset avec temps de mots attendu");
const { live, translation } = verse;
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'");

describe("LiveArabic", () => {
  const render = (active: number) =>
    renderToStaticMarkup(
      <LiveArabic
        parts={live.parts}
        active={active}
        seekable={false}
        onSeekWord={() => {}}
      />,
    );

  it("marque un seul mot avec aria-current, celui en cours", () => {
    const html = render(3);
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    expect(html).toContain('data-w="3" aria-current="true"');
  });

  it("ne marque rien quand aucun mot n'est suivi", () => {
    expect(render(-1)).not.toContain("aria-current");
  });

  it("garde le texte du corpus intact, signes de pause compris", () => {
    const original = INTERVAL_4.kind === "verse" ? (INTERVAL_4.text ?? "") : "";
    expect(text(render(0))).toBe(original);
  });

  it("n'expose les mots comme cliquables que lecture à l'arrêt", () => {
    const html = (seekable: boolean) =>
      renderToStaticMarkup(
        <LiveArabic
          parts={live.parts}
          active={-1}
          seekable={seekable}
          onSeekWord={() => {}}
        />,
      );
    expect(html(true)).toContain('data-seekable="true"');
    expect(html(false)).not.toContain("data-seekable");
  });
});

describe("LiveTranslation", () => {
  it("fragment : sous-titre du passage, points de suspension décoratifs, segment du mot marqué", () => {
    const html = renderToStaticMarkup(
      <LiveTranslation
        translation={translation}
        word={19}
        passageLive={false}
      />,
    );
    expect(html).toContain("Traduction du passage (mots 15–23)");
    expect(html).not.toContain("Traduction du verset entier");
    expect(html).toContain("Découpage approximatif");
    expect(html.match(/aria-hidden="true"/g)).toHaveLength(2);
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    expect(html).toContain(
      'data-seg="4" aria-current="true">et Il vous l’a fait peupler (et exploiter).',
    );
    expect(html).not.toContain("Thamûd");
  });

  it("changer de mot déplace le segment marqué, un mot hors segments ne marque rien", () => {
    const at = (word: number | null) =>
      renderToStaticMarkup(
        <LiveTranslation
          translation={translation}
          word={word}
          passageLive={false}
        />,
      );
    expect(at(15)).toContain('data-seg="3" aria-current="true"');
    expect(at(22)).toContain('data-seg="5" aria-current="true"');
    expect(at(3)).not.toContain("aria-current");
    expect(at(null)).not.toContain("aria-current");
  });

  it("repli verset entier : l'étiquette actuelle est conservée, rien n'est marqué mot à mot", () => {
    const legacy = describePassage(INTERVAL_3_LEGACY);
    if (legacy.type !== "verse" || !legacy.translation)
      throw new Error("fixture");
    const html = renderToStaticMarkup(
      <LiveTranslation
        translation={legacy.translation}
        word={12}
        passageLive
      />,
    );
    expect(html).toContain("Traduction du verset entier");
    expect(html).not.toContain("Traduction du passage");
    expect(html).not.toContain("aria-current");
    expect(html).toContain('class="translation is-live"');
    expect(text(html)).toContain(TRANSLATION_LEGACY.text);
  });
});
