import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { hasAccessCredential } from "@/lib/local-request";
import ReviewApp from "./review-app";
export const dynamic = "force-dynamic";
export default async function Page() {
  // Mode test distant : sans jeton valide, la page mène au formulaire d'accès.
  if (
    !hasAccessCredential(
      new Request("http://localhost/", { headers: await headers() }),
    )
  )
    redirect("/access");
  return <ReviewApp />;
}
