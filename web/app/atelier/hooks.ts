"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { Store } from "@/lib/mini-store";
import {
  DEFAULT_PREFS,
  UI_STORAGE_KEY,
  clampQuranSize,
  effectiveTheme,
  parsePrefs,
  serializePrefs,
  type UiPrefs,
} from "@/lib/ui-prefs";
import { resolveQuranFont, type QuranFontId } from "@/lib/quran-fonts";

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

/**
 * Préférences d'interface mémorisées (`aqr.ui.v1`). Lues après le montage (jamais pendant le rendu
 * serveur) ; un stockage bloqué (fenêtre privée) ne casse rien : on garde les valeurs en mémoire.
 */
export function usePrefs() {
  const [prefs, setPrefs] = useState<UiPrefs>(DEFAULT_PREFS);
  const [ready, setReady] = useState(false);
  const loaded = useRef(false);
  useEffect(() => {
    try {
      setPrefs(parsePrefs(window.localStorage.getItem(UI_STORAGE_KEY)));
    } catch {
      /* stockage indisponible : valeurs par défaut */
    }
    loaded.current = true;
    setReady(true);
  }, []);
  const update = useCallback((patch: Partial<UiPrefs>) => {
    setPrefs((current) => {
      const next = { ...current, ...patch };
      try {
        window.localStorage.setItem(UI_STORAGE_KEY, serializePrefs(next));
      } catch {
        /* non bloquant */
      }
      return next;
    });
  }, []);
  return { prefs, ready, update };
}

/** Polices sous licence installées sur ce poste (`GET /api/fonts`). */
export function useFontAvailability() {
  const [availability, setAvailability] = useState<
    Partial<Record<QuranFontId, boolean>>
  >({});
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/fonts", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { fonts: [] }))
      .then((data: { fonts?: { id: QuranFontId; available: boolean }[] }) => {
        if (cancelled) return;
        setAvailability(
          Object.fromEntries(
            (data.fonts ?? []).map((f) => [f.id, f.available]),
          ),
        );
      })
      .catch(() => undefined)
      .finally(() => !cancelled && setChecked(true));
    return () => {
      cancelled = true;
    };
  }, []);
  return { availability, checked };
}

/** Applique thème, police arabe et taille sur <html> (le script d'amorçage a déjà posé les valeurs initiales). */
export function useAppearance(
  prefs: UiPrefs,
  availability: Partial<Record<QuranFontId, boolean>>,
  ready: boolean,
) {
  const font = resolveQuranFont(prefs.font, availability);
  useEffect(() => {
    if (!ready) return;
    const root = document.documentElement;
    if (prefs.theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", prefs.theme);
    root.setAttribute("data-quran-font", font);
    if (prefs.size === null) root.style.removeProperty("--quran-size");
    else
      root.style.setProperty("--quran-size", `${clampQuranSize(prefs.size)}px`);
  }, [prefs.theme, prefs.size, font, ready]);
  return font;
}

/** Thème réellement affiché (pour l'icône du bouton). */
export function useEffectiveTheme(prefs: UiPrefs): "light" | "dark" {
  const systemDark = useMedia("(prefers-color-scheme: dark)");
  return effectiveTheme(prefs.theme, systemDark);
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
