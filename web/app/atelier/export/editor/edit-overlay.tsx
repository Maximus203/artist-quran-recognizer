"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import {
  blocksAt,
  cycleBlock,
  handlePlacements,
  hitLayout,
  overlappingBlocks,
  stepSize,
  type FrameRect,
  type Guide,
  type Handle,
  type Visibility,
} from "@/lib/export-video-edit";
import {
  BLOCK_LABEL,
  BLOCK_SHORT,
  describePlacement,
  describeSize,
  sizeLockedBlock,
  type FitReport,
} from "@/lib/export-video-edit-text";
import {
  createGesture,
  keyAction,
  type Gesture,
  type GestureEffect,
  type GesturePhase,
  type GestureTarget,
} from "@/lib/export-video-gesture";
import {
  BLOCK_IDS,
  type BlockId,
  type Box,
  type ExportLayout,
  type TextBlockId,
} from "@/lib/export-video-model";
import { BLOCK_ICON, EIcon } from "./editor-icons";

/**
 * Le calque d'édition : des zones DOM transparentes posées PAR-DESSUS l'aperçu (qui reste la vraie
 * `drawFrame`, donc fidèle au rendu final). Une zone par élément affiché (arabe, traduction, onde, sourate
 * et verset), construite sur la boîte de la mise en page. Il porte, au tactile comme à la souris et au
 * clavier :
 *  - choisir un élément (toucher, clic, Entrée) ; toucher encore au même endroit passe à l'élément
 *    d'en dessous quand plusieurs se chevauchent ;
 *  - glisser, avec aimants sur le centre et les marges et repères visibles ;
 *  - huit poignées pour changer la zone, de 44 px de zone tactile, posées à l'extérieur ;
 *  - pincer à deux doigts : la taille du texte ;
 *  - clavier : flèches 1 % (Maj 5 %), Ctrl + flèches = la zone, + et − = taille, Échap ;
 *  - une région `aria-live` qui annonce chaque geste.
 *
 * COMPOSANT PARTAGÉ : il ne sait rien du Plateau. Il reçoit la mise en page et l'élément choisi, rend
 * des événements (`onSelect`, `onBox`, `onSize`) et n'écrit jamais dans les réglages : c'est le parent
 * qui garde un brouillon pendant le geste (`phase: "live"`), l'enregistre à `"end"` et le rejette à
 * `"cancel"`. La logique (seuils, aimants, pincement, annulation) est dans `export-video-gesture.ts`,
 * sans DOM ; ce fichier ne fait que brancher les Pointer Events dessus.
 *
 * Défilement : la page défile partout SAUF sur les éléments et les poignées (`touch-action: none` sur
 * elles, `pan-y` sur le reste), donc glisser un élément ne fait jamais bouger la page.
 */

export type EditOverlayProps = {
  /** La mise en page (quatre boîtes en fractions du cadre) du format montré, brouillon compris. */
  layout: ExportLayout;
  /** Quels éléments sont dans l'aperçu : un élément masqué n'a pas de zone. */
  visible: Visibility;
  selected: BlockId | null;
  /** Taille relative de chaque texte : le pincement et + / − partent d'elle. */
  sizes: Partial<Record<TextBlockId, number>>;
  /** Ce que l'ajustement du texte à sa zone a fait (« réduit à 87 % »), pour l'étiquette. */
  fit?: FitReport;
  onSelect: (id: BlockId | null) => void;
  onBox: (id: BlockId, box: Box, phase: GesturePhase) => void;
  onSize: (id: BlockId, size: number, phase: GesturePhase) => void;
  /** Aide du premier affichage : la main qui touche cet élément (le parent la retire). */
  coach?: BlockId | null;
  /** Hors service (lecture de l'aperçu animé en cours, export…) : les zones n'attrapent plus rien. */
  disabled?: boolean;
};

const percentStyle = (box: Box): CSSProperties => ({
  left: `${box.x * 100}%`,
  top: `${box.y * 100}%`,
  width: `${box.w * 100}%`,
  height: `${box.h * 100}%`,
});

function frameRectOf(node: HTMLElement | null): FrameRect {
  const rect = node?.getBoundingClientRect();
  return rect
    ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    : { left: 0, top: 0, width: 0, height: 0 };
}

const zoneHint = (id: BlockId): string =>
  id === "wave"
    ? "Flèches : déplacer. Ctrl et flèches : changer la zone. Échap : désélectionner."
    : "Flèches : déplacer. Ctrl et flèches : changer la zone. Plus et moins : taille du texte. Échap : désélectionner.";

export function EditOverlay(props: EditOverlayProps) {
  const { layout, visible, selected, fit, disabled } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [message, setMessage] = useState("");
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const [active, setActive] = useState(false);
  const toggle = useRef(false);

  // Ce que le geste lit à chaque événement : toujours le plus récent, sans réécouter les événements.
  const latest = useRef(props);
  latest.current = props;
  const pressedSelected = useRef(false);

  const announce = useCallback((text: string) => {
    toggle.current = !toggle.current;
    // Le même texte deux fois de suite doit être annoncé deux fois : un caractère invisible l'alterne.
    setMessage(text + (toggle.current ? "​" : ""));
  }, []);

  const apply = useCallback(
    (effects: GestureEffect[]) => {
      const p = latest.current;
      for (const effect of effects) {
        switch (effect.type) {
          case "select":
            p.onSelect(effect.id);
            break;
          case "tap": {
            // Toucher encore l'élément déjà choisi : passe à celui d'en dessous s'il y en a plusieurs.
            if (!pressedSelected.current) break;
            const under = blocksAt(
              hitLayout(p.layout, frameRectOf(rootRef.current)),
              effect.point,
              p.visible,
            );
            if (under.length > 1) {
              const next = cycleBlock(under, effect.id);
              if (next && next !== effect.id) {
                p.onSelect(next);
                announce(`${BLOCK_LABEL[next]} choisi.`);
              }
            }
            break;
          }
          case "box":
            p.onBox(effect.id, effect.box, effect.phase);
            setGuides(effect.phase === "live" ? effect.guides : []);
            break;
          case "size":
            p.onSize(effect.id, effect.size, effect.phase);
            break;
          case "announce":
            announce(effect.text);
            break;
        }
      }
    },
    [announce],
  );

  const gesture = useRef<Gesture | null>(null);
  if (gesture.current === null)
    gesture.current = createGesture({
      frame: () => frameRectOf(rootRef.current),
      box: (id) => latest.current.layout[id],
      size: (id) =>
        sizeLockedBlock(id) ? null : (latest.current.sizes[id] ?? null),
      selected: () => latest.current.selected,
    });

  // Démontage ou désactivation en plein geste : on l'annule proprement (le brouillon est rejeté).
  useEffect(() => {
    const current = gesture.current;
    return () => {
      if (current) apply(current.reset());
    };
  }, [apply]);
  useEffect(() => {
    if (disabled && gesture.current) {
      apply(gesture.current.reset());
      setActive(false);
    }
  }, [disabled, apply]);

  // La taille du cadre à l'écran : place des poignées (une boîte étroite écarte les siennes).
  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const measure = () =>
      setFrame({ width: node.clientWidth, height: node.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  function targetAt(event: PointerEvent<HTMLElement>): GestureTarget {
    const p = latest.current;
    const handle = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-handle]",
    );
    if (handle?.dataset.block && handle.dataset.handle)
      return {
        kind: "handle",
        id: handle.dataset.block as BlockId,
        handle: handle.dataset.handle as Handle,
      };
    const rect = frameRectOf(rootRef.current);
    if (!(rect.width > 0) || !(rect.height > 0)) return { kind: "background" };
    const point = {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    };
    const under = blocksAt(hitLayout(p.layout, rect), point, p.visible);
    // Glisser un élément déjà choisi le déplace, même si un plus petit se trouve dessous.
    const id = p.selected && under.includes(p.selected) ? p.selected : under[0];
    return id ? { kind: "block", id } : { kind: "background" };
  }

  const sample = (event: PointerEvent<HTMLElement>) => ({
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    pointerType: event.pointerType,
    altKey: event.altKey,
    button: event.pointerType === "mouse" ? event.button : undefined,
  });

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (disabled || !gesture.current) return;
    const target = targetAt(event);
    pressedSelected.current =
      target.kind === "block" && latest.current.selected === target.id;
    const effects = gesture.current.down(sample(event), target);
    if (gesture.current.active !== "idle") {
      try {
        rootRef.current?.setPointerCapture(event.pointerId);
      } catch {
        // Un pointeur déjà fini (rare) : le geste ira jusqu'à son relâcher sans capture.
      }
      setActive(true);
    }
    apply(effects);
  }
  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!gesture.current) return;
    apply(gesture.current.move(sample(event)));
  }
  function finish(event: PointerEvent<HTMLDivElement>, cancelled: boolean) {
    const g = gesture.current;
    if (!g) return;
    const effects = cancelled ? g.cancel(sample(event)) : g.up(sample(event));
    apply(effects);
    if (g.active === "idle") {
      setActive(false);
      setGuides([]);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>, id: BlockId) {
    const p = latest.current;
    const size = sizeLockedBlock(id) ? null : (p.sizes[id] ?? null);
    const action = keyAction(
      event.key,
      { shift: event.shiftKey, ctrl: event.ctrlKey, meta: event.metaKey },
      p.layout[id],
      size !== null,
    );
    if (!action) return;
    event.preventDefault();
    if (p.selected !== id) p.onSelect(id);
    switch (action.type) {
      case "box":
        p.onBox(id, action.box, "end");
        announce(describePlacement(id, action.box));
        break;
      case "size": {
        if (size === null || sizeLockedBlock(id)) break;
        const next = stepSize(size, action.direction);
        p.onSize(id, next, "end");
        announce(describeSize(id, next));
        break;
      }
      case "escape":
        p.onSelect(null);
        announce("Plus aucun élément choisi.");
        break;
      case "pick":
        p.onSelect(id);
        break;
    }
  }

  const shown = BLOCK_IDS.filter((id) => visible[id] !== false);
  const overlapping = overlappingBlocks(layout, visible);
  // Les zones qu'on attrape ont 44 px au moins (une ligne de sourate n'en fait que 11) ; le cadre de sélection, lui, garde la vraie boîte.
  const hits = hitLayout(layout, frame);
  const selectedBox =
    selected && visible[selected] !== false ? layout[selected] : null;

  return (
    <div
      ref={rootRef}
      className="xe-overlay"
      role="group"
      aria-label="Éléments de la vidéo : touche un élément pour le choisir, puis tire-le, ou utilise les flèches du clavier"
      data-testid="edit-overlay"
      data-active={active || undefined}
      data-disabled={disabled || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => finish(event, false)}
      onPointerCancel={(event) => finish(event, true)}
      onLostPointerCapture={(event) => {
        // Capture perdue sans relâcher (élément retiré, fenêtre quittée) : geste annulé, jamais figé.
        if (gesture.current?.active !== "idle") finish(event, true);
      }}
    >
      {shown.map((id) => (
        <div
          key={id}
          className="xe-zone"
          role="button"
          tabIndex={disabled ? -1 : 0}
          aria-pressed={selected === id}
          aria-label={`${BLOCK_LABEL[id]}. ${zoneHint(id)}`}
          aria-description={
            overlapping.includes(id)
              ? "Plusieurs éléments se chevauchent ici : touche encore pour choisir le suivant."
              : undefined
          }
          data-block={id}
          data-selected={selected === id || undefined}
          data-overlap={overlapping.includes(id) || undefined}
          data-testid={`zone-${id}`}
          style={percentStyle(hits[id])}
          onKeyDown={(event) => onKeyDown(event, id)}
          onFocus={() => {
            if (latest.current.selected !== id) latest.current.onSelect(id);
          }}
        />
      ))}

      {selected && selectedBox ? (
        <SelectionFrame
          id={selected}
          box={selectedBox}
          frame={frame}
          note={
            selected === "wave"
              ? null
              : (fit?.[selected as TextBlockId]?.note ?? null)
          }
          overflow={
            selected === "wave"
              ? false
              : Boolean(fit?.[selected as TextBlockId]?.overflow)
          }
        />
      ) : null}

      {guides.map((guide) => (
        <i
          key={`${guide.axis}-${guide.at}`}
          className={`xe-guide xe-guide--${guide.axis}`}
          data-kind={guide.kind}
          style={
            guide.axis === "x"
              ? { left: `${guide.at * 100}%` }
              : { top: `${guide.at * 100}%` }
          }
          aria-hidden="true"
        />
      ))}

      {props.coach && visible[props.coach] !== false ? (
        <span
          className="xe-coach"
          aria-hidden="true"
          style={{
            left: `${(layout[props.coach].x + layout[props.coach].w / 2) * 100}%`,
            top: `${(layout[props.coach].y + layout[props.coach].h / 2) * 100}%`,
          }}
        >
          <EIcon name="hand" size={34} />
        </span>
      ) : null}

      <div
        className="sr"
        role="status"
        aria-live="polite"
        data-testid="edit-live"
      >
        {message}
      </div>
    </div>
  );
}

/** Le cadre de l'élément choisi : étiquette et poignées de 44 px, posées à l'extérieur (`handlePlacements`). */
function SelectionFrame({
  id,
  box,
  frame,
  note,
  overflow,
}: {
  id: BlockId;
  box: Box;
  frame: { width: number; height: number };
  note: string | null;
  overflow: boolean;
}) {
  return (
    <div
      className="xe-sel"
      style={percentStyle(box)}
      data-testid="edit-selection"
      data-block={id}
      data-below={box.y < 0.09 || undefined}
    >
      <span className="xe-tag" data-overflow={overflow || undefined}>
        <EIcon name={BLOCK_ICON[id]} size={16} />
        {BLOCK_SHORT[id]}
        {overflow ? (
          <em> · zone trop petite</em>
        ) : note && note.startsWith("réduit") ? (
          <em> · {note}</em>
        ) : null}
      </span>
      {handlePlacements(box, frame).map((place) => (
        <i
          key={place.handle}
          className="xe-h"
          data-handle={place.handle}
          data-block={id}
          data-testid={`handle-${place.handle}`}
          style={{
            left: `${place.left}%`,
            top: `${place.top}%`,
            transform: `translate(calc(-50% + ${place.dx}px), calc(-50% + ${place.dy}px))`,
          }}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}
