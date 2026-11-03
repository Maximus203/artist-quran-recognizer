"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "@/lib/api-client";
import {
  lookupVerse,
  saveDecisions,
  type DecisionOp,
} from "@/lib/export-client";
import {
  buildDecision,
  choicesFor,
  correctionTitle,
  pickOf,
  type DecisionDraft,
} from "@/lib/export-decision";
import { clearOps, pendingOps, queueOps } from "@/lib/export-draft";
import { ListenMeter } from "@/lib/export-listen";
import { neighbours } from "@/lib/export-neighbours";
import type { ExportOptions } from "@/lib/export-options";
import { loadExportOptions } from "@/lib/export-prefs";
import {
  IMPACT_LABEL,
  TYPE_LABEL,
  clock,
  decisionLabel,
  engineLabel,
  plural,
  secondsFr,
  why,
  wordsLabel,
} from "@/lib/export-text";
import type {
  CandidateView,
  DecisionsView,
  ReadinessItem,
  VerseLookup,
} from "@/lib/export-types";
import { useStoreValue } from "../hooks";
import { usePlayer } from "../use-player";
import { useToast } from "../use-toast";
import { Live } from "./export-page";
import { Diamond, XIcon } from "./export-icons";
import { CorrectWave } from "./correct-wave";
import { useCorrection } from "./use-correction";
import { WordRange } from "./word-range";

const NUDGE_S = 0.1;
/** Fréquence de lecture de la position pour mesurer l'écoute (ms). */
const LISTEN_SAMPLE_MS = 100;
const GLYPH: Record<string, string> = {
  uncertain: "s-uncertain",
  inferred: "s-inferred",
  cut: "s-recognized",
  approx: "s-recognized",
  report: "s-abstention",
};
const round1 = (n: number) => Math.round(n * 10) / 10;
const REF = /^\d{1,3}:\d{1,3}$/;

const exportHref = (sessionId: string) => `/s/${sessionId}/exporter`;
const itemHref = (sessionId: string, key: string) =>
  `${exportHref(sessionId)}/corriger?item=${encodeURIComponent(key)}`;

/** Les mots d'un candidat, la différence surlignée (fond ET trait : jamais la couleur seule). */
function CandidateText({ candidate }: { candidate: CandidateView }) {
  return (
    <span className="ex-cand">
      <span className="ar" lang="ar" dir="rtl">
        {candidate.tokens.map((token, i) => (
          <span key={i}>
            {token.diff ? (
              <mark className="ex-diffmark">{token.text}</mark>
            ) : (
              token.text
            )}{" "}
          </span>
        ))}
      </span>
      {candidate.translation ? (
        <span className="fr">
          {candidate.translation_scope === "fragment"
            ? "Traduction du passage : "
            : "Traduction du verset entier : "}
          {candidate.translation.length > 120
            ? `${candidate.translation.slice(0, 118).replace(/\s\S*$/, "")} …`
            : candidate.translation}
        </span>
      ) : null}
    </span>
  );
}

/** Ce que dit la phrase d'écoute : les mots qui diffèrent, lus dans le corpus (« Écoute la fin : … ou … ? »). */
function listenSentence(item: ReadinessItem): React.ReactNode {
  const c = item.candidates ?? [];
  if (item.type !== "uncertain" || c.length < 2 || item.impact === "reference")
    return why(item);
  const diff = (cand: CandidateView) =>
    cand.tokens
      .filter((t) => t.diff)
      .slice(0, 3)
      .map((t) => t.text)
      .join(" ");
  const parts = c.slice(0, 3).map(diff).filter(Boolean);
  if (parts.length < 2) return why(item);
  return (
    <>
      Le moteur hésite entre {c.length} versets qui commencent pareil.{" "}
      <b style={{ color: "var(--text)", fontWeight: 600 }}>Écoute :</b>{" "}
      {parts.map((p, i) => (
        <span key={i}>
          {i ? " ou " : ""}«{" "}
          <span
            lang="ar"
            dir="rtl"
            style={{ fontFamily: "var(--font-quran)", fontSize: "1.15em" }}
          >
            {p}
          </span>{" "}
          »
        </span>
      ))}{" "}
      ?
    </>
  );
}

function CorrectForm({
  sessionId,
  item,
  items,
  decisions,
  setDecisions,
  reload,
}: {
  sessionId: string;
  item: ReadinessItem;
  items: ReadinessItem[];
  decisions: DecisionsView | null;
  setDecisions: (view: DecisionsView) => void;
  reload: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [live, setLive] = useState("");
  const announce = useCallback((message: string) => {
    setLive("");
    setTimeout(() => setLive(message), 30);
  }, []);
  const nav = useMemo(() => neighbours(items, item.key), [items, item.key]);
  const resolved = item.state !== "open";

  // --- état de la décision en cours ---------------------------------------------------------------
  const existing = item.decision;
  const [pick, setPick] = useState<string | null>(pickOf(item));
  const [custom, setCustom] = useState<{
    ref: string;
    first: number;
    last: number;
  }>(() => ({
    ref:
      existing?.kind === "set_ref" && existing.value.ref
        ? existing.value.ref
        : item.type === "report" && item.ref
          ? item.ref
          : "",
    first: existing?.value.words?.[0] ?? item.words?.[0] ?? 1,
    last: existing?.value.words?.[1] ?? item.words?.[1] ?? 1,
  }));
  const [extend, setExtend] = useState<[number, number]>(
    existing?.kind === "set_ref" && existing.value.words
      ? existing.value.words
      : (item.words ?? [1, 1]),
  );
  const [t, setT] = useState<[number, number] | null>(
    existing?.value.t ?? null,
  );
  const [lookup, setLookup] = useState<VerseLookup | null>(null);
  const [saving, setSaving] = useState(false);
  const [offline, setOffline] = useState(false);
  const owner = decisions?.is_owner ?? false;
  const [train, setTrain] = useState<boolean>(
    existing
      ? existing.use_for_training
      : Boolean(decisions?.consent.training && owner),
  );
  useEffect(() => {
    if (!existing && decisions)
      setTrain(Boolean(decisions.consent.training && decisions.is_owner));
  }, [decisions, existing]);

  const customTouched = pick === "other" || pick === "setref" || pick === "add";
  useEffect(() => {
    if (!customTouched || !REF.test(custom.ref)) {
      setLookup(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void lookupVerse(
        custom.ref,
        [custom.first, Math.max(custom.first, custom.last)],
        controller.signal,
      )
        .then((found) => !controller.signal.aborted && setLookup(found))
        .catch(() => undefined);
    }, 300);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [customTouched, custom.ref, custom.first, custom.last]);
  const lookupOk = lookup?.ok === true;

  const draft: DecisionDraft = {
    custom: {
      ref: custom.ref,
      range: [custom.first, Math.max(custom.first, custom.last)],
      valid: lookupOk,
    },
    extend,
    t,
  };
  const built = pick ? buildDecision(item, pick, draft) : null;

  // --- écoute : un seul <audio>, une plage, un compteur -------------------------------------------
  const player = usePlayer(sessionId, {
    onError: announce,
    onPlay: () => undefined,
    rate: 1,
    volume: 1,
    onRate: () => undefined,
    onVolume: () => undefined,
  });
  const meter = useRef(new ListenMeter(item.t[0], item.t[1]));
  const [listenedSeconds, setListenedSeconds] = useState(0);
  const listened = listenedSeconds >= (item.t[1] - item.t[0]) * 0.7;
  const playing = useStoreValue(player.store, (s) => s.playing);
  // La position lue directement sur l'<audio>, à intervalle fixe : elle ne dépend ni du dessin des images
  // (volet masqué, onglet en arrière-plan) ni de la fréquence de publication du lecteur.
  const position = player.position;
  useEffect(() => {
    const sample = (isPlaying: boolean) => {
      const before = meter.current.seconds;
      meter.current.feed(position(), isPlaying, performance.now());
      if (meter.current.seconds !== before)
        setListenedSeconds(meter.current.seconds);
    };
    if (!playing) {
      sample(false);
      return;
    }
    sample(true);
    const timer = setInterval(() => sample(true), LISTEN_SAMPLE_MS);
    return () => {
      clearInterval(timer);
      sample(true);
    };
  }, [playing, position]);
  const [loop, setLoop] = useState(false);
  const range = t ?? item.t;
  const listen = useCallback(() => {
    if (playing) return player.toggle();
    player.playRange(range[0], range[1], { loop });
  }, [loop, player, playing, range]);

  // --- gestes ----------------------------------------------------------------------------------------
  const moveTime = (which: 0 | 1, delta: number) => {
    const base = t ?? [item.t[0], item.t[1]];
    const next: [number, number] = [base[0], base[1]];
    next[which] = Math.max(0, round1(next[which] + delta));
    if (next[1] - next[0] < NUDGE_S) return;
    setT(next);
  };
  const goNext = useCallback(() => {
    if (nav.next) router.push(itemHref(sessionId, nav.next));
    else router.push(exportHref(sessionId));
  }, [nav.next, router, sessionId]);

  const reviewIds =
    item.type === "report" ? item.review_ids : item.related_reports;
  const submit = useCallback(
    async (ops: DecisionOp[], doneMessage: string, after: () => void) => {
      setSaving(true);
      setOffline(false);
      try {
        let view = await saveDecisions(sessionId, [
          ...pendingOps(sessionId),
          ...ops,
        ]);
        clearOps(sessionId);
        setDecisions(view);
        // Une décision enregistrée avec l'accord par défaut ; l'interrupteur peut la retirer, décision par décision.
        const fresh = view.decisions.find(
          (d) =>
            d.state !== "withdrawn" &&
            d.state !== "superseded" &&
            d.target.item === item.type &&
            (d.target.fingerprint === item.fingerprint ||
              (item.fingerprint === null &&
                d.target.review_ids.join() === item.review_ids.join())),
        );
        if (
          fresh &&
          ops[0]?.op === "decide" &&
          owner &&
          fresh.use_for_training !== train
        ) {
          view = await saveDecisions(sessionId, [
            { op: "training", id: fresh.id, use: train },
          ]);
          setDecisions(view);
        }
        reload();
        toast.show(doneMessage);
        announce(doneMessage);
        after();
      } catch (error) {
        if (error instanceof ApiError && error.status === 0) {
          queueOps(sessionId, ops);
          setOffline(true);
          announce("Hors ligne : ta décision est gardée sur cet appareil.");
        } else
          toast.show(
            error instanceof Error
              ? error.message
              : "Enregistrement impossible.",
          );
      } finally {
        setSaving(false);
      }
    },
    [announce, item, owner, reload, sessionId, setDecisions, toast, train],
  );

  const validate = useCallback(() => {
    if (!built || !built.ok) {
      announce(
        built && !built.ok
          ? built.reason
          : "Choisis une réponse avant de valider.",
      );
      return;
    }
    const left = Math.max(0, nav.open - (resolved ? 0 : 1));
    void submit(
      [
        {
          op: "decide",
          item: item.type,
          index: item.index,
          review_ids: reviewIds.length ? reviewIds : undefined,
          kind: built.kind,
          value: built.value as Record<string, unknown>,
          evidence: {
            listened: meter.current.listened,
            listened_s: round1(meter.current.seconds),
            device: window.matchMedia("(pointer: coarse)").matches
              ? "mobile"
              : "desktop",
          },
        },
      ],
      `Décision enregistrée : la prédiction du moteur n’a pas changé. ${left > 0 ? `${plural(left, "restant", "restants")}.` : "Tout est vérifié."}`,
      goNext,
    );
  }, [announce, built, goNext, item, nav.open, resolved, reviewIds, submit]);

  const ignore = useCallback(() => {
    void submit(
      [
        {
          op: "decide",
          item: item.type,
          index: item.index,
          review_ids: reviewIds.length ? reviewIds : undefined,
          kind: "ignore",
          value: {},
        },
      ],
      "Passage ignoré : il sera exporté selon la règle par défaut (omis).",
      goNext,
    );
  }, [goNext, item, reviewIds, submit]);

  const undo = useCallback(() => {
    if (!existing) return;
    void submit(
      [{ op: "withdraw", id: existing.id }],
      "Décision annulée : le passage est de nouveau à vérifier.",
      () => {
        setPick(null);
        setT(null);
      },
    );
  }, [existing, submit]);

  // --- clavier : jamais dans un champ -----------------------------------------------------------------
  const latest = useRef({ validate, listen, goNext });
  latest.current = { validate, listen, goNext };
  const choices = useMemo(() => choicesFor(item), [item]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement;
      if (target.matches?.("input,textarea,select,[contenteditable]")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        router.push(exportHref(sessionId));
        return;
      }
      const onControl = target.closest?.("button,a,summary,[role=tab]");
      if (event.key === "Enter" && !onControl) {
        event.preventDefault();
        latest.current.validate();
      } else if (event.key === " " && !onControl) {
        event.preventDefault();
        latest.current.listen();
      } else if (event.key.toLowerCase() === "j" && nav.next) {
        router.push(itemHref(sessionId, nav.next));
      } else if (event.key.toLowerCase() === "k" && nav.prev) {
        router.push(itemHref(sessionId, nav.prev));
      } else if (
        event.key.toLowerCase() === "x" &&
        choices.some((c) => c.id === "exclude")
      ) {
        setPick("exclude");
      } else if (/^[1-9]$/.test(event.key)) {
        const found = choices.find((c) => c.key === event.key);
        if (found) setPick(found.id);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [choices, nav.next, nav.prev, router, sessionId]);

  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);

  const around = useMemo(
    () => items.filter((o) => Math.abs(o.t[0] - item.t[0]) < 60),
    [items, item.t],
  );
  const timeEditable =
    item.type !== "approx" &&
    pick !== null &&
    pick !== "dismiss" &&
    !pick.startsWith("scope:") &&
    pick !== "exclude" &&
    !(pick === "confirm" && item.type === "cut");
  const humanT = pick && timeEditable ? range : null;
  const words = (c: CandidateView) => (c.words ? wordsLabel(c.words) : "");

  // La carte « Ta décision » reflète le choix en direct, avec le texte DU CORPUS (jamais une chaîne saisie).
  const decisionCard = (() => {
    if (!pick)
      return (
        <p className="ex-none">
          Choisis une réponse à droite
          {item.type === "uncertain" ? ", ou saisis une autre référence" : ""}.
        </p>
      );
    if (pick.startsWith("cand:")) {
      const c = item.candidates?.[Number(pick.slice(5))];
      return c ? (
        <>
          <div className="ex-big">
            {c.ref} · {words(c)}
          </div>
          <div className="ar" lang="ar" dir="rtl">
            {c.tokens.map((x) => x.text).join(" ")}
          </div>
        </>
      ) : null;
    }
    if (customTouched)
      return (
        <>
          <div className="ex-big">
            {custom.ref || "—"} ·{" "}
            {wordsLabel([custom.first, Math.max(custom.first, custom.last)])}
          </div>
          {lookup?.ok ? (
            <div className="ar" lang="ar" dir="rtl">
              {lookup.tokens.join(" ")}
            </div>
          ) : null}
        </>
      );
    if (pick === "extend") {
      const tokens = item.verse_tokens ?? [];
      return (
        <>
          <div className="ex-big">
            {item.ref} · {wordsLabel(extend)}
          </div>
          <div className="ar" lang="ar" dir="rtl">
            {tokens.slice(extend[0] - 1, extend[1]).join(" ")}
          </div>
        </>
      );
    }
    const found = choices.find((c) => c.id === pick);
    return <div className="ex-big">{found?.label}</div>;
  })();

  const back = exportHref(sessionId);
  return (
    <>
      <audio
        ref={player.attach}
        src={`/api/sessions/${sessionId}/audio`}
        preload="metadata"
        aria-hidden="true"
      />
      <div className="ex-cx" data-testid="correct-page">
        <div className="ex-cx-nav">
          {nav.prev ? (
            <Link
              className="btn btn--secondary btn--sm"
              href={itemHref(sessionId, nav.prev)}
              aria-label="Passage précédent"
              data-testid="prev"
            >
              <XIcon name="chev-l" /> <span className="hide-m">Précédent</span>
            </Link>
          ) : (
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled
              aria-label="Passage précédent"
            >
              <XIcon name="chev-l" /> <span className="hide-m">Précédent</span>
            </button>
          )}
          <span className="ex-pos" aria-live="polite" data-testid="position">
            {nav.position !== null
              ? `Passage ${nav.position} sur ${nav.open} ${nav.open > 1 ? "restants" : "restant"}`
              : "Passage déjà traité"}
          </span>
          {nav.next ? (
            <Link
              className="btn btn--secondary btn--sm"
              href={itemHref(sessionId, nav.next)}
              aria-label="Passage suivant"
              data-testid="next"
            >
              <span className="hide-m">Suivant</span> <XIcon name="chev-r" />
            </Link>
          ) : (
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled
              aria-label="Passage suivant"
            >
              <span className="hide-m">Suivant</span> <XIcon name="chev-r" />
            </button>
          )}
          <span className="grow" />
        </div>

        <section className="ex-cx-main" aria-labelledby="ex-item-h">
          <div className="ex-card2">
            <div className="ex-item-head">
              <span className={`sw ${GLYPH[item.type]}`} aria-hidden="true" />
              <h1
                className="ex-ref"
                id="ex-item-h"
                ref={heading}
                tabIndex={-1}
                data-testid="item-title"
              >
                {item.type === "uncertain" && item.candidates?.length
                  ? item.candidates.map((c, n) => (
                      <span key={c.ref}>
                        {n ? (
                          <span style={{ color: "var(--text-3)" }}> ou </span>
                        ) : null}
                        {c.ref}
                      </span>
                    ))
                  : correctionTitle(item)}
              </h1>
              <span className="badge badge--warn">
                <span className={`sw ${GLYPH[item.type]}`} aria-hidden="true" />
                {TYPE_LABEL[item.type]}
                {item.candidates
                  ? ` · ${item.candidates.length} candidats`
                  : ""}
              </span>
              <span className="ex-tag ex-tag--ar">
                {IMPACT_LABEL[item.impact]}
              </span>
            </div>
            <p className="muted" style={{ fontSize: "var(--fs-sm)" }}>
              {item.words ? `${wordsLabel(item.words)} · ` : ""}
              <span className="mono">
                {clock(item.t[0])} → {clock(item.t[1])}
              </span>{" "}
              · {secondsFr(item.t[1] - item.t[0])}. {listenSentence(item)}
            </p>
            {item.type === "report" && item.notes?.length ? (
              <ul className="ex-plain-list" data-testid="notes">
                {item.notes.map((n) => (
                  <li key={n.id}>
                    <b>{n.tester}</b> :{" "}
                    {n.description || "signalement sans commentaire"}
                  </li>
                ))}
              </ul>
            ) : null}
            <CorrectWave
              sessionId={sessionId}
              item={item}
              around={around}
              decision={humanT}
              store={player.store}
              onSeek={(time) => player.seek(time)}
            />
            <div className="ex-tools2">
              <button
                type="button"
                className="btn btn--secondary"
                data-testid="listen"
                onClick={listen}
              >
                <XIcon name={playing ? "stop" : "play"} />
                {playing ? "Arrêter" : "Écouter le passage"}
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                aria-pressed={loop}
                onClick={() => setLoop((v) => !v)}
              >
                <XIcon name="loop" />
                En boucle
              </button>
              {timeEditable
                ? (["Début", "Fin"] as const).map((label, which) => (
                    <span
                      className="ex-nud"
                      role="group"
                      aria-label={`${label} de la décision`}
                      key={label}
                    >
                      <span className="l">{label}</span>
                      <button
                        type="button"
                        className="btn"
                        aria-label={`${label} : 0,1 s plus tôt`}
                        onClick={() => moveTime(which as 0 | 1, -NUDGE_S)}
                      >
                        −
                      </button>
                      <output data-testid={`t-${which}`}>
                        {secondsFr(range[which])}
                      </output>
                      <button
                        type="button"
                        className="btn"
                        aria-label={`${label} : 0,1 s plus tard`}
                        onClick={() => moveTime(which as 0 | 1, NUDGE_S)}
                      >
                        +
                      </button>
                    </span>
                  ))
                : null}
            </div>
            <p className="ex-keys2 hide-m" aria-label="Raccourcis">
              <span>
                <span className="ex-kbd">Espace</span>écouter
              </span>
              {item.type === "uncertain" ? (
                <span>
                  <span className="ex-kbd">1</span>
                  <span className="ex-kbd">2</span>choisir
                </span>
              ) : null}
              {choices.some((c) => c.id === "exclude") ? (
                <span>
                  <span className="ex-kbd">X</span>exclure
                </span>
              ) : null}
              <span>
                <span className="ex-kbd">Entrée</span>valider et suivant
              </span>
              <span>
                <span className="ex-kbd">J</span>
                <span className="ex-kbd">K</span>suivant · précédent
              </span>
              <span>
                <span className="ex-kbd">Échap</span>retour à la liste
              </span>
            </p>
          </div>

          <div className="ex-vs" aria-label="Comparaison moteur et décision">
            <div className="ex-vs-card" data-testid="engine-card">
              <div className="ex-lbl">
                <span>Moteur</span>
                <span
                  style={{
                    display: "inline-flex",
                    gap: 5,
                    alignItems: "center",
                    color: "var(--text-3)",
                  }}
                >
                  <XIcon name="lock" />
                  Figé
                </span>
              </div>
              <div className="ex-big">{TYPE_LABEL[item.type]}</div>
              <p>
                {item.type === "uncertain" ? (
                  <>
                    Candidats :{" "}
                    {(item.candidates ?? []).map((c, n) => (
                      <span key={c.ref}>
                        {n ? " · " : ""}
                        <b style={{ color: "var(--text)", fontWeight: 600 }}>
                          {c.ref}
                        </b>
                      </span>
                    ))}
                    .<br />
                    Aucun texte nommé (précision d’abord).
                  </>
                ) : (
                  engineLabel(item)
                )}
              </p>
              <p className="mono" style={{ fontSize: "var(--fs-xs)" }}>
                empreinte{" "}
                {item.fingerprint
                  ? `${item.fingerprint.slice(0, 4)}…${item.fingerprint.slice(-2)}`
                  : "—"}
              </p>
            </div>
            <div
              className="ex-vs-card ex-vs-card--human"
              aria-live="polite"
              data-testid="decision-card"
            >
              <div className="ex-lbl">
                <span>Ta décision</span>
                <span
                  style={{
                    display: "inline-flex",
                    gap: 5,
                    alignItems: "center",
                  }}
                >
                  <Diamond hollow={!existing} />
                  <span data-testid="decision-state">
                    {existing
                      ? "Enregistrée"
                      : pick
                        ? "Brouillon"
                        : "Non décidé"}
                  </span>
                </span>
              </div>
              {decisionCard}
              {pick && timeEditable ? (
                <p className="mono" style={{ fontSize: "var(--fs-xs)" }}>
                  {secondsFr(range[0])} → {secondsFr(range[1])}
                </p>
              ) : null}
            </div>
          </div>

          {owner || decisions ? (
            <section className="ex-train" aria-labelledby="ex-tr-h" id="train">
              <h4 id="ex-tr-h">
                <XIcon name="info" />
                Ta correction aide à entraîner le moteur
              </h4>
              <p>
                Quand tu as écouté le passage, ta décision devient une{" "}
                <b style={{ color: "var(--text)", fontWeight: 600 }}>
                  proposition de vérité terrain
                </b>{" "}
                (référence, mots, temps), relue ensuite par le relecteur. Elle
                reste sur ce serveur ; ton audio n’est envoyé nulle part.
              </p>
              <label
                className="ex-sw-row"
                htmlFor="ex-train-ok"
                style={{ gap: 12 }}
              >
                <span className="t">
                  <b>Utiliser ma correction pour améliorer le moteur</b>
                  <small>
                    {owner
                      ? "Modifiable à tout moment, décision par décision."
                      : "Seul le propriétaire de l’audio consent à l’usage de ses corrections."}
                  </small>
                </span>
                <span className="ex-tgl">
                  <input
                    id="ex-train-ok"
                    type="checkbox"
                    checked={owner && train}
                    disabled={!owner}
                    data-testid="train-switch"
                    onChange={(event) => setTrain(event.target.checked)}
                  />
                  <i />
                </span>
              </label>
            </section>
          ) : null}
        </section>

        <aside className="ex-xcol ex-xcol--set" aria-labelledby="ex-dec-h">
          <form className="ex-set" onSubmit={(event) => event.preventDefault()}>
            <div className="ex-set-head">
              <h2
                id="ex-dec-h"
                style={{ font: "400 var(--fs-xl)/1.1 var(--font-display)" }}
              >
                Qu’entends-tu ?
              </h2>
              <p
                className="muted"
                style={{ fontSize: "var(--fs-sm)", marginTop: 4 }}
              >
                Ta décision s’ajoute à la prédiction ; elle ne la remplace
                jamais.
              </p>
            </div>
            <fieldset
              className="ex-set-sec"
              style={{ borderTop: 0, paddingTop: "var(--sp-2)" }}
            >
              <legend className="sr">Choix du passage</legend>
              <div
                className="ex-rads"
                role="radiogroup"
                aria-label="Ta réponse"
              >
                {choices.map((choice) => {
                  const cand = choice.id.startsWith("cand:")
                    ? item.candidates?.[Number(choice.id.slice(5))]
                    : undefined;
                  const showsInputs = ["other", "setref", "add"].includes(
                    choice.id,
                  );
                  return (
                    <label className="ex-rad" key={choice.id}>
                      <input
                        type="radio"
                        name="ex-pick"
                        checked={pick === choice.id}
                        data-testid={`pick-${choice.id}`}
                        onChange={() => setPick(choice.id)}
                      />
                      <span>
                        {cand ? (
                          <>
                            <span className="ex-head2">
                              <b>{choice.label}</b>
                              <small style={{ margin: 0 }}>
                                {words(cand)} ·{" "}
                                <span className="ex-kbd">{choice.key}</span>
                              </small>
                            </span>
                            <CandidateText candidate={cand} />
                          </>
                        ) : (
                          <>
                            <b>{choice.label}</b>
                            {choice.hint ? (
                              <small>
                                {choice.hint}
                                {choice.key ? (
                                  <>
                                    {" "}
                                    <span className="ex-kbd">{choice.key}</span>
                                  </>
                                ) : null}
                              </small>
                            ) : null}
                          </>
                        )}
                        {showsInputs && pick === choice.id ? (
                          <>
                            <span className="ex-ref-inputs">
                              <span className="ex-fld">
                                Sourate:verset
                                <input
                                  className="input"
                                  value={custom.ref}
                                  inputMode="numeric"
                                  placeholder="11:62"
                                  data-testid="custom-ref"
                                  aria-label="Sourate et verset, par exemple 11:62"
                                  aria-invalid={
                                    Boolean(custom.ref) &&
                                    (!REF.test(custom.ref) ||
                                      lookup?.ok === false)
                                  }
                                  onChange={(event) =>
                                    setCustom({
                                      ...custom,
                                      ref: event.target.value.trim(),
                                    })
                                  }
                                />
                              </span>
                              <span className="ex-fld">
                                Mot début
                                <input
                                  className="input"
                                  value={custom.first}
                                  inputMode="numeric"
                                  aria-label="Mot de début"
                                  onChange={(event) =>
                                    setCustom({
                                      ...custom,
                                      first: Math.max(
                                        1,
                                        Number(
                                          event.target.value.replace(/\D/g, ""),
                                        ) || 1,
                                      ),
                                    })
                                  }
                                />
                              </span>
                              <span className="ex-fld">
                                Mot fin
                                <input
                                  className="input"
                                  value={custom.last}
                                  inputMode="numeric"
                                  aria-label="Mot de fin"
                                  onChange={(event) =>
                                    setCustom({
                                      ...custom,
                                      last: Math.max(
                                        1,
                                        Number(
                                          event.target.value.replace(/\D/g, ""),
                                        ) || 1,
                                      ),
                                    })
                                  }
                                />
                              </span>
                            </span>
                            <span
                              className="ex-ref-ok"
                              data-testid="lookup"
                              role="status"
                            >
                              {lookup === null ? (
                                custom.ref ? (
                                  "Saisis sourate:verset, par exemple 11:62."
                                ) : (
                                  ""
                                )
                              ) : lookup.ok ? (
                                <>
                                  <XIcon name="check" size={16} />
                                  Verset trouvé dans le corpus ·{" "}
                                  {plural(
                                    lookup.words[1] - lookup.words[0] + 1,
                                    "mot",
                                    "mots",
                                  )}{" "}
                                  sur {lookup.words_total}
                                </>
                              ) : (
                                <>
                                  <XIcon name="alert" size={16} />
                                  {lookup.error}
                                </>
                              )}
                            </span>
                          </>
                        ) : null}
                        {choice.id === "extend" &&
                        pick === "extend" &&
                        item.verse_tokens ? (
                          <WordRange
                            tokens={item.verse_tokens}
                            value={extend}
                            onChange={setExtend}
                            label="Plage affichée"
                          />
                        ) : null}
                        {choice.id === "scope:verse" &&
                        item.translation?.verse ? (
                          <small className="fr">{item.translation.verse}</small>
                        ) : null}
                        {choice.id === "scope:fragment" &&
                        item.translation?.fragment ? (
                          <small className="fr">
                            {item.translation.fragment}
                          </small>
                        ) : null}
                      </span>
                    </label>
                  );
                })}
              </div>
              {existing ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  style={{ justifySelf: "start" }}
                  data-testid="undo"
                  disabled={saving}
                  onClick={undo}
                >
                  <XIcon name="undo" size={16} />
                  Annuler ma décision
                </button>
              ) : null}
              {existing ? (
                <p className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                  Décision actuelle : <b>{decisionLabel(existing)}</b>.
                </p>
              ) : null}
            </fieldset>
            <div className="ex-set-foot">
              <div className="ex-btnrow">
                <button
                  type="button"
                  className="btn btn--primary btn--lg btn--block"
                  data-testid="validate"
                  disabled={saving || !built || !built.ok}
                  onClick={validate}
                >
                  {nav.next ? "Valider et passer au suivant" : "Valider"}
                </button>
                <div className="ex-cx-actions">
                  <button
                    type="button"
                    className="btn btn--ghost"
                    data-testid="ignore-item"
                    disabled={saving || resolved}
                    onClick={ignore}
                  >
                    Ignorer cet élément
                  </button>
                  <span className="grow" />
                  <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                    Ignorer = exporter selon la règle par défaut
                  </span>
                </div>
              </div>
              <p className="ex-micro" data-testid="listened">
                {meter.current.listened || listened ? (
                  <>
                    <b>Écouté</b> · cette décision vaut vérité terrain
                  </>
                ) : (
                  <>
                    <b>Pas encore écouté</b> · une décision écoutée vaut vérité
                    terrain
                  </>
                )}
              </p>
              {built && !built.ok && pick ? (
                <p className="ex-micro" role="status" data-testid="why-not">
                  {built.reason}
                </p>
              ) : null}
              {offline ? (
                <p
                  className="notice notice--error"
                  role="alert"
                  data-testid="offline"
                >
                  Hors ligne : ta décision est gardée sur cet appareil et
                  partira dès que la connexion revient.
                </p>
              ) : null}
            </div>
          </form>
        </aside>
      </div>
      <div className="ex-stickybar ex-stickybar--cx" data-testid="stickybar-cx">
        <button
          type="button"
          className="btn btn--secondary btn--icon btn--lg"
          style={{ flex: "0 0 52px" }}
          aria-label="Écouter le passage"
          onClick={listen}
        >
          <XIcon name={playing ? "stop" : "play"} />
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          disabled={saving || resolved}
          onClick={ignore}
        >
          Ignorer
        </button>
        <button
          type="button"
          className="btn btn--primary btn--lg"
          disabled={saving || !built || !built.ok}
          onClick={validate}
        >
          Valider et suivant
        </button>
      </div>
      <Live text={live} />
      {toast.node}
      <Link href={back} className="sr">
        Retour à la liste
      </Link>
    </>
  );
}

/** L'écran de correction d'un passage : écouter, décider, valider, passer au suivant. */
export function CorrectPage({
  sessionId,
  itemKey,
}: {
  sessionId: string;
  itemKey: string;
}) {
  const [options, setOptions] = useState<ExportOptions | null>(null);
  useEffect(() => setOptions(loadExportOptions()), []);
  return (
    <div className="ex-xp-page">
      <div className="ex-xp-wrap">
        <nav className="ex-crumb" aria-label="Fil d’Ariane">
          <Link href={exportHref(sessionId)}>
            <XIcon name="chev-l" size={16} />
            Prêt à exporter ?
          </Link>
          <span aria-hidden="true">/</span>
          <span>Corriger</span>
        </nav>
        {options ? (
          <CorrectLoader
            sessionId={sessionId}
            itemKey={itemKey}
            options={options}
          />
        ) : (
          <div className="ex-skel" aria-hidden="true">
            <i />
            <i />
          </div>
        )}
      </div>
    </div>
  );
}

function CorrectLoader({
  sessionId,
  itemKey,
  options,
}: {
  sessionId: string;
  itemKey: string;
  options: ExportOptions;
}) {
  const data = useCorrection(sessionId, options);
  // Les décisions gardées hors ligne repartent dès que la page s'ouvre ou que le réseau revient.
  useEffect(() => {
    const flush = () => {
      const pending = pendingOps(sessionId);
      if (!pending.length) return;
      void saveDecisions(sessionId, pending).then(
        () => {
          clearOps(sessionId);
          data.reload();
        },
        () => undefined,
      );
    };
    flush();
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);
  const item = data.items.find((i) => i.key === itemKey) ?? null;
  if (data.error)
    return (
      <div className="ex-state" role="alert" data-testid="state-error">
        <h3>Le passage n’a pas pu être chargé</h3>
        <p>{data.error.message}</p>
        <Link className="btn btn--secondary" href={exportHref(sessionId)}>
          Retour au contrôle
        </Link>
      </div>
    );
  if (data.loading && !item)
    return (
      <div className="ex-skel" aria-hidden="true" data-testid="loading">
        <i />
        <i />
        <i />
      </div>
    );
  if (!item)
    return (
      <div className="ex-state" role="status" data-testid="state-gone">
        <h3>Ce passage n’existe plus tel quel</h3>
        <p>
          L’analyse a peut-être été refaite, ou le passage n’est plus à vérifier
          avec ces réglages. Retourne au contrôle : la liste est à jour.
        </p>
        <Link className="btn btn--primary" href={exportHref(sessionId)}>
          Retour au contrôle
        </Link>
      </div>
    );
  if (!data.canEdit)
    return (
      <div className="ex-state" role="status" data-testid="state-read-only">
        <h3>Seul le propriétaire corrige</h3>
        <p>
          Tu peux écouter et exporter, mais pas décider à la place du
          propriétaire de cet audio. Tu peux forcer l’export depuis le contrôle.
        </p>
        <Link className="btn btn--primary" href={exportHref(sessionId)}>
          Retour au contrôle
        </Link>
      </div>
    );
  return (
    <CorrectForm
      key={`${item.key}:${item.decision?.id ?? "-"}`}
      sessionId={sessionId}
      item={item}
      items={data.items}
      decisions={data.decisions}
      setDecisions={data.setDecisions}
      reload={data.reload}
    />
  );
}
