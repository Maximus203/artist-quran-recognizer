import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_VIDEO_PREFS, type VideoPrefs } from "./export-video-prefs";
import { SOURCE_BACKGROUND_ID } from "./export-video-backgrounds";
import {
  PrefsAutosave,
  startingVideoPrefs,
} from "./session-video-prefs-client";

const account: VideoPrefs = { ...DEFAULT_VIDEO_PREFS, showWave: false };
const stored: VideoPrefs = { ...DEFAULT_VIDEO_PREFS, showTranslation: false };

describe("startingVideoPrefs : qui a la priorité", () => {
  it("les réglages de CETTE vidéo l'emportent sur le compte, même pour une vidéo d'origine", () => {
    expect(startingVideoPrefs({ stored, account, isVideo: false })).toEqual(
      stored,
    );
    expect(startingVideoPrefs({ stored, account, isVideo: true })).toEqual(
      stored,
    );
  });
  it("vidéo jamais personnalisée : le compte sert de point de départ", () => {
    expect(
      startingVideoPrefs({ stored: null, account, isVideo: false }),
    ).toEqual(account);
  });
  it("vidéo envoyée jamais personnalisée : « vidéo d'origine » est le défaut, sur le point de départ du compte", () => {
    expect(
      startingVideoPrefs({ stored: null, account, isVideo: true }),
    ).toEqual({
      ...account,
      orientation: "source",
      background: SOURCE_BACKGROUND_ID,
    });
  });
  it("ne modifie pas ses entrées", () => {
    const before = structuredClone(account);
    startingVideoPrefs({ stored: null, account, isVideo: true });
    expect(account).toEqual(before);
  });
});

describe("PrefsAutosave : sauvegarde automatique", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const make = (send = vi.fn().mockResolvedValue(undefined)) => ({
    send,
    saver: new PrefsAutosave({ send, delayMs: 600 }),
  });
  const a = { ...DEFAULT_VIDEO_PREFS, showArabic: false };
  const b = { ...DEFAULT_VIDEO_PREFS, showRef: false };

  it("n'envoie rien tant qu'aucun changement n'est annoncé", async () => {
    const { send, saver } = make();
    await vi.advanceTimersByTimeAsync(5000);
    await saver.flush();
    expect(send).not.toHaveBeenCalled();
  });
  it("regroupe les changements rapprochés : une requête, avec la valeur la plus récente", async () => {
    const { send, saver } = make();
    saver.schedule(a);
    await vi.advanceTimersByTimeAsync(300);
    saver.schedule(b);
    await vi.advanceTimersByTimeAsync(599);
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(b);
  });
  it("flush envoie tout de suite (lancement d'un export, changement de page) et attend la fin", async () => {
    const { send, saver } = make();
    saver.schedule(a);
    await saver.flush();
    expect(send).toHaveBeenCalledWith(a);
    await vi.advanceTimersByTimeAsync(2000);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("un changement fait pendant un envoi n'est jamais perdu", async () => {
    let release: () => void = () => undefined;
    const send = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<void>((resolve) => (release = resolve)),
      )
      .mockResolvedValue(undefined);
    const { saver } = make(send);
    saver.schedule(a);
    const first = saver.flush();
    saver.schedule(b);
    await vi.advanceTimersByTimeAsync(1000);
    expect(send).toHaveBeenCalledTimes(1); // pas d'envois concurrents
    release();
    await first;
    await vi.advanceTimersByTimeAsync(1000);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith(b);
  });
  it("un échec garde la valeur : elle repart au prochain changement ou à retry, sans boucle", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("réseau"))
      .mockResolvedValue(undefined);
    const onStatus = vi.fn();
    const saver = new PrefsAutosave({ send, delayMs: 600, onStatus });
    saver.schedule(a);
    await saver.flush();
    expect(onStatus).toHaveBeenLastCalledWith("error");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(send).toHaveBeenCalledTimes(1);
    await saver.flush();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith(a);
    expect(onStatus).toHaveBeenLastCalledWith("saved");
  });
  it("une valeur plus récente n'est jamais écrasée par une ancienne qui revient d'un échec", async () => {
    let fail: (e: Error) => void = () => undefined;
    const send = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<void>((_, reject) => (fail = reject)),
      )
      .mockResolvedValue(undefined);
    const { saver } = make(send);
    saver.schedule(a);
    const first = saver.flush();
    saver.schedule(b);
    fail(new Error("réseau"));
    await first;
    await saver.flush();
    expect(send).toHaveBeenLastCalledWith(b);
  });
  it("cancel abandonne ce qui attend (changement de vidéo : rien ne part vers une autre)", async () => {
    const { send, saver } = make();
    saver.schedule(a);
    saver.cancel();
    await vi.advanceTimersByTimeAsync(5000);
    await saver.flush();
    expect(send).not.toHaveBeenCalled();
  });
});
