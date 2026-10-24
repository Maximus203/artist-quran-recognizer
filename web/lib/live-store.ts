/**
 * Le magasin de l'écran « En direct » : un RÉDUCTEUR PUR (état, action) → état, sans horloge, sans
 * réseau, sans DOM. Toute l'horloge entre dans les actions (`nowMs`), si bien qu'un scénario de
 * messages `aqr.live/1` rejoué donne toujours le même état (tests par rejeu, comme `live-core.js`
 * du prototype : docs/design/en-direct.md §3).
 *
 * Invariants que ce module garantit :
 *  - I1/I3 : aucun texte coranique n'est fabriqué ; l'état ne contient que ce que les messages
 *    portent (`heard.text`, `interval.text`, traduction du verset), et un passage non nommé n'a
 *    jamais de texte propre ;
 *  - `INFERRED` garde son statut (« déduit de la position »), jamais « reconnu » ;
 *  - `REVISION` ne supprime jamais une ligne : elle la marque « corrigée » et retire son texte ;
 *  - le client ne dérive jamais un nom de verset (`GAP` est la seule dérivation : un trou entre deux
 *    versets nommés, sans nom pour le trou).
 */
import { LIVE_UI } from "./live-config";
import { serviceErrorKey, type LiveErrorKey } from "./live-errors";
import type {
  LiveInterval,
  LiveTranslation,
  ServerMessage,
} from "./live-protocol";

export type Phase =
  | "idle"
  | "permission"
  | "connecting"
  | "listening"
  | "paused"
  | "ending"
  | "ended"
  | "error";

export type JumpKind = "repeat" | "back" | "skip" | "other_surah";
export type LostReason = "silence" | "non_quran" | "no_candidate";

export type CandidateState = {
  count: number;
  wordsHeard: number;
  /** Texte du corpus des mots que TOUS les candidats ont en commun (absent si les graphies diffèrent). */
  heardText: string | null;
  /** Traduction commune (seulement si identique pour tous les candidats). */
  translation: LiveTranslation | null;
  /** Références seulement, jamais de texte : le volet fermé « Voir les pistes ». */
  refs: string[];
  /** Suite attendue, seulement si le favori l'est par la position (`basis: context`). */
  piste: string | null;
};

export type LockState = {
  id: string;
  ref: string;
  status: "recognized" | "inferred";
  basis: "words" | "context";
  text: string | null;
  translation: LiveTranslation | null;
  translationUnavailable: boolean;
  words: [number, number] | null;
  wordsHeard: number;
  repetition: boolean;
  partial: boolean;
  startT: number;
};

export type HistItem =
  | {
      kind: "verse";
      id: string;
      ref: string;
      status: "recognized" | "inferred" | "uncertain";
      basis: "words" | "context";
      t: [number, number | null];
      repetition: boolean;
      wordsHeard: number;
      text: string | null;
      translation: LiveTranslation | null;
      translationUnavailable: boolean;
      partial: boolean;
      revised: boolean;
      interrupted: boolean;
    }
  | {
      kind: "unres";
      id: string;
      t: [number, number];
      wordsHeard: number;
      heardText: string | null;
      candidates: string[];
      candidateCount: number;
      gap: boolean;
    }
  | { kind: "jump"; id: string; jump: JumpKind; t: number }
  | { kind: "nq"; id: string; t: number }
  | {
      kind: "basmala";
      id: string;
      t: number;
      text: string | null;
      translation: LiveTranslation | null;
    };

export type BetweenState = {
  ref: string;
  status: "recognized" | "inferred";
  text: string | null;
  translation: LiveTranslation | null;
  expected: string | null;
  revised: boolean;
};

export type KeepState =
  | { state: "idle" }
  | { state: "sending"; progress: number }
  | { state: "queued"; sessionId: string | null }
  | { state: "failed"; message: string }
  | { state: "discarded" };

export type LogEntry = { seq: number; t: number; type: string; detail: string };

export type LiveState = {
  phase: Phase;
  nowMs: number;
  errorKey: LiveErrorKey | null;
  errorMessage: string | null;
  /** Nouvel essai automatique prévu dans… (secondes), pour `server_busy`. */
  retryAfterS: number | null;
  /** Erreur du service survenue pendant l'écoute (suivie de `FINAL`). */
  streamError: { code: string; message: string; key: LiveErrorKey } | null;
  // Capture locale
  capturedS: number;
  endAtS: number | null;
  level: number;
  levels: number[];
  lastVoiceS: number;
  // Session
  sessionId: string | null;
  lastSeq: number;
  technical: boolean;
  resumeTtlS: number | null;
  // Connexion
  link: "ok" | "lost" | "catchup";
  linkLostAtMs: number | null;
  catchupS: number;
  finalizing: boolean;
  // Dégradation
  degraded: {
    overloaded: boolean;
    skipped: string[];
    lagS: number;
  } | null;
  degLog: [number, number | null][];
  // Passage
  cand: CandidateState | null;
  trail: number[];
  firstCandMs: number | null;
  lock: LockState | null;
  between: BetweenState | null;
  unres: { id: string; atMs: number } | null;
  lost: { reason: LostReason; atMs: number } | null;
  jump: { kind: JumpKind; from: string | null; atMs: number } | null;
  rev: { ref: string; atMs: number } | null;
  hist: HistItem[];
  /** Dernière transcription provisoire (mode technique seulement ; jamais le « passage entendu »). */
  partial: { text: string; stable: boolean } | null;
  log: LogEntry[];
  // Onglet en arrière-plan
  hidden: { atMs: number; capturedS: number } | null;
  tabGap: { fromS: number; lostS: number } | null;
  // Enregistrement local
  keep: KeepState;
  keepAvailable: boolean;
  /** Compteur pour des identifiants stables (ne dépend pas de l'horloge). */
  counter: number;
};

export type LiveAction =
  | { type: "reset" }
  | { type: "start"; nowMs: number }
  | { type: "mic_granted"; nowMs: number; keepAvailable: boolean }
  | {
      type: "failed";
      nowMs: number;
      key: LiveErrorKey;
      message?: string;
      retryAfterS?: number;
    }
  | { type: "server"; nowMs: number; message: ServerMessage }
  | { type: "link_lost"; nowMs: number }
  | { type: "link_back"; nowMs: number; catchupS: number }
  | { type: "caught_up"; nowMs: number }
  | { type: "pause"; nowMs: number }
  | { type: "resume"; nowMs: number }
  | { type: "stop"; nowMs: number }
  | { type: "cancel" }
  | {
      type: "finish";
      nowMs: number;
      error?: { key: LiveErrorKey; message: string };
    }
  | { type: "audio"; nowMs: number; capturedS: number; level: number }
  | { type: "tick"; nowMs: number }
  | { type: "visibility"; nowMs: number; hidden: boolean }
  | { type: "keep"; keep: KeepState };

export function initialState(): LiveState {
  return {
    phase: "idle",
    nowMs: 0,
    errorKey: null,
    errorMessage: null,
    retryAfterS: null,
    streamError: null,
    capturedS: 0,
    endAtS: null,
    level: 0,
    levels: [],
    lastVoiceS: 0,
    sessionId: null,
    lastSeq: 0,
    technical: false,
    resumeTtlS: null,
    link: "ok",
    linkLostAtMs: null,
    catchupS: 0,
    finalizing: false,
    degraded: null,
    degLog: [],
    cand: null,
    trail: [],
    firstCandMs: null,
    lock: null,
    between: null,
    unres: null,
    lost: null,
    jump: null,
    rev: null,
    hist: [],
    partial: null,
    log: [],
    hidden: null,
    tabGap: null,
    keep: { state: "idle" },
    keepAvailable: false,
    counter: 0,
  };
}

const LIVE_PHASES: Phase[] = ["listening", "paused", "ending"];
export const isLive = (phase: Phase): boolean => LIVE_PHASES.includes(phase);

// ───────────────────────── Réducteur ─────────────────────────

export function reduce(state: LiveState, action: LiveAction): LiveState {
  switch (action.type) {
    case "reset":
      return initialState();
    case "cancel":
      return { ...initialState(), nowMs: state.nowMs };
    case "start":
      return {
        ...initialState(),
        phase: "permission",
        nowMs: action.nowMs,
      };
    case "mic_granted":
      if (state.phase !== "permission") return state;
      return {
        ...state,
        phase: "connecting",
        nowMs: action.nowMs,
        keepAvailable: action.keepAvailable,
      };
    case "failed":
      return {
        ...state,
        phase: "error",
        nowMs: action.nowMs,
        errorKey: action.key,
        errorMessage: action.message ?? null,
        retryAfterS: action.retryAfterS ?? null,
      };
    case "finish": {
      // Fin décidée côté client (coupure trop longue, `FINAL` jamais arrivé) : elle se dit, et rien
      // de ce qui avait été entendu n'est perdu.
      const closed = closeLock(state, state.lock?.startT ?? 0);
      return {
        ...closed,
        phase: "ended",
        nowMs: action.nowMs,
        endAtS: closed.endAtS ?? closed.capturedS,
        level: 0,
        link: "ok",
        linkLostAtMs: null,
        streamError: action.error
          ? {
              code: action.error.key,
              message: action.error.message,
              key: action.error.key,
            }
          : closed.streamError,
      };
    }
    case "tick":
      return action.nowMs === state.nowMs
        ? state
        : { ...state, nowMs: action.nowMs };
    case "pause":
      if (state.phase !== "listening") return state;
      return { ...state, phase: "paused", nowMs: action.nowMs, level: 0 };
    case "resume":
      if (state.phase !== "paused") return state;
      return { ...state, phase: "listening", nowMs: action.nowMs };
    case "stop":
      if (state.phase !== "listening" && state.phase !== "paused") return state;
      return {
        ...state,
        phase: "ending",
        nowMs: action.nowMs,
        endAtS: state.capturedS,
        level: 0,
      };
    case "audio": {
      if (!isLive(state.phase)) return state;
      const levels = [...state.levels, action.level];
      if (levels.length > LIVE_UI.levelBars)
        levels.splice(0, levels.length - LIVE_UI.levelBars);
      return {
        ...state,
        nowMs: action.nowMs,
        capturedS: Math.max(state.capturedS, action.capturedS),
        level: action.level,
        levels,
        lastVoiceS:
          action.level >= LIVE_UI.voiceLevel
            ? Math.max(state.capturedS, action.capturedS)
            : state.lastVoiceS,
      };
    }
    case "link_lost":
      if (!isLive(state.phase) || state.link === "lost") return state;
      return {
        ...state,
        link: "lost",
        linkLostAtMs: action.nowMs,
        nowMs: action.nowMs,
      };
    case "link_back":
      if (!isLive(state.phase)) return state;
      return {
        ...state,
        link: action.catchupS > 0 ? "catchup" : "ok",
        linkLostAtMs: null,
        catchupS: action.catchupS,
        nowMs: action.nowMs,
      };
    case "caught_up":
      return state.link === "catchup"
        ? { ...state, link: "ok", catchupS: 0, nowMs: action.nowMs }
        : state;
    case "visibility":
      return onVisibility(state, action.hidden, action.nowMs);
    case "keep":
      return { ...state, keep: action.keep };
    case "server":
      return onServer({ ...state, nowMs: action.nowMs }, action.message);
  }
}

function onVisibility(
  state: LiveState,
  hidden: boolean,
  nowMs: number,
): LiveState {
  if (!isLive(state.phase)) return { ...state, nowMs };
  if (hidden)
    return {
      ...state,
      nowMs,
      hidden: { atMs: nowMs, capturedS: state.capturedS },
    };
  const from = state.hidden;
  if (!from) return { ...state, nowMs };
  // Le micro a-t-il continué à avancer pendant que l'onglet était caché ? Sinon, un passage n'a pas
  // été écouté (non mesuré sur appareil réel : le texte dit « peut-être »).
  const wall = (nowMs - from.atMs) / 1000;
  const advanced = state.capturedS - from.capturedS;
  const lost = state.phase === "paused" ? 0 : wall - advanced;
  return {
    ...state,
    nowMs,
    hidden: null,
    tabGap:
      lost > LIVE_UI.blockMs / 1000 + 1
        ? { fromS: from.capturedS, lostS: lost }
        : state.tabGap,
  };
}

const nextId = (state: LiveState, prefix: string): [string, number] => [
  `${prefix}${state.counter + 1}`,
  state.counter + 1,
];

function logOf(state: LiveState, message: ServerMessage): LogEntry[] {
  const detail = describe(message);
  const entry: LogEntry = {
    seq: message.seq,
    t: message.t,
    type: message.type,
    detail,
  };
  return [...state.log, entry].slice(-LIVE_UI.logKeep);
}

function describe(message: ServerMessage): string {
  switch (message.type) {
    case "CANDIDATES":
      return `mots=${message.words_heard} count=${message.count}`;
    case "LOCKED":
      return `ref=${message.interval.ref} statut=${message.interval.status} base=${message.interval.identity_basis ?? "?"}`;
    case "PROGRESS":
      return `ref=${message.ref} mots=${message.words_heard}`;
    case "CONTINUE":
      return `ref=${message.closed.ref} statut=${message.closed.status} suite=${message.expected?.ref ?? "—"}`;
    case "REVISION":
      return `ref=${message.ref} statut=${message.status} motif=${message.reason ?? "—"}`;
    case "JUMP":
      return `genre=${message.kind}`;
    case "LOST":
      return `motif=${message.reason}`;
    case "DEGRADED":
      return `palier=${message.tier} retard=${message.lag_s}s surcharge=${message.overloaded}`;
    case "READY":
      return `session=${message.session_id.slice(0, 6)} reprise=${message.resumed}`;
    case "ERROR":
      return `code=${message.code}`;
    default:
      return "";
  }
}

function verseItem(
  id: string,
  source: LiveInterval,
  extra: Partial<{
    interrupted: boolean;
    text: string | null;
    translation: LiveTranslation | null;
    wordsHeard: number;
  }> = {},
): HistItem {
  return {
    kind: "verse",
    id,
    ref: source.ref,
    status: source.status,
    basis: source.identity_basis ?? "words",
    t: [source.t[0], source.t[1]],
    repetition: source.repetition ?? false,
    wordsHeard: extra.wordsHeard ?? source.words_heard ?? 0,
    text: extra.text !== undefined ? extra.text : (source.text ?? null),
    translation:
      extra.translation !== undefined
        ? extra.translation
        : (source.translation ?? null),
    translationUnavailable: source.translation_unavailable ?? false,
    partial: source.partial ?? false,
    revised: false,
    interrupted: extra.interrupted ?? false,
  };
}

/** Ferme le verset verrouillé resté ouvert (saut, perte, fin) : il reste dans la liste, « interrompu ». */
function closeLock(state: LiveState, endT: number): LiveState {
  const lock = state.lock;
  if (!lock) return state;
  const item: HistItem = {
    kind: "verse",
    id: lock.id,
    ref: lock.ref,
    status: lock.status,
    basis: lock.basis,
    t: [lock.startT, Math.max(endT, lock.startT)],
    repetition: lock.repetition,
    wordsHeard: lock.wordsHeard,
    text: lock.text,
    translation: lock.translation,
    translationUnavailable: lock.translationUnavailable,
    partial: lock.partial,
    revised: false,
    interrupted: true,
  };
  return { ...state, lock: null, hist: [item, ...state.hist] };
}

const clearPassage = (state: LiveState): LiveState => ({
  ...state,
  cand: null,
  trail: [],
  firstCandMs: null,
});

function onServer(state: LiveState, message: ServerMessage): LiveState {
  // Les messages d'événement sont numérotés : un rejeu après reprise ne s'applique jamais deux fois.
  if (message.seq > 0 && message.seq <= state.lastSeq) return state;
  let next: LiveState =
    message.seq > 0 ? { ...state, lastSeq: message.seq } : state;
  next = { ...next, log: logOf(next, message) };
  switch (message.type) {
    case "READY": {
      const initial = message.degraded.length
        ? {
            overloaded: message.degraded.includes("overload"),
            skipped: message.degraded
              .filter((x) => x !== "overload")
              .map(String),
            lagS: 0,
          }
        : null;
      return {
        ...next,
        phase: next.phase === "connecting" ? "listening" : next.phase,
        sessionId: message.session_id,
        technical: message.technical,
        resumeTtlS: message.resume_ttl_s,
        degraded: next.degraded ?? initial,
        degLog:
          initial && !next.degLog.length ? [[message.t, null]] : next.degLog,
      };
    }
    case "PARTIAL":
      return {
        ...next,
        partial: { text: message.text, stable: message.stable },
      };
    case "CANDIDATES": {
      const closed = closeLock(next, message.t);
      const trail =
        closed.trail[closed.trail.length - 1] === message.count
          ? closed.trail
          : [...closed.trail, message.count];
      const leader = message.leader;
      return {
        ...closed,
        lost: null,
        unres: null,
        between: null,
        jump: null,
        trail,
        firstCandMs: closed.firstCandMs ?? next.nowMs,
        cand: {
          count: message.count,
          wordsHeard: message.words_heard,
          heardText: message.heard?.text ?? null,
          translation: message.heard?.translation ?? null,
          refs: message.items.map((item) => item.ref),
          piste: leader && leader.basis === "context" ? leader.ref : null,
        },
      };
    }
    case "LOCKED": {
      const closed = closeLock(next, message.t);
      const iv = message.interval;
      if (iv.status === "uncertain") return closed; // jamais nommé : un verrou ne l'est pas
      const [id, counter] = nextId(closed, "v");
      return {
        ...clearPassage(closed),
        counter,
        lost: null,
        unres: null,
        between: null,
        jump: null,
        lock: {
          id,
          ref: iv.ref,
          status: iv.status,
          basis:
            iv.identity_basis ??
            (iv.status === "inferred" ? "context" : "words"),
          text: iv.text ?? null,
          translation: iv.translation ?? null,
          translationUnavailable: iv.translation_unavailable ?? false,
          words: iv.words ? [iv.words[0], iv.words[1]] : null,
          wordsHeard: iv.words_heard ?? 0,
          repetition: iv.repetition ?? false,
          partial: iv.partial ?? false,
          startT: iv.t[0],
        },
      };
    }
    case "PROGRESS": {
      if (!next.lock || next.lock.ref !== message.ref) return next;
      return {
        ...next,
        lock: {
          ...next.lock,
          wordsHeard: Math.max(next.lock.wordsHeard, message.words_heard),
        },
      };
    }
    case "CONTINUE":
      return onContinue(next, message);
    case "REVISION":
      return onRevision(next, message);
    case "JUMP": {
      const closed = closeLock(clearPassage(next), message.t);
      const top = closed.hist[0];
      const base: LiveState = {
        ...closed,
        lost: null,
        between: null,
        jump: {
          kind: message.kind,
          from: message.from ?? null,
          atMs: next.nowMs,
        },
      };
      // GAP, dérivé ici : un saut en avant qui suit un passage resté sans nom est le trou lui-même.
      if (message.kind === "skip" && top && top.kind === "unres")
        return {
          ...base,
          hist: [{ ...top, gap: true }, ...closed.hist.slice(1)],
        };
      const [id, counter] = nextId(base, "j");
      return {
        ...base,
        counter,
        hist: [
          { kind: "jump", id, jump: message.kind, t: message.t },
          ...base.hist,
        ],
      };
    }
    case "LOST":
      return onLost(next, message);
    case "BASMALA": {
      const [id, counter] = nextId(next, "b");
      return {
        ...next,
        counter,
        hist: [
          {
            kind: "basmala",
            id,
            t: message.t,
            text: message.text ?? null,
            translation: message.translation ?? null,
          },
          ...next.hist,
        ],
      };
    }
    case "DEGRADED": {
      const active = message.overloaded || message.skipped.length > 0;
      const wasActive = next.degraded !== null;
      let degLog = next.degLog;
      if (active && !wasActive) degLog = [...degLog, [message.t, null]];
      if (!active && wasActive)
        degLog = degLog.map((range, i) =>
          i === degLog.length - 1 && range[1] === null
            ? [range[0], message.t]
            : range,
        );
      return {
        ...next,
        degLog,
        degraded: active
          ? {
              overloaded: message.overloaded,
              skipped: message.skipped,
              lagS: message.lag_s,
            }
          : null,
      };
    }
    case "FINALIZING":
      return {
        ...next,
        finalizing: true,
        phase: next.phase === "ended" ? "ended" : "ending",
        endAtS: next.endAtS ?? next.capturedS,
      };
    case "FINAL": {
      const closed = closeLock(next, message.t);
      return {
        ...closed,
        phase: "ended",
        endAtS: closed.endAtS ?? closed.capturedS,
        level: 0,
        link: "ok",
        linkLostAtMs: null,
        degLog: closed.degLog.map((range) =>
          range[1] === null ? [range[0], message.t] : range,
        ),
      };
    }
    case "ERROR": {
      if (next.phase === "connecting" || next.phase === "permission")
        return {
          ...next,
          phase: "error",
          errorKey: keyForCode(message.code),
          errorMessage: message.message,
          retryAfterS: message.retry_after_s ?? null,
        };
      return {
        ...next,
        streamError: {
          code: message.code,
          message: message.message,
          key: keyForCode(message.code),
        },
      };
    }
  }
}

const keyForCode = (code: string): LiveErrorKey => serviceErrorKey(code);

function onContinue(
  state: LiveState,
  message: Extract<ServerMessage, { type: "CONTINUE" }>,
): LiveState {
  const closed = message.closed;
  const cleared = clearPassage({
    ...state,
    lost: null,
    jump: null,
    unres: null,
  });
  if (closed.status === "uncertain") {
    const afterLock = closeLock(cleared, message.t);
    const [id, counter] = nextId(afterLock, "u");
    const heardText = state.cand?.heardText ?? null;
    const t0 = closed.t[0];
    return {
      ...afterLock,
      counter,
      between: null,
      unres: { id, atMs: state.nowMs },
      hist: [
        {
          kind: "unres",
          id,
          t: [t0, closed.t[1] ?? t0],
          wordsHeard: closed.words
            ? closed.words[1]
            : (state.cand?.wordsHeard ?? 0),
          heardText,
          candidates: closed.candidates ?? [],
          candidateCount:
            closed.candidate_count ?? closed.candidates?.length ?? 0,
          gap: false,
        },
        ...afterLock.hist,
      ],
    };
  }
  const lock = state.lock && state.lock.ref === closed.ref ? state.lock : null;
  const id = lock?.id ?? `v${state.counter + 1}`;
  const item = verseItem(id, closed, {
    text: closed.text ?? lock?.text ?? null,
    translation: closed.translation ?? lock?.translation ?? null,
    wordsHeard: Math.max(closed.words_heard ?? 0, lock?.wordsHeard ?? 0),
  });
  // Un verrou resté ouvert sur un autre verset est fermé « interrompu » ; sinon il est remplacé.
  const rest = lock
    ? { ...cleared, lock: null }
    : closeLock(cleared, message.t);
  return {
    ...rest,
    counter: lock ? state.counter : state.counter + 1,
    between: {
      ref: closed.ref,
      status: closed.status,
      text: closed.text ?? lock?.text ?? null,
      translation: closed.translation ?? lock?.translation ?? null,
      expected: message.expected?.ref ?? null,
      revised: false,
    },
    hist: [item, ...rest.hist],
  };
}

function onRevision(
  state: LiveState,
  message: Extract<ServerMessage, { type: "REVISION" }>,
): LiveState {
  // Le verset verrouillé en cours est retiré de la carte et reste dans la liste, corrigé.
  let next = state;
  if (state.lock && state.lock.ref === message.ref) {
    next = closeLock(state, message.t);
    next = {
      ...next,
      hist: next.hist.map((item, i) =>
        i === 0 && item.kind === "verse"
          ? { ...item, interrupted: false }
          : item,
      ),
    };
  }
  let touched = false;
  const hist = next.hist.map((item) => {
    if (
      !touched &&
      item.kind === "verse" &&
      item.ref === message.ref &&
      !item.revised &&
      item.status !== "uncertain"
    ) {
      touched = true;
      // Le texte n'est plus conservé : un passage plus sûr ne doit plus se lire comme tel (I3).
      return {
        ...item,
        revised: true,
        status: "uncertain" as const,
        text: null,
        translation: null,
      };
    }
    return item;
  });
  return {
    ...next,
    hist,
    rev: { ref: message.ref, atMs: state.nowMs },
    between:
      next.between && next.between.ref === message.ref
        ? { ...next.between, revised: true, text: null, translation: null }
        : next.between,
  };
}

function onLost(
  state: LiveState,
  message: Extract<ServerMessage, { type: "LOST" }>,
): LiveState {
  const closed = closeLock(state, message.t);
  const base: LiveState = {
    ...clearPassage(closed),
    lost: { reason: message.reason, atMs: state.nowMs },
    jump: null,
  };
  if (message.reason === "silence") return base; // le dernier verset reste affiché
  if (message.reason === "non_quran") {
    const top = base.hist[0];
    const [id, counter] = nextId(base, "n");
    return {
      ...base,
      between: null,
      counter: top && top.kind === "nq" ? base.counter : counter,
      hist:
        top && top.kind === "nq"
          ? base.hist
          : [{ kind: "nq", id, t: message.t }, ...base.hist],
    };
  }
  // Fil perdu après des candidats : le passage reste sans nom (état normal), il garde sa place.
  if (state.cand) {
    const [id, counter] = nextId(base, "u");
    return {
      ...base,
      counter,
      between: null,
      unres: { id, atMs: state.nowMs },
      hist: [
        {
          kind: "unres",
          id,
          t: [message.t, message.t],
          wordsHeard: state.cand.wordsHeard,
          heardText: state.cand.heardText,
          candidates: state.cand.refs,
          candidateCount: state.cand.count,
          gap: false,
        },
        ...base.hist,
      ],
    };
  }
  return { ...base, between: null };
}

// ───────────────────────── Sélecteurs ─────────────────────────

export type View =
  | "idle"
  | "perm"
  | "conn"
  | "err"
  | "listen"
  | "cands"
  | "named"
  | "inferred"
  | "unres"
  | "jump"
  | "nonquran"
  | "between"
  | "end";

export function viewOf(state: LiveState): View {
  switch (state.phase) {
    case "idle":
      return "idle";
    case "permission":
      return "perm";
    case "connecting":
      return "conn";
    case "error":
      return "err";
    case "ended":
      return "end";
  }
  if (state.lock)
    return state.lock.status === "inferred" ? "inferred" : "named";
  if (state.cand) return "cands";
  if (state.unres) return "unres";
  if (state.jump) return "jump";
  if (state.lost?.reason === "non_quran") return "nonquran";
  if (state.between) return "between";
  return "listen";
}

/** 0 = rien à dire ; 1, 2, 3 = les trois phrases de patience (seuils 6 / 12 / 21 s de LIVE_UI). */
export function patienceStage(state: LiveState): 0 | 1 | 2 | 3 {
  if (!state.cand || state.firstCandMs === null) return 0;
  const waited = (state.nowMs - state.firstCandMs) / 1000;
  const [a, b, c] = LIVE_UI.patienceS;
  return waited >= c ? 3 : waited >= b ? 2 : waited >= a ? 1 : 0;
}

export function waitedS(state: LiveState): number {
  return state.cand && state.firstCandMs !== null
    ? Math.max(0, (state.nowMs - state.firstCandMs) / 1000)
    : 0;
}

/** Secondes de son gardées côté client pendant une coupure (borné par la mémoire). */
export function cutSeconds(state: LiveState): number {
  if (state.link !== "lost" || state.linkLostAtMs === null) return 0;
  return Math.min(
    LIVE_UI.bufferMaxS,
    Math.max(0, (state.nowMs - state.linkLostAtMs) / 1000),
  );
}

/** Secondes sans voix perçue par le micro (côté client, aide seulement). */
export function silenceS(state: LiveState): number {
  return isLive(state.phase) && state.phase !== "paused"
    ? Math.max(0, state.capturedS - state.lastVoiceS)
    : 0;
}

export const quietHint = (state: LiveState): boolean =>
  silenceS(state) >= LIVE_UI.silenceHintS ||
  (state.lost?.reason === "silence" && silenceS(state) > 0);

export function counts(state: LiveState): { named: number; unnamed: number } {
  let named = state.lock ? 1 : 0;
  let unnamed = 0;
  for (const item of state.hist) {
    if (
      item.kind === "verse" &&
      (item.status === "recognized" || item.status === "inferred")
    )
      named += 1;
    if (item.kind === "unres") unnamed += 1;
  }
  return { named, unnamed };
}

/** Versets nommés puis retirés par une `REVISION` : ni nommés, ni « non nommés », mais jamais passés sous silence. */
export function revisedCount(state: LiveState): number {
  return state.hist.filter((h) => h.kind === "verse" && h.revised).length;
}

/** Le bandeau « Correction » : visible `revisionShownS` secondes après la révision. */
export function recentRevision(state: LiveState): string | null {
  return state.rev &&
    (state.nowMs - state.rev.atMs) / 1000 <= LIVE_UI.revisionShownS
    ? state.rev.ref
    : null;
}

export type HistRow = HistItem & {
  /** Pour un passage non nommé qui est un trou : les deux versets nommés qui l'encadrent. */
  between?: [string | null, string | null];
};

/** Liste des passages, du plus récent au plus ancien, avec les trous « entre 1:2 et 1:4 ». */
export function historyRows(state: LiveState): HistRow[] {
  const rows: HistRow[] = state.hist.map((item) => ({ ...item }));
  rows.forEach((row, i) => {
    if (row.kind !== "unres" || !row.gap) return;
    const named = (r: HistRow) =>
      r.kind === "verse" && r.status !== "uncertain" && !r.revised;
    const older = rows.slice(i + 1).find(named);
    const newer = rows.slice(0, i).reverse().find(named);
    row.between = [
      older && older.kind === "verse" ? older.ref : null,
      newer && newer.kind === "verse" ? newer.ref : null,
    ];
  });
  return rows;
}

/** Dernier verset nommé (et son heure de fin dans le flux), pour la bande « Ce que je sais déjà ». */
export function lastNamed(
  state: LiveState,
): { ref: string; endT: number | null } | null {
  const item = state.hist.find(
    (h) =>
      h.kind === "verse" &&
      (h.status === "recognized" || h.status === "inferred"),
  );
  return item && item.kind === "verse"
    ? { ref: item.ref, endT: item.t[1] }
    : null;
}

// ───────────────────────── Annonces (une seule région vivante) ─────────────────────────

const key = (s: LiveState) => ({
  phase: s.phase,
  lock: s.lock ? `${s.lock.id}:${s.lock.status}` : "",
  rev: s.rev ? `${s.rev.ref}@${s.rev.atMs}` : "",
  link: s.link,
  degraded: s.degraded !== null,
  unres: s.unres?.id ?? "",
});

/**
 * Phrase à annoncer quand l'état change, ou `null`. Sobre : ni nombre de candidats, ni mots, ni
 * niveau, ni durée, ni texte arabe, ni PARTIAL (docs/design/en-direct.md §11). Une seule annonce à la
 * fois ; l'espacement de 2,5 s est géré par l'appelant (`LIVE_UI.announceGapMs`).
 */
export function announceChange(
  prev: LiveState | null,
  next: LiveState,
  name: (ref: string) => string,
): string | null {
  if (!prev) return null;
  const a = key(prev);
  const b = key(next);
  if (a.phase !== b.phase) {
    if (b.phase === "listening" && a.phase === "connecting")
      return "Écoute démarrée.";
    if (b.phase === "paused") return "Écoute en pause.";
    if (b.phase === "listening" && a.phase === "paused")
      return "Écoute reprise.";
    if (b.phase === "ended") return "Écoute terminée.";
  }
  if (b.rev && a.rev !== b.rev && next.rev)
    return `Correction : ${next.rev.ref} n’est plus nommé.`;
  if (b.lock && a.lock !== b.lock && next.lock)
    return next.lock.status === "inferred"
      ? `Verset déduit de la position : ${name(next.lock.ref)}. Non reconnu à la voix.`
      : `Verset nommé : ${name(next.lock.ref)}.`;
  if (a.link !== b.link) {
    if (b.link === "lost") return "Connexion perdue. L’écoute continue.";
    if (a.link === "lost") return "Connexion rétablie.";
  }
  if (a.degraded !== b.degraded)
    return b.degraded
      ? "Mode allégé : les noms arriveront plus tard."
      : "Retour au mode normal.";
  if (b.unres && a.unres !== b.unres)
    return "Passage entendu, non nommé. Ce n’est pas une erreur.";
  return null;
}
