"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bindMediaDrop, isVideoName } from "@/lib/audio-upload";
import { listenWindow } from "@/lib/marking";
import { activeIndex, intervalLabel, intervalStateLabel } from "@/lib/passage";
import type { Preferences } from "@/lib/preferences-schema";
import { canModifyAnnotation } from "@/lib/review-access";
import type { Annotation } from "@/lib/review";
import { isSessionId } from "@/lib/session-id";
import { pageTitle } from "@/lib/session-list";
import { canImport } from "@/lib/storage-meter";
import { QURAN_SIZE, clampQuranSize } from "@/lib/ui-prefs";
import { Console, SKIP_SECONDS, type ListeningState } from "./atelier/console";
import { FontPicker, FONT_SAMPLE } from "./atelier/font-picker";
import { Header } from "./atelier/header";
import {
  useFocusTrap,
  useMedia,
  usePageVisible,
  useStoreValue,
} from "./atelier/hooks";
import { IntervalsList } from "./atelier/intervals-list";
import { NewTrial } from "./atelier/new-trial";
import { LivePassage } from "./atelier/passage-card";
import { ReviewPanel, type ReviewTab } from "./atelier/review-panel";
import { SessionHead } from "./atelier/session-head";
import { SessionsPanel } from "./atelier/sessions-panel";
import { useShell } from "./atelier/shell";
import type { TimelineHandle } from "./atelier/timeline";
import { usePlayer } from "./atelier/use-player";
import { useReviewController, type ToastAction } from "./atelier/use-review";
import {
  cancelSession,
  markViewed,
  patchSession,
  runSession,
  setFavorite,
  useImporter,
  useSessionDetail,
  useSidebarSessions,
  type Visibility,
} from "./atelier/use-sessions";

type Peaks = { duration: number; peaks: number[] };
type View = "revue" | "new";
const TOAST_MS = 6000;
const VIEWED_RETRY_MS = 4000;

export default function ReviewApp() {
  const {
    prefs,
    update,
    user,
    quota,
    refreshQuota,
    font,
    fontAvailability,
    mounted,
  } = useShell();
  const ready = mounted;
  const wide = useMedia("(min-width: 1280px)");
  const narrow = useMedia("(max-width: 767px)");
  const visible = usePageVisible();
  const sidebar = useSidebarSessions();
  const admin = user.role === "admin";
  const me = useMemo(
    () => ({ username: user.username, admin }),
    [user.username, admin],
  );

  const [view, setView] = useState<View>("new");
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<"left" | "right" | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [follow, setFollow] = useState(prefs.followPlayback);
  const [message, setMessage] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [toast, setToast] = useState<{
    text: string;
    action?: ToastAction;
  } | null>(null);
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
  const viewedSent = useRef(new Map<string, number>());
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    detail,
    error: detailError,
    notFound,
    patch,
    reload,
  } = useSessionDetail(currentId);
  const currentView = detail?.session ?? null;
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
    rate: prefs.playbackRate,
    volume: prefs.volume,
    onRate: (playbackRate) => update({ playbackRate }),
    onVolume: (volume) => update({ volume }),
  });
  const playerDuration = useStoreValue(player.store, (s) => s.duration);
  const duration =
    playerDuration || peaks?.duration || detail?.result?.source.duration_s || 0;

  /* ── panneaux : bureau = préférences du compte, en dessous = tiroirs ── */
  const showingNew = view === "new" || currentId === null;
  const rightAvailable = !showingNew;
  const leftOpen = wide ? prefs.leftPanelOpen !== false : drawer === "left";
  const rightOpen =
    rightAvailable &&
    (wide ? prefs.rightPanelOpen !== false : drawer === "right");
  const toggleLeft = () =>
    wide
      ? update({ leftPanelOpen: !leftOpen })
      : setDrawer(drawer === "left" ? null : "left");
  const toggleRight = () =>
    wide
      ? update({ rightPanelOpen: !rightOpen })
      : setDrawer(drawer === "right" ? null : "right");
  const closeDrawer = useCallback(() => setDrawer(null), []);
  const openRight = useCallback(() => {
    if (wide) update({ rightPanelOpen: true });
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
  const open = useCallback(
    (id: string) => {
      setCurrentId(id);
      setView("revue");
      setSelectedIndex(null);
      setMessage("");
      setFollow(prefs.followPlayback);
      setDrawer(null);
      history.replaceState(null, "", `?session=${id}`);
    },
    [prefs.followPlayback],
  );
  const showNew = useCallback(() => {
    setView("new");
    setDrawer(null);
    history.replaceState(null, "", "?vue=new");
  }, []);
  const showReview = useCallback(() => {
    setDrawer(null);
    if (currentId) {
      setView("revue");
      history.replaceState(null, "", `?session=${currentId}`);
    } else showNew();
  }, [currentId, showNew]);

  useEffect(() => {
    const id = new URLSearchParams(location.search).get("session");
    if (isSessionId(id)) open(id);
    // une seule fois, au montage
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* « Non lu » disparaît quand on OUVRE le résultat, jamais par simple sondage. */
  useEffect(() => {
    if (!currentId || !currentView?.unread || !detail || !visible) return;
    // Une session affichée est lue. Si le serveur la redonne « non lue » juste après (fin tardive du
    // processus du moteur qui réécrit l'issue), on le redit, sans jamais marteler le serveur.
    const last = viewedSent.current.get(currentId);
    if (last !== undefined && Date.now() - last < VIEWED_RETRY_MS) return;
    viewedSent.current.set(currentId, Date.now());
    markViewed(currentId)
      .then(() => {
        patch({ unread: false });
        return sidebar.refresh();
      })
      .catch(() => viewedSent.current.delete(currentId));
  }, [currentId, currentView?.unread, detail, visible, patch, sidebar]);

  /* ── forme d'onde : crêtes de la copie d'écoute, calculées par le serveur ── */
  // Seulement une fois la session connue : une session absente ou privée n'a pas de forme d'onde.
  const detailId = detail?.session.id ?? null;
  useEffect(() => {
    if (!detailId) return;
    let cancelled = false;
    setPeaks(null);
    setListening("pending");
    fetch(`/api/sessions/${detailId}/peaks`, { cache: "no-store" })
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
  }, [detailId]);

  /* ── revue humaine : l'auteur est le compte connecté ── */
  const targetAt = useCallback((time: number) => {
    if (selectedRef.current !== null) return selectedRef.current;
    const index = activeIndex(intervalsRef.current, time);
    return index >= 0 ? index : null;
  }, []);

  const tab: ReviewTab =
    prefs.reviewTab === "truth" && !admin ? "sig" : prefs.reviewTab;
  const setTab = useCallback(
    (next: ReviewTab) => update({ reviewTab: next }),
    [update],
  );

  const review = useReviewController({
    session: detail
      ? {
          id: detail.session.id,
          audio_sha256: detail.session.audio_sha256,
          prediction_sha256: detail.session.prediction_sha256,
        }
      : null,
    initial: detail?.review?.annotations ?? null,
    tester: user.username,
    canModify: (annotation) => canModifyAnnotation(annotation, me),
    duration,
    getPosition: player.position,
    targetAt,
    announce: say,
    toast: showToast,
    reveal: () => {
      setTab("sig");
      openRight();
    },
  });
  const reviewRef = useRef(review);
  reviewRef.current = review;

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
  const visibility: Visibility = prefs.defaultVisibility;
  const importer = useImporter(() => {
    void sidebar.refresh();
    void refreshQuota();
  });

  /** Refuse AVANT l'envoi ce qui dépasse la taille permise ou l'espace libre. */
  const admissible = useCallback(
    (files: File[]): { ok: File[]; refusal: string } => {
      const ok: File[] = [];
      let refusal = "";
      let used = quota.used_bytes;
      for (const file of files) {
        const check = canImport(
          file.size,
          { used_bytes: used, limit_bytes: quota.limit_bytes },
          isVideoName(file.name) ? quota.max_video_bytes : quota.max_file_bytes,
        );
        if (check.ok) {
          ok.push(file);
          used += file.size;
        } else if (!refusal) refusal = check.message;
      }
      return { ok, refusal };
    },
    [quota],
  );

  const importMedia = useCallback(
    async (files: File[]) => {
      setImportNotice("");
      const { ok, refusal } = admissible(files);
      if (refusal) setImportNotice(refusal);
      if (ok.length === 0) return;
      const { ids, errors } = await importer.importFiles(ok, { visibility });
      await sidebar.refresh();
      if (ids.length === 1) open(ids[0]);
      else if (ids.length > 1)
        showToast(`${ids.length} fichiers ajoutés à la file d’analyse`, {
          label: "Voir la file",
          run: () =>
            wide ? update({ leftPanelOpen: true }) : setDrawer("left"),
        });
      if (errors.length && ids.length <= 1 && !refusal)
        setImportNotice(errors[0]);
    },
    [admissible, importer, visibility, sidebar, open, showToast, update, wide],
  );
  const importWithResult = async (audio: File, result: File) => {
    setImportNotice("");
    const { ok, refusal } = admissible([audio]);
    if (ok.length === 0) return setImportNotice(refusal);
    const { ids, errors } = await importer.importFiles(ok, {
      result,
      visibility,
    });
    await sidebar.refresh();
    if (ids.length === 1) open(ids[0]);
    else if (errors.length) setImportNotice(errors[0]);
  };
  const analyzeRecording = async (file: File) => {
    const { ok, refusal } = admissible([file]);
    if (ok.length === 0) throw new Error(refusal);
    const { ids, errors } = await importer.importFiles(ok, {
      source: "microphone",
      visibility,
    });
    await sidebar.refresh();
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

  const act = async (task: () => Promise<unknown>) => {
    setRunBusy(true);
    try {
      await task();
      await Promise.all([sidebar.refresh(), reload()]);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Action impossible");
    } finally {
      setRunBusy(false);
    }
  };

  /* ── gestes sur la session ouverte : renommer, favori, portée, archiver ── */
  const rename = async (name: string | null) => {
    if (!currentView) return;
    try {
      const { session } = await patchSession(currentView.id, { name });
      patch({ name: session.name, name_source: session.name_source });
      say(
        name === null
          ? "Nom par défaut rétabli"
          : `Nom enregistré : ${session.name}`,
      );
      void sidebar.refresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Renommage impossible");
    }
  };
  const toggleFavorite = async () => {
    if (!currentView) return;
    const on = !currentView.favorite;
    patch({ favorite: on });
    try {
      await setFavorite(currentView.id, on);
      say(on ? "Ajouté aux favoris" : "Retiré des favoris");
      void sidebar.refresh();
    } catch (e) {
      patch({ favorite: !on });
      showToast(e instanceof Error ? e.message : "Favori impossible");
    }
  };
  const changeVisibility = async (next: Visibility) => {
    if (!currentView) return;
    const before = currentView.visibility;
    patch({ visibility: next });
    try {
      await patchSession(currentView.id, { visibility: next });
      say(
        next === "global" ? "Session rendue globale" : "Session rendue privée",
      );
      void sidebar.refresh();
    } catch (e) {
      patch({ visibility: before });
      showToast(e instanceof Error ? e.message : "Changement impossible");
    }
  };
  const archive = async (archived: boolean) => {
    if (!currentView) return;
    const before = currentView.archived_at;
    patch({ archived_at: archived ? new Date().toISOString() : null });
    try {
      await patchSession(currentView.id, { archived });
      void sidebar.refresh();
      showToast(archived ? "Session archivée" : "Session restaurée", {
        label: "Annuler",
        run: () => {
          patch({ archived_at: before });
          void patchSession(currentView.id, { archived: !archived }).then(() =>
            sidebar.refresh(),
          );
        },
      });
    } catch (e) {
      patch({ archived_at: before });
      showToast(e instanceof Error ? e.message : "Archivage impossible");
    }
  };

  /* ── raccourcis clavier : jamais dans un champ, désactivables (WCAG 2.1.4) ── */
  const latest = useRef({ prefs, showingNew, detail });
  latest.current = { prefs, showingNew, detail };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const { prefs: p, showingNew: onNew, detail: d } = latest.current;
      if (onNew || !d) return;
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
      if (
        (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
        !target.closest?.(
          "[role=slider],[role=tab],[role=radio],[role=menuitem],[role=switch],[role=dialog]",
        )
      ) {
        event.preventDefault();
        const back = event.key === "ArrowLeft";
        player.skip(back ? -SKIP_SECONDS : SKIP_SECONDS);
        say(back ? "Reculé de 5 secondes" : "Avancé de 5 secondes");
        return;
      }
      if (!p.shortcutsEnabled) return;
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
  const unread = sidebar.counts?.states.unread ?? 0;
  useEffect(() => {
    document.title = pageTitle(unread);
  }, [unread]);

  /* ── police arabe ── */
  const defaultSize = narrow ? 32 : QURAN_SIZE.fallback;
  const appliedSize = clampQuranSize(prefs.arabicSize ?? defaultSize);
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
      availability={fontAvailability}
      size={prefs.arabicSize}
      appliedSize={appliedSize}
      sample={sample}
      onFont={(id) => update({ arabicFont: id })}
      onSize={(px) => update({ arabicSize: clampQuranSize(px) })}
      onReset={() => update({ arabicFont: null, arabicSize: null })}
    />
  );

  const attention = unread + sidebar.queue.filter((s) => s.mine).length;
  const showRightPanel = rightAvailable;

  return (
    <div className="app" data-ready={ready} data-testid="app" data-view={view}>
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
        active="revue"
        onRevue={showReview}
        onNew={showNew}
        left={{
          open: leftOpen,
          onToggle: toggleLeft,
          buttonRef: leftButton,
          attention,
        }}
        right={{
          open: rightOpen,
          onToggle: toggleRight,
          buttonRef: rightButton,
          available: rightAvailable,
        }}
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
            data={sidebar}
            currentId={currentId}
            onOpen={open}
            onRefresh={() => void sidebar.refresh()}
            onRetry={(id) => void act(() => runSession(id))}
            onClose={closeDrawer}
          />
        </aside>

        <main className="center" id="center" data-testid="center">
          {showingNew ? (
            <NewTrial
              busy={importer.busy}
              items={importer.items}
              error={importNotice}
              onFiles={(files) => void importMedia(files)}
              onFileWithResult={(a, r) => void importWithResult(a, r)}
              onRecording={analyzeRecording}
              onClear={importer.clear}
              visibility={visibility}
              onVisibility={(next) => update({ defaultVisibility: next })}
              quota={quota}
              onSeeQueue={() => {
                if (wide) update({ leftPanelOpen: true });
                else setDrawer("left");
              }}
            />
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
                <div
                  className="notice notice--error o-head"
                  role="alert"
                  data-testid="detail-error"
                >
                  <p>{detailError}</p>
                  {notFound ? (
                    <p style={{ marginTop: 8 }}>
                      <button
                        type="button"
                        className="btn btn--secondary btn--sm"
                        onClick={showNew}
                      >
                        Nouvel essai
                      </button>
                    </p>
                  ) : null}
                </div>
              ) : null}
              {currentView ? (
                <SessionHead
                  view={currentView}
                  result={detail?.result ?? null}
                  busy={runBusy}
                  onRun={() => void act(() => runSession(currentView.id))}
                  onCancel={() => void act(() => cancelSession(currentView.id))}
                  onRename={rename}
                  onFavorite={() => void toggleFavorite()}
                  onVisibility={(next) => void changeVisibility(next)}
                  onArchive={(archived) => void archive(archived)}
                />
              ) : !detailError ? (
                <header className="o-head session-head">
                  <p className="muted">Chargement de la session…</p>
                </header>
              ) : null}
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
                    span={prefs.visibleSpanSeconds}
                    onSpan={(span) =>
                      update({
                        visibleSpanSeconds:
                          span as Preferences["visibleSpanSeconds"],
                      })
                    }
                    follow={follow}
                    onFollow={setFollow}
                    onFollowToggle={(on) => {
                      setFollow(on);
                      update({ followPlayback: on });
                    }}
                    review={review}
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
              me={me}
              tab={tab}
              onTab={setTab}
              showTruth={admin}
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
              shortcuts={prefs.shortcutsEnabled}
              onShortcuts={(on) => update({ shortcutsEnabled: on })}
              onClose={closeDrawer}
            />
          ) : null}
        </aside>
      </div>
      <div className="scrim" onClick={closeDrawer} aria-hidden="true" />
      {detail ? (
        <audio
          key={detail.session.id}
          ref={player.attach}
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
