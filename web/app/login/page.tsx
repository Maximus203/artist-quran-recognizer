import type { Metadata } from "next";
import { redirectIfSignedIn, safeNext } from "@/lib/page-auth";
import { AuthShell } from "../atelier/auth-shell";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Se connecter · Quran TR" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const next = safeNext((await searchParams).next);
  await redirectIfSignedIn(next);
  return (
    <AuthShell>
      <LoginForm next={next} />
    </AuthShell>
  );
}
