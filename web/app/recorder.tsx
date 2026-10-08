"use client";

import { useEffect, useRef, useState } from "react";
import { formatTime } from "@/lib/recognition";
import {
  recordingError,
  recordingExtension,
  supportedRecordingType,
} from "@/lib/recording";

type Phase = "idle" | "requesting" | "recording" | "preparing" | "preview";

export default function Recorder({
  onAnalyze,
}: {
  onAnalyze: (audio: File) => Promise<void>;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [preview, setPreview] = useState<{ file: File; url: string } | null>(
    null,
  );
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [uploading, setUploading] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const playback = useRef<HTMLAudioElement | null>(null);
  const previewUrl = useRef<string | null>(null);
  const started = useRef(0);
  const mounted = useRef(true);
  const requesting = useRef(false);

  function releaseStream() {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  }

  function clearPreview() {
    playback.current?.pause();
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = null;
    setPreview(null);
    setPlaying(false);
    setPosition(0);
    setDuration(0);
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (recorder.current?.state === "recording") recorder.current.stop();
      releaseStream();
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    };
  }, []);

  useEffect(() => {
    if (phase !== "recording") return;
    const tick = () => setSeconds((performance.now() - started.current) / 1000);
    tick();
    const timer = window.setInterval(tick, 100);
    return () => window.clearInterval(timer);
  }, [phase]);

  async function begin() {
    if (requesting.current || phase === "recording") return;
    requesting.current = true;
    setError("");
    setPhase("requesting");
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setError(
        "L’enregistrement micro n’est pas disponible dans ce navigateur ou cette page.",
      );
      setPhase(preview ? "preview" : "idle");
      requesting.current = false;
      return;
    }
    try {
      const input = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current) {
        input.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = input;
      const mimeType = supportedRecordingType((type) =>
        MediaRecorder.isTypeSupported(type),
      );
      if (!mimeType) throw new Error("UnsupportedFormat");
      clearPreview();
      const capture = new MediaRecorder(input, { mimeType });
      const chunks: Blob[] = [];
      let failed = false;
      capture.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      capture.onerror = () => {
        failed = true;
        releaseStream();
        if (mounted.current) {
          setError(
            "L’enregistrement a été interrompu. Réessaie après avoir vérifié le microphone.",
          );
          setPhase("idle");
        }
      };
      capture.onstop = () => {
        releaseStream();
        recorder.current = null;
        if (!mounted.current || failed) return;
        const actualType = capture.mimeType || mimeType;
        const extension = recordingExtension(actualType);
        const blob = new Blob(chunks, { type: actualType });
        if (!extension || blob.size === 0) {
          setError(
            "Aucun son n’a été capturé. Vérifie le microphone puis recommence.",
          );
          setPhase("idle");
          return;
        }
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const file = new File([blob], `recitation-${stamp}${extension}`, {
          type: actualType,
        });
        const url = URL.createObjectURL(blob);
        previewUrl.current = url;
        setPreview({ file, url });
        setPhase("preview");
      };
      capture.start(1000);
      recorder.current = capture;
      started.current = performance.now();
      setSeconds(0);
      setPhase("recording");
    } catch (cause) {
      releaseStream();
      if (mounted.current) {
        setError(
          (cause as Error).message === "UnsupportedFormat"
            ? "Ce navigateur ne propose aucun format audio compatible avec le moteur."
            : recordingError(cause as Error),
        );
        setPhase(preview ? "preview" : "idle");
      }
    } finally {
      requesting.current = false;
    }
  }

  function stop() {
    if (recorder.current?.state !== "recording") return;
    setSeconds((performance.now() - started.current) / 1000);
    setPhase("preparing");
    recorder.current.stop();
  }

  async function analyze() {
    if (!preview || uploading) return;
    setUploading(true);
    setError("");
    try {
      await onAnalyze(preview.file);
      clearPreview();
      setPhase("idle");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Analyse impossible.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className={`recorder recorder-${phase}`}>
      <div className="recorder-heading">
        <span className="recorder-symbol" aria-hidden="true">
          ●
        </span>
        <div>
          <strong>Enregistrer une récitation</strong>
          <small>Depuis le microphone de cet appareil</small>
        </div>
        {(phase === "recording" || phase === "preparing") && (
          <output
            className="recorder-timer"
            aria-label="Durée de l’enregistrement"
          >
            {formatTime(seconds)}
          </output>
        )}
      </div>
      {phase === "idle" && (
        <button
          className="outline recorder-start"
          type="button"
          onClick={() => void begin()}
        >
          Enregistrer une récitation
        </button>
      )}
      {phase === "requesting" && (
        <p className="recorder-note">
          Autorise l’accès au microphone dans le navigateur…
        </p>
      )}
      {phase === "recording" && (
        <div className="recorder-actions">
          <span className="recorder-live" role="status">
            Enregistrement en cours
          </span>
          <button className="outline" type="button" onClick={stop}>
            Arrêter
          </button>
        </div>
      )}
      {phase === "preparing" && (
        <p className="recorder-note">Préparation de la réécoute…</p>
      )}
      {phase === "preview" && preview && (
        <>
          <audio
            ref={playback}
            src={preview.url}
            preload="metadata"
            onLoadedMetadata={(event) =>
              setDuration(
                Number.isFinite(event.currentTarget.duration)
                  ? event.currentTarget.duration
                  : seconds,
              )
            }
            onTimeUpdate={(event) =>
              setPosition(event.currentTarget.currentTime)
            }
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onError={() =>
              setError(
                "Réécoute impossible dans ce navigateur. Tu peux recommencer l’enregistrement.",
              )
            }
          />
          <div className="recorder-preview">
            <button
              className="recorder-play"
              type="button"
              aria-label={
                playing
                  ? "Mettre la réécoute en pause"
                  : "Réécouter la récitation"
              }
              onClick={() => {
                const node = playback.current;
                if (!node) return;
                if (node.paused)
                  void node
                    .play()
                    .catch(() =>
                      setError("Réécoute impossible dans ce navigateur."),
                    );
                else node.pause();
              }}
            >
              {playing ? "Ⅱ" : "▶"}
            </button>
            <div className="recorder-preview-track">
              <div>
                <span>{formatTime(position)}</span>
                <span>{formatTime(duration || seconds)}</span>
              </div>
              <input
                type="range"
                min="0"
                max={duration || seconds || 1}
                step="0.01"
                value={Math.min(position, duration || seconds || 1)}
                aria-label="Position de réécoute"
                onChange={(event) => {
                  if (playback.current)
                    playback.current.currentTime = Number(event.target.value);
                }}
              />
            </div>
          </div>
          <div className="recorder-actions">
            <button
              className="quiet recorder-retry"
              type="button"
              disabled={uploading}
              onClick={() => void begin()}
            >
              Recommencer
            </button>
            <button
              className="primary"
              type="button"
              disabled={uploading}
              onClick={() => void analyze()}
            >
              {uploading
                ? "Import et lancement…"
                : "Analyser cette récitation ↗"}
            </button>
          </div>
        </>
      )}
      {error && (
        <p className="recorder-error" role="alert">
          {error}
        </p>
      )}
      <p className="recorder-note">
        L’audio choisi est conservé dans une session privée après analyse.
      </p>
    </div>
  );
}
