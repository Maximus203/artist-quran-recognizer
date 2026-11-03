const formats = [
  { mime: "audio/webm;codecs=opus", extension: ".webm" },
  { mime: "audio/webm", extension: ".webm" },
  { mime: "audio/ogg;codecs=opus", extension: ".ogg" },
  { mime: "audio/ogg", extension: ".ogg" },
  { mime: "audio/mp4", extension: ".m4a" },
];

export function supportedRecordingType(
  isSupported: (type: string) => boolean,
): string | null {
  return formats.find(({ mime }) => isSupported(mime))?.mime ?? null;
}

export function recordingExtension(mime: string): string | null {
  const base = mime.split(";", 1)[0].toLowerCase();
  return (
    formats.find((format) => format.mime.split(";", 1)[0] === base)
      ?.extension ?? null
  );
}

export function recordingError(error: { name?: string }): string {
  switch (error.name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return "Autorisation du microphone refusée. Autorise l’accès dans le navigateur puis réessaie.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "Aucun microphone détecté sur cet appareil.";
    case "NotReadableError":
    case "TrackStartError":
      return "Le microphone est déjà utilisé ou indisponible. Ferme l’autre application puis réessaie.";
    default:
      return "L’enregistrement a échoué. Vérifie le microphone et réessaie.";
  }
}
