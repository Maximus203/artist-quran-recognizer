import type { Metadata } from "next";
import { requirePageUser } from "@/lib/page-auth";
import { AccountFrame } from "../../../atelier/account-frame";
import { SecurityPane } from "../../../atelier/account-security";
import { PageFrame } from "../../../atelier/page-frame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sécurité · Atelier de revue" };

export default async function AccountSecurityPage() {
  await requirePageUser("/compte/securite");
  return (
    <PageFrame active="account">
      <AccountFrame tab="securite">
        <SecurityPane />
      </AccountFrame>
    </PageFrame>
  );
}
