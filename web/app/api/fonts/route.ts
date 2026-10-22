import { NextResponse } from "next/server";
import { fontAvailability } from "@/lib/font-files";
import { isLocalRequest } from "@/lib/local-request";
export const runtime = "nodejs";

/** Quelles polices sous licence sont installées sur ce poste (grise l'option sinon). */
export async function GET(request: Request) {
  if (!isLocalRequest(request))
    return NextResponse.json({ error: "Accès local requis" }, { status: 403 });
  return NextResponse.json(
    { fonts: await fontAvailability() },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
