import type { Metadata } from "next";
import { requirePageUser } from "@/lib/page-auth";
import { PageFrame } from "../../atelier/page-frame";
import { SessionsPage } from "../../atelier/sessions-page";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sessions · Atelier de revue" };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (typeof value === "string") search.set(key, value);
  const qs = search.toString();
  await requirePageUser(qs ? `/sessions?${qs}` : "/sessions");
  return (
    <PageFrame active="sessions">
      <SessionsPage search={qs} />
    </PageFrame>
  );
}
