import { canRegister, passesGate } from "@/lib/invitations";
import {
  ACCESS_COOKIE,
  accessTtlSeconds,
  issueAccessCookie,
  verifyToken,
} from "@/lib/local-request";
import { ready } from "@/lib/server-init";
export const runtime = "nodejs";

const redirect = (location: string, headers: Record<string, string> = {}) =>
  new Response(null, {
    status: 303,
    headers: { Location: location, "Cache-Control": "no-store", ...headers },
  });

/**
 * Échange le jeton d'accès du serveur, OU un lien d'invitation valide (`invitation`), contre un cookie signé à
 * durée limitée (mode test distant). Les deux donnent le même cookie. Une invitation expirée, révoquée ou inventée
 * ne donne rien ; une invitation déjà utilisée pour s'inscrire ouvre encore l'accès (le testeur revient se
 * connecter avec le même lien) et mène à la connexion plutôt qu'à l'inscription.
 */
export async function POST(request: Request) {
  const token = process.env.AQR_ACCESS_TOKEN ?? "";
  if (!token) return redirect("/");
  const form = await request.formData().catch(() => null);
  const given = form?.get("token");
  const invitation = form?.get("invitation");
  let next = "/";
  let allowed = typeof given === "string" && verifyToken(given, token);
  if (!allowed && typeof invitation === "string" && invitation !== "") {
    const db = await ready();
    if (passesGate(db, invitation)) {
      allowed = true;
      next = canRegister(db, invitation)
        ? `/register?invitation=${encodeURIComponent(invitation)}`
        : "/login";
    }
  }
  if (!allowed) return redirect("/access?error=1");
  const ttl = accessTtlSeconds(process.env.AQR_ACCESS_TTL_S);
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return redirect(next, {
    "Set-Cookie": `${ACCESS_COOKIE}=${issueAccessCookie(token, ttl)}; Path=/; Max-Age=${ttl}; HttpOnly; SameSite=Strict${secure}`,
  });
}
