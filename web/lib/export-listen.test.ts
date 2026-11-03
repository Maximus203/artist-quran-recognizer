import { describe, expect, it } from "vitest";
import { ListenMeter, LISTENED_RATIO } from "./export-listen";

const play = (meter: ListenMeter, from: number, to: number, step = 0.05) => {
  for (let t = from; t < to; t += step) meter.feed(t, true);
};

describe("écoute d'un passage", () => {
  it("jouer toute la plage vaut « écouté »", () => {
    const meter = new ListenMeter(10, 20);
    play(meter, 10, 20);
    expect(meter.seconds).toBeCloseTo(10, 1);
    expect(meter.listened).toBe(true);
  });
  it("le seuil est de 70 % de la plage", () => {
    const meter = new ListenMeter(0, 10);
    play(meter, 0, 6.5);
    expect(meter.ratio).toBeLessThan(LISTENED_RATIO);
    expect(meter.listened).toBe(false);
    play(meter, 6.5, 7.5);
    expect(meter.listened).toBe(true);
  });
  it("une pause, un saut et ce qui est hors plage ne comptent pas", () => {
    const meter = new ListenMeter(10, 20);
    for (let t = 10; t < 20; t += 0.05) meter.feed(t, false); // en pause
    play(meter, 0, 9.9); // avant la plage
    play(meter, 20, 30); // après la plage
    meter.feed(15, true); // un saut : un seul quart de seconde
    expect(meter.seconds).toBeLessThanOrEqual(0.25);
    expect(meter.listened).toBe(false);
  });
  it("des mises à jour rares (onglet masqué, 4 par seconde) comptent tout le trajet", () => {
    const meter = new ListenMeter(0, 10);
    for (let t = 0; t < 10; t += 0.25) meter.feed(t, true);
    expect(meter.ratio).toBeGreaterThan(0.95);
    const sparse = new ListenMeter(0, 10);
    for (let t = 0; t < 10; t += 0.5) sparse.feed(t, true);
    expect(sparse.listened).toBe(true);
  });
  it("avec l'horloge : des images très espacées comptent, un saut non", () => {
    const meter = new ListenMeter(0, 10);
    // un navigateur qui ne dessine qu'une image toutes les 1,5 s : la lecture avance à vitesse normale
    for (let k = 0; k <= 7; k += 1) meter.feed(k * 1.5, true, k * 1500);
    expect(meter.listened).toBe(true);
    const jumper = new ListenMeter(0, 100);
    jumper.feed(1, true, 0);
    jumper.feed(80, true, 20); // 79 s de position en 20 ms : un saut
    expect(jumper.seconds).toBeLessThanOrEqual(0.5);
  });
  it("un saut dans le fichier n'est pas une lecture", () => {
    const meter = new ListenMeter(0, 100);
    meter.feed(1, true);
    meter.feed(80, true);
    expect(meter.seconds).toBeLessThanOrEqual(0.5);
  });
  it("une pause coupe le trajet : reprendre ailleurs ne comble rien", () => {
    const meter = new ListenMeter(0, 100);
    meter.feed(1, true);
    meter.feed(1.2, false);
    meter.feed(1.6, true);
    expect(meter.seconds).toBeLessThanOrEqual(0.5);
  });
  it("une boucle ne compte pas deux fois", () => {
    const meter = new ListenMeter(0, 4);
    play(meter, 0, 2);
    play(meter, 0, 2);
    play(meter, 0, 2);
    expect(meter.seconds).toBeCloseTo(2, 1);
  });
  it("changer de plage repart de zéro ; une plage vide n'est jamais écoutée", () => {
    const meter = new ListenMeter(0, 4);
    play(meter, 0, 4);
    meter.reset(10, 14);
    expect(meter.seconds).toBe(0);
    expect(new ListenMeter(5, 5).listened).toBe(false);
  });
});
