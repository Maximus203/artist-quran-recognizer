"use client";
import { useCallback, useEffect, useState } from "react";
import {
  fetchSavedVideos,
  VIDEOS_CHANGED,
  type SavedVideo,
} from "@/lib/export-video-library";

/** Vidéos gardées sur le serveur pour cet enregistrement ; se recharge quand l'une est ajoutée ou supprimée. */
export function useSavedVideos(sessionId: string) {
  const [videos, setVideos] = useState<SavedVideo[]>([]);
  const [totalBytes, setTotalBytes] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(async () => {
    try {
      const data = await fetchSavedVideos(sessionId);
      setVideos(data.videos);
      setTotalBytes(data.total_bytes);
    } catch {
      /* la liste est un confort : un échec ne bloque pas l'export */
    } finally {
      setLoaded(true);
    }
  }, [sessionId]);
  useEffect(() => {
    void reload();
    const again = () => void reload();
    window.addEventListener(VIDEOS_CHANGED, again);
    return () => window.removeEventListener(VIDEOS_CHANGED, again);
  }, [reload]);
  return { videos, totalBytes, loaded, reload };
}
