import type { Metadata } from "next";
import { requirePageUser } from "@/lib/page-auth";
import { AccountFrame } from "../../../atelier/account-frame";
import { MyStats } from "../../../atelier/my-stats";
import { PageFrame } from "../../../atelier/page-frame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Mes statistiques · Quran TR",
};

export default async function AccountStatsPage() {
  await requirePageUser("/compte/statistiques");
  return (
    <PageFrame active="account">
      <AccountFrame tab="statistiques">
        <h2 className="sr">Statistiques</h2>
        <MyStats />
      </AccountFrame>
    </PageFrame>
  );
}
