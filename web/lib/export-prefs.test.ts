import { describe, expect, it } from "vitest";
import {
  forgetDeviceExportPrefs,
  LEGACY_DEVICE_EXPORT_KEYS,
} from "./export-prefs";

describe("anciens réglages d'export par appareil", () => {
  it("retire les clés partagées par tous les comptes du navigateur", () => {
    const data = new Map<string, string>([
      ["aqr.ui.v1.export", "{}"],
      ["aqr.ui.v1.export-video", "{}"],
      ["aqr.prefs.v2", "{}"],
    ]);
    forgetDeviceExportPrefs({ removeItem: (k) => void data.delete(k) });
    for (const key of LEGACY_DEVICE_EXPORT_KEYS)
      expect(data.has(key)).toBe(false);
    expect(data.has("aqr.prefs.v2")).toBe(true);
  });

  it("ne lève pas quand le stockage est absent ou bloqué", () => {
    expect(() => forgetDeviceExportPrefs(null)).not.toThrow();
    expect(() =>
      forgetDeviceExportPrefs({
        removeItem: () => {
          throw new Error("bloqué");
        },
      }),
    ).not.toThrow();
  });
});
