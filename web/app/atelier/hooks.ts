"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Store } from "@/lib/mini-store";
import { effectiveTheme, type ThemePref } from "@/lib/ui-prefs";

/** Valeur dérivée d'un magasin : le composant ne se redessine que si la valeur choisie change. */
export function useStoreValue<T, S>(
  store: Store<T>,
  select: (value: T) => S,
): S {
  return useSyncExternalStore(
    store.subscribe,
    () => select(store.get()),
    () => select(store.get()),
  );
}

/** Condition `matchMedia`, sûre côté serveur (faux avant le montage). */
export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}

/** Visibilité de l'onglet (sondage plus lent en arrière-plan). */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

/** Thème réellement affiché (pour l'icône du bouton) : le choix, ou celui du système. */
export function useEffectiveTheme(pref: ThemePref): "light" | "dark" {
  const systemDark = useMedia("(prefers-color-scheme: dark)");
  return effectiveTheme(pref, systemDark);
}

/** Ids de focus : piège de focus pour un tiroir ouvert, Échap, retour du focus au bouton. */
export function useFocusTrap(
  ref: React.RefObject<HTMLElement | null>,
  active: boolean,
  onClose: () => void,
  returnTo?: React.RefObject<HTMLElement | null>,
) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const node = ref.current;
    if (!active || !node) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () =>
      Array.from(
        node.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);
    const first = focusable()[0];
    (first ?? node).focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const head = items[0];
      const tail = items[items.length - 1];
      const current = document.activeElement;
      if (event.shiftKey && (current === head || !node.contains(current))) {
        event.preventDefault();
        tail.focus();
      } else if (
        !event.shiftKey &&
        (current === tail || !node.contains(current))
      ) {
        event.preventDefault();
        head.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      (returnTo?.current ?? previous)?.focus({ preventScroll: true });
    };
  }, [active, ref, returnTo]);
}
