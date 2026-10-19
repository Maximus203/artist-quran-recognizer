import { NextResponse } from "next/server";
import { z } from "zod";
import {
  alignValidation,
  proposeValidation,
  readValidation,
  saveValidation,
  writeManifest,
} from "@/lib/align";
import { isLocalRequest } from "@/lib/local-request";
import { addPassage, editPassage } from "@/lib/validation";
export const runtime = "nodejs";

const time = z.number().finite().nonnegative();
const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("propose") }),
  z.object({
    action: z.literal("edit"),
    passage: z.string().uuid(),
    patch: z
      .object({
        verses: z.string().max(2000),
        t: z.tuple([time, time]),
        status: z.enum(["proposed", "validated", "excluded"]),
      })
      .partial(),
  }),
  z.object({
    action: z.literal("add"),
    t: z.tuple([time, time]),
    verses: z.string().max(2000),
  }),
  z.object({
    action: z.literal("align"),
    ids: z.array(z.string().uuid()).min(1),
  }),
  z.object({ action: z.literal("manifest"), reviewed_by: z.string().max(64) }),
]);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isLocalRequest(request))
    return NextResponse.json({ error: "Accès local requis" }, { status: 403 });
  try {
    return NextResponse.json({
      validation: await readValidation((await params).id),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Session introuvable" },
      { status: 404 },
    );
  }
}

/** Propose, modifie, aligne (modèle réel, peut durer) ou écrit dans le manifeste. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isLocalRequest(request, true))
    return NextResponse.json({ error: "Accès local requis" }, { status: 403 });
  try {
    const id = (await params).id;
    const input = action.parse(await request.json());
    if (input.action === "propose")
      return NextResponse.json({ validation: await proposeValidation(id) });
    if (input.action === "align")
      return NextResponse.json({
        validation: await alignValidation(id, input.ids),
      });
    if (input.action === "manifest") {
      const { validation, report } = await writeManifest(id, input.reviewed_by);
      return NextResponse.json({ validation, report });
    }
    const current = await readValidation(id);
    const next =
      input.action === "add"
        ? addPassage(current, input.t, input.verses)
        : editPassage(current, input.passage, input.patch);
    await saveValidation(next);
    return NextResponse.json({ validation: next });
  } catch (e) {
    const message =
      e instanceof z.ZodError
        ? e.issues.map((issue) => issue.message).join(" · ")
        : e instanceof Error
          ? e.message
          : "Action impossible";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
