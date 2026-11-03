import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/page-auth";
import { PageFrame } from "../../../atelier/page-frame";
import { PlaylistPlayer } from "../../../atelier/playlist-player";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Playlist · Quran TR" };

/** Le lecteur d'une playlist. Une playlist absente ou d'un autre compte se montre comme absente. */
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: raw } = await params;
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) notFound();
  await requirePageUser(`/playlists/${id}`);
  return (
    <PageFrame active="playlists">
      <PlaylistPlayer playlistId={id} />
    </PageFrame>
  );
}
