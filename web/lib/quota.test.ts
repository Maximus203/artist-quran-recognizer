import { describe, expect, it } from "vitest";
import { DEFAULT_USER_QUOTA_BYTES, fitsQuota, userQuotaBytes } from "./quota";

describe("userQuotaBytes", () => {
  it("2 Gio par défaut quand la variable est absente ou vide", () => {
    expect(DEFAULT_USER_QUOTA_BYTES).toBe(2 * 1024 ** 3);
    expect(userQuotaBytes(undefined)).toBe(DEFAULT_USER_QUOTA_BYTES);
    expect(userQuotaBytes("")).toBe(DEFAULT_USER_QUOTA_BYTES);
  });
  it("une valeur d'octets la remplace ; 0 veut dire illimité", () => {
    expect(userQuotaBytes("1048576")).toBe(1048576);
    expect(userQuotaBytes("0")).toBe(0);
  });
  it("une valeur invalide retombe sur le défaut, jamais sur « illimité »", () => {
    for (const bad of ["abc", "-5", "1.5", "NaN"])
      expect(userQuotaBytes(bad)).toBe(DEFAULT_USER_QUOTA_BYTES);
  });
});

describe("fitsQuota", () => {
  it("accepte ce qui tient dans l'espace libre, refuse ce qui dépasse", () => {
    expect(fitsQuota(100, 50, 200)).toBe(true);
    expect(fitsQuota(100, 100, 200)).toBe(true);
    expect(fitsQuota(100, 101, 200)).toBe(false);
  });
  it("sans quota (0), tout tient", () => {
    expect(fitsQuota(10 ** 12, 10 ** 12, 0)).toBe(true);
  });
});
