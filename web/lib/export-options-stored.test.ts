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
