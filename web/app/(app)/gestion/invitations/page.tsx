import type { Metadata } from "next";
import { requirePageAdmin } from "@/lib/page-auth";
import { AdminFrame } from "../../../atelier/admin-frame";
import { InvitationsPane } from "../../../atelier/admin-invitations";
import { PageFrame } from "../../../atelier/page-frame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Invitations · Administration · Quran TR",
};

export default async function AdminInvitationsPage() {
  await requirePageAdmin("/gestion/invitations");
  return (
    <PageFrame active="account">
      <AdminFrame tab="invitations">
        <InvitationsPane />
      </AdminFrame>
    </PageFrame>
  );
}
