import type { Metadata } from "next";
import { requirePageUser } from "@/lib/page-auth";
import { AccountFrame } from "../../../atelier/account-frame";
import { ApiPane } from "../../../atelier/account-api";
import { PageFrame } from "../../../atelier/page-frame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "API & MCP · Quran TR" };

export default async function AccountApiPage() {
  await requirePageUser("/compte/api");
  return (
    <PageFrame active="account">
      <AccountFrame tab="api">
        <ApiPane />
      </AccountFrame>
    </PageFrame>
  );
}
