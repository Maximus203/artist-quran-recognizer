import type { Metadata } from "next";
import { requirePageAdmin } from "@/lib/page-auth";
import { AdminFrame } from "../../../atelier/admin-frame";
import { AgentsPane } from "../../../atelier/admin-agents";
import { PageFrame } from "../../../atelier/page-frame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Moteur · Administration · Quran TR",
};

export default async function AdminEnginePage() {
  await requirePageAdmin("/gestion/moteur");
  return (
    <PageFrame active="account">
      <AdminFrame tab="moteur">
        <AgentsPane />
      </AdminFrame>
    </PageFrame>
  );
}
