/**
 * Réglages de l'écran « En direct » : UN SEUL endroit (comme `LiveConfig` côté moteur). Aucun seuil,
 * délai ni taille n'est écrit ailleurs dans l'interface (conception : docs/design/en-direct.md §14,
 * risque 10). Les seuils de patience sont des valeurs de départ (médiane, p90 et maximum observés à
 * l'étape 2), à recaler avec une vraie mesure : ce sont des réglages d'interface, pas des mesures.
 */
export const LIVE_UI = {
  /** Contrat parlé avec le service. */
  schema: "aqr.live/1",
  /** Fréquence d'échantillonnage envoyée : le service n'accepte que 16 kHz mono 16 bits. */
  sampleRate: 16000,
  /** Taille d'un bloc audio envoyé (le service conseille 20 à 100 ms). */
  blockMs: 100,
  /**
   * En pause, rien du micro n'est envoyé ; seule une trame de silence très courte part à intervalle
   * régulier pour que ni le service (délai d'inactivité) ni un tunnel ne ferment la connexion.
   */
  heartbeatEveryMs: 1000,
  heartbeatMs: 20,
  /** Son gardé côté client pendant une coupure (borne de la mémoire : 5 min ≈ 9,6 Mo). */
  bufferMaxS: 300,
  /** Seuils de patience (secondes depuis les premiers candidats du passage) : 6 / 12 / 21. */
  patienceS: [6, 12, 21],
  /** Au-delà, sans son : « Je n'entends rien pour l'instant ». */
  silenceHintS: 8,
  /** Nouvel essai automatique après une coupure. */
  retryEveryS: 5,
  /** Marge après le délai de reprise annoncé par le service avant de renoncer. */
  resumeGraceS: 5,
  /** Le bandeau « Correction » reste visible ce temps. */
  revisionShownS: 14,
  /** Annonces vocales : jamais plus d'une toutes les 2,5 s. */
  announceGapMs: 2500,
  /** Ruban de niveau : 40 barres, 0,12 s chacune (≈ 5 s d'historique). */
  levelBars: 40,
  levelBarS: 0.12,
  /** Niveau (RMS 0–1) au-dessus duquel le client considère que quelqu'un parle (aide, jamais un verdict). */
  voiceLevel: 0.012,
  /** Attente maximale d'une réponse du service au démarrage, puis à la fin d'écoute. */
  connectTimeoutMs: 12000,
  finalTimeoutMs: 20000,
  /** « Ne rien garder » est annulable ce temps. */
  discardUndoS: 6,
  /** Mise à jour de l'interface : au plus 8 fois par seconde pour le niveau. */
  levelHz: 8,
  /** Nombre de messages gardés pour le mode technique. */
  logKeep: 40,
  /** Taille maximale de la mémoire d'enregistrement local (octets) avant d'arrêter de le garder. */
  keepMaxBytes: 200 * 1024 * 1024,
  /** Clé de l'interrupteur « mode technique » (stockage local du navigateur). */
  techStorageKey: "aqr.ui.live.v1",
  /** Adresse proposée si le serveur d'atelier n'en donne pas (aussi celle de `aqr live-serve`). */
  defaultUrl: "ws://127.0.0.1:8765/live",
} as const;

export type LiveUi = typeof LIVE_UI;
