import type { Metadata } from "next";
import { signupStatus } from "@/lib/auth";
import { issueFormToken } from "@/lib/honeypot";
import { looksLikeInvitation } from "@/lib/invitations";
import { redirectIfSignedIn } from "@/lib/page-auth";
import { authDeps } from "@/lib/route-guard";
import { AuthShell } from "../atelier/auth-shell";
import { RegisterForm } from "./register-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Créer un compte · Quran TR",
};

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ invitation?: string }>;
}) {
  await redirectIfSignedIn("/");
  // Mode d'inscription lu côté serveur : la page n'affiche que ce que le serveur acceptera.
  const status = signupStatus(await authDeps());
  // Lien d'invitation : transmis tel quel au formulaire, que le serveur revérifie à l'inscription.
  const given = (await searchParams).invitation;
  const invitation = looksLikeInvitation(given) ? given : null;
  return (
    <AuthShell>
      <RegisterForm
        mode={status.signup}
        firstAccount={status.setup_required}
        formToken={issueFormToken()}
        invitation={invitation}
      />
    </AuthShell>
  );
}
