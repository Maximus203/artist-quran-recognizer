import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PREFERENCE_DEFAULTS, type Preferences } from "./preferences-schema";
import {
  PrefsSync,
  appearanceOf,
  applyPatch,
  mergePatch,
  parseCache,
  serializeCache,
  type SyncStatus,
} from "./prefs-sync";

describe("mergePatch / applyPatch", () => {
  it("la modification la plus récente d'une clé gagne, les autres clés restent", () => {
    expect(
      mergePatch({ theme: "dark", volume: 0.5 }, { theme: "light" }),
    ).toEqual({ theme: "light", volume: 0.5 });
  });

  it("applyPatch ne touche que les clés fournies et ne modifie pas l'original", () => {
    const base = { ...PREFERENCE_DEFAULTS };
    const next = applyPatch(base, { translation: false, arabicSize: 48 });
    expect(next.translation).toBe(false);
    expect(next.arabicSize).toBe(48);
    expect(next.theme).toBe(base.theme);
    expect(base.translation).toBe(true);
  });

  it("une valeur null est une vraie valeur (retour à l'automatique)", () => {
    expect(
      applyPatch(
        { ...PREFERENCE_DEFAULTS, arabicSize: 48 },
        { arabicSize: null },
      ).arabicSize,
    ).toBeNull();
  });
});

describe("cache local", () => {
  it("fait l'aller-retour", () => {
    const prefs: Preferences = { ...PREFERENCE_DEFAULTS, theme: "dark" };
    const raw = serializeCache(7, prefs, { volume: 0.4 });
    expect(parseCache(raw, 7)).toEqual({ prefs, pending: { volume: 0.4 } });
  });

  it("refuse le cache d'un AUTRE compte (partage d'un navigateur)", () => {
    const raw = serializeCache(7, PREFERENCE_DEFAULTS, {});
    expect(parseCache(raw, 8)).toBeNull();
  });

  it("jamais fiable : JSON illisible, valeur invalide ou absente → null", () => {
    expect(parseCache(null, 1)).toBeNull();
    expect(parseCache("{pas du json", 1)).toBeNull();
    expect(
      parseCache(
        JSON.stringify({
          v: 1,
          user: 1,
          prefs: { theme: "rose" },
          pending: {},
        }),
        1,
      ),
    ).toBeNull();
    expect(parseCache(JSON.stringify([1, 2]), 1)).toBeNull();
  });

  it("une modification en attente invalide est écartée, le reste est gardé", () => {
    const raw = JSON.stringify({
      v: 1,
      user: 1,
      prefs: PREFERENCE_DEFAULTS,
      pending: { volume: 9, theme: "dark" },
    });
    expect(parseCache(raw, 1)?.pending).toEqual({ theme: "dark" });
  });
});

describe("appearanceOf", () => {
  it("thème clair/sombre explicite, ou automatique (null)", () => {
    expect(appearanceOf({ ...PREFERENCE_DEFAULTS, theme: "dark" }).theme).toBe(
      "dark",
    );
    expect(appearanceOf(PREFERENCE_DEFAULTS).theme).toBeNull();
  });

  it("taille arabe en px bornée, ou null pour la valeur du thème", () => {
    expect(
      appearanceOf({ ...PREFERENCE_DEFAULTS, arabicSize: 48 }).quranSize,
    ).toBe("48px");
    expect(appearanceOf(PREFERENCE_DEFAULTS).quranSize).toBeNull();
  });

  it("police arabe : le choix, sinon la police par défaut", () => {
    expect(
      appearanceOf({ ...PREFERENCE_DEFAULTS, arabicFont: "scheherazade" }).font,
    ).toBe("scheherazade");
    expect(appearanceOf(PREFERENCE_DEFAULTS).font).toBe("amiri-quran");
  });
});

describe("PrefsSync", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = (send = vi.fn().mockResolvedValue(undefined)) => {
    const statuses: SyncStatus[] = [];
    const sync = new PrefsSync({
      send,
      delayMs: 500,
      onStatus: (s) => statuses.push(s),
    });
    return { sync, send, statuses };
  };

  it("regroupe les changements rapprochés en UNE requête (anti-rebond)", async () => {
    const { sync, send } = setup();
    sync.schedule({ theme: "dark" });
    sync.schedule({ volume: 0.3 });
    sync.schedule({ theme: "light" });
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ theme: "light", volume: 0.3 });
  });

  it("annonce en attente, enregistrement, puis enregistré", async () => {
    const { sync, statuses } = setup();
    sync.schedule({ theme: "dark" });
    await vi.advanceTimersByTimeAsync(500);
    expect(statuses).toEqual(["pending", "saving", "saved"]);
    expect(sync.pending()).toEqual({});
  });

  it("en cas d'échec : garde le changement, annonce l'erreur, ne boucle pas", async () => {
    const send = vi.fn().mockRejectedValue(new Error("hors ligne"));
    const { sync, statuses } = setup(send);
    sync.schedule({ theme: "dark" });
    await vi.advanceTimersByTimeAsync(500);
    expect(statuses.at(-1)).toBe("error");
    expect(sync.pending()).toEqual({ theme: "dark" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("retry() renvoie ce qui est resté en attente, et réussit", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("hors ligne"))
      .mockResolvedValue(undefined);
    const { sync, statuses } = setup(send);
    sync.schedule({ theme: "dark" });
    await vi.advanceTimersByTimeAsync(500);
    await sync.retry();
    expect(send).toHaveBeenLastCalledWith({ theme: "dark" });
    expect(statuses.at(-1)).toBe("saved");
    expect(sync.pending()).toEqual({});
  });

  it("un changement fait PENDANT l'envoi n'est pas perdu", async () => {
    let release: () => void = () => undefined;
    const send = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<void>((resolve) => (release = resolve)),
      )
      .mockResolvedValue(undefined);
    const { sync } = setup(send);
    sync.schedule({ theme: "dark" });
    await vi.advanceTimersByTimeAsync(500);
    sync.schedule({ volume: 0.2 });
    release();
    await vi.advanceTimersByTimeAsync(500);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith({ volume: 0.2 });
  });

  it("un échec ne ressuscite pas une valeur déjà remplacée par un changement plus récent", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("x"))
      .mockResolvedValue(undefined);
    const { sync } = setup(send);
    sync.schedule({ theme: "dark" });
    await vi.advanceTimersByTimeAsync(500);
    sync.schedule({ theme: "light" });
    await vi.advanceTimersByTimeAsync(500);
    expect(send).toHaveBeenLastCalledWith({ theme: "light" });
  });

  it("flush() envoie tout de suite, sans attendre l'anti-rebond", async () => {
    const { sync, send } = setup();
    sync.schedule({ theme: "dark" });
    await sync.flush();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("rien à envoyer : aucune requête", async () => {
    const { sync, send } = setup();
    await sync.flush();
    expect(send).not.toHaveBeenCalled();
  });

  it("reprend des modifications restées en attente d'une session précédente", async () => {
    const { sync, send } = setup();
    sync.restore({ translation: false });
    await sync.flush();
    expect(send).toHaveBeenCalledWith({ translation: false });
  });
});
