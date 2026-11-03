import { serveFont } from "@/lib/font-files";
export const runtime = "nodejs";

/** Police sous licence servie depuis `AQR_FONTS_DIR` (boucle locale seulement, liste blanche). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  return serveFont(request, (await params).name);
}
