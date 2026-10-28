/**
 * Serveur MCP de Quran TR (transport « Streamable HTTP », sans état, réponses JSON) : JSON-RPC 2.0
 * pur, sans Next ni réseau. Les outils appellent l'API de l'atelier par `call`, injecté par la
 * route : un outil n'a donc jamais plus de droits que l'API (mêmes contrôles d'accès, mêmes
 * quotas, mêmes erreurs). Le texte arabe et la traduction viennent toujours du résultat de
 * l'atelier (corpus et QuranEnc), jamais d'un modèle (invariants I1 et I2).
 */
import type { TokenScope } from "./api-tokens";

export const MCP_PROTOCOLS = [
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
] as const;
export const SERVER_INFO = { name: "quran-tr", version: "1.0.0" } as const;

/** Taille maximale d'un audio envoyé en base64 par l'outil (au-delà : l'API REST, en flux). */
export const MAX_MCP_AUDIO_BYTES = 25 * 1024 * 1024;

export type ApiCall = (
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  options?: {
    json?: unknown;
    bytes?: Buffer;
    headers?: Record<string, string>;
  },
) => Promise<{ status: number; body: unknown }>;

export type McpContext = { scope: TokenScope; call: ApiCall };

type Json = Record<string, unknown>;

type Tool = {
  name: string;
  description: string;
  write?: boolean;
  inputSchema: Json;
  run: (args: Json, ctx: McpContext) => Promise<unknown>;
};

const idSchema = {
  type: "string",
  description:
    "Identifiant de l'essai (UUID), tel que renvoyé par list_recordings.",
};

function asId(args: Json): string {
  const id = args.id;
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id))
    throw new ToolError("id : un identifiant d'essai (UUID) est requis.");
  return id.toLowerCase();
}

export class ToolError extends Error {}

function unwrap(
  reply: { status: number; body: unknown },
  action: string,
): Json {
  if (reply.status >= 200 && reply.status < 300)
    return (reply.body ?? {}) as Json;
  const message =
    (reply.body as { error?: string } | null)?.error ?? `HTTP ${reply.status}`;
  throw new ToolError(`${action} : ${message}`);
}

type Interval = Json & {
  kind?: string;
  ref?: string;
  t?: [number, number];
  status?: string;
  partial?: boolean;
  text?: string;
  translation?: { text?: string; attribution?: string } | null;
};

/** Projection compacte et fidèle du résultat : ce dont un agent a besoin, rien d'inventé. */
export function compactResult(result: Json | null): Json | null {
  if (!result) return null;
  const intervals = (result.intervals as Interval[] | undefined) ?? [];
  const verses = intervals
    .filter((i) => i.kind === "verse")
    .map((i) => ({
      ref: i.ref,
      start_s: i.t?.[0] ?? null,
      end_s: i.t?.[1] ?? null,
      status: i.status,
      partial: i.partial ?? false,
      arabic: i.text ?? null,
      translation: i.translation?.text ?? null,
      translation_source: i.translation?.attribution ?? null,
    }));
  const others = intervals.filter((i) => i.kind !== "verse");
  return {
    verses,
    non_quran_or_abstained: others.length,
    warnings: result.warnings ?? [],
  };
}

export const TOOLS: Tool[] = [
  {
    name: "whoami",
    description:
      "Qui est connecté : le compte et les droits du jeton (lecture seule ou écriture).",
    inputSchema: { type: "object", properties: {} },
    run: async (_args, ctx) => ({ scope: ctx.scope }),
  },
  {
    name: "list_recordings",
    description:
      "Liste les essais (audios) du compte, du plus récent au plus ancien. Chacun a un état : ready, queued, running, done, failed, cancelled. Seuls ceux en état « done » ont un résultat.",
    inputSchema: {
      type: "object",
      properties: {
        q: {
          type: "string",
          description: "Recherche dans le nom et le contenu.",
        },
        state: {
          type: "string",
          description: "États séparés par des virgules, ex. « done,running ».",
        },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
        cursor: {
          type: "string",
          description: "next_cursor d'une page précédente.",
        },
      },
    },
    run: async (args, ctx) => {
      const params = new URLSearchParams();
      for (const key of ["q", "state", "cursor"])
        if (typeof args[key] === "string" && args[key])
          params.set(key, args[key] as string);
      if (typeof args.limit === "number")
        params.set("limit", String(args.limit));
      return unwrap(
        await ctx.call("GET", `/api/sessions?${params}`),
        "Liste impossible",
      );
    },
  },
  {
    name: "get_recording",
    description:
      "État d'un essai et, s'il est terminé, les versets reconnus : référence (sourate:verset), début et fin en secondes, statut de preuve (recognized, inferred, uncertain), texte arabe exact du Mushaf et traduction française officielle QuranEnc. Les passages non coraniques ne sont jamais nommés.",
    inputSchema: {
      type: "object",
      properties: { id: idSchema },
      required: ["id"],
    },
    run: async (args, ctx) => {
      const id = asId(args);
      const body = unwrap(
        await ctx.call("GET", `/api/sessions/${id}`),
        "Lecture impossible",
      );
      return {
        session: body.session,
        result: compactResult((body.result as Json | null) ?? null),
      };
    },
  },
  {
    name: "create_recording",
    write: true,
    description:
      "Importe un audio (ou une vidéo) et lance l'analyse. L'audio est envoyé en base64 (25 Mo au plus ; au-delà, utiliser l'API REST en flux). Renvoie l'essai créé ; interroger ensuite get_recording jusqu'à l'état « done ». Par défaut l'essai est privé (visible du seul compte).",
    inputSchema: {
      type: "object",
      properties: {
        filename: {
          type: "string",
          description:
            "Nom du fichier avec son extension (mp3, m4a, wav, ogg, webm, mp4…).",
        },
        audio_base64: {
          type: "string",
          description: "Contenu du fichier en base64.",
        },
        name: { type: "string", description: "Nom affiché (facultatif)." },
        visibility: {
          type: "string",
          enum: ["private", "global"],
          default: "private",
        },
        autorun: { type: "boolean", default: true },
      },
      required: ["filename", "audio_base64"],
    },
    run: async (args, ctx) => {
      if (ctx.scope !== "write")
        throw new ToolError(
          "Ce jeton est en lecture seule : l'import est refusé.",
        );
      const filename = args.filename;
      const b64 = args.audio_base64;
      if (typeof filename !== "string" || !filename.trim())
        throw new ToolError("filename : un nom de fichier est requis.");
      if (typeof b64 !== "string" || !b64)
        throw new ToolError("audio_base64 : le contenu du fichier est requis.");
      if (b64.length > Math.ceil((MAX_MCP_AUDIO_BYTES * 4) / 3) + 8)
        throw new ToolError(
          "Fichier trop gros pour cet outil (25 Mo) : utiliser POST /api/v1/recordings en flux.",
        );
      const bytes = Buffer.from(b64, "base64");
      if (bytes.length === 0)
        throw new ToolError("audio_base64 est vide ou invalide.");
      const params = new URLSearchParams({
        visibility: args.visibility === "global" ? "global" : "private",
      });
      if (args.autorun !== false) params.set("autorun", "1");
      if (typeof args.name === "string" && args.name)
        params.set("name", args.name);
      return unwrap(
        await ctx.call("POST", `/api/sessions?${params}`, {
          bytes,
          headers: {
            "x-aqr-filename": encodeURIComponent(filename),
            "content-type": "application/octet-stream",
          },
        }),
        "Import impossible",
      );
    },
  },
  {
    name: "get_export_options",
    description:
      "Catalogue des options d'export : sous-titres (format, contenu, durées, police…) et vidéo (format, tailles, fonds proposés…), avec valeurs permises et défauts.",
    inputSchema: { type: "object", properties: {} },
    run: async (_args, ctx) =>
      unwrap(
        await ctx.call("GET", "/api/v1/export/options"),
        "Lecture impossible",
      ),
  },
  {
    name: "suggest_video_ranges",
    description:
      "À appeler AVANT export_video pour choisir quoi découper. Renvoie les plages protégées d'un essai terminé : une par verset (ou par passage), qui commencent un peu avant la récitation et finissent un peu après, aimantées au silence pour ne jamais couper une voix. Chaque plage donne start/end (à passer tels quels à export_video dans `ranges`), core_start/core_end (la récitation seule), lead_in/tail_out réellement gardés, refs (références sourate:verset), status (recognized ou inferred) et warnings (voisin trop proche, aucun silence trouvé, bord de l'audio…). Les passages incertains ne sont jamais proposés. Sans réglage, la marge est 0,6 s avant et 0,4 s après.",
    inputSchema: {
      type: "object",
      properties: {
        id: idSchema,
        lead_in: { type: "number", description: "Marge avant (s, 0-5)." },
        tail_out: { type: "number", description: "Marge après (s, 0-5)." },
        snap_to_silence: { type: "boolean" },
        group: {
          type: "string",
          enum: ["verse", "passage"],
          description: "Une plage par verset (défaut) ou par passage enchaîné.",
        },
        merge_gap: { type: "number" },
        include_silences: {
          type: "boolean",
          description: "Ajoute la liste des silences de l'audio.",
        },
      },
      required: ["id"],
    },
    run: async (args, ctx) => {
      const id = asId(args);
      const params = new URLSearchParams();
      for (const key of ["lead_in", "tail_out", "merge_gap"])
        if (typeof args[key] === "number") params.set(key, String(args[key]));
      if (typeof args.snap_to_silence === "boolean")
        params.set("snap", args.snap_to_silence ? "1" : "0");
      if (typeof args.group === "string") params.set("group", args.group);
      if (args.include_silences === true) params.set("silences", "1");
      return unwrap(
        await ctx.call(
          "GET",
          `/api/sessions/${id}/export/suggestions?${params}`,
        ),
        "Suggestion impossible",
      );
    },
  },
  {
    name: "export_video",
    description:
      "Demande la vidéo MP4 d'un essai terminé (verset surligné mot à mot, traduction, onde audio) : mêmes réglages que le formulaire de l'atelier. Renvoie un job ; suivre avec get_video_export jusqu'à « done », puis télécharger chaque entrée de `download_paths` (ou `download_path` s'il n'y a qu'une vidéo) avec le même jeton. Plusieurs plages (ranges) ou per_verse donnent plusieurs vidéos, une par plage. Le rendu dure à peu près la moitié de la durée de l'audio à 30 im/s, davantage à 60 im/s ou en 1440p/4K.",
    inputSchema: {
      type: "object",
      properties: {
        id: idSchema,
        orientation: {
          type: "string",
          enum: ["16:9", "9:16", "1:1", "source"],
        },
        arabic_size: {
          description: "Points (40-140) ou small | medium | large | xlarge.",
        },
        translation_size: {
          description: "Points (16-64) ou small | medium | large | xlarge.",
        },
        show_translation: { type: "boolean" },
        fps: {
          type: "number",
          enum: [30, 60],
          description:
            "Images par seconde : 30 (défaut) ou 60 (plus fluide, plus lourd).",
        },
        resolution: {
          type: "number",
          enum: [360, 480, 720, 1080, 1440, 2160],
          description:
            "Côté court de l'image en pixels (720 = 1280×720 en 16:9). Défaut 1080.",
        },
        ranges: {
          type: "array",
          description:
            "Parties à exporter : une vidéo par plage { start, end, name? } en secondes de l'audio (50 au plus). Absent = tout l'audio. `name` (80 caractères au plus) nomme le fichier de la plage, par exemple la référence « 2:255 ».",
          items: {
            type: "object",
            properties: {
              start: { type: "number" },
              end: { type: "number" },
              name: {
                type: "string",
                description: "Nom de la plage, suffixe du fichier MP4.",
              },
            },
            required: ["start", "end"],
          },
        },
        per_verse: {
          type: "boolean",
          description:
            "Une vidéo par verset reconnu (= suggest « verse », exclusif avec ranges).",
        },
        suggest: {
          type: "string",
          enum: ["verse", "passage"],
          description:
            "Découpe automatique protégée (marges avant/après la récitation, aimantée au silence : aucune voix coupée). « passage » regroupe les versets enchaînés. Voir suggest_video_ranges pour prévisualiser.",
        },
        lead_in: {
          type: "number",
          description:
            "Marge avant la récitation, en secondes (0-5, défaut 0,6).",
        },
        tail_out: {
          type: "number",
          description:
            "Marge après la récitation, en secondes (0-5, défaut 0,4).",
        },
        snap_to_silence: {
          type: "boolean",
          description:
            "Aimante les bords au silence le plus proche (défaut true).",
        },
        merge_gap: {
          type: "number",
          description:
            "Écart max (s) entre versets d'un même passage (défaut 1).",
        },
        pad_ranges: {
          type: "boolean",
          description:
            "Applique lead_in / tail_out (et l'aimantation) à tes propres ranges.",
        },
        fill: {
          type: "boolean",
          description: "Le texte occupe toute la zone libre.",
        },
        text_position: {
          description: "0 (haut) à 100 (bas), ou top | middle | bottom.",
        },
        show_wave: { type: "boolean", description: "Onde audio en bas." },
        accent: {
          type: "object",
          description:
            "Couleur d'accent { h, s, l, a } ; absente = automatique.",
        },
        file_name: {
          type: "string",
          description: "Nom du fichier téléchargé.",
        },
        background: {
          type: "string",
          description:
            "Identifiant d'un fond proposé, « source » (vidéo d'origine) ou « color » ; voir get_export_options.",
        },
        color: {
          type: "string",
          description: "Couleur unie #rrggbb (avec background « color »).",
        },
      },
      required: ["id"],
    },
    run: async (args, ctx) => {
      const id = asId(args);
      const options: Json = {};
      for (const key of [
        "orientation",
        "arabic_size",
        "translation_size",
        "show_translation",
        "fps",
        "resolution",
        "ranges",
        "per_verse",
        "suggest",
        "lead_in",
        "tail_out",
        "snap_to_silence",
        "merge_gap",
        "pad_ranges",
        "fill",
        "text_position",
        "show_wave",
        "accent",
        "file_name",
        "background",
        "color",
      ])
        if (args[key] !== undefined) options[key] = args[key];
      const body = unwrap(
        await ctx.call("POST", `/api/sessions/${id}/export/video/jobs`, {
          json: { options },
        }),
        "Export vidéo impossible",
      );
      return { ...body, status_tool: "get_video_export" };
    },
  },
  {
    name: "get_video_export",
    description:
      "État d'un export vidéo demandé par export_video : `progress` dit où en est le rendu (« Vidéo 2/5 : rendu 64 % »), `files_done` / `files_total` comptent les vidéos produites. Quand l’état est « done », `download_paths` liste les MP4 (un par plage ; `download_path` = le premier), à télécharger en GET avec le même jeton (conservés une heure).",
    inputSchema: {
      type: "object",
      properties: {
        id: idSchema,
        job: {
          type: "string",
          description: "Identifiant du job renvoyé par export_video.",
        },
      },
      required: ["id", "job"],
    },
    run: async (args, ctx) => {
      const id = asId(args);
      const job = args.job;
      if (typeof job !== "string" || !/^[0-9a-f-]{36}$/i.test(job))
        throw new ToolError("job : l'identifiant du job est requis.");
      const body = unwrap(
        await ctx.call("GET", `/api/sessions/${id}/export/video/jobs/${job}`),
        "Lecture impossible",
      );
      const record = body.job as Json | undefined;
      const base = `/api/v1/recordings/${id}/export/video/jobs/${job}`;
      const downloads = Array.isArray(record?.downloads)
        ? (record.downloads as { index: number; name: string; url: string }[])
        : [];
      return {
        ...body,
        ...(record?.state === "done"
          ? {
              download_path: `${base}/file`,
              download_paths: downloads.map((d) => ({
                index: d.index,
                name: d.name,
                path: `${base}/${d.url}`,
              })),
            }
          : {}),
      };
    },
  },
  {
    name: "update_recording",
    write: true,
    description:
      "Renomme un essai (`name`, null = nom par défaut), change sa portée (`visibility` : private = vous seul, global = tous les comptes) ou l'archive (`archived`). Propriétaire ou administrateur.",
    inputSchema: {
      type: "object",
      properties: {
        id: idSchema,
        name: { type: ["string", "null"] },
        visibility: { type: "string", enum: ["private", "global"] },
        archived: { type: "boolean" },
      },
      required: ["id"],
    },
    run: async (args, ctx) => {
      const id = asId(args);
      const patch: Json = {};
      for (const key of ["name", "visibility", "archived"])
        if (args[key] !== undefined) patch[key] = args[key];
      if (Object.keys(patch).length === 0)
        throw new ToolError("Rien à modifier : name, visibility ou archived.");
      return unwrap(
        await ctx.call("PATCH", `/api/sessions/${id}`, { json: patch }),
        "Modification impossible",
      );
    },
  },
  {
    name: "delete_recording",
    write: true,
    description:
      "Supprime DÉFINITIVEMENT un essai (audio, résultat, revue). Irréversible : exige `confirm: true`.",
    inputSchema: {
      type: "object",
      properties: {
        id: idSchema,
        confirm: {
          type: "boolean",
          description: "Doit valoir true : la suppression est définitive.",
        },
      },
      required: ["id", "confirm"],
    },
    run: async (args, ctx) => {
      const id = asId(args);
      if (args.confirm !== true)
        throw new ToolError(
          "Suppression non confirmée : passe confirm à true (irréversible).",
        );
      return unwrap(
        await ctx.call("DELETE", `/api/sessions/${id}`),
        "Suppression impossible",
      );
    },
  },
  {
    name: "run_analysis",
    write: true,
    description:
      "Lance (ou relance) l'analyse d'un essai : il passe en file puis « running ». Suivre avec get_recording jusqu'à « done ».",
    inputSchema: {
      type: "object",
      properties: { id: idSchema },
      required: ["id"],
    },
    run: async (args, ctx) =>
      unwrap(
        await ctx.call("POST", `/api/sessions/${asId(args)}/run`, { json: {} }),
        "Lancement impossible",
      ),
  },
  {
    name: "cancel_analysis",
    write: true,
    description:
      "Annule l'analyse d'un essai : retirée de la file si elle attend, arrêtée si elle tourne.",
    inputSchema: {
      type: "object",
      properties: { id: idSchema },
      required: ["id"],
    },
    run: async (args, ctx) =>
      unwrap(
        await ctx.call("DELETE", `/api/sessions/${asId(args)}/run`),
        "Annulation impossible",
      ),
  },
  {
    name: "set_favorite",
    write: true,
    description:
      "Ajoute ou retire un essai des favoris du compte (les favoris sont personnels).",
    inputSchema: {
      type: "object",
      properties: { id: idSchema, favorite: { type: "boolean" } },
      required: ["id", "favorite"],
    },
    run: async (args, ctx) => {
      const id = asId(args);
      if (typeof args.favorite !== "boolean")
        throw new ToolError("favorite : true ou false est requis.");
      return unwrap(
        await ctx.call(
          args.favorite ? "PUT" : "DELETE",
          `/api/sessions/${id}/favorite`,
        ),
        "Favori impossible",
      );
    },
  },
  {
    name: "get_review",
    description:
      "Revue d'un essai (corrections et état de relecture saisis dans l'atelier).",
    inputSchema: {
      type: "object",
      properties: { id: idSchema },
      required: ["id"],
    },
    run: async (args, ctx) =>
      unwrap(
        await ctx.call("GET", `/api/sessions/${asId(args)}/review`),
        "Lecture impossible",
      ),
  },
  {
    name: "save_review",
    write: true,
    description:
      "Enregistre la revue d'un essai. `review` est l'objet renvoyé par get_review (modifié) : le serveur le valide et refuse toute forme inattendue.",
    inputSchema: {
      type: "object",
      properties: { id: idSchema, review: { type: "object" } },
      required: ["id", "review"],
    },
    run: async (args, ctx) => {
      if (!args.review || typeof args.review !== "object")
        throw new ToolError("review : un objet est requis.");
      return unwrap(
        await ctx.call("PUT", `/api/sessions/${asId(args)}/review`, {
          json: args.review,
        }),
        "Enregistrement impossible",
      );
    },
  },
  {
    name: "get_decisions",
    description:
      "Décisions de relecture d'un essai (versets acceptés, rejetés ou corrigés par le relecteur).",
    inputSchema: {
      type: "object",
      properties: { id: idSchema },
      required: ["id"],
    },
    run: async (args, ctx) =>
      unwrap(
        await ctx.call("GET", `/api/sessions/${asId(args)}/decisions`),
        "Lecture impossible",
      ),
  },
  {
    name: "save_decisions",
    write: true,
    description:
      "Enregistre les décisions de relecture d'un essai. `decisions` est l'objet renvoyé par get_decisions (modifié) ; le serveur le valide.",
    inputSchema: {
      type: "object",
      properties: { id: idSchema, decisions: { type: "object" } },
      required: ["id", "decisions"],
    },
    run: async (args, ctx) => {
      if (!args.decisions || typeof args.decisions !== "object")
        throw new ToolError("decisions : un objet est requis.");
      return unwrap(
        await ctx.call("PUT", `/api/sessions/${asId(args)}/decisions`, {
          json: args.decisions,
        }),
        "Enregistrement impossible",
      );
    },
  },
  {
    name: "get_stats",
    description:
      "Statistiques du compte : essais, durée écoutée, versets reconnus, performances.",
    inputSchema: { type: "object", properties: {} },
    run: async (_args, ctx) =>
      unwrap(await ctx.call("GET", "/api/me/stats"), "Lecture impossible"),
  },
  {
    name: "get_preferences",
    description:
      "Préférences d'affichage du compte (thème, police du Coran, visibilité par défaut des essais…).",
    inputSchema: { type: "object", properties: {} },
    run: async (_args, ctx) =>
      unwrap(
        await ctx.call("GET", "/api/me/preferences"),
        "Lecture impossible",
      ),
  },
  {
    name: "set_preferences",
    write: true,
    description:
      "Modifie des préférences du compte : `preferences` est un objet partiel (clés de get_preferences) ; le serveur refuse les clés ou valeurs inconnues.",
    inputSchema: {
      type: "object",
      properties: { preferences: { type: "object" } },
      required: ["preferences"],
    },
    run: async (args, ctx) => {
      if (!args.preferences || typeof args.preferences !== "object")
        throw new ToolError("preferences : un objet est requis.");
      return unwrap(
        await ctx.call("PATCH", "/api/me/preferences", {
          json: args.preferences,
        }),
        "Modification impossible",
      );
    },
  },
  {
    name: "get_verse",
    description:
      "Texte exact d'un verset du corpus (Mushaf Hafs, Tanzil) et sa traduction officielle, par référence `sourate:verset`. Utile pour vérifier ou citer un verset.",
    inputSchema: {
      type: "object",
      properties: { ref: { type: "string", description: "Ex. « 2:255 »." } },
      required: ["ref"],
    },
    run: async (args, ctx) => {
      const ref = args.ref;
      if (typeof ref !== "string" || !/^\d{1,3}:\d{1,3}$/.test(ref))
        throw new ToolError(
          "ref : une référence « sourate:verset » est requise.",
        );
      return unwrap(
        await ctx.call(
          "GET",
          `/api/corpus/verse?ref=${encodeURIComponent(ref)}`,
        ),
        "Lecture impossible",
      );
    },
  },
  {
    name: "export_subtitles",
    description:
      "Génère les sous-titres d'un essai terminé : srt, vtt, ass (karaoké mot à mot quand les temps sont mesurés) ou json. Renvoie le contenu du fichier. L'arabe et la traduction sont ceux du résultat, sans modification.",
    inputSchema: {
      type: "object",
      properties: {
        id: idSchema,
        format: {
          type: "string",
          enum: ["srt", "vtt", "ass", "json"],
          default: "srt",
        },
        options: {
          type: "object",
          description:
            "Options d'export avancées (voir la documentation de l'API).",
        },
      },
      required: ["id"],
    },
    run: async (args, ctx) => {
      const id = asId(args);
      const options: Json = {
        ...(typeof args.options === "object" && args.options
          ? (args.options as Json)
          : {}),
      };
      if (typeof args.format === "string") options.format = args.format;
      return unwrap(
        await ctx.call("POST", `/api/sessions/${id}/export/subtitles`, {
          json: { options },
        }),
        "Export impossible",
      );
    },
  },
];

export const toolList = () =>
  TOOLS.map(({ name, description, inputSchema }) => ({
    name,
    description,
    inputSchema,
  }));

type Rpc = { jsonrpc?: string; id?: unknown; method?: string; params?: Json };

const ok = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });
const fail = (id: unknown, code: number, message: string) => ({
  jsonrpc: "2.0",
  id: id ?? null,
  error: { code, message },
});

/** Traite un message JSON-RPC ; `null` pour une notification (aucune réponse). */
export async function handleRpc(
  message: Rpc,
  ctx: McpContext,
): Promise<Json | null> {
  if (
    !message ||
    message.jsonrpc !== "2.0" ||
    typeof message.method !== "string"
  )
    return fail(message?.id, -32600, "Requête JSON-RPC invalide.");
  const { id, method } = message;
  const isNotification = id === undefined || id === null;
  switch (method) {
    case "initialize": {
      const asked = message.params?.protocolVersion;
      const version = (MCP_PROTOCOLS as readonly string[]).includes(
        String(asked),
      )
        ? String(asked)
        : MCP_PROTOCOLS[0];
      return ok(id, {
        protocolVersion: version,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          "Quran TR localise chaque verset récité dans un audio et rend le texte exact du Mushaf et la traduction officielle. Importer avec create_recording, attendre l'état « done » avec get_recording, puis lire les versets.",
      });
    }
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, { tools: toolList() });
    case "tools/call": {
      const name = message.params?.name;
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) return fail(id, -32602, `Outil inconnu : ${String(name)}`);
      const args =
        typeof message.params?.arguments === "object" &&
        message.params.arguments
          ? (message.params.arguments as Json)
          : {};
      try {
        const out = await tool.run(args, ctx);
        return ok(id, {
          content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
        });
      } catch (error) {
        const text =
          error instanceof ToolError
            ? error.message
            : "Erreur interne de l'outil.";
        return ok(id, { isError: true, content: [{ type: "text", text }] });
      }
    }
    default:
      if (isNotification) return null; // notifications/initialized, etc.
      return fail(id, -32601, `Méthode inconnue : ${method}`);
  }
}
