import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXPORT_OPTIONS,
  fromStoredExportOptions,
  storedExportOptionsSchema,
  toStoredExportOptions,
} from "./export-options";
import {
  preferencesPatchSchema,
  PREFERENCE_DEFAULTS,
} from "./preferences-schema";

describe("réglages d'export mémorisés sur le compte", () => {
  it("ne mémorise jamais le forçage ni la politique", () => {
    const stored = toStoredExportOptions({
      ...DEFAULT_EXPORT_OPTIONS,
      format: "ass",
      allow_unresolved: true,
      policy: "first",
    });
    expect(stored).not.toHaveProperty("allow_unresolved");
    expect(stored).not.toHaveProperty("policy");
    expect(stored.format).toBe("ass");
  });

  it("restitue les réglages, avec le forçage et la politique remis à leurs défauts", () => {
    expect(
      fromStoredExportOptions({
        ...toStoredExportOptions(DEFAULT_EXPORT_OPTIONS),
        content: "ar",
      }),
    ).toMatchObject({ content: "ar", allow_unresolved: false, policy: "omit" });
  });

  it("une durée incohérente revient aux défauts", () => {
    expect(
      fromStoredExportOptions({
        ...toStoredExportOptions(DEFAULT_EXPORT_OPTIONS),
        min_s: 9,
        max_s: 2,
      }),
    ).toEqual(DEFAULT_EXPORT_OPTIONS);
  });

  it("un ancien réglage « coupe aux pauses activée » est neutralisé, il ne ressuscite pas la coupe (ADR-0031)", () => {
    const legacy = {
      ...PREFERENCE_DEFAULTS.exportOptions,
      content: "ar",
      pause_split: true,
      pause_s: 1.5,
    };
    const parsed = storedExportOptionsSchema.safeParse(legacy);
    expect(parsed.success).toBe(true); // la ligne n'est pas rejetée : les autres réglages survivent
    if (!parsed.success) return;
    expect(parsed.data).toMatchObject({ content: "ar" });
    expect(parsed.data).not.toHaveProperty("pause_split");
    expect(parsed.data).not.toHaveProperty("pause_s");
    // Même une valeur brute, lue sans passer par le schéma, ne rallume pas la coupe.
    const restored = fromStoredExportOptions(
      legacy as unknown as Parameters<typeof fromStoredExportOptions>[0],
    );
    expect(restored.content).toBe("ar");
    expect(restored).not.toHaveProperty("pause_split");
    expect(restored).not.toHaveProperty("pause_s");
    // Les préférences du compte, lues comme écrites, acceptent aussi l'ancienne ligne.
    expect(
      preferencesPatchSchema.safeParse({ exportOptions: legacy }).success,
    ).toBe(true);
  });

  it("refuse une valeur hors liste dans les préférences du compte", () => {
    expect(
      preferencesPatchSchema.safeParse({
        exportOptions: { ...PREFERENCE_DEFAULTS.exportOptions, format: "doc" },
      }).success,
    ).toBe(false);
    expect(
      storedExportOptionsSchema.safeParse(PREFERENCE_DEFAULTS.exportOptions)
        .success,
    ).toBe(true);
  });
});
