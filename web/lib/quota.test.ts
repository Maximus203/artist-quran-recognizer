import { describe, expect, it } from "vitest";
import { DEFAULT_USER_QUOTA_BYTES, userQuotaBytes } from "./quota";

describe("userQuotaBytes", () => {
  it("5 Gio par défaut quand la variable est absente ou vide", () => {
    expect(DEFAULT_USER_QUOTA_BYTES).toBe(5 * 1024 ** 3);
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
