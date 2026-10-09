import {
  ACCESS_COOKIE,
  accessTtlSeconds,
  issueAccessCookie,
  verifyToken,
} from "@/lib/local-request";
export const runtime = "nodejs";
const redirect = (location: string, headers: Record<string, string> = {}) =>
  new Response(null, {
    status: 303,
    headers: { Location: location, "Cache-Control": "no-store", ...headers },
  });
/** Échange le jeton d'accès contre un cookie signé à durée limitée (mode test distant). */
export async function POST(request: Request) {
  const token = process.env.AQR_ACCESS_TOKEN ?? "";
  if (!token) return redirect("/");
  const form = await request.formData().catch(() => null);
  const given = form?.get("token");
  if (typeof given !== "string" || !verifyToken(given, token))
    return redirect("/access?error=1");
  const ttl = accessTtlSeconds(process.env.AQR_ACCESS_TTL_S);
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return redirect("/", {
    "Set-Cookie": `${ACCESS_COOKIE}=${issueAccessCookie(token, ttl)}; Path=/; Max-Age=${ttl}; HttpOnly; SameSite=Strict${secure}`,
  });
}
