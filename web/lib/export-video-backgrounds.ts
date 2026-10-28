/**
 * Fonds proposés pour la vidéo d'export, sans rien téléverser : dégradés dessinés à la volée
 * (aucun fichier, aucune licence) et photos libres de droits embarquées dans
 * `public/backgrounds/` (licence Pexels : usage libre, attribution non requise ; crédits dans
 * `public/backgrounds/CREDITS.md`). Les sites de photos libres ne sont jamais appelés par le
 * code : l'interface propose seulement des liens de recherche, l'image se téléverse ensuite.
 */

export type GradientBackground = {
  kind: "gradient";
  id: string;
  label: string;
  /** Du haut vers le bas : couleur de départ, d'arrivée, et halo radial discret. */
  from: string;
  to: string;
  glow: string;
  /** Teinte d'accent assortie (HSL), utilisée tant que l'utilisateur n'en choisit pas. */
  accent: { h: number; s: number; l: number; a: number };
};

export type PhotoBackground = {
  kind: "photo";
  id: string;
  label: string;
  group: "Mosquées" | "Déserts" | "Nature";
  /** Image pleine taille et vignette, relatives à la racine du site. */
  src: string;
  thumb: string;
};

export type BackgroundPreset = GradientBackground | PhotoBackground;

export const GRADIENT_BACKGROUNDS: readonly GradientBackground[] = [
  {
    kind: "gradient",
    id: "nuit-doree",
    label: "Nuit dorée",
    from: "#0d1b2a",
    to: "#16263a",
    glow: "rgba(216, 180, 90, 0.20)",
    accent: { h: 43, s: 62, l: 64, a: 1 },
  },
  {
    kind: "gradient",
    id: "emeraude",
    label: "Émeraude",
    from: "#0b2a24",
    to: "#123f35",
    glow: "rgba(120, 220, 180, 0.18)",
    accent: { h: 158, s: 55, l: 70, a: 1 },
  },
  {
    kind: "gradient",
    id: "aube",
    label: "Aube",
    from: "#2a1f3d",
    to: "#4a2c4d",
    glow: "rgba(255, 170, 120, 0.22)",
    accent: { h: 20, s: 85, l: 74, a: 1 },
  },
  {
    kind: "gradient",
    id: "sable",
    label: "Sable sombre",
    from: "#2b2218",
    to: "#3d3022",
    glow: "rgba(240, 200, 130, 0.20)",
    accent: { h: 38, s: 62, l: 68, a: 1 },
  },
  {
    kind: "gradient",
    id: "ardoise",
    label: "Ardoise",
    from: "#1a1d23",
    to: "#2a2f38",
    glow: "rgba(160, 180, 210, 0.16)",
    accent: { h: 210, s: 55, l: 76, a: 1 },
  },
] as const;

const photo = (
  id: string,
  label: string,
  group: PhotoBackground["group"],
): PhotoBackground => ({
  kind: "photo",
  id,
  label,
  group,
  src: `/backgrounds/${id}.jpg`,
  thumb: `/backgrounds/thumb-${id}.jpg`,
});

export const PHOTO_BACKGROUNDS: readonly PhotoBackground[] = [
  photo("mosquee-crepuscule", "Mosquée au crépuscule", "Mosquées"),
  photo("mosquee-arche-bleue", "Arche bleue", "Mosquées"),
  photo("mosquee-minarets", "Minarets", "Mosquées"),
  photo("mosquee-faience", "Faïences", "Mosquées"),
  photo("desert-dunes", "Dunes dorées", "Déserts"),
  photo("desert-nuit", "Dunes sombres", "Déserts"),
  photo("ciel-orange", "Ciel orangé", "Nature"),
  photo("foret-brume", "Forêt dans la brume", "Nature"),
  photo("foret-lumiere", "Forêt en lumière", "Nature"),
];

export const BACKGROUND_PRESETS: readonly BackgroundPreset[] = [
  ...GRADIENT_BACKGROUNDS,
  ...PHOTO_BACKGROUNDS,
];

/** Fond par défaut quand rien n'est choisi (jamais le noir illisible d'avant). */
export const DEFAULT_BACKGROUND_ID = "nuit-doree";
/** Identifiant du choix « la vidéo d'origine sert de fond » (sessions importées en vidéo). */
export const SOURCE_BACKGROUND_ID = "source";

export function findBackground(
  id: string | null | undefined,
): BackgroundPreset | null {
  return BACKGROUND_PRESETS.find((preset) => preset.id === id) ?? null;
}

/** Sites de photos libres : lien de recherche à ouvrir dans un nouvel onglet. */
export const FREE_IMAGE_SITES = [
  {
    name: "Unsplash",
    note: "libre d'usage",
    url: "https://unsplash.com/s/photos/mosque",
  },
  {
    name: "Pexels",
    note: "libre d'usage",
    url: "https://www.pexels.com/search/mosque/",
  },
  {
    name: "Pixabay",
    note: "libre d'usage",
    url: "https://pixabay.com/images/search/mosque/",
  },
  {
    name: "Freepik",
    note: "attribution requise",
    url: "https://www.freepik.com/search?query=mosque&type=photo",
  },
] as const;

/** Peint un fond dégradé (ctx de n'importe quelle taille). */
export function paintGradientBackground(
  ctx: CanvasRenderingContext2D,
  preset: GradientBackground,
  width: number,
  height: number,
): void {
  const linear = ctx.createLinearGradient(0, 0, 0, height);
  linear.addColorStop(0, preset.from);
  linear.addColorStop(1, preset.to);
  ctx.fillStyle = linear;
  ctx.fillRect(0, 0, width, height);
  const radius = Math.max(width, height) * 0.7;
  const halo = ctx.createRadialGradient(
    width / 2,
    height * 0.38,
    0,
    width / 2,
    height * 0.38,
    radius,
  );
  halo.addColorStop(0, preset.glow);
  halo.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, width, height);
}

export type BackgroundChoice =
  | { kind: "upload" }
  | { kind: "source" }
  | { kind: "color" }
  | { kind: "preset"; preset: BackgroundPreset };

/**
 * Quel fond appliquer. Une image téléversée gagne toujours (choisir un fond proposé la retire) ;
 * sinon le choix mémorisé ; sinon, sans choix, la vidéo d'origine pour une session vidéo, et le
 * dégradé par défaut pour une session audio.
 */
export function chooseBackground(
  saved: string | null | undefined,
  context: { hasUpload: boolean; isVideo: boolean },
): BackgroundChoice {
  if (context.hasUpload) return { kind: "upload" };
  if (saved === "color") return { kind: "color" };
  if (saved === SOURCE_BACKGROUND_ID && context.isVideo)
    return { kind: "source" };
  const preset = findBackground(saved);
  if (preset) return { kind: "preset", preset };
  if (context.isVideo) return { kind: "source" };
  return {
    kind: "preset",
    preset: findBackground(DEFAULT_BACKGROUND_ID) as BackgroundPreset,
  };
}
