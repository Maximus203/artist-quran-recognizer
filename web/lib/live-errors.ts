/**
 * Les erreurs de l'écran « En direct », dites en français clair : ce qui ne marche pas (titre), la
 * cause, ce que ça change, ce qu'on peut faire (règle « une erreur s'explique »). Jamais un code
 * brut, un nom de variable ou une commande. Le texte du service, quand il en envoie un, est montré
 * à part, tel quel (il est déjà en clair, docs/LIVE-PROTOCOL.md §4).
 */
export type LiveErrorKey =
  | "denied"
  | "insecure"
  | "nomic"
  | "micbusy"
  | "unsupported"
  | "server_busy"
  | "too_many_streams"
  | "unreachable"
  | "signin"
  | "token"
  | "unavailable"
  | "rate_limited"
  | "expired"
  | "internal";

export type LiveErrorText = {
  icon: "mic-off" | "lock" | "link-off" | "alert";
  title: string;
  cause: string;
  impact: string;
  todo: string;
  /** Le bouton « Réessayer » a un sens (sinon l'écran propose seulement l'import classique). */
  retry: boolean;
};

export const LIVE_ERRORS: Record<LiveErrorKey, LiveErrorText> = {
  denied: {
    icon: "mic-off",
    title: "Le micro est bloqué pour ce site",
    cause:
      "Tu as refusé l’accès au micro, ou le navigateur s’en souvient d’une fois précédente.",
    impact: "Rien n’est écouté et rien n’est envoyé.",
    todo: "Clique sur le cadenas à gauche de l’adresse, autorise le micro, puis réessaie.",
    retry: true,
  },
  insecure: {
    icon: "lock",
    title: "Le micro est interdit sur cette page",
    cause:
      "Les navigateurs n’ouvrent le micro que sur une page sécurisée (adresse en https, ou localhost). Cette page est ouverte en http sur le réseau.",
    impact:
      "L’écoute en direct ne peut pas démarrer ici ; l’enregistrement classique non plus.",
    todo: "Ouvre l’atelier par son adresse https (lien de test) ou depuis l’ordinateur qui l’héberge.",
    retry: false,
  },
  nomic: {
    icon: "mic-off",
    title: "Aucun micro trouvé",
    cause:
      "Le navigateur ne voit aucune entrée audio (micro débranché, casque coupé).",
    impact: "Rien n’est écouté.",
    todo: "Branche ou active un micro, puis réessaie.",
    retry: true,
  },
  micbusy: {
    icon: "mic-off",
    title: "Le micro est déjà utilisé",
    cause: "Une autre application ou un autre onglet a pris le micro.",
    impact: "L’écoute n’a pas démarré.",
    todo: "Ferme l’autre application (appel, enregistreur), puis réessaie.",
    retry: true,
  },
  unsupported: {
    icon: "alert",
    title: "Ce navigateur ne sait pas écouter en direct",
    cause: "Il lui manque la capture audio continue ou la connexion WebSocket.",
    impact:
      "L’écoute en direct n’est pas disponible ; l’import d’un fichier fonctionne.",
    todo: "Essaie une version récente de Chrome, Edge, Firefox ou Safari, ou utilise « Nouvel essai ».",
    retry: false,
  },
  server_busy: {
    icon: "link-off",
    title: "Le service d’écoute est complet",
    cause:
      "Trop de personnes écoutent en même temps : le serveur a une limite de flux simultanés.",
    impact:
      "Ton écoute n’a pas démarré ; le micro a été refermé et rien n’a été envoyé.",
    todo: "Réessaie dans quelques secondes. Tu peux aussi enregistrer ta récitation et l’analyser ensuite.",
    retry: true,
  },
  too_many_streams: {
    icon: "link-off",
    title: "Tu as déjà une écoute en cours",
    cause:
      "Ton compte est limité à un petit nombre d’écoutes à la fois, et une autre est encore ouverte (autre onglet ou autre appareil).",
    impact: "Cette écoute n’a pas démarré.",
    todo: "Termine l’autre écoute (ou attends quelques secondes qu’elle se ferme), puis réessaie.",
    retry: true,
  },
  unreachable: {
    icon: "link-off",
    title: "Impossible de joindre le service d’écoute",
    cause:
      "Le service d’écoute ne répond pas : il n’est pas démarré, ou la connexion est coupée entre ton appareil et lui.",
    impact: "Rien n’a été écouté et rien n’a été envoyé.",
    todo: "Vérifie ta connexion puis réessaie ; si cela dure, prévenir la personne qui héberge l’atelier. L’enregistrement classique reste possible.",
    retry: true,
  },
  signin: {
    icon: "lock",
    title: "Ta connexion à l’atelier a expiré",
    cause:
      "Le jeton d’écoute n’a pas pu être demandé : ta session n’est plus valide.",
    impact: "L’écoute n’a pas démarré.",
    todo: "Reconnecte-toi à l’atelier, puis relance l’écoute.",
    retry: false,
  },
  token: {
    icon: "lock",
    title: "Le laissez-passer d’écoute n’a pas été accepté",
    cause:
      "Il ne vaut qu’une minute et ne sert qu’une fois : celui de cette écoute a expiré ou avait déjà servi.",
    impact: "L’écoute n’a pas démarré ; rien n’a été envoyé.",
    todo: "Réessaie : un nouveau laissez-passer est demandé à chaque départ. Si cela revient, recharge la page.",
    retry: true,
  },
  unavailable: {
    icon: "alert",
    title: "L’écoute en direct n’est pas configurée",
    cause:
      "L’atelier n’a pas de clé de signature ou d’adresse valide pour joindre le service d’écoute.",
    impact: "L’écoute en direct ne peut pas démarrer.",
    todo: "Préviens la personne qui héberge l’atelier. L’enregistrement classique reste possible.",
    retry: false,
  },
  rate_limited: {
    icon: "alert",
    title: "Trop de demandes d’écoute en peu de temps",
    cause: "L’atelier limite le nombre de départs d’écoute par minute.",
    impact: "Cette écoute n’a pas démarré.",
    todo: "Patiente quelques secondes, puis réessaie.",
    retry: true,
  },
  expired: {
    icon: "link-off",
    title: "L’écoute a été coupée trop longtemps",
    cause:
      "La connexion est restée perdue plus longtemps que le délai de reprise : le service a fermé la session.",
    impact:
      "Ce qui a été entendu avant la coupure est conservé ci-dessous. Le son depuis la coupure n’a pas été analysé.",
    todo: "Garde l’enregistrement pour l’analyser en entier, ou recommence une écoute.",
    retry: false,
  },
  internal: {
    icon: "alert",
    title: "Le service d’écoute a rencontré un problème",
    cause: "Une erreur interne du serveur a interrompu l’analyse.",
    impact: "Ce qui avait été entendu avant l’erreur est conservé ci-dessous.",
    todo: "Réessaie dans un instant ; garde l’enregistrement si tu veux l’analyser en entier.",
    retry: true,
  },
};

/** Erreur de `getUserMedia` (ou contexte) → écran qui s'explique. */
export function micErrorKey(
  error: unknown,
  context: { secure: boolean; hasApi: boolean },
): LiveErrorKey {
  if (!context.secure) return "insecure";
  if (!context.hasApi) return "unsupported";
  const name = (error as { name?: string } | null)?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return "nomic";
  if (name === "NotReadableError" || name === "AbortError") return "micbusy";
  return "unsupported";
}

/** Code d'erreur du service (ou de l'émission du jeton) → écran. */
export function serviceErrorKey(code: string): LiveErrorKey {
  switch (code) {
    case "server_busy":
      return "server_busy";
    case "too_many_streams":
      return "too_many_streams";
    case "session_expired":
    case "replay_unavailable":
      return "expired";
    case "token_invalid":
    case "token_expired":
    case "token_replayed":
      return "token";
    case "unauthenticated":
      return "signin";
    case "live_unavailable":
      return "unavailable";
    case "rate_limited":
      return "rate_limited";
    default:
      return "internal";
  }
}

/**
 * Que faire d'une erreur du service ?
 *  - `retry_link` : le flux est reprenable, on rouvre une connexion (coupure, inactivité, jeton) ;
 *  - `terminal` : le service enverra `FINAL` puis fermera, ce qui a été entendu est gardé ;
 *  - `start_failure` : refus au départ, avant `READY`.
 */
export type ErrorAction = "retry_link" | "terminal" | "start_failure";

const STREAM_ERRORS = new Set([
  "bad_audio_block",
  "stream_too_long",
  "silence_too_long",
  "session_expired",
  "replay_unavailable",
  "bad_message",
  "bad_audio_format",
  "unsupported_schema",
]);

export function classifyError(code: string, started: boolean): ErrorAction {
  if (!started) return "start_failure";
  if (STREAM_ERRORS.has(code)) return "terminal";
  if (code === "server_busy") return "terminal";
  return "retry_link";
}
