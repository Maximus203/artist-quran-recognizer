"use client";
import { useEffect, useMemo, useRef } from "react";
import { clampQuranSize, QURAN_SIZE } from "@/lib/ui-prefs";
import { isLive } from "@/lib/live-store";
import { FontPicker, FONT_SAMPLE } from "../font-picker";
import { useMedia } from "../hooks";
import { useShell } from "../shell";
import { Console, Know, Notices, StatusBar } from "./live-console";
import { EndCard } from "./live-end";
import { History, Tech, TechSwitch } from "./live-hist";
import { Stage } from "./live-stage";
import { useLive } from "./use-live";

const INPUT = /^(input|textarea|select|button|a|summary)$/i;

/** L'écran « En direct » : console, état de la connexion, carte « Passage en cours », liste des passages. */
export function LiveView() {
  const live = useLive();
  const { state } = live;
  const { prefs, update, font, fontAvailability } = useShell();
  const title = useRef<HTMLHeadingElement>(null);

  // Le focus ne bouge jamais sans geste, sauf à la fin : il va au titre « Écoute terminée ».
  const wasEnded = useRef(false);
  useEffect(() => {
    if (state.phase === "ended" && !wasEnded.current) title.current?.focus();
    wasEnded.current = state.phase === "ended";
  }, [state.phase]);

  // Raccourcis : Espace = pause / reprendre, T = mode technique ; aucun pour Arrêter (WCAG 2.1.4).
  const { pause, resume, setTechnical, technical } = live;
  useEffect(() => {
    if (!prefs.shortcutsEnabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (INPUT.test(target.tagName) || target.isContentEditable))
        return;
      if (event.code === "Space") {
        if (state.phase === "listening") {
          event.preventDefault();
          pause();
        } else if (state.phase === "paused") {
          event.preventDefault();
          resume();
        }
      } else if (event.key === "t" || event.key === "T") {
        setTechnical(!technical);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    prefs.shortcutsEnabled,
    state.phase,
    pause,
    resume,
    setTechnical,
    technical,
  ]);

  const narrow = useMedia("(max-width: 767px)");
  const defaultSize = narrow ? 32 : QURAN_SIZE.fallback;
  const appliedSize = clampQuranSize(prefs.arabicSize ?? defaultSize);
  const sample = useMemo(
    () => state.lock?.text?.split(/\s+/).slice(0, 5).join(" ") ?? FONT_SAMPLE,
    [state.lock?.text],
  );
  const fontTools = (
    <FontPicker
      font={font}
      availability={fontAvailability}
      size={prefs.arabicSize}
      appliedSize={appliedSize}
      sample={sample}
      onFont={(id) => update({ arabicFont: id })}
      onSize={(px) => update({ arabicSize: clampQuranSize(px) })}
      onReset={() => update({ arabicFont: null, arabicSize: null })}
    />
  );

  const ended = state.phase === "ended";
  return (
    <div className="lv" data-phase={state.phase} data-testid="live-page">
      <div
        className="sr"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="live-announce"
      >
        {live.announcement.text}
      </div>
      <div className="lv-wrap">
        <h1 className="lv-title" id="lv-h1">
          En direct <em>· le moteur t’écoute</em>
        </h1>
        <p className="lv-lead">
          Récite : les versets reconnus s’affichent pendant que tu parles, avec
          leur traduction. Le moteur ne nomme un verset que lorsqu’il est sûr.
        </p>
        <div className="lv-grid">
          <div className="lv-main">
            <Console
              state={state}
              onStart={() => void live.start()}
              onPause={live.pause}
              onResume={live.resume}
              onStop={() => void live.stop()}
              onCancel={live.cancel}
            />
            <StatusBar state={state} wakeHeld={live.wakeHeld} />
            <Notices state={state} onRetryNow={live.retryNow} />
            {ended ? (
              <EndCard
                ref={title}
                state={state}
                hasRecording={live.keepFile !== null}
                undoIn={live.undoIn}
                onKeep={() => void live.keep()}
                onCopy={() => void live.copyList()}
                onRestart={() => void live.start()}
                onDiscard={live.discard}
                onUndo={live.undoDiscard}
              />
            ) : (
              <Stage
                state={state}
                fontTools={fontTools}
                showTranslation={prefs.translation}
                retryIn={live.retryIn}
                onStart={() => void live.start()}
              />
            )}
            <Know state={state} />
          </div>
          <aside className="lv-side" aria-label="Passages et mode technique">
            {state.phase !== "idle" && state.phase !== "error" ? (
              <History state={state} showTranslation={prefs.translation} />
            ) : null}
            <TechSwitch
              on={live.technical}
              onChange={live.setTechnical}
              grantedAtStart={state.technical}
              live={isLive(state.phase)}
            />
            {live.technical ? <Tech state={state} /> : null}
          </aside>
        </div>
      </div>
    </div>
  );
}
