"use client";
import { useEffect, useState } from "react";
import {
  queueNoticeLines,
  type QueueNoticeInput,
} from "@/lib/queue-notice-text";
import { Icon } from "./icons";

const BUSY_MS = 6000;
const IDLE_MS = 15000;

/**
 * Pastille de la file : dit à l'utilisateur QU'IL ATTEND ET POURQUOI (sa position, l'attente estimée,
 * ou « le système est occupé »), sans jamais montrer le titre, le nom ou l'identifiant d'une
 * génération privée d'un autre compte. Interroge `/api/queue` tant que la page est visible.
 */
export function QueueNotice() {
  const [status, setStatus] = useState<QueueNoticeInput | null>(null);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      let next = IDLE_MS;
      if (document.visibilityState === "visible") {
        try {
          const response = await fetch("/api/queue", { cache: "no-store" });
          if (response.ok && !stopped) {
            const body = (await response.json()) as QueueNoticeInput;
            setStatus(body);
            if (queueNoticeLines(body).length > 0) next = BUSY_MS;
          }
        } catch {
          /* réseau indisponible : on réessaie au prochain passage */
        }
      }
      if (!stopped) timer = setTimeout(tick, next);
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);
  const lines = queueNoticeLines(status);
  return (
    <div
      className="queue-notice"
      role="status"
      aria-live="polite"
      data-testid="queue-notice"
      data-visible={lines.length > 0}
    >
      {lines.length > 0 ? (
        <>
          <Icon name="alert" />
          <span>
            {lines.map((line) => (
              <span key={line} className="queue-notice__line">
                {line}
              </span>
            ))}
          </span>
        </>
      ) : null}
    </div>
  );
}
