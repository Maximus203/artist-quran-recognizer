import type { Metadata } from "next";
import { requirePageUser } from "@/lib/page-auth";
import { AccountFrame } from "../../atelier/account-frame";
import { PreferencesPane } from "../../atelier/account-prefs";
import { PageFrame } from "../../atelier/page-frame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Préférences · Atelier de revue" };

export default async function AccountPage() {
  await requirePageUser("/compte");
  return (
    <PageFrame active="account">
      <AccountFrame tab="preferences">
        <PreferencesPane />
      </AccountFrame>
    </PageFrame>
  );
}
