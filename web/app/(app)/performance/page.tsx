import type { Metadata } from "next";
import { requirePageUser } from "@/lib/page-auth";
import { PageFrame } from "../../atelier/page-frame";
import { PerfView } from "../../atelier/perf-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Performance · Quran TR" };

export default async function PerformancePage({
  searchParams,
}: {
  searchParams: Promise<{ vue?: string }>;
}) {
  const { vue } = await searchParams;
  await requirePageUser(
    vue === "moi" ? "/performance?vue=moi" : "/performance",
  );
  return (
    <PageFrame active="perf">
      <PerfView initialMine={vue === "moi"} />
    </PageFrame>
  );
}
