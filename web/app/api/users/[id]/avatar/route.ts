import { AVATAR } from "@/lib/avatar-config";
import { avatarHashOf, avatarServing, readAvatar } from "@/lib/avatar-store";
import { apiError, notFound, safe } from "@/lib/http";
import { requireUser } from "@/lib/route-guard";
export const runtime = "nodejs";

/**
 * Photo de profil d'un compte, lisible par tout compte connecté (les pseudos et photos sont
 * visibles des autres testeurs ; cela n'ouvre AUCUNE session : les audios privés restent à leur
 * propriétaire). Toujours un JPEG que nous avons fabriqué : `Content-Type` fixe, `nosniff`,
 * `sandbox` en cas d'ouverture directe. 404 sans photo (l'interface montre alors l'initiale).
 * Cache par empreinte : `?v=<avatar_version>` correspondant → un an, sinon revalidation (ETag/304).
 */
const SECURITY = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "Cross-Origin-Resource-Policy": "same-origin",
};

async function handleGET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;
  const { id: raw } = await params;
  if (!/^[1-9]\d{0,9}$/.test(raw)) return notFound("Photo introuvable");
  const userId = Number(raw);
  const url = new URL(request.url);
  const serving = avatarServing(
    avatarHashOf(auth.db, userId),
    url.searchParams.get("v"),
    request.headers.get("if-none-match"),
  );
  if (serving.status === 404) return notFound("Photo introuvable");
  const headers = {
    ...SECURITY,
    ETag: serving.etag,
    "Cache-Control": serving.cacheControl,
  };
  if (serving.status === 304)
    return new Response(null, { status: 304, headers });
  const bytes = await readAvatar(userId);
  if (!bytes) return apiError(404, "Photo introuvable", { code: "not_found" });
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      ...headers,
      "Content-Type": AVATAR.mime,
      "Content-Length": String(bytes.length),
      "Content-Disposition": `inline; filename="avatar.${AVATAR.extension}"`,
    },
  });
}

export const GET = safe(handleGET);
