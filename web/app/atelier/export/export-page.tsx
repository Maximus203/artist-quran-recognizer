"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "@/lib/api-client";
import type { ItemType } from "@/lib/decisions";
import {
  fetchDecisions,
  fetchReadiness,
  runExport,
  saveDecisions,
} from "@/lib/export-client";
import {
  DEFAULT_EXPORT_OPTIONS,
  exportFileName,
  type ExportOptions,
  type ExportPolicy,
} from "@/lib/export-options";
import { loadExportOptions, saveExportOptions } from "@/lib/export-prefs";
import { bytesFr, plural } from "@/lib/export-text";
import type {
  DecisionsView,
  ExportFile,
  ReadinessItem,
  ReadinessPayload,
} from "@/lib/export-types";
import {
  formatClockLength,
  formatDurationFr,
  formatRealtimeFactor,
} from "@/lib/format";
import { Icon } from "../icons";
import { useStoreValue } from "../hooks";
import { useToast } from "../use-toast";
import { usePlayer } from "../use-player";
import { XIcon } from "./export-icons";
import { ExportPreview } from "./export-preview";
import { ExportResult } from "./export-result";
import { ExportSettings } from "./export-settings";
import { ForceDialog } from "./force-dialog";
import { VideoPanel } from "./video-panel";
import { NonQuranLine, VerdictCard } from "./readiness-card";
import { Filters, ReadinessList, type RowActions } from "./readiness-list";
import { usePreview, useReadiness } from "./use-export-data";

const PAGE_SIZE = 10;

type Tab = "verifier" | "reglages" | "video";

export const correctionHref = (sessionId: string, key: string): string =>
  `/s/${sessionId}/exporter/corriger?item=${encodeURIComponent(key)}`;

/** Un échec lisible : ce qui s'est passé, ce qui est intact, ce qu'on peut faire (jamais une trace brute). */
function ErrorPanel({
  error,
  sessionId,
  onRetry,
}: {
  error: ApiError;
  sessionId: string;
  onRetry: () => void;
}) {
  if (error.status === 404)
    return (
      <div className="ex-state" role="alert" data-testid="state-missing">
        <h3>Session introuvable</h3>
        <p>Cette session n’existe pas, ou tu n’as pas le droit de la voir.</p>
        <Link className="btn btn--secondary" href="/sessions">
          Voir mes sessions
        </Link>
      </div>
    );
  if (error.code === "not_ready")
    return (
      <div className="ex-state" role="status" data-testid="state-not-ready">
        <h3>L’analyse n’est pas terminée</h3>
        <p>
          Il n’y a pas encore de résultat à exporter. Reviens à la session : tu
          y suis la progression.
        </p>
        <Link className="btn btn--primary" href={`/?session=${sessionId}`}>
          Voir la session
        </Link>
      </div>
    );
  return (
    <div className="ex-state" role="alert" data-testid="state-error">
      <h3>Le contrôle n’a pas pu se faire</h3>
      <p>
        {error.message} Tes décisions sont intactes : rien n’a été perdu.
        Réessaie ; si cela continue, le moteur d’export n’est peut-être pas
        lancé sur ce serveur.
      </p>
      <button type="button" className="btn btn--primary" onClick={onRetry}>
        Réessayer
      </button>
    </div>
  );
}

function ExportView({
  sessionId,
  initial,
}: {
  sessionId: string;
  initial: ExportOptions;
}) {
  const [options, setOptions] = useState<ExportOptions>(initial);
  const patch = useCallback((change: Partial<ExportOptions>) => {
    setOptions((current) => {
      const next = { ...current, ...change };
      saveExportOptions(next);
      return next;
    });
  }, []);
  const [type, setType] = useState<ItemType | null>(null);
  const [page, setPage] = useState(0);
  const [tab, setTab] = useState<Tab>("verifier");
  const [fileName, setFileName] = useState("");
  const [live, setLive] = useState("");
  const announce = useCallback((message: string) => {
    setLive("");
    setTimeout(() => setLive(message), 30);
  }, []);
  const toast = useToast();

  const ready = useReadiness(sessionId, options, {
    page,
    size: PAGE_SIZE,
    type,
  });
  const data: ReadinessPayload | null = ready.data;
  const preview = usePreview(
    sessionId,
    options,
    data ? data.decisions_sha256 : null,
  );
  const canEdit = data?.session?.can_edit ?? false;

  // --- lecture : un seul <audio> pour toute la page -------------------------------------------
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const player = usePlayer(sessionId, {
    onError: announce,
    onPlay: () => undefined,
    rate: 1,
    volume: 1,
    onRate: () => undefined,
    onVolume: () => undefined,
  });
  const playing = useStoreValue(player.store, (s) => s.playing);
  useEffect(() => {
    if (!playing) setPlayingKey(null);
  }, [playing]);
  const listen = useCallback(
    (item: ReadinessItem) => {
      if (playingKey === item.key) {
        player.toggle();
        setPlayingKey(null);
        return;
      }
      setPlayingKey(item.key);
      player.playRange(item.t[0], item.t[1], {
        onDone: () => setPlayingKey(null),
      });
    },
    [player, playingKey],
  );

  // --- décisions : ignorer, annuler ------------------------------------------------------------
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const change = useCallback(
    async (
      item: ReadinessItem,
      ops: Parameters<typeof saveDecisions>[1],
      doneMessage: string,
      undo?: () => void,
    ) => {
      setBusyKey(item.key);
      try {
        await saveDecisions(sessionId, ops);
        ready.reload();
        announce(doneMessage);
        toast.show(
          doneMessage,
          undo ? { label: "Annuler", run: undo } : undefined,
        );
      } catch (error) {
        toast.show(
          error instanceof Error ? error.message : "Enregistrement impossible.",
        );
      } finally {
        setBusyKey(null);
      }
    },
    [announce, ready, sessionId, toast],
  );
  const withdraw = useCallback(
    (item: ReadinessItem) => {
      if (!item.decision) return;
      void change(
        item,
        [{ op: "withdraw", id: item.decision.id }],
        "Décision annulée : le passage est de nouveau à vérifier.",
      );
    },
    [change],
  );
  const ignore = useCallback(
    (item: ReadinessItem) => {
      void change(
        item,
        [
          {
            op: "decide",
            item: item.type,
            index: item.index,
            review_ids:
              item.index === null || item.type === "report"
                ? item.review_ids
                : undefined,
            kind: "ignore",
            value: {},
          },
        ],
        "Passage ignoré : il sera exporté selon la règle par défaut (omis).",
      );
    },
    [change],
  );
  const actions: RowActions = useMemo(
    () => ({
      listen,
      playingKey,
      ignore,
      undo: withdraw,
      seek: (item) => player.seek(item.t[0]),
      correctHref: (item) => correctionHref(sessionId, item.key),
      canEdit,
      busyKey,
    }),
    [busyKey, canEdit, ignore, listen, player, playingKey, sessionId, withdraw],
  );

  // --- forcer, exporter, résultat -----------------------------------------------------------------
  const [dialog, setDialog] = useState(false);
  const [policy, setPolicy] = useState<ExportPolicy>("omit");
  const [forceItems, setForceItems] = useState<ReadinessItem[]>([]);
  const [forceLoading, setForceLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [file, setFile] = useState<ExportFile | null>(null);
  const [decisions, setDecisions] = useState<DecisionsView | null>(null);
  const forceButton = useRef<HTMLButtonElement>(null);

  const openForce = useCallback(async () => {
    setExportError(null);
    setPolicy("omit");
    setDialog(true);
    setForceLoading(true);
    try {
      const open = await fetchReadiness(sessionId, options, {
        state: "open",
        size: 50,
      });
      setForceItems(open.items);
    } catch {
      setForceItems([]);
    } finally {
      setForceLoading(false);
    }
  }, [options, sessionId]);

  const finish = useCallback(
    async (exported: ExportFile) => {
      setFile(exported);
      setDialog(false);
      if (exported.summary.applied > 0)
        void fetchDecisions(sessionId).then(setDecisions, () => undefined);
    },
    [sessionId],
  );
  const exportNow = useCallback(
    async (forced: boolean) => {
      setBusy(true);
      setExportError(null);
      try {
        await finish(
          await runExport(
            sessionId,
            forced
              ? { ...options, allow_unresolved: true, policy }
              : { ...options, allow_unresolved: false },
            fileName.trim() || undefined,
          ),
        );
      } catch (error) {
        const message =
          error instanceof ApiError && error.code === "unresolved_items"
            ? "Des passages ambigus restent à corriger : le contrôle vient de changer."
            : error instanceof Error
              ? error.message
              : "L’export a échoué.";
        setExportError(message);
        if (!forced) toast.show(message);
        ready.reload();
      } finally {
        setBusy(false);
      }
    },
    [fileName, finish, options, policy, ready, sessionId, toast],
  );
  const setTraining = useCallback(
    async (use: boolean) => {
      try {
        setDecisions(
          await saveDecisions(sessionId, [{ op: "consent", training: use }]),
        );
        announce(
          use
            ? "Accord redonné."
            : "Accord retiré : tes décisions ne servent qu’à cet export.",
        );
      } catch (error) {
        toast.show(
          error instanceof Error
            ? error.message
            : "Impossible de changer l’accord.",
        );
      }
    },
    [announce, sessionId, toast],
  );

  const goNextOpen = useCallback(() => {
    if (data?.first_open_page !== null && data?.first_open_page !== undefined)
      setPage(data.first_open_page);
  }, [data]);

  // Un changement de contenu ou de filtre ramène à la première page.
  useEffect(() => setPage(0), [type, options.content, options.show_ref]);

  const session = data?.session;
  const verdict = data?.verdict;
  const firstHref = data?.first_open
    ? correctionHref(sessionId, data.first_open)
    : null;
  /** Rien à régler tant que le contrôle n'a pas répondu : une session absente ou non terminée n'exporte pas. */
  const failed = Boolean(ready.error && !data);
  const defaultName = exportFileName(session?.name ?? "sous-titres", options);
  const formatLabel =
    options.format === "vtt" ? "WebVTT" : options.format.toUpperCase();

  if (file)
    return (
      <>
        <Crumb sessionId={sessionId} name={session?.name} />
        <ExportResult
          file={file}
          decisions={decisions}
          onAgain={() => {
            setFile(null);
            ready.reload();
          }}
          onTraining={(use) => void setTraining(use)}
          announce={announce}
        />
        <Live text={live} />
        {toast.node}
      </>
    );

  return (
    <>
      <Crumb sessionId={sessionId} name={session?.name} />
      <audio
        ref={player.attach}
        src={`/api/sessions/${sessionId}/audio`}
        preload="metadata"
        aria-hidden="true"
      />
      <div
        className="ex-xp"
        data-tab={tab}
        data-failed={failed ? "" : undefined}
        data-testid="export-page"
      >
        <div className="ex-xp-head">
          <h1 className="ex-xp-title">
            {tab === "video" ? (
              <>
                Exporter la <em>vidéo</em>
              </>
            ) : (
              <>
                Exporter les <em>sous-titres</em>
              </>
            )}
          </h1>
          {session && verdict && data ? (
            <p className="ex-xp-facts">
              <span className="ex-f">
                <Icon name="audio" size={16} />
                Audio
                {session.audio_duration_s ? (
                  <>
                    {" · "}
                    <span className="mono">
                      {formatClockLength(session.audio_duration_s)}
                    </span>
                  </>
                ) : null}
              </span>
              {session.duration_s ? (
                <span className="ex-f">
                  Terminé en{" "}
                  <b className="mono" style={{ fontWeight: 600 }}>
                    {formatDurationFr(session.duration_s)}
                  </b>
                  {formatRealtimeFactor(
                    session.audio_duration_s,
                    session.duration_s,
                  )
                    ? ` · ${formatRealtimeFactor(session.audio_duration_s, session.duration_s)} temps réel`
                    : ""}
                </span>
              ) : null}
              <span className="ex-f">
                <span className="mono">{data.verses}</span>&nbsp;passages
                coraniques ·{" "}
                <span className="mono">
                  {data.non_quran.abstentions + data.non_quran.formulas}
                </span>
                &nbsp;non coraniques ignorés
              </span>
            </p>
          ) : null}
          <div
            className="ex-seg-tabs"
            role="tablist"
            aria-label="Étapes de l’export"
            hidden={failed}
          >
            <button
              type="button"
              role="tab"
              id="ex-tab-verifier"
              aria-selected={tab === "verifier"}
              data-testid="tab-verifier"
              onClick={() => setTab("verifier")}
            >
              1 · Vérifier{" "}
              {verdict && verdict.unresolved > 0 ? (
                <span className="n">{verdict.unresolved}</span>
              ) : null}
            </button>
            <button
              type="button"
              role="tab"
              id="ex-tab-reglages"
              aria-selected={tab === "reglages"}
              data-testid="tab-reglages"
              onClick={() => setTab("reglages")}
            >
              2 · Réglages
            </button>
            <button
              type="button"
              role="tab"
              id="ex-tab-video"
              aria-selected={tab === "video"}
              data-testid="tab-video"
              onClick={() => setTab("video")}
            >
              3 · Vidéo
            </button>
          </div>
        </div>

        <section
          className="ex-xcol ex-xcol--check"
          aria-labelledby="ex-list-h"
          aria-busy={ready.loading}
        >
          {ready.error && !data ? (
            <ErrorPanel
              error={ready.error}
              sessionId={sessionId}
              onRetry={ready.reload}
            />
          ) : !data || !verdict ? (
            <div className="ex-skel" aria-hidden="true" data-testid="loading">
              <i />
              <i />
              <i />
            </div>
          ) : (
            <>
              <VerdictCard
                payload={data}
                canEdit={canEdit}
                correctHref={firstHref}
                onForce={() => void openForce()}
              />
              {ready.error ? (
                <p className="notice notice--error" role="alert">
                  {ready.error.message}
                </p>
              ) : null}
              <NonQuranLine nonQuran={data.non_quran} />
              {data.orphans.length > 0 ? (
                <OrphansNotice
                  sessionId={sessionId}
                  orphans={data.orphans.length}
                  canEdit={canEdit}
                  onDone={ready.reload}
                  announce={announce}
                />
              ) : null}
              {data.verses > 0 &&
              (data.verdict.total > 0 || data.ineffective.total > 0) ? (
                <>
                  <Filters payload={data} value={type} onChange={setType} />
                  <ReadinessList
                    payload={data}
                    loading={ready.loading}
                    slow={ready.slow}
                    page={page}
                    onPage={setPage}
                    onNextOpen={goNextOpen}
                    actions={actions}
                  />
                </>
              ) : null}
              {!canEdit && verdict.unresolved > 0 ? (
                <p
                  className="muted"
                  style={{ fontSize: "var(--fs-sm)" }}
                  data-testid="read-only"
                >
                  Seul le propriétaire corrige. Tu peux forcer l’export : les
                  passages ambigus seront alors traités selon la règle choisie.
                </p>
              ) : null}
            </>
          )}
        </section>

        <aside
          className="ex-xcol ex-xcol--set"
          aria-labelledby="ex-set-h"
          hidden={failed}
        >
          <form className="ex-set" onSubmit={(event) => event.preventDefault()}>
            <ExportSettings
              options={options}
              onChange={patch}
              fileName={fileName}
              onFileName={setFileName}
              defaultFileName={defaultName}
            />
            <ExportPreview
              summary={preview.data}
              loading={preview.loading}
              slow={preview.slow}
              error={preview.error ? preview.error.message : null}
              options={options}
              correctHref={
                canEdit ? (key) => correctionHref(sessionId, key) : null
              }
            />
            <div className="ex-set-foot">
              <div className="ex-btnrow">
                {verdict?.ready ? (
                  <button
                    className="btn btn--primary btn--lg btn--block"
                    type="button"
                    data-testid="go"
                    disabled={busy}
                    onClick={() => void exportNow(false)}
                  >
                    <XIcon name="download" />
                    Exporter en {formatLabel}
                  </button>
                ) : null}
                <button
                  ref={forceButton}
                  className="btn btn--secondary btn--lg btn--block"
                  type="button"
                  data-testid="force"
                  disabled={!verdict || verdict.ready || verdict.total === 0}
                  onClick={() => void openForce()}
                >
                  Forcer l’export…
                </button>
              </div>
              <p className="ex-micro" data-testid="micro">
                {preview.data ? (
                  <>
                    <b>{preview.data.cues}</b> sous-titres · ≈{" "}
                    {bytesFr(preview.data.bytes)}
                    {verdict && verdict.unresolved > 0
                      ? ` · ${plural(verdict.unresolved, "passage ambigu", "passages ambigus")} à traiter`
                      : ""}
                  </>
                ) : (
                  " "
                )}
              </p>
            </div>
          </form>
        </aside>

        <section
          className="ex-xcol ex-xcol--video"
          aria-labelledby="ex-video-h"
          hidden={failed}
        >
          {tab === "video" && !failed ? (
            <VideoPanel sessionId={sessionId} onError={toast.show} />
          ) : null}
        </section>
      </div>

      <div
        className="ex-stickybar"
        data-tab={tab}
        data-testid="stickybar"
        hidden={failed || tab === "video"}
      >
        <button
          type="button"
          className="btn btn--ghost"
          disabled={!verdict || verdict.ready || verdict.total === 0}
          onClick={() => void openForce()}
        >
          Forcer l’export
        </button>
        {verdict?.ready ? (
          <button
            type="button"
            className="btn btn--primary btn--lg"
            disabled={busy}
            data-testid="go-mobile"
            onClick={() => void exportNow(false)}
          >
            Exporter
          </button>
        ) : canEdit && firstHref ? (
          <Link
            className="btn btn--primary btn--lg"
            href={firstHref}
            data-testid="correct-mobile"
          >
            Corriger ({verdict?.unresolved ?? 0})
          </Link>
        ) : null}
      </div>

      <ForceDialog
        open={dialog}
        unresolved={verdict?.unresolved ?? 0}
        items={forceItems}
        loading={forceLoading}
        policy={policy}
        onPolicy={setPolicy}
        busy={busy}
        error={exportError}
        onClose={() => setDialog(false)}
        onConfirm={() => void exportNow(true)}
        returnTo={forceButton}
      />
      <Live text={live} />
      {toast.node}
    </>
  );
}

function Crumb({ sessionId, name }: { sessionId: string; name?: string }) {
  return (
    <nav className="ex-crumb" aria-label="Fil d’Ariane">
      <Link href={`/?session=${sessionId}`}>
        <XIcon name="chev-l" size={16} />
        Retour à la session
      </Link>
      {name ? (
        <>
          <span aria-hidden="true">/</span>
          <span>{name}</span>
        </>
      ) : null}
    </nav>
  );
}

/** Une seule région annoncée aux lecteurs d'écran : « 2 sur 6 résolus. 4 restants. », « Export terminé… ». */
export function Live({ text }: { text: string }) {
  return (
    <div className="sr" aria-live="polite" role="status" data-testid="live">
      {text}
    </div>
  );
}

/** Décisions orphelines après une nouvelle analyse : jamais appliquées en silence, jamais perdues. */
function OrphansNotice({
  sessionId,
  orphans,
  canEdit,
  onDone,
  announce,
}: {
  sessionId: string;
  orphans: number;
  canEdit: boolean;
  onDone: () => void;
  announce: (message: string) => void;
}) {
  const [view, setView] = useState<DecisionsView | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open && !view)
      void fetchDecisions(sessionId).then(setView, () => undefined);
  }, [open, sessionId, view]);
  const apply = async (
    ops: Parameters<typeof saveDecisions>[1],
    message: string,
  ) => {
    setBusy(true);
    try {
      setView(await saveDecisions(sessionId, ops));
      announce(message);
      onDone();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="ex-neutral-line ex-orphans" data-testid="orphans">
      <XIcon name="alert" />
      <div>
        <p>
          <b style={{ fontWeight: 600, color: "var(--text)" }}>
            {plural(
              orphans,
              "décision n’a plus son passage",
              "décisions n’ont plus leur passage",
            )}
          </b>{" "}
          : l’analyse a été refaite et le moteur ne produit plus tel quel{" "}
          {orphans > 1 ? "ces passages" : "ce passage"}. Elle n’est pas
          appliquée à un autre passage.{" "}
          {canEdit ? (
            <button
              type="button"
              className="ex-link"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              {open ? "Masquer" : "Voir et rattacher"}
            </button>
          ) : null}
        </p>
        {open && view ? (
          <ul className="ex-plain-list" data-testid="orphan-list">
            {view.orphans.map(({ decision, suggestion }) => (
              <li key={decision.id}>
                <span className="mono">
                  {String(decision.target.snapshot.ref ?? "?")}
                </span>
                {" · "}
                {suggestion ? (
                  <>
                    passage proche : <b>{suggestion.ref}</b>{" "}
                    <button
                      type="button"
                      className="ex-link"
                      disabled={busy}
                      data-testid="reattach"
                      onClick={() =>
                        void apply(
                          [
                            {
                              op: "reattach",
                              id: decision.id,
                              index: suggestion.index,
                            },
                          ],
                          "Décision rattachée au passage proche.",
                        )
                      }
                    >
                      Rattacher
                    </button>
                  </>
                ) : (
                  "aucun passage proche"
                )}{" "}
                <button
                  type="button"
                  className="ex-link"
                  disabled={busy}
                  data-testid="drop-orphan"
                  onClick={() =>
                    void apply(
                      [{ op: "withdraw", id: decision.id }],
                      "Décision retirée.",
                    )
                  }
                >
                  Retirer
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

/** La page « Exporter les sous-titres » : vérifier à gauche, régler à droite, une action en bas. */
export function ExportPage({ sessionId }: { sessionId: string }) {
  const [initial, setInitial] = useState<ExportOptions | null>(null);
  useEffect(() => setInitial(loadExportOptions()), []);
  return (
    <div className="ex-xp-page">
      <div className="ex-xp-wrap">
        {initial ? (
          <ExportView sessionId={sessionId} initial={initial} />
        ) : (
          <>
            <Crumb sessionId={sessionId} />
            <div className="ex-skel" aria-hidden="true">
              <i />
              <i />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export { DEFAULT_EXPORT_OPTIONS };
