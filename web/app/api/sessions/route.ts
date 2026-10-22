import { NextRequest } from "next/server";
import { apiError, json, safe } from "@/lib/http";
import {
  ImportError,
  importFromBytes,
  importFromStream,
  type ImportOwner,
} from "@/lib/import-session";
import { ensureQueueRecovered, launch } from "@/lib/jobs";
import { userQuotaBytes } from "@/lib/quota";
import { requireUser } from "@/lib/route-guard";
import { getMeta, markViewedBy, usedBytes } from "@/lib/session-index";
import { cleanUserName } from "@/lib/session-name";
import { parseListQuery } from "@/lib/session-query";
import { listForUser, viewForUser } from "@/lib/session-service";
import {
  cleanupSessions,
  exceedsUploadLimit,
  sessionTtlSeconds,
  uploadLimitBytes,
} from "@/lib/store";

export const runtime = "nodejs";

/**
 * Liste paginée des sessions visibles de l'utilisateur.
 * Paramètres : `scope` (mine · shared · all · favorites · archived, défaut all), `q` (nom, contenu,
 * fichier), `state` (liste séparée par des virgules : ready queued running done failed cancelled
 * active unread), `engine`, `from` / `to` (date ou ISO), `sort` (recent · oldest · name · duration ·
 * size), `limit` (1–100, défaut 20), `cursor` (valeur de `next_cursor`).
 * Réponse : `{ items, next_cursor, total, counts: { scopes, states } }`.
 */
async function handleGET(request: NextRequest) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;
  const parsed = parseListQuery(new URL(request.url).searchParams);
  if (!parsed.ok) return apiError(400, parsed.message, { code: "invalid" });
  await ensureQueueRecovered().catch(() => []);
  return json(await listForUser(auth.db, auth.user, parsed.query));
}

type Chosen = { visibility: "global" | "private"; name: string | null };

/** `visibility` (défaut global) et `name` (facultatif) : adresse, formulaire ou en-tête `x-aqr-name`. */
function chosenOptions(
  request: Request,
  form: FormData | null,
): Chosen | { error: string } {
  const url = new URL(request.url).searchParams;
  const field = (name: string) => {
    const value = form?.get(name);
    return typeof value === "string" ? value : null;
  };
  const visibility = url.get("visibility") ?? field("visibility") ?? "global";
  if (visibility !== "global" && visibility !== "private")
    return { error: "visibility : « global » ou « private »." };
  let rawName = url.get("name") ?? field("name");
  const header = request.headers.get("x-aqr-name");
  if (rawName === null && header !== null) {
    try {
      rawName = decodeURIComponent(header);
    } catch {
      return { error: "Nom mal encodé." };
    }
  }
  if (rawName === null || rawName.trim() === "")
    return { visibility, name: null };
  const name = cleanUserName(rawName);
  if (name === null) return { error: "Le nom fait 1 à 120 caractères." };
  return { visibility, name };
}

/**
 * Import d'un audio ou d'une vidéo. Le propriétaire est l'utilisateur connecté.
 *
 * - Flux brut (recommandé, seul adapté à une vidéo volumineuse) : corps = octets du fichier,
 *   en-tête `x-aqr-filename` (nom encodé en pourcentage), `x-aqr-source-kind` facultatif.
 * - Formulaire multipart (champ `audio`, résultat `result` facultatif) : lu en mémoire, audio seulement
 *   dans la pratique (plafond `AQR_MAX_UPLOAD_BYTES`).
 * `?autorun=1` met l'analyse en file dès l'import ; `?visibility=global|private` (défaut `global`) ;
 * `?name=…` (ou en-tête `x-aqr-name`) donne un nom ; sans lui, un nom par défaut est dérivé du fichier.
 * `413` si le fichier dépasse le plafond d'envoi ou le quota de l'utilisateur.
 */
async function handlePOST(request: NextRequest) {
  const auth = await requireUser(request, { mutation: true });
  if (!auth.ok) return auth.response;
  try {
    await cleanupSessions(sessionTtlSeconds()).catch(() => []);
    const wantsAutorun = (value: unknown) => value === "1" || value === "true";
    let autorun = wantsAutorun(
      new URL(request.url).searchParams.get("autorun"),
    );
    const multipart = (request.headers.get("content-type") ?? "")
      .toLowerCase()
      .startsWith("multipart/form-data");
    if (
      multipart &&
      exceedsUploadLimit(
        request.headers.get("content-length"),
        uploadLimitBytes(),
      )
    )
      return apiError(413, "Envoi trop volumineux.");
    const form = multipart ? await request.formData() : null;
    const chosen = chosenOptions(request, form);
    if ("error" in chosen)
      return apiError(400, chosen.error, { code: "invalid" });
    const limit = userQuotaBytes();
    const owner: ImportOwner = {
      ownerId: auth.user.id,
      visibility: chosen.visibility,
      name: chosen.name,
      quota: limit ? { limit, used: usedBytes(auth.db, auth.user.id) } : null,
    };
    let created;
    if (form) {
      const file = form.get("audio") ?? form.get("media");
      if (!(file instanceof File))
        return apiError(400, "Choisis un audio ou une vidéo.");
      const imported = form.get("result");
      const kind = form.get("source_kind");
      autorun = autorun || wantsAutorun(form.get("autorun"));
      created = await importFromBytes({
        name: file.name,
        bytes: Buffer.from(await file.arrayBuffer()),
        sourceKind: typeof kind === "string" ? kind : null,
        prediction:
          imported instanceof File && imported.size
            ? Buffer.from(await imported.arrayBuffer())
            : null,
        owner,
      });
    } else {
      if (!request.body) return apiError(400, "Corps de requête vide.");
      created = await importFromStream({
        stream: request.body,
        filename: request.headers.get("x-aqr-filename"),
        sourceKind: request.headers.get("x-aqr-source-kind"),
        contentLength: request.headers.get("content-length"),
        owner,
      });
    }
    // Un échec de mise en file ne perd pas l'import : la session reste « prête » et le dit.
    let autorunError: string | null = null;
    if (autorun && created.state === "ready") {
      try {
        await ensureQueueRecovered();
        await launch(created.id);
      } catch (e) {
        autorunError =
          e instanceof Error ? e.message : "Mise en file impossible";
      }
    }
    // Un résultat joint à l'import est sous les yeux de l'utilisateur : pas de point « non lu ».
    if (created.state === "done")
      markViewedBy(auth.db, auth.user.id, created.id, new Date().toISOString());
    const meta = getMeta(auth.db, created.id);
    const view = meta ? await viewForUser(auth.db, auth.user, meta) : null;
    return json(
      { ...view, ...(autorunError ? { autorun_error: autorunError } : {}) },
      201,
    );
  } catch (e) {
    if (e instanceof ImportError)
      return apiError(e.status, e.message, {
        code: e.status === 413 ? "too_large" : "invalid",
      });
    return apiError(400, e instanceof Error ? e.message : "Import impossible");
  }
}

export const GET = safe(handleGET);
export const POST = safe(handlePOST);
