import type { Metadata } from "next";
import { requirePageAdmin } from "@/lib/page-auth";
import { AdminFrame } from "../../../atelier/admin-frame";
import { UsersPane } from "../../../atelier/admin-users";
import { PageFrame } from "../../../atelier/page-frame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Comptes · Administration · Quran TR",
};

export default async function AdminUsersPage() {
  await requirePageAdmin("/gestion/comptes");
  return (
    <PageFrame active="account">
      <AdminFrame tab="comptes">
        <UsersPane />
      </AdminFrame>
    </PageFrame>
  );
}
