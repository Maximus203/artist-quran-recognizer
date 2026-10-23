/**
 * « A-t-on écouté ce passage ? » : une correction écoutée vaut vérité terrain (ADR-0014), pas un clic au
 * hasard. Le compteur marque les quarts de seconde de la plage réellement joués ; un saut ou une pause ne
 * comptent pas, une boucle ne compte pas deux fois. Écouté = au moins 70 % de la plage. Mesuré côté
 * navigateur (aucun audio n'est envoyé nulle part).
 *
 * Les mises à jour de position ne sont pas régulières (60 Hz quand l'onglet est visible, 4 Hz quand il est
 * masqué) : entre deux mises à jour proches en lecture, tout le trajet est compté ; un écart plus grand
 * (un saut dans le fichier) ne l'est pas.
 */
export const LISTENED_RATIO = 0.7;
const BUCKET_S = 0.25;
/** Plus grand trajet continu entre deux mises à jour : au-delà, c'est un saut, pas une lecture. */
const MAX_STEP_S = 0.8;
/** Avec une horloge : vitesse de lecture maximale admise (le lecteur va jusqu'à ×2) et marge de mesure. */
const MAX_RATE = 2.5;
const SLACK_S = 0.1;

export class ListenMeter {
  private readonly seen = new Set<number>();
  private last: number | null = null;
  private lastAt: number | null = null;
  constructor(
    private start: number,
    private end: number,
  ) {}

  /** Une plage différente : on repart de zéro. */
  reset(start: number, end: number): void {
    this.start = start;
    this.end = end;
    this.seen.clear();
    this.last = null;
    this.lastAt = null;
  }

  private mark(time: number): void {
    if (time < this.start || time >= this.end) return;
    this.seen.add(Math.floor((time - this.start) / BUCKET_S));
  }

  /** À appeler à chaque mise à jour de la position ; ne compte que ce qui est joué DANS la plage. */
  feed(time: number, playing: boolean, nowMs?: number): void {
    if (!playing) {
      this.last = null;
      this.lastAt = null;
      return;
    }
    const previous = this.last;
    const previousAt = this.lastAt;
    this.last = time;
    this.lastAt = nowMs ?? null;
    this.mark(time);
    if (previous === null || time <= previous) return;
    // Avec l'horloge : le trajet est une lecture si la position n'a pas avancé plus vite que le temps
    // réel (même à vitesse 2) ; un navigateur qui ralentit ses images (volet masqué) ne fait pas un saut.
    const plausible =
      nowMs !== undefined && previousAt !== null
        ? time - previous <= ((nowMs - previousAt) / 1000) * MAX_RATE + SLACK_S
        : time - previous <= MAX_STEP_S;
    if (!plausible) return;
    for (let t = previous; t < time; t += BUCKET_S / 2) this.mark(t);
  }

  get duration(): number {
    return Math.max(0, this.end - this.start);
  }

  /** Secondes de la plage entendues. */
  get seconds(): number {
    return Math.min(this.duration, this.seen.size * BUCKET_S);
  }

  get ratio(): number {
    return this.duration > 0 ? this.seconds / this.duration : 0;
  }

  get listened(): boolean {
    return this.ratio >= LISTENED_RATIO;
  }
}
