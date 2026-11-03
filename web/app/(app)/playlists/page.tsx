import type { Metadata } from "next";
import { requireTesterPage } from "@/lib/page-auth";
import { PageFrame } from "../../atelier/page-frame";
import { PlaylistsPane } from "../../atelier/playlists-pane";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Playlists · Quran TR" };

export default async function Page() {
  await requireTesterPage("/playlists");
  return (
    <PageFrame active="playlists">
      <PlaylistsPane />
    </PageFrame>
  );
}
