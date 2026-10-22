import { requirePageUser } from "@/lib/page-auth";
import ReviewApp from "../review-app";

export const dynamic = "force-dynamic";

export default async function Page() {
  // Mode test distant : sans jeton valide, la page mène au formulaire d'accès (couche réseau) ;
  // puis, sans compte connecté, à /login (couche identité).
  await requirePageUser("/");
  return <ReviewApp />;
}
