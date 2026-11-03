import type { Metadata } from "next";
import { requireTesterPage } from "@/lib/page-auth";
import { LiveView } from "../../atelier/live/live-view";
import { PageFrame } from "../../atelier/page-frame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "En direct · Quran TR" };

export default async function LivePage() {
  await requireTesterPage("/direct");
  return (
    <PageFrame active="live">
      <LiveView />
    </PageFrame>
  );
}
