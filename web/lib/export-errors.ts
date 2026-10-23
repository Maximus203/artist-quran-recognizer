import { ZodError } from "zod";
import { DecisionsError } from "./decisions";
import { DecisionsForbiddenError } from "./decisions-store";
import {
  EngineInputError,
  NotReadyError,
  UnresolvedItemsError,
} from "./export-engine";
import { apiError, forbidden } from "./http";

/** Une erreur du moteur d'export ou des décisions, en réponse d'API lisible (jamais un chemin ni une trace). */
export function exportErrorResponse(error: unknown): Response | null {
  if (error instanceof NotReadyError)
    return apiError(409, error.message, { code: "not_ready" });
  if (error instanceof UnresolvedItemsError)
    return Response.json(
      {
        error:
          "Des passages ambigus restent à corriger : corrige-les ou force l'export.",
        code: "unresolved_items",
        unresolved: error.unresolved,
      },
      { status: 409, headers: { "Cache-Control": "private, no-store" } },
    );
  if (error instanceof DecisionsForbiddenError) return forbidden(error.message);
  if (error instanceof DecisionsError || error instanceof EngineInputError)
    return apiError(400, error.message, { code: "invalid" });
  if (error instanceof ZodError)
    return apiError(
      400,
      error.issues
        .map((issue) => `${issue.path.join(".") || "corps"} : ${issue.message}`)
        .join(" · "),
      { code: "invalid" },
    );
  if (error instanceof Error && error.message.includes("Session introuvable"))
    return apiError(404, "Session introuvable", { code: "not_found" });
  return null;
}
