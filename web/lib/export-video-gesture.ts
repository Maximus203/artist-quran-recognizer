/**
 * Les gestes sur l'aperçu de la vidéo d'export, sans DOM : une petite machine à états qui reçoit des
 * échantillons de pointeurs (appui, déplacement, relâchement, annulation) et rend des EFFETS (choisir,
 * déplacer, redimensionner, changer la taille du texte, annoncer). Le calque d'édition de l'interface
 * (`edit-overlay.tsx`) ne fait que brancher les Pointer Events dessus : tout ce qui est logique (seuil
 * de glissement, aimants, pincement, annulation propre) se teste à froid et se réutilise tel quel dans
 * la table de montage et le pas à pas.
 *
 * Les calculs sont ceux du noyau (`export-video-edit.ts`) : un geste donne le même résultat que le clavier,
 * la croix directionnelle et les champs de l'inspecteur.
 *
 * Contrat des phases d'un effet `box` ou `size` : `live` pendant le geste (l'interface montre, sans rien
 * enregistrer), `end` au relâcher (elle enregistre), `cancel` quand le geste est interrompu (elle rejette
 * le brouillon : la valeur de départ est rendue dans l'effet).
 */
import {
  SNAP_PX,
  deltaToFraction,
  moveBox,
  nudgeBox,
  pinchSize,
  pointToFraction,
  resizeBox,
  touchDistance,
  type FrameRect,
  type Guide,
  type Handle,
} from "./export-video-edit";
import { describePlacement, describeSize } from "./export-video-edit-text";
import type { BlockId, Box } from "./export-video-model";

/** Ce que le pointeur a touché à l'appui. */
export type GestureTarget =
  | { kind: "block"; id: BlockId }
  | { kind: "handle"; id: BlockId; handle: Handle }
  | { kind: "background" };

/** Un échantillon de pointeur, en pixels d'écran (`clientX`, `clientY`). */
export type PointerSample = {
  id: number;
  x: number;
  y: number;
  pointerType?: string;
  /** Alt enfoncé : l'aimant est coupé. */
  altKey?: boolean;
  /** Bouton de la souris à l'appui (0 = principal) ; absent = doigt ou stylet. */
  button?: number;
};

/** L'interface prête au geste l'état courant au lieu de le lui donner : il lit toujours le plus récent. */
export type GestureHost = {
  /** Rectangle du cadre à l'écran, au moment de l'événement. */
  frame: () => FrameRect;
  /** Boîte actuelle d'un bloc (fractions du cadre). */
  box: (id: BlockId) => Box;
  /** Taille relative du texte d'un bloc ; `null` pour un bloc sans taille de texte (l'onde). */
  size: (id: BlockId) => number | null;
  /** Élément choisi. */
  selected: () => BlockId | null;
};

export type GesturePhase = "live" | "end" | "cancel";

export type GestureEffect =
  | { type: "select"; id: BlockId | null }
  | { type: "tap"; id: BlockId; point: { x: number; y: number } }
  | {
      type: "box";
      id: BlockId;
      box: Box;
      guides: Guide[];
      phase: GesturePhase;
    }
  | { type: "size"; id: BlockId; size: number; phase: GesturePhase }
  | { type: "announce"; text: string };

export type GestureOptions = {
  /** Seuil de l'aimant, en pixels d'écran (défaut `SNAP_PX`). */
  snapPx?: number;
  /** Distance sous laquelle un appui reste un « toucher » (px) : souris, doigt. */
  slopMouse?: number;
  slopTouch?: number;
  /** Écart minimal entre les deux doigts au départ d'un pincement (px) : en deçà, le rapport n'a pas de sens. */
  minPinchPx?: number;
};

export type GestureState = "idle" | "press" | "move" | "resize" | "pinch";

type Point = { x: number; y: number };

type Mode =
  | { kind: "idle" }
  | {
      kind: "press";
      pointer: number;
      target: GestureTarget;
      start: Point;
      slop: number;
    }
  | {
      kind: "move";
      pointer: number;
      id: BlockId;
      start: Point;
      startBox: Box;
    }
  | {
      kind: "resize";
      pointer: number;
      id: BlockId;
      handle: Handle;
      start: Point;
      startBox: Box;
    }
  | {
      kind: "pinch";
      pointers: [number, number];
      id: BlockId;
      startSize: number;
      startDistance: number;
    }
  /** Un fond glissé : la page défile, on ne touche à rien (ni choix ni déplacement) jusqu'au relâcher. */
  | { kind: "scroll"; pointer: number }
  /** Après un pincement : on attend que tous les doigts soient levés avant d'accepter un nouveau geste. */
  | { kind: "drain" };

export type Gesture = {
  down: (sample: PointerSample, target: GestureTarget) => GestureEffect[];
  move: (sample: PointerSample) => GestureEffect[];
  up: (sample: PointerSample) => GestureEffect[];
  cancel: (sample: PointerSample) => GestureEffect[];
  /** Démontage : annule le geste en cours et oublie les pointeurs. */
  reset: () => GestureEffect[];
  readonly active: GestureState;
};

const DEFAULTS = {
  snapPx: SNAP_PX,
  slopMouse: 4,
  slopTouch: 8,
  minPinchPx: 10,
} as const;

export function createGesture(
  host: GestureHost,
  options: GestureOptions = {},
): Gesture {
  const config = { ...DEFAULTS, ...options };
  const pointers = new Map<number, Point>();
  let mode: Mode = { kind: "idle" };

  const idle = (): void => {
    mode = pointers.size > 0 ? { kind: "drain" } : { kind: "idle" };
  };
  const at = (sample: PointerSample): Point => ({ x: sample.x, y: sample.y });

  /** Le déplacement ou le redimensionnement à la position actuelle du pointeur. */
  function drag(
    current: Mode & { kind: "move" | "resize" },
    sample: PointerSample,
  ): GestureEffect[] {
    const frame = host.frame();
    const delta = deltaToFraction(
      { dx: sample.x - current.start.x, dy: sample.y - current.start.y },
      frame,
    );
    // Un cadre n'est pas carré : le même nombre de pixels vaut un seuil par axe.
    const snap = sample.altKey ? 0 : config.snapPx / Math.max(1, frame.width);
    const snapY = sample.altKey ? 0 : config.snapPx / Math.max(1, frame.height);
    const result =
      current.kind === "move"
        ? moveBox(current.startBox, delta, { snap, snapY })
        : resizeBox(current.startBox, current.handle, delta, { snap, snapY });
    return [
      {
        type: "box",
        id: current.id,
        box: result.box,
        guides: result.guides,
        phase: "live",
      },
    ];
  }

  function down(sample: PointerSample, target: GestureTarget): GestureEffect[] {
    if (sample.button !== undefined && sample.button > 0) return [];
    if (pointers.has(sample.id) || pointers.size >= 2) return [];

    if (pointers.size === 1 && mode.kind !== "drain") return startPinch(sample);

    pointers.set(sample.id, at(sample));
    if (mode.kind === "drain") return [];

    const slop =
      sample.pointerType === "touch" ? config.slopTouch : config.slopMouse;
    if (target.kind === "handle") {
      if (host.selected() !== target.id) {
        pointers.delete(sample.id);
        return [];
      }
      mode = {
        kind: "press",
        pointer: sample.id,
        target,
        start: at(sample),
        slop,
      };
      return [];
    }
    mode = {
      kind: "press",
      pointer: sample.id,
      target,
      start: at(sample),
      slop,
    };
    if (target.kind === "block" && host.selected() !== target.id)
      return [{ type: "select", id: target.id }];
    return [];
  }

  /** Le deuxième doigt arrive : pincement sur l'élément choisi (ou celui qu'on touchait), s'il a un texte. */
  function startPinch(sample: PointerSample): GestureEffect[] {
    const effects: GestureEffect[] = [];
    let id: BlockId | null = null;
    let first: number | null = null;
    if (mode.kind === "press" && mode.target.kind === "block") {
      id = mode.target.id;
      first = mode.pointer;
    } else if (mode.kind === "move") {
      id = mode.id;
      first = mode.pointer;
    } else if (mode.kind === "press" && mode.target.kind === "background") {
      id = host.selected();
      first = mode.pointer;
    }
    const startSize = id === null ? null : host.size(id);
    const firstPoint = first === null ? undefined : pointers.get(first);
    if (id === null || startSize === null || first === null || !firstPoint) {
      // Pas de texte à pincer (l'onde, un fond, une poignée) : ce doigt-là est suivi mais sans effet.
      pointers.set(sample.id, at(sample));
      return effects;
    }
    const startDistance = touchDistance(firstPoint, at(sample));
    if (startDistance < config.minPinchPx) {
      pointers.set(sample.id, at(sample));
      return effects;
    }
    pointers.set(sample.id, at(sample));
    // Un glissement déjà commencé est rendu à sa place : le pincement part d'une position propre.
    if (mode.kind === "move")
      effects.push({
        type: "box",
        id: mode.id,
        box: mode.startBox,
        guides: [],
        phase: "cancel",
      });
    mode = {
      kind: "pinch",
      pointers: [first, sample.id],
      id,
      startSize,
      startDistance,
    };
    return effects;
  }

  function move(sample: PointerSample): GestureEffect[] {
    if (!pointers.has(sample.id)) return [];
    pointers.set(sample.id, at(sample));
    switch (mode.kind) {
      case "press": {
        if (mode.pointer !== sample.id) return [];
        const travelled = touchDistance(mode.start, at(sample));
        if (travelled <= mode.slop) return [];
        const { target, start, pointer } = mode;
        if (target.kind === "background") {
          mode = { kind: "scroll", pointer };
          return [];
        }
        mode =
          target.kind === "handle"
            ? {
                kind: "resize",
                pointer,
                id: target.id,
                handle: target.handle,
                start,
                startBox: host.box(target.id),
              }
            : {
                kind: "move",
                pointer,
                id: target.id,
                start,
                startBox: host.box(target.id),
              };
        return drag(mode, sample);
      }
      case "move":
      case "resize":
        return mode.pointer === sample.id ? drag(mode, sample) : [];
      case "pinch": {
        const [a, b] = mode.pointers;
        const pa = pointers.get(a);
        const pb = pointers.get(b);
        if (!pa || !pb) return [];
        return [
          {
            type: "size",
            id: mode.id,
            size: pinchSize(
              mode.startSize,
              mode.startDistance,
              touchDistance(pa, pb),
            ),
            phase: "live",
          },
        ];
      }
      default:
        return [];
    }
  }

  function up(sample: PointerSample): GestureEffect[] {
    if (!pointers.has(sample.id)) return [];
    pointers.set(sample.id, at(sample));
    const effects: GestureEffect[] = [];
    switch (mode.kind) {
      case "press":
        if (mode.pointer === sample.id) {
          const { target } = mode;
          if (target.kind === "block")
            effects.push({
              type: "tap",
              id: target.id,
              point: pointToFraction(at(sample), host.frame()),
            });
          else if (target.kind === "background")
            effects.push({ type: "select", id: null });
        }
        break;
      case "move":
      case "resize":
        if (mode.pointer === sample.id) {
          const [live] = drag(mode, sample) as Extract<
            GestureEffect,
            { type: "box" }
          >[];
          effects.push(
            { ...live, guides: [], phase: "end" },
            { type: "announce", text: describePlacement(mode.id, live.box) },
          );
        }
        break;
      case "pinch":
        if (mode.pointers.includes(sample.id)) {
          const [a, b] = mode.pointers;
          const pa = a === sample.id ? at(sample) : pointers.get(a);
          const pb = b === sample.id ? at(sample) : pointers.get(b);
          const size =
            pa && pb
              ? pinchSize(
                  mode.startSize,
                  mode.startDistance,
                  touchDistance(pa, pb),
                )
              : mode.startSize;
          effects.push(
            { type: "size", id: mode.id, size, phase: "end" },
            { type: "announce", text: describeSize(mode.id, size) },
          );
        }
        break;
      default:
        break;
    }
    pointers.delete(sample.id);
    const owner =
      mode.kind === "pinch"
        ? mode.pointers.includes(sample.id)
        : "pointer" in mode && mode.pointer === sample.id;
    if (owner) idle();
    else if (pointers.size === 0) mode = { kind: "idle" };
    return effects;
  }

  function cancelCurrent(): GestureEffect[] {
    switch (mode.kind) {
      case "move":
      case "resize":
        return [
          {
            type: "box",
            id: mode.id,
            box: mode.startBox,
            guides: [],
            phase: "cancel",
          },
        ];
      case "pinch":
        return [
          {
            type: "size",
            id: mode.id,
            size: mode.startSize,
            phase: "cancel",
          },
        ];
      default:
        return [];
    }
  }

  function cancel(sample: PointerSample): GestureEffect[] {
    if (!pointers.has(sample.id)) return [];
    const effects = cancelCurrent();
    pointers.delete(sample.id);
    idle();
    return effects;
  }

  function reset(): GestureEffect[] {
    const effects = cancelCurrent();
    pointers.clear();
    mode = { kind: "idle" };
    return effects;
  }

  return {
    down,
    move,
    up,
    cancel,
    reset,
    get active(): GestureState {
      return mode.kind === "drain" || mode.kind === "scroll"
        ? "idle"
        : mode.kind;
    },
  };
}

// ── clavier ─────────────────────────────────────────────────────────────────

export type KeyAction =
  /** Une flèche : la boîte déplacée (`zone` faux) ou sa zone changée (Ctrl / Cmd, `zone` vrai). */
  | { type: "box"; box: Box; zone: boolean }
  | { type: "size"; direction: 1 | -1 }
  | { type: "escape" }
  | { type: "pick" };

/**
 * Ce que fait une touche sur un élément choisi : flèches (1 %, Maj 5 %), Ctrl ou Cmd + flèches (la
 * zone), + et − (taille du texte, seulement si l'élément en a une), Échap, Entrée et Espace. Les autres
 * touches (Tab…) reviennent à `null` : elles restent au navigateur.
 */
export function keyAction(
  key: string,
  modifiers: { shift?: boolean; ctrl?: boolean; meta?: boolean },
  box: Box,
  canSize: boolean,
): KeyAction | null {
  const zone = Boolean(modifiers.ctrl || modifiers.meta);
  const nudged = nudgeBox(box, key, { shift: modifiers.shift, ctrl: zone });
  if (nudged) return { type: "box", box: nudged, zone };
  if (key === "+" || key === "=")
    return canSize ? { type: "size", direction: 1 } : null;
  if (key === "-" || key === "_")
    return canSize ? { type: "size", direction: -1 } : null;
  if (key === "Escape") return { type: "escape" };
  if (key === "Enter" || key === " ") return { type: "pick" };
  return null;
}
