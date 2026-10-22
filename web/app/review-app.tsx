"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bindMediaDrop } from "@/lib/audio-upload";
import { listenWindow } from "@/lib/marking";
import { activeIndex, intervalLabel, intervalStateLabel } from "@/lib/passage";
import { attentionCount, pageTitle } from "@/lib/session-list";
import { QURAN_SIZE, clampQuranSize } from "@/lib/ui-prefs";
import { rememberTester } from "@/lib/tester";
import type { Annotation } from "@/lib/review";
import { Console, type ListeningState } from "./atelier/console";
import { FontPicker, FONT_SAMPLE } from "./atelier/font-picker";
import { Header, type View } from "./atelier/header";
import { HeroWave } from "./atelier/hero-wave";
import {
  useAppearance,
  useEffectiveTheme,
  useFocusTrap,
  useFontAvailability,
  useMedia,
  usePageVisible,
  usePrefs,
} from "./atelier/hooks";
import { IconSprite } from "./atelier/icons";
import { IntervalsList } from "./atelier/intervals-list";
import { NewTrial } from "./atelier/new-trial";
import { LivePassage } from "./atelier/passage-card";
import { PerfView } from "./atelier/perf-view";
import { ReviewPanel, type ReviewTab } from "./atelier/review-panel";
import { SessionHead } from "./atelier/session-head";
import { SessionsPanel } from "./atelier/sessions-panel";
import type { TimelineHandle } from "./atelier/timeline";
import { usePlayer } from "./atelier/use-player";
import { useReviewController, type ToastAction } from "./atelier/use-review";
import {
  cancelSession,
  markViewed,
  runSession,
  useImporter,
  useSessionDetail,
  useSessionList,
} from "./atelier/use-sessions";
import { useStoreValue } from "./atelier/hooks";

type Peaks = { duration: number; peaks: number[] };
const TOAST_MS = 6000;

export default function ReviewApp() {
  const { prefs, ready, update } = usePrefs();
  const { availability } = useFontAvailability();
  const font = useAppearance(prefs, availability, ready);
  const theme = useEffectiveTheme(prefs);
  const wide = useMedia("(min-width: 1280px)");
  const narrow = useMedia("(max-width: 767px)");
  const visible = usePageVisible();
  const { views, loaded, refresh } = useSessionList();

  const [view, setView] = useState<View>("revue");
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<"left" | "right" | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [follow, setFollow] = useState(true);
  const [span, setSpan] = useState<number | null>(null);
  const [tab, setTab] = useState<ReviewTab>("sig");
  const [relecteur, setRelecteur] = useState(false);
  const [message, setMessage] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [toast, setToast] = useState<{
    text: string;
    action?: ToastAction;
  } | null>(null);
  const [testerFocus, setTesterFocus] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const [runBusy, setRunBusy] = useState(false);
  const [peaks, setPeaks] = useState<Peaks | null>(null);
  const [listening, setListening] = useState<ListeningState>("pending");
  const [importNotice, setImportNotice] = useState("");

  const timelineRef = useRef<TimelineHandle>(null);
  const leftPanel = useRef<HTMLElement>(null);
  const rightPanel = useRef<HTMLElement>(null);
  const leftButton = useRef<HTMLButtonElement>(null);
  const rightButton = useRef<HTMLButtonElement>(null);
  const viewedSent = useRef(new Set<string>());
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentView = views.find((v) => v.id === currentId) ?? null;
  const { detail, error: detailError } = useSessionDetail(
    currentId,
    currentView?.state,
    currentView?.prediction_sha256,
  );
  const intervals = useMemo(() => detail?.result?.intervals ?? [], [detail]);
  const intervalsRef = useRef(intervals);
  intervalsRef.current = intervals;
  const selectedRef = useRef(selectedIndex);
  selectedRef.current = selectedIndex;

  const say = useCallback((text: string) => {
    setAnnouncement("");
    setTimeout(() => setAnnouncement(text), 30);
  }, []);
  const showToast = useCallback((text: string, action?: ToastAction) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ text, action });
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  const player = usePlayer(currentId, {
    onError: setMessage,
    onPlay: () => setSelectedIndex(null),
  });
  const playerDuration = useStoreValue(player.store, (s) => s.duration);
  const duration =
    playerDuration || peaks?.duration || detail?.result?.source.duration_s || 0;

  /* ── panneaux : bureau = mémorisés, en dessous = tiroirs ── */
  const rightAvailable = view === "revue" && currentId !== null;
  const leftOpen = wide ? prefs.left !== false : drawer === "left";
  const rightOpen =
    rightAvailable && (wide ? prefs.right !== false : drawer === "right");
  const toggleLeft = () =>
    wide
      ? update({ left: !leftOpen })
      : setDrawer(drawer === "left" ? null : "left");
  const toggleRight = () =>
    wide
      ? update({ right: !rightOpen })
      : setDrawer(drawer === "right" ? null : "right");
  const closeDrawer = useCallback(() => setDrawer(null), []);
  const openRight = useCallback(() => {
    if (wide) update({ right: true });
    else setDrawer("right");
  }, [wide, update]);
  useEffect(() => {
    if (wide) setDrawer(null);
  }, [wide]);
  useFocusTrap(leftPanel, !wide && drawer === "left", closeDrawer, leftButton);
  useFocusTrap(
    rightPanel,
    !wide && drawer === "right",
    closeDrawer,
    rightButton,
  );

  /* ── ouverture d'une session ── */
  const open = useCallback((id: string) => {
    setCurrentId(id);
    setView("revue");
    setSelectedIndex(null);
    setMessage("");
    setFollow(true);
    setDrawer(null);
    const params = new URLSearchParams();
    params.set("session", id);
    if (new URLSearchParams(location.search).get("relecteur") === "1")
      params.set("relecteur", "1");
    history.replaceState(null, "", `?${params}`);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    setRelecteur(params.get("relecteur") === "1");
    const id = params.get("session");
    if (id) open(id);
    // une seule fois, au montage
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* « Non lu » disparaît quand on OUVRE le résultat, jamais par simple sondage. */
  useEffect(() => {
    if (!currentId || !currentView?.unread || !detail || !visible) return;
    if (viewedSent.current.has(currentId)) return;
    viewedSent.current.add(currentId);
    markViewed(currentId)
      .then(refresh)
      .catch(() => viewedSent.current.delete(currentId));
  }, [currentId, currentView?.unread, detail, visible, refresh]);

  /* ── forme d'onde : crêtes de la copie d'écoute, calculées par le serveur ── */
  useEffect(() => {
    if (!currentId) return;
    let cancelled = false;
    setPeaks(null);
    setListening("pending");
    fetch(`/api/sessions/${currentId}/peaks`, { cache: "no-store" })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        if (cancelled) return;
        setPeaks({ duration: data.duration, peaks: data.peaks });
        setListening("ready");
      })
      .catch((e) => {
        if (cancelled) return;
        setListening("fallback");
        setMessage(
          `${e instanceof Error ? e.message : "Copie d’écoute indisponible"}. Lecture du fichier original : le positionnement peut y être décalé de plusieurs secondes.`,
        );
      });
    return () => {
      cancelled = true;
    };
  }, [currentId]);

  /* ── revue humaine ── */
  const needTester = useCallback(() => {
    setTab("sig");
    if (wide) update({ right: true });
    else setDrawer("right");
    setTesterFocus((n) => n + 1);
    showToast("Indique d’abord qui teste.");
  }, [showToast, update, wide]);

  const targetAt = useCallback((time: number) => {
    if (selectedRef.current !== null) return selectedRef.current;
    const index = activeIndex(intervalsRef.current, time);
    return index >= 0 ? index : null;
  }, []);

  const review = useReviewController({
    session: detail
      ? {
          id: detail.session.id,
          audio_sha256: detail.session.audio_sha256,
          prediction_sha256: detail.session.prediction_sha256,
        }
      : null,
    initial: detail?.review?.annotations ?? null,
    tester: prefs.tester,
    duration,
    getPosition: player.position,
    targetAt,
    announce: say,
    toast: showToast,
    needTester,
    reveal: () => {
      setTab("sig");
      openRight();
    },
  });
  const reviewRef = useRef(review);
  reviewRef.current = review;

  const setTester = (name: string) => {
    update({ tester: name, testers: rememberTester(prefs.testers, name) });
    say(`Testeur : ${name}`);
  };

  const listen = useCallback(
    (a: Annotation) => {
      const [start, end] = listenWindow(
        { start: a.start_s, end: a.end_s },
        duration,
      );
      timelineRef.current?.centerOn(start);
      player.playRange(start, end, {
        loop: reviewRef.current.loop,
        onDone: () => reviewRef.current.listened(a.id),
      });
    },
    [duration, player],
  );
  const setLoop = (on: boolean) => {
    review.setLoop(on);
    const draft = review.draft;
    if (on && draft) {
      const [start, end] = listenWindow(
        { start: draft.start_s, end: draft.end_s },
        duration,
      );
      player.playRange(start, end, {
        loop: true,
        onDone: () => reviewRef.current.listened(draft.id),
      });
    } else player.stopRange();
  };
  const jump = (a: Annotation) => {
    review.select(a.id);
    setFollow(false);
    player.seek(a.start_s);
    timelineRef.current?.centerOn(a.start_s);
  };
  const contextAt = (time: number) => {
    const index = activeIndex(intervals, time);
    if (index < 0) return null;
    return `${intervalLabel(intervals[index])} · ${intervalStateLabel(intervals[index])}`;
  };

  /* ── interactions du passage et des intervalles ── */
  const selectInterval = (index: number) => {
    setSelectedIndex(index);
    setFollow(false);
    const item = intervals[index];
    if (item?.t) {
      player.seek(item.t[0]);
      timelineRef.current?.centerOn(item.t[0]);
    }
  };
  const listenPassage = ([start, end]: [number, number]) => {
    timelineRef.current?.centerOn(start);
    player.playRange(start, end);
  };

  /* ── import (audio et vidéo, plusieurs fichiers) ── */
  const importer = useImporter(() => void refresh());
  const importMedia = useCallback(
    async (files: File[]) => {
      setImportNotice("");
      const { ids, errors } = await importer.importFiles(files);
      await refresh();
      if (ids.length === 1) open(ids[0]);
      else if (ids.length > 1)
        showToast(`${ids.length} fichiers ajoutés à la file d’analyse`, {
          label: "Voir la file",
          run: () => (wide ? update({ left: true }) : setDrawer("left")),
        });
      if (errors.length && ids.length <= 1) setImportNotice(errors[0]);
    },
    [importer, open, refresh, showToast, update, wide],
  );
  const importWithResult = async (audio: File, result: File) => {
    setImportNotice("");
    const { ids, errors } = await importer.importFiles([audio], { result });
    await refresh();
    if (ids.length === 1) open(ids[0]);
    else if (errors.length) setImportNotice(errors[0]);
  };
  const analyzeRecording = async (file: File) => {
    const { ids, errors } = await importer.importFiles([file], {
      source: "microphone",
    });
    await refresh();
    if (ids.length === 0) throw new Error(errors[0] ?? "Import impossible");
    if (errors.length)
      setMessage(
        `Audio conservé dans la session. L’analyse n’a pas démarré : ${errors[0]}`,
      );
    open(ids[0]);
  };
  useEffect(
    () =>
      bindMediaDrop(window, {
        onActive: setDragActive,
        onFiles: (files) => void importMedia(files),
        onError: setMessage,
      }),
    [importMedia],
  );

  const act = async (task: () => Promise<void>) => {
    setRunBusy(true);
    try {
      await task();
      await refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Action impossible");
    } finally {
      setRunBusy(false);
    }
  };

  /* ── raccourcis clavier : jamais dans un champ, désactivables (WCAG 2.1.4) ── */
  const latest = useRef({ prefs, view, detail });
  latest.current = { prefs, view, detail };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const { prefs: p, view: v, detail: d } = latest.current;
      if (v !== "revue" || !d) return;
      const target = event.target as HTMLElement;
      const typing = target.matches?.(
        "input,textarea,select,[contenteditable]",
      );
      const r = reviewRef.current;
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        if (r.draft) {
          event.preventDefault();
          r.confirm(r.draft.id);
        }
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey || typing) return;
      if (event.key === "Escape") {
        if (r.state.mark !== null) r.cancel();
        else if (r.trace) r.setTrace(false);
        return;
      }
      if (!p.shortcuts) return;
      const key = event.key.toLowerCase();
      if (key === "m") {
        event.preventDefault();
        r.press();
      } else if (key === "p") {
        event.preventDefault();
        r.point();
      } else if (key === "l" && r.draft) {
        event.preventDefault();
        setLoop(!r.loop);
      } else if (
        key === " " &&
        !target.closest?.("button,[role=tab],summary,a,[role=slider],input")
      ) {
        event.preventDefault();
        player.toggle();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // setLoop et player lus à l'appel
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── titre de l'onglet : total des résultats non lus ── */
  const unread = views.filter((v) => v.unread).length;
  useEffect(() => {
    document.title = pageTitle(unread);
  }, [unread]);

  /* ── police arabe ── */
  const defaultSize = narrow ? 32 : QURAN_SIZE.fallback;
  const appliedSize = clampQuranSize(prefs.size ?? defaultSize);
  const sample = useMemo(() => {
    const first = intervals.find(
      (i) => i.kind === "verse" && typeof i.text === "string" && i.text,
    );
    return first && first.kind === "verse" && first.text
      ? first.text.split(/\s+/).slice(0, 5).join(" ")
      : FONT_SAMPLE;
  }, [intervals]);
  const fontTools = (
    <FontPicker
      font={font}
      availability={availability}
      size={prefs.size}
      appliedSize={appliedSize}
      sample={sample}
      onFont={(id) => update({ font: id })}
      onSize={(px) => update({ size: clampQuranSize(px) })}
      onReset={() => update({ font: null, size: null })}
    />
  );

  const attention = attentionCount(views);
  const showRightPanel = rightAvailable;

  return (
    <div className="app" data-ready={ready} data-testid="app" data-view={view}>
      <IconSprite />
      <div
        className="sr"
        aria-live="polite"
        role="status"
        data-testid="live-region"
      >
        {announcement}
      </div>
      {dragActive && (
        <div className="drop-overlay" role="status" aria-live="polite">
          <div className="drop-overlay-card">
            <strong>Dépose tes fichiers ici</strong>
            <small>Audios et vidéos : chacun part dans la file d’analyse</small>
          </div>
        </div>
      )}
      <Header
        view={view}
        onView={(next) => {
          setView(next);
          setDrawer(null);
        }}
        leftOpen={leftOpen}
        rightOpen={rightOpen}
        rightAvailable={rightAvailable}
        onToggleLeft={toggleLeft}
        onToggleRight={toggleRight}
        attention={attention}
        theme={theme}
        onToggleTheme={() =>
          update({ theme: theme === "dark" ? "light" : "dark" })
        }
        leftButton={leftButton}
        rightButton={rightButton}
      />
      <div
        className="workspace"
        data-testid="workspace"
        data-left={ready ? (leftOpen ? "open" : "closed") : undefined}
        data-right={ready ? (rightOpen ? "open" : "closed") : undefined}
      >
        <aside
          ref={leftPanel}
          id="panel-left"
          className="panel panel--left"
          data-testid="panel-left"
          data-open={ready ? String(leftOpen) : undefined}
          aria-label="Sessions"
          role={!wide && leftOpen ? "dialog" : undefined}
          aria-modal={!wide && leftOpen ? true : undefined}
          tabIndex={-1}
          inert={ready && !leftOpen}
        >
          <SessionsPanel
            views={views}
            loaded={loaded}
            currentId={currentId}
            onOpen={open}
            onRefresh={() => void refresh()}
            onRetry={(id) => void act(() => runSession(id))}
            onClose={closeDrawer}
            onPerf={() => {
              setView("perf");
              setDrawer(null);
            }}
          />
        </aside>

        <main className="center" id="center" data-testid="center">
          {view === "perf" ? (
            <PerfView views={views} />
          ) : view === "new" ? (
            <NewTrial
              busy={importer.busy}
              items={importer.items}
              error={importNotice}
              onFiles={(files) => void importMedia(files)}
              onFileWithResult={(a, r) => void importWithResult(a, r)}
              onRecording={analyzeRecording}
              onClear={importer.clear}
              onSeeQueue={() => {
                setView("revue");
                if (wide) update({ left: true });
                else setDrawer("left");
              }}
            />
          ) : !currentId ? (
            <div className="stack">
              <div className="empty-state" data-testid="empty-state">
                <HeroWave />
                <h2>Le temps de l’écoute</h2>
                <p>
                  Choisis une session dans la liste pour ouvrir le lecteur, la
                  carte arabe et les pistes synchronisées, ou lance un nouvel
                  essai.
                </p>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => setView("new")}
                >
                  Nouvel essai
                </button>
              </div>
            </div>
          ) : (
            <div className="stack" data-testid="review-view">
              {message ? (
                <p
                  className="notice notice--error o-head"
                  role="alert"
                  data-testid="message"
                >
                  {message}
                </p>
              ) : null}
              {detailError && !detail ? (
                <p className="notice notice--error o-head" role="alert">
                  {detailError}
                </p>
              ) : null}
              {currentView ? (
                <SessionHead
                  view={currentView}
                  result={detail?.result ?? null}
                  busy={runBusy}
                  onRun={() => void act(() => runSession(currentView.id))}
                  onCancel={() => void act(() => cancelSession(currentView.id))}
                />
              ) : (
                <header className="o-head session-head">
                  <p className="muted">Chargement de la session…</p>
                </header>
              )}
              {detail ? (
                <>
                  <Console
                    player={player}
                    duration={duration}
                    peaks={peaks}
                    listening={listening}
                    intervals={intervals}
                    selectedIndex={selectedIndex}
                    onSelectInterval={selectInterval}
                    timelineRef={timelineRef}
                    span={span}
                    onSpan={setSpan}
                    follow={follow}
                    onFollow={setFollow}
                    review={review}
                    testerKnown={Boolean(prefs.tester)}
                    onNeedTester={needTester}
                    onSelectAnnotation={(id) => {
                      review.select(id);
                      setTab("list");
                    }}
                  />
                  <LivePassage
                    store={player.store}
                    intervals={intervals}
                    selectedIndex={selectedIndex}
                    sessionId={detail.session.id}
                    showTranslation={prefs.translation}
                    onToggleTranslation={() =>
                      update({ translation: !prefs.translation })
                    }
                    tools={fontTools}
                    onListen={listenPassage}
                  />
                  <IntervalsList
                    intervals={intervals}
                    selectedIndex={selectedIndex}
                    follow={follow}
                    onUserScroll={() => setFollow(false)}
                    onSelect={selectInterval}
                    store={player.store}
                  />
                  <details
                    className="card diag o-diag"
                    data-testid="diagnostics"
                  >
                    <summary>Détails du moteur et avertissements</summary>
                    <p style={{ marginTop: 8 }}>
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
                    {selectedIndex !== null && intervals[selectedIndex] ? (
                      <pre>
                        {JSON.stringify(intervals[selectedIndex], null, 2)}
                      </pre>
                    ) : null}
                  </details>
                </>
              ) : null}
              <footer className="o-foot foot-note">
                Texte coranique : Tanzil Project (CC BY 3.0) ·{" "}
                <a href="https://tanzil.net" target="_blank" rel="noreferrer">
                  tanzil.net
                </a>{" "}
                — non modifié. Traductions : QuranEnc.com, provenance affichée
                par passage. Aucune reconnaissance simulée.
              </footer>
            </div>
          )}
        </main>

        <aside
          ref={rightPanel}
          id="panel-right"
          className="panel panel--right"
          data-testid="panel-right"
          data-open={ready ? String(rightOpen) : undefined}
          aria-label="Revue humaine"
          role={!wide && rightOpen ? "dialog" : undefined}
          aria-modal={!wide && rightOpen ? true : undefined}
          tabIndex={-1}
          inert={ready && !rightOpen}
        >
          {showRightPanel && detail ? (
            <ReviewPanel
              sessionId={detail.session.id}
              review={review}
              tester={prefs.tester}
              recentTesters={prefs.testers}
              onTester={setTester}
              testerFocus={testerFocus}
              tab={tab}
              onTab={setTab}
              showTruth={relecteur}
              store={player.store}
              duration={duration}
              getPosition={player.position}
              contextAt={contextAt}
              onListen={listen}
              onLoop={setLoop}
              onJump={jump}
              onEdit={(a) => {
                review.edit(a.id);
                setTab("sig");
                jump(a);
              }}
              playRange={(start, end) => player.playRange(start, end)}
              resultReady={
                detail.session.state === "done" && Boolean(detail.result)
              }
              shortcuts={prefs.shortcuts}
              onShortcuts={(on) => update({ shortcuts: on })}
              onClose={closeDrawer}
            />
          ) : null}
        </aside>
      </div>
      <div className="scrim" onClick={closeDrawer} aria-hidden="true" />
      {detail ? (
        <audio
          key={detail.session.id}
          ref={player.audioRef}
          src={`/api/sessions/${detail.session.id}/audio`}
          preload="metadata"
          aria-label="Lecteur audio"
          style={{ display: "none" }}
          onError={() =>
            setMessage("Lecture impossible pour cet audio dans ce navigateur.")
          }
        />
      ) : null}
      {toast ? (
        <div className="toast" role="status" data-testid="toast">
          <span>{toast.text}</span>
          {toast.action ? (
            <button
              type="button"
              onClick={() => {
                toast.action?.run();
                setToast(null);
              }}
            >
              {toast.action.label}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
