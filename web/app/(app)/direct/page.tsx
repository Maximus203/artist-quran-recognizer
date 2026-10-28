import type { Metadata } from "next";
import { requirePageUser } from "@/lib/page-auth";
import { LiveView } from "../../atelier/live/live-view";
import { PageFrame } from "../../atelier/page-frame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "En direct · Atelier de revue" };

export default async function LivePage() {
  await requirePageUser("/direct");
  return (
    <PageFrame active="live">
      <LiveView />
    </PageFrame>
  );
}
