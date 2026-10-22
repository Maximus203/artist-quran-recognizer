"use client";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PublicUser } from "@/lib/auth-response";
import { ApiError, api } from "@/lib/api-client";
import type { Preferences, PreferencesPatch } from "@/lib/preferences-schema";
import {
  PREFS_CACHE_KEY,
  PrefsSync,
  applyPatch,
  appearanceOf,
  parseCache,
  serializeCache,
  type SyncStatus,
} from "@/lib/prefs-sync";
import { resolveQuranFont, type QuranFontId } from "@/lib/quran-fonts";
import { Icon, IconSprite } from "./icons";

/**
 * Coquille commune des pages connectées : le compte, ses préférences (enregistrées côté serveur,
 * appliquées partout) et son quota. Le serveur fournit l'état initial dans le HTML (aucun
 * clignotement) ; ici on le fait vivre : changement → application immédiate, cache local, envoi
 * groupé (anti-rebond). Si le serveur est injoignable, l'interface continue avec le cache et le dit.
 */
const SAVE_DELAY_MS = 600;
const RETRY_AFTER_MS = 5000;
const RETRIES = 3;

import type { QuotaView } from "@/lib/quota-view";
export type Quota = QuotaView;

type ShellValue = {
  user: PublicUser;
  prefs: Preferences;
  update: (patch: PreferencesPatch) => void;
  /** Remet toutes les préférences à leur valeur par défaut, côté serveur. */
  reset: () => Promise<void>;
  status: SyncStatus;
  retry: () => void;
  quota: Quota;
  refreshQuota: () => Promise<void>;
  repoUrl: string;
  fontAvailability: Partial<Record<QuranFontId, boolean>>;
  /** Police arabe réellement appliquée (choix, sinon Hafs V30 si installée, sinon Amiri Quran). */
  font: QuranFontId;
  /** Vrai une fois la page montée (les mesures d'écran sont alors connues). */
  mounted: boolean;
};

const Shell = createContext<ShellValue | null>(null);

export function useShell(): ShellValue {
  const value = useContext(Shell);
  if (!value) throw new Error("useShell hors de <ShellProvider>");
  return value;
}

type Props = {
  user: PublicUser;
  preferences: Preferences;
  quota: Quota;
  repoUrl: string;
  children: React.ReactNode;
};

const readStorage = (): string | null => {
  try {
    return window.localStorage.getItem(PREFS_CACHE_KEY);
  } catch {
    return null;
  }
};

export function ShellProvider(props: Props) {
  const { user } = props;
  const [prefs, setPrefs] = useState(props.preferences);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const [status, setStatus] = useState<SyncStatus>("idle");
  const [quota, setQuota] = useState(props.quota);
  const [mounted, setMounted] = useState(false);
  const [fontAvailability, setFontAvailability] = useState<
    Partial<Record<QuranFontId, boolean>>
  >({});

  const writeCache = useCallback(
    (next: Preferences, pending: PreferencesPatch) => {
      try {
        window.localStorage.setItem(
          PREFS_CACHE_KEY,
          serializeCache(user.id, next, pending),
        );
      } catch {
        /* stockage bloqué : l'envoi au serveur suffit */
      }
    },
    [user.id],
  );

  const sync = useMemo(
    () =>
      new PrefsSync({
        delayMs: SAVE_DELAY_MS,
        send: (patch) =>
          api("/api/me/preferences", { method: "PATCH", json: patch }),
        onStatus: setStatus,
      }),
    [],
  );

  // Au montage : on reprend ce qui n'avait pas pu partir lors d'une session précédente.
  useEffect(() => {
    setMounted(true);
    const cached = parseCache(readStorage(), user.id);
    if (cached && Object.keys(cached.pending).length > 0) {
      const next = applyPatch(prefsRef.current, cached.pending);
      setPrefs(next);
      sync.restore(cached.pending);
      void sync.flush();
    } else writeCache(prefsRef.current, {});
  }, [sync, user.id, writeCache]);

  // Après chaque envoi, le cache reflète ce qui reste à envoyer.
  useEffect(() => {
    if (status === "saved" || status === "error")
      writeCache(prefsRef.current, sync.pending());
  }, [status, sync, writeCache]);

  const update = useCallback(
    (patch: PreferencesPatch) => {
      const next = applyPatch(prefsRef.current, patch);
      prefsRef.current = next;
      setPrefs(next);
      sync.schedule(patch);
      writeCache(next, sync.pending());
    },
    [sync, writeCache],
  );

  const reset = useCallback(async () => {
    sync.clear();
    try {
      const view = await api<{ preferences: Preferences }>(
        "/api/me/preferences",
        { method: "DELETE" },
      );
      prefsRef.current = view.preferences;
      setPrefs(view.preferences);
      writeCache(view.preferences, {});
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  }, [sync, writeCache]);

  const retry = useCallback(() => void sync.retry(), [sync]);

  // Échec : trois nouvelles tentatives, espacées de 5 s, puis on attend un geste de l'utilisateur.
  const attempts = useRef(0);
  useEffect(() => {
    if (status === "saved") attempts.current = 0;
    if (status !== "error" || attempts.current >= RETRIES) return;
    const timer = setTimeout(() => {
      attempts.current += 1;
      void sync.retry();
    }, RETRY_AFTER_MS);
    return () => clearTimeout(timer);
  }, [status, sync]);

  // Retour du réseau ou de l'onglet : on renvoie ce qui était resté en attente.
  useEffect(() => {
    const flushLater = () => {
      if (Object.keys(sync.pending()).length > 0) void sync.flush();
    };
    const onVisible = () => {
      if (document.visibilityState === "hidden") flushLater();
    };
    window.addEventListener("online", flushLater);
    window.addEventListener("pagehide", flushLater);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", flushLater);
      window.removeEventListener("pagehide", flushLater);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [sync]);

  // Polices sous licence installées sur ce poste.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/fonts", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { fonts: [] }))
      .then((data: { fonts?: { id: QuranFontId; available: boolean }[] }) => {
        if (!cancelled)
          setFontAvailability(
            Object.fromEntries(
              (data.fonts ?? []).map((f) => [f.id, f.available]),
            ),
          );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const font = resolveQuranFont(prefs.arabicFont, fontAvailability);

  // Apparence : thème, police et taille posés sur <html> (le serveur a posé les valeurs initiales).
  useEffect(() => {
    const root = document.documentElement;
    const look = appearanceOf(prefs);
    if (look.theme) root.setAttribute("data-theme", look.theme);
    else root.removeAttribute("data-theme");
    root.setAttribute("data-quran-font", font);
    if (look.quranSize) root.style.setProperty("--quran-size", look.quranSize);
    else root.style.removeProperty("--quran-size");
  }, [prefs, font]);

  const refreshQuota = useCallback(async () => {
    try {
      const me = await api<{ quota: Quota }>("/api/me");
      setQuota(me.quota);
    } catch {
      /* le quota se rafraîchira au prochain appel */
    }
  }, []);

  const value = useMemo<ShellValue>(
    () => ({
      user,
      prefs,
      update,
      reset,
      status,
      retry,
      quota,
      refreshQuota,
      repoUrl: props.repoUrl,
      fontAvailability,
      font,
      mounted,
    }),
    [
      user,
      prefs,
      update,
      reset,
      status,
      retry,
      quota,
      refreshQuota,
      props.repoUrl,
      fontAvailability,
      font,
      mounted,
    ],
  );

  return (
    <Shell.Provider value={value}>
      <IconSprite />
      {props.children}
      <PrefsNotice status={status} onRetry={retry} />
    </Shell.Provider>
  );
}

/**
 * Échec d'enregistrement des préférences : visible partout (sauf sur la page Compte, qui a sa propre
 * pastille), il dit que les choix sont gardés sur cet appareil et propose de réessayer. Le succès,
 * lui, reste silencieux hors de la page Compte.
 */
function PrefsNotice({
  status,
  onRetry,
}: {
  status: SyncStatus;
  onRetry: () => void;
}) {
  const pathname = usePathname();
  const onAccount = pathname.startsWith("/compte");
  const error = status === "error" && !onAccount;
  return (
    <div
      className="prefs-notice"
      role="status"
      aria-live="polite"
      data-testid="prefs-status"
      data-state={status}
      data-visible={error}
    >
      {error ? (
        <>
          <Icon name="alert" />
          <span>
            Préférences gardées sur cet appareil : enregistrement impossible
            pour l’instant.
          </span>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={onRetry}
          >
            Réessayer
          </button>
        </>
      ) : null}
    </div>
  );
}

export { ApiError };
