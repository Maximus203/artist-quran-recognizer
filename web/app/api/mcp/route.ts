import { handleRpc, type ApiCall } from "@/lib/mcp";
import { apiError, safe } from "@/lib/http";
import { internalOrigin } from "@/lib/local-request";
import { requireUser } from "@/lib/route-guard";
export const runtime = "nodejs";

/**
 * Point d'entrée MCP (Streamable HTTP, sans état) : `POST /mcp` avec `Authorization: Bearer qtr_…`.
 * Un jeton d'API est obligatoire (pas de cookie) : l'agent est identifié, ses outils agissent
 * avec les droits de son compte et ceux de son jeton. Les outils passent par l'API de l'atelier
 * (même origine), donc par les mêmes contrôles d'accès, quotas et erreurs.
 */
async function handlePOST(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok)
    return new Response(auth.response.body, {
      status: auth.response.status,
      headers: {
        "content-type": "application/json",
        "www-authenticate": 'Bearer realm="quran-tr"',
      },
    });
  if (!auth.api)
    return apiError(
      401,
      "Un jeton d'API (Authorization: Bearer qtr_…) est requis.",
      {
        code: "token_required",
      },
    );

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "JSON invalide." },
      },
      { status: 400 },
    );
  }

  const origin = internalOrigin(request.url);
  const bearer = request.headers.get("authorization") as string;
  const call: ApiCall = async (method, path, options) => {
    const headers: Record<string, string> = { authorization: bearer };
    let body: BodyInit | undefined;
    if (options?.json !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(options.json);
    } else if (options?.bytes) {
      body = new Uint8Array(options.bytes);
    }
    Object.assign(headers, options?.headers);
    const response = await fetch(origin + path, { method, headers, body });
    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { error: text.slice(0, 200) };
    }
    return { status: response.status, body: parsed };
  };

  const ctx = { scope: auth.api.scope, call };
  const noContent = new Response(null, { status: 202 });
  if (Array.isArray(payload)) {
    const replies = (
      await Promise.all(
        payload.map((message) => handleRpc(message as never, ctx)),
      )
    ).filter((reply) => reply !== null);
    return replies.length ? Response.json(replies) : noContent;
  }
  const reply = await handleRpc(payload as never, ctx);
  return reply ? Response.json(reply) : noContent;
}

/** Pas de flux serveur→client : `GET` répond 405 (permis par la spécification). */
async function handleGET() {
  return new Response(null, { status: 405, headers: { allow: "POST" } });
}

export const POST = safe(handlePOST);
export const GET = safe(handleGET);
