"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import gsap from "gsap";
import {
  activeIntervals,
  formatTime,
  type Recognition,
  type Interval,
} from "@/lib/recognition";
import type { Annotation, Review } from "@/lib/review";

type Session = {
  id: string;
  name: string;
  audio_sha256: string;
  created_at: string;
  state: string;
  error: string | null;
  prediction_sha256: string | null;
  started_at: string | null;
};
type Detail = {
  session: Session;
  result: Recognition | null;
  review: Review | null;
};
const labels: Record<string, string> = {
  recognized: "Reconnu",
  inferred: "Déduit",
  uncertain: "Incertain",
  non_quran: "Formule",
  abstention: "Abstention",
  wrong_verse: "Mauvais verset",
  missing_verse: "Verset manquant",
  repetition: "Répétition",
  timing: "Décalage",
  other: "Autre",
};
const reasons: Record<string, string> = {
  silence: "Silence selon le moteur",
  empty_transcript: "Aucun texte exploitable",
  no_candidate: "Aucune correspondance",
  below_threshold: "Score insuffisant",
};
function intervalLabel(item: Interval) {
  return item.kind === "verse"
    ? item.status === "uncertain"
      ? `Références possibles : ${item.candidates.join(" · ") || "aucune"}`
      : item.ref || "Verset"
    : item.kind === "non_quran"
      ? item.label
      : reasons[item.reason];
}
function newAnnotation(
  mode: "point" | "range",
  start: number,
  end: number | null,
  target: number | null,
): Annotation {
  return {
    id: crypto.randomUUID(),
    mode,
    start_s: start,
    end_s: end,
    type: "other",
    description: "",
    expected_ref: null,
    target_index: target,
    status: "draft",
    updated_at: new Date().toISOString(),
  };
}
export default function ReviewApp() {
  const [sessions, setSessions] = useState<Session[]>([]),
    [detail, setDetail] = useState<Detail | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false),
    [selected, setSelected] = useState<number | null>(null),
    [filter, setFilter] = useState("all"),
    [follow, setFollow] = useState(true),
    [zoom, setZoom] = useState(1),
    [fontSize, setFontSize] = useState(40),
    [translation, setTranslation] = useState(true),
    [loop, setLoop] = useState(false),
    [draft, setDraft] = useState<Annotation | null>(null),
    [saveState, setSaveState] = useState(""),
    [elapsed, setElapsed] = useState(0);
  const audio = useRef<HTMLAudioElement>(null),
    wave = useRef<HTMLDivElement>(null),
    card = useRef<HTMLDivElement>(null),
    segmentList = useRef<HTMLDivElement>(null),
    file = useRef<HTMLInputElement>(null),
    resultFile = useRef<HTMLInputElement>(null),
    raf = useRef<number>(0),
    saved = useRef<string>("");
  const refreshList = useCallback(async () => {
    const r = await fetch("/api/sessions", { cache: "no-store" });
    if (r.ok) setSessions(await r.json());
  }, []);
  const open = useCallback(async (id: string) => {
    const r = await fetch(`/api/sessions/${id}`, { cache: "no-store" });
    if (!r.ok) throw new Error("Session introuvable");
    const value: Detail = await r.json();
    setDetail(value);
    setDraft(null);
    setSelected(null);
    setTime(0);
    setPlaying(false);
    setSaveState("");
    saved.current = JSON.stringify(value.review?.annotations || []);
  }, []);
  useEffect(() => {
    refreshList().then(() => {
      const id = new URLSearchParams(location.search).get("session");
      if (id) open(id).catch(() => {});
    });
  }, [open, refreshList]);
  useEffect(() => {
    if (!detail || detail.session.state !== "running") return;
    const id = detail.session.id;
    const timer = setInterval(async () => {
      try {
        const r = await fetch(`/api/sessions/${id}`, { cache: "no-store" });
        if (r.ok) {
          const value: Detail = await r.json();
          setDetail((current) =>
            current?.session.id === id
              ? { ...value, review: current.review || value.review }
              : current,
          );
          await refreshList();
        }
      } catch {
        /* prochaine interrogation */
      }
    }, 1800);
    return () => clearInterval(timer);
  }, [detail?.session.id, detail?.session.state, refreshList]);
  useEffect(() => {
    if (
      !detail ||
      detail.session.state !== "running" ||
      !detail.session.started_at
    )
      return;
    const tick = () =>
      setElapsed(
        Math.floor(
          (Date.now() - Date.parse(detail.session.started_at!)) / 1000,
        ),
      );
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [detail]);
  useEffect(() => {
    const node = audio.current;
    if (!node || !detail || !wave.current) return;
    let destroyed = false;
    let ws: import("wavesurfer.js").default | null = null;
    import("wavesurfer.js").then(({ default: WaveSurfer }) => {
      if (destroyed || !wave.current) return;
      ws = WaveSurfer.create({
        container: wave.current,
        media: node,
        waveColor: "#697878",
        progressColor: "#b4ddac",
        cursorColor: "#eff8df",
        height: 84,
        barWidth: 2,
        barGap: 2,
        normalize: true,
      });
      ws.on("interaction", () => setFollow(false));
      ws.on("error", () =>
        setMessage(
          "Waveform indisponible ; le lecteur et la liste restent utilisables.",
        ),
      );
    });
    return () => {
      destroyed = true;
      ws?.destroy();
    };
  }, [detail?.session.id]);
  useEffect(() => {
    const node = audio.current;
    if (!node) return;
    const tick = () => {
      setTime(node.currentTime);
      if (!node.paused) raf.current = requestAnimationFrame(tick);
    };
    const onPlay = () => {
      setSelected(null);
      setPlaying(true);
      tick();
    };
    const onPause = () => {
      setPlaying(false);
      cancelAnimationFrame(raf.current);
      setTime(node.currentTime);
    };
    const onSeek = () => setTime(node.currentTime);
    node.addEventListener("play", onPlay);
    node.addEventListener("pause", onPause);
    node.addEventListener("seeked", onSeek);
    node.addEventListener("ended", onPause);
    document.addEventListener("visibilitychange", onSeek);
    return () => {
      cancelAnimationFrame(raf.current);
      node.removeEventListener("play", onPlay);
      node.removeEventListener("pause", onPause);
      node.removeEventListener("seeked", onSeek);
      node.removeEventListener("ended", onPause);
      document.removeEventListener("visibilitychange", onSeek);
    };
  }, [detail?.session.id]);
  useEffect(() => {
    if (!loop || !draft || !audio.current) return;
    const start =
      draft.mode === "range" ? draft.start_s : Math.max(0, draft.start_s - 2);
    const end = draft.mode === "range" ? draft.end_s! : draft.start_s + 2;
    if (time >= end || time < start) audio.current.currentTime = start;
  }, [time, loop, draft]);
  const intervals = detail?.result?.intervals || [];
  const active = activeIntervals(intervals, time);
  const currentIndex = intervals.findIndex(
    (i) => i.t && i.t[0] <= time && time < i.t[1] && i.kind === "verse",
  );
  const chosen = selected !== null ? intervals[selected] : null;
  const shown =
    chosen && (chosen.t === null || (chosen.t[0] <= time && time < chosen.t[1]))
      ? chosen
      : currentIndex >= 0
        ? intervals[currentIndex]
        : null;
  useEffect(() => {
    if (follow && currentIndex >= 0)
      segmentList.current
        ?.querySelector(`[data-index="${currentIndex}"]`)
        ?.scrollIntoView({ block: "nearest" });
  }, [currentIndex, follow]);
  useEffect(() => {
    if (
      !card.current ||
      !shown ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const ctx = gsap.context(() =>
      gsap.fromTo(
        card.current,
        { opacity: 0.65, y: 7 },
        { opacity: 1, y: 0, duration: 0.22, ease: "power2.out" },
      ),
    );
    return () => ctx.revert();
  }, [selected, currentIndex, detail?.session.id]);
  useEffect(() => {
    if (!detail || !draft) return;
    const annotations = [
      ...(detail.review?.annotations || []).filter((a) => a.id !== draft.id),
      draft,
    ];
    const key = JSON.stringify(annotations);
    if (key === saved.current) return;
    setSaveState("Enregistrement…");
    const timer = setTimeout(async () => {
      const review: Review = {
        schema: "aqr.review/1",
        session_id: detail.session.id,
        audio_sha256: detail.session.audio_sha256,
        prediction_sha256: detail.session.prediction_sha256,
        annotations,
        updated_at: new Date().toISOString(),
      };
      try {
        const r = await fetch(`/api/sessions/${detail.session.id}/review`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(review),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        saved.current = key;
        setDetail((d) =>
          d && d.session.id === detail.session.id ? { ...d, review } : d,
        );
        setSaveState("Enregistré localement");
      } catch (e) {
        setSaveState(
          `Échec de sauvegarde : ${e instanceof Error ? e.message : "erreur"}`,
        );
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [draft, detail?.session.id, detail?.session.prediction_sha256]);
  async function upload() {
    if (!file.current?.files?.[0]) return;
    setBusy(true);
    setMessage("");
    try {
      const form = new FormData();
      form.append("audio", file.current.files[0]);
      if (resultFile.current?.files?.[0])
        form.append("result", resultFile.current.files[0]);
      const r = await fetch("/api/sessions", { method: "POST", body: form });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      await refreshList();
      await open(data.id);
      history.replaceState(null, "", `?session=${data.id}`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Import impossible");
    } finally {
      setBusy(false);
    }
  }
  async function action(method: "POST" | "DELETE") {
    if (!detail) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/sessions/${detail.session.id}/run`, {
        method,
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      await open(detail.session.id);
      await refreshList();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Action impossible");
    } finally {
      setBusy(false);
    }
  }
  function seek(index: number) {
    const item = intervals[index];
    setSelected(index);
    if (item?.t && audio.current) audio.current.currentTime = item.t[0];
    setFollow(false);
  }
  function patchDraft(patch: Partial<Annotation>) {
    if (draft)
      setDraft({ ...draft, ...patch, updated_at: new Date().toISOString() });
  }
  async function removeDraft() {
    if (!detail || !draft) return;
    const annotations = (detail.review?.annotations || []).filter(
      (a) => a.id !== draft.id,
    );
    const review: Review = {
      schema: "aqr.review/1",
      session_id: detail.session.id,
      audio_sha256: detail.session.audio_sha256,
      prediction_sha256: detail.session.prediction_sha256,
      annotations,
      updated_at: new Date().toISOString(),
    };
    try {
      const r = await fetch(`/api/sessions/${detail.session.id}/review`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(review),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      saved.current = JSON.stringify(annotations);
      setDetail({ ...detail, review });
      setDraft(null);
      setSaveState("Signalement annulé · révision conservée");
    } catch (e) {
      setSaveState(
        `Échec de sauvegarde : ${e instanceof Error ? e.message : "erreur"}`,
      );
    }
  }
  function startAnnotation(mode: "point" | "range") {
    setLoop(false);
    const start =
      mode === "range" ? Math.min(time, Math.max(0, duration - 0.5)) : time;
    const end =
      mode === "range" ? Math.min(duration || start + 5, start + 5) : null;
    setDraft(
      newAnnotation(
        mode,
        Number(start.toFixed(3)),
        end === null ? null : Number(end.toFixed(3)),
        selected ?? (currentIndex >= 0 ? currentIndex : null),
      ),
    );
  }
  const duration =
    detail?.result?.source.duration_s || audio.current?.duration || 0;
  const visible = intervals
    .map((item, index) => ({ item, index }))
    .filter(
      ({ item }) =>
        filter === "all" ||
        (filter === "verse"
          ? item.kind === "verse"
          : filter === "uncertain"
            ? item.kind === "verse" && item.status !== "recognized"
            : item.kind === filter),
    );
  return (
    <main className="shell">
      <header className="top">
        <div className="brand">
          <span className="mark">۞</span>
          <div>
            <small>ATELIER DE REVUE</small>
            <h1>Artist Quran Review</h1>
          </div>
        </div>
        <div className="topnote">
          Hafs · Revue locale <span className="dot" /> Moteur expérimental
        </div>
      </header>
      <section className="intro">
        <div>
          <p className="eyebrow">ÉCOUTER · VÉRIFIER · CORRIGER</p>
          <h2>
            Chaque récitation mérite
            <br />
            <em>une écoute attentive.</em>
          </h2>
          <p>
            Importe un audio, lance le moteur existant ou ouvre son JSON. Les
            hypothèses et les abstentions restent visibles comme telles.
          </p>
        </div>
        <div className="upload">
          <label>
            Fichier audio{" "}
            <input ref={file} type="file" accept="audio/*,.opus,.flac" />
          </label>
          <label>
            Résultat existant <span className="optional">facultatif</span>
            <input
              ref={resultFile}
              type="file"
              accept=".json,application/json"
            />
          </label>
          <button className="primary" onClick={upload} disabled={busy}>
            Importer dans l’atelier <span>↗</span>
          </button>
          <small>
            Fichiers conservés localement hors Git. L’import JSON exige le même
            audio, vérifié par SHA-256.
          </small>
        </div>
      </section>
      {message && (
        <p className="notice error" role="alert">
          {message}
        </p>
      )}
      <div className="workspace">
        <aside className="library">
          <div className="section-head">
            <span>01 / SESSIONS</span>
            <button className="quiet" onClick={refreshList}>
              Actualiser
            </button>
          </div>
          {sessions.length === 0 ? (
            <p className="muted">Aucun essai local.</p>
          ) : (
            sessions.map((s) => (
              <button
                key={s.id}
                className={`session ${detail?.session.id === s.id ? "on" : ""}`}
                onClick={() => {
                  open(s.id)
                    .then(() =>
                      history.replaceState(null, "", `?session=${s.id}`),
                    )
                    .catch((e) => setMessage(e.message));
                }}
              >
                <span className="session-name">{s.name}</span>
                <span className="session-meta">
                  {new Date(s.created_at).toLocaleString("fr-FR")} · {s.state}
                </span>
              </button>
            ))
          )}
        </aside>
        <section className="center">
          {!detail ? (
            <div className="empty">
              <span>۝</span>
              <h3>Le temps de l’écoute</h3>
              <p>
                Choisis un fichier pour ouvrir le lecteur, la carte arabe et les
                pistes synchronisées.
              </p>
            </div>
          ) : (
            <>
              <div className="section-head">
                <span>02 / ÉCOUTE</span>
                <span className="muted">{detail.session.name}</span>
              </div>
              <div className="statusbar">
                <span className={`state ${detail.session.state}`}>
                  {detail.session.state === "done"
                    ? "Résultat disponible"
                    : detail.session.state === "running"
                      ? `Analyse réelle en cours · ${formatTime(elapsed)}`
                      : detail.session.state === "ready"
                        ? "Prêt à analyser"
                        : detail.session.state === "failed"
                          ? "Moteur indisponible"
                          : "Annulé"}
                </span>
                <span>SHA-256 {detail.session.audio_sha256.slice(0, 12)}…</span>
              </div>
              {detail.session.error && (
                <p className="notice error" role="alert">
                  {detail.session.error}
                </p>
              )}
              <div className="transport">
                <audio
                  key={detail.session.id}
                  ref={audio}
                  src={`/api/sessions/${detail.session.id}/audio`}
                  preload="metadata"
                  controls
                  aria-label="Lecteur audio"
                />
                <div ref={wave} className="wave" aria-label="Forme d’onde" />
                <div className="transport-row">
                  <span>
                    {formatTime(time)} / {formatTime(duration)}
                  </span>
                  <div>
                    <button
                      onClick={() => {
                        if (audio.current)
                          audio.current.currentTime = Math.max(0, time - 5);
                      }}
                    >
                      − 5 s
                    </button>
                    <button
                      onClick={() =>
                        playing ? audio.current?.pause() : audio.current?.play()
                      }
                    >
                      {playing ? "Pause" : "Lecture"}
                    </button>
                    <button
                      onClick={() => {
                        if (audio.current)
                          audio.current.currentTime = Math.min(
                            duration,
                            time + 5,
                          );
                      }}
                    >
                      + 5 s
                    </button>
                  </div>
                  <label>
                    Vitesse{" "}
                    <select
                      defaultValue="1"
                      onChange={(e) => {
                        if (audio.current)
                          audio.current.playbackRate = Number(e.target.value);
                      }}
                    >
                      <option value="0.5">0,5×</option>
                      <option value="0.75">0,75×</option>
                      <option value="1">1×</option>
                      <option value="1.25">1,25×</option>
                      <option value="1.5">1,5×</option>
                    </select>
                  </label>
                </div>
                <div className="transport-row">
                  <label>
                    Zoom{" "}
                    <input
                      type="range"
                      min="1"
                      max="8"
                      value={zoom}
                      onChange={(e) => setZoom(Number(e.target.value))}
                    />
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={follow}
                      onChange={(e) => setFollow(e.target.checked)}
                    />{" "}
                    Suivre la lecture
                  </label>
                  <span className="muted">
                    {follow ? "Lecture suivie" : "Exploration libre"}
                  </span>
                </div>
              </div>
              {detail.session.state === "ready" ||
              detail.session.state === "failed" ||
              detail.session.state === "cancelled" ? (
                <button
                  className="primary run"
                  disabled={busy}
                  onClick={() => action("POST")}
                >
                  Lancer le vrai moteur Python ↗
                </button>
              ) : detail.session.state === "running" ? (
                <button
                  className="outline run"
                  disabled={busy}
                  onClick={() => action("DELETE")}
                >
                  Arrêter le traitement
                </button>
              ) : null}
              <div ref={card} className="verse-card">
                <div className="card-top">
                  <span>03 / PASSAGE ACTIF</span>
                  <div>
                    <button
                      onClick={() => setFontSize((v) => Math.max(28, v - 4))}
                      aria-label="Réduire le texte arabe"
                    >
                      A−
                    </button>
                    <button
                      onClick={() => setFontSize((v) => Math.min(72, v + 4))}
                      aria-label="Agrandir le texte arabe"
                    >
                      A+
                    </button>
                  </div>
                </div>
                {shown && shown.kind === "verse" ? (
                  <>
                    <div className="badges">
                      <span>
                        {shown.status === "inferred"
                          ? "Hypothèse · non entendue"
                          : labels[shown.status]}
                      </span>
                      {shown.partial && <span>Passage partiel</span>}
                      {shown.repetition && <span>Répétition</span>}
                      {shown.time_interpolated && <span>Temps interpolé</span>}
                    </div>
                    <p className="ref">
                      {shown.status === "uncertain"
                        ? "Identification ambiguë"
                        : shown.ref}{" "}
                      ·{" "}
                      {shown.t
                        ? `${formatTime(shown.t[0])} – ${formatTime(shown.t[1])}`
                        : "Sans temps"}
                    </p>
                    {shown.text ? (
                      <p
                        className="arabic"
                        lang="ar"
                        dir="rtl"
                        style={{ fontSize }}
                      >
                        {shown.text}
                      </p>
                    ) : (
                      <p className="arabic placeholder" lang="fr">
                        {shown.status === "uncertain"
                          ? `Références candidates : ${shown.candidates.join(" · ") || "aucune"}`
                          : "Texte non inclus dans ce résultat"}
                      </p>
                    )}
                    {translation && shown.translation && (
                      <div className="translation">
                        <p>{shown.translation.text}</p>
                        <small>
                          {shown.partial
                            ? "Traduction du verset entier · "
                            : ""}
                          {shown.translation.attribution} ·{" "}
                          {shown.translation.translation_id} · source{" "}
                          {shown.translation.version}
                        </small>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="card-empty">
                    <h3>Aucun verset localisé à cet instant</h3>
                    <p>
                      {shown
                        ? intervalLabel(shown)
                        : active.length
                          ? active.map(intervalLabel).join(" · ")
                          : "Lis un passage ou sélectionne un segment dans la liste."}
                    </p>
                  </div>
                )}
                <label className="translation-toggle">
                  <input
                    type="checkbox"
                    checked={translation}
                    onChange={(e) => setTranslation(e.target.checked)}
                  />{" "}
                  Afficher la traduction
                </label>
              </div>
              <div className="timeline">
                <div className="section-head">
                  <span>04 / PISTES SYNCHRONISÉES</span>
                  <span className="muted">{intervals.length} intervalles</span>
                </div>
                <div className="ruler" style={{ overflowX: "auto" }}>
                  <div
                    className="track-inner"
                    style={{ width: `${zoom * 100}%` }}
                  >
                    <div
                      className="playhead"
                      style={{
                        left: `${duration ? (time / duration) * 100 : 0}%`,
                      }}
                    />
                    {(["main", "inferred", "review"] as const).map((track) => (
                      <div key={track} className="track">
                        <span className="track-name">
                          {track === "main"
                            ? "Moteur"
                            : track === "inferred"
                              ? "Hypothèses"
                              : "Revue"}
                        </span>
                        {track === "review"
                          ? detail.review?.annotations
                              .filter((a) => a.end_s !== null)
                              .map((a) => (
                                <button
                                  key={a.id}
                                  className="track-item correction"
                                  style={{
                                    left: `${duration ? (a.start_s / duration) * 100 : 0}%`,
                                    width: `${duration ? ((a.end_s! - a.start_s) / duration) * 100 : 0}%`,
                                  }}
                                  onClick={() => setDraft(a)}
                                  title={a.description || labels[a.type]}
                                />
                              ))
                          : intervals.map((item, index) =>
                              item.t &&
                              (track === "inferred"
                                ? item.kind === "verse" &&
                                  item.status === "inferred"
                                : !(
                                    item.kind === "verse" &&
                                    item.status === "inferred"
                                  )) ? (
                                <button
                                  key={index}
                                  className={`track-item ${item.kind} ${item.kind === "verse" ? item.status : ""} ${selected === index ? "selected" : ""}`}
                                  style={{
                                    left: `${duration ? (item.t[0] / duration) * 100 : 0}%`,
                                    width: `${Math.max(0.28, duration ? ((item.t[1] - item.t[0]) / duration) * 100 : 0)}%`,
                                  }}
                                  onClick={() => seek(index)}
                                  title={`${intervalLabel(item)} ${formatTime(item.t![0])}`}
                                />
                              ) : null,
                            )}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="ticks">
                  <span>00:00</span>
                  <span>{formatTime(duration / 2)}</span>
                  <span>{formatTime(duration)}</span>
                </div>
              </div>
              <div className="segments">
                <div className="section-head">
                  <span>05 / INTERVALLES</span>
                  <select
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    aria-label="Filtrer les intervalles"
                  >
                    <option value="all">Tous</option>
                    <option value="verse">Versets</option>
                    <option value="uncertain">À revoir</option>
                    <option value="non_quran">Formules</option>
                    <option value="abstention">Abstentions</option>
                  </select>
                </div>
                <div
                  ref={segmentList}
                  className="segment-list"
                  onWheel={() => setFollow(false)}
                >
                  {visible.length === 0 ? (
                    <p className="muted">Aucun intervalle à afficher.</p>
                  ) : (
                    visible.map(({ item, index }) => (
                      <button
                        data-index={index}
                        key={index}
                        className={`segment ${selected === index || (selected === null && currentIndex === index) ? "active" : ""}`}
                        onClick={() => seek(index)}
                      >
                        <span className="segment-time">
                          {item.t ? formatTime(item.t[0]) : "Sans temps"}
                        </span>
                        <span className="segment-title">
                          {intervalLabel(item)}
                        </span>
                        <span className="segment-state">
                          {item.kind === "verse"
                            ? labels[item.status]
                            : labels[item.kind]}
                        </span>
                      </button>
                    ))
                  )}
                  {intervals.some((i) => i.t === null) && (
                    <p className="muted">
                      Les éléments « Sans temps » ne déplacent pas le lecteur.
                    </p>
                  )}
                </div>
              </div>
              <details className="diagnostics">
                <summary>Détails du moteur et avertissements</summary>
                <p>
                  ASR : {detail.result?.engine.asr || "en attente"} ·
                  Segmentation :{" "}
                  {detail.result?.engine.segmenter || "en attente"}
                </p>
                <p>
                  Ces scores proviennent du moteur ; ils ne sont pas des
                  probabilités de justesse calibrées.
                </p>
                {detail.result?.warnings.map((w, i) => (
                  <p key={i}>Avertissement : {w}</p>
                ))}
                {selected !== null && intervals[selected] && (
                  <pre>{JSON.stringify(intervals[selected], null, 2)}</pre>
                )}
              </details>
            </>
          )}
        </section>
        <aside className="review">
          <div className="section-head">
            <span>06 / REVUE HUMAINE</span>
          </div>
          {!detail ? (
            <p className="muted">La revue s’ouvre avec un audio.</p>
          ) : (
            <>
              <p className="review-intro">
                Note ce qui est faux. Un signalement ne devient pas une vérité
                terrain complète.
              </p>
              <div className="review-actions">
                <button
                  className="primary"
                  onClick={() => startAnnotation("point")}
                >
                  + Signaler ici
                </button>
                <button
                  className="outline"
                  onClick={() => startAnnotation("range")}
                >
                  + Sélectionner une plage
                </button>
              </div>
              {draft && (
                <div className="editor">
                  <div className="section-head">
                    <span>
                      {draft.status === "confirmed"
                        ? "Signalement confirmé"
                        : "Brouillon"}
                    </span>
                    <button className="quiet" onClick={() => setDraft(null)}>
                      Fermer
                    </button>
                  </div>
                  <label>
                    Type d’erreur
                    <select
                      value={draft.type}
                      onChange={(e) =>
                        patchDraft({
                          type: e.target.value as Annotation["type"],
                        })
                      }
                    >
                      {Object.entries(labels)
                        .filter(([k]) =>
                          [
                            "wrong_verse",
                            "missing_verse",
                            "repetition",
                            "timing",
                            "other",
                          ].includes(k),
                        )
                        .map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                    </select>
                  </label>
                  <div className="form-row">
                    <label>
                      Début (s)
                      <input
                        type="number"
                        step="0.001"
                        min="0"
                        value={draft.start_s}
                        onChange={(e) =>
                          patchDraft({ start_s: Number(e.target.value) })
                        }
                      />
                    </label>
                    {draft.mode === "range" && (
                      <label>
                        Fin (s)
                        <input
                          type="number"
                          step="0.001"
                          min="0"
                          value={draft.end_s ?? ""}
                          onChange={(e) =>
                            patchDraft({ end_s: Number(e.target.value) })
                          }
                        />
                      </label>
                    )}
                  </div>
                  <label>
                    Description
                    <textarea
                      value={draft.description}
                      onChange={(e) =>
                        patchDraft({ description: e.target.value })
                      }
                      placeholder="Qu’as-tu entendu ? Que faut-il corriger ?"
                    />
                  </label>
                  <label>
                    Référence attendue{" "}
                    <span className="optional">facultatif</span>
                    <input
                      value={draft.expected_ref || ""}
                      onChange={(e) =>
                        patchDraft({ expected_ref: e.target.value || null })
                      }
                      placeholder="ex. 2:255"
                    />
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={loop}
                      onChange={(e) => {
                        setLoop(e.target.checked);
                        if (e.target.checked && audio.current) {
                          audio.current.currentTime =
                            draft.mode === "range"
                              ? draft.start_s
                              : Math.max(0, draft.start_s - 2);
                          audio.current.play();
                        }
                      }}
                    />{" "}
                    Écouter en boucle{" "}
                    {draft.mode === "point"
                      ? "(± 2 s, écoute seulement)"
                      : "la plage"}
                  </label>
                  <button
                    className="primary"
                    onClick={() => {
                      if (!draft.description.trim()) {
                        setMessage("Décris le signalement avant confirmation.");
                        return;
                      }
                      patchDraft({ status: "confirmed" });
                    }}
                  >
                    Confirmer après écoute
                  </button>
                  <button className="quiet" onClick={removeDraft}>
                    Annuler ce signalement
                  </button>
                  <p
                    className={`save ${saveState.startsWith("Échec") ? "error" : ""}`}
                  >
                    {saveState || "Brouillon local"}
                  </p>
                </div>
              )}
              <div className="review-list">
                <h3>Signalements ({detail.review?.annotations.length || 0})</h3>
                {detail.review?.annotations.map((a) => (
                  <button key={a.id} onClick={() => setDraft(a)}>
                    <span>
                      {formatTime(a.start_s)}{" "}
                      {a.mode === "range" && a.end_s !== null
                        ? `– ${formatTime(a.end_s)}`
                        : "· point"}
                    </span>
                    <strong>{labels[a.type]}</strong>
                    <small>
                      {a.status === "confirmed" ? "Confirmé" : "Brouillon"}
                    </small>
                  </button>
                ))}
              </div>
              <a
                className="export"
                href={`/api/sessions/${detail.session.id}/bundle`}
                download
              >
                Télécharger le pack complet ZIP ↗
              </a>
              <a
                className="audio-download"
                href={`/api/sessions/${detail.session.id}/export`}
                download
              >
                Exporter le bilan JSON
              </a>
              <p className="fine">
                Le ZIP contient audio, prédiction et révisions avec leurs
                empreintes. Aucun envoi cloud automatique. Métriques
                indisponibles pour une revue partielle.
              </p>
            </>
          )}
        </aside>
      </div>
      <footer>
        Texte coranique : Tanzil Project ·{" "}
        <a href="https://tanzil.net" target="_blank" rel="noreferrer">
          tanzil.net
        </a>
        . Traductions : QuranEnc, provenance affichée par passage. Aucune
        reconnaissance simulée.
      </footer>
    </main>
  );
}
