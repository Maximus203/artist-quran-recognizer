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
  method: "GET" | "POST" | "DELETE",
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
    name: "export_video",
    description:
      "Demande la vidéo MP4 d'un essai terminé (verset surligné mot à mot, traduction, onde audio) : mêmes réglages que le formulaire de l'atelier. Renvoie un job ; suivre avec get_video_export jusqu'à « done », puis télécharger `download_path` avec le même jeton. Le rendu dure à peu près la moitié de la durée de l'audio.",
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
      "État d'un export vidéo demandé par export_video. Quand l'état est « done », `download_path` est l'adresse du MP4 (GET avec le même jeton ; conservé une heure).",
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
      const state = (body.job as Json | undefined)?.state;
      return {
        ...body,
        ...(state === "done"
          ? {
              download_path: `/api/v1/recordings/${id}/export/video/jobs/${job}/file`,
            }
          : {}),
      };
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
