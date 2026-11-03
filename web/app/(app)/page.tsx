import { redirect } from "next/navigation";
import { requirePageUser } from "@/lib/page-auth";
import { isSessionId } from "@/lib/session-id";
import { landingFor, sessionHref } from "@/lib/role-view";
import ReviewApp from "../review-app";

export const dynamic = "force-dynamic";

/**
 * La revue. Le récitateur n'y entre que pour enregistrer (« Nouvel essai ») : une session qu'on lui
 * ouvre part directement vers son export vidéo, et tout le reste le renvoie à ses sessions.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{
    session?: string | string[];
    vue?: string | string[];
  }>;
}) {
  // Mode test distant : sans jeton valide, la page mène au formulaire d'accès (couche réseau) ;
  // puis, sans compte connecté, à /login (couche identité).
  const user = await requirePageUser("/");
  if (user.role === "recitant") {
    const { session, vue } = await searchParams;
    if (typeof session === "string" && isSessionId(session))
      redirect(sessionHref(user.role, session));
    if (vue !== "new") redirect(landingFor(user.role));
  }
  return <ReviewApp />;
}
