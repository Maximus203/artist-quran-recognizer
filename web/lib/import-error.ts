/**
 * Refus d'import avec son code HTTP et un message lisible (jamais une trace technique). `code` est le
 * code lisible par une machine renvoyé par l'API ; absent, la route le déduit du statut.
 * Module à part : `import-session` et le contrôle du résultat (`result-check`) s'en servent tous deux.
 */
export class ImportError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "ImportError";
    this.status = status;
    this.code = code;
  }
}
