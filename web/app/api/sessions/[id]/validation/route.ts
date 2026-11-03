import { safe } from "@/lib/http";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  alignValidation,
  proposeFromDecisions,
  proposeValidation,
  readValidation,
  saveValidation,
  writeManifest,
} from "@/lib/align";
import { sessionAccess } from "@/lib/route-guard";
import { addPassage, editPassage } from "@/lib/validation";
export const runtime = "nodejs";

const time = z.number().finite().nonnegative();
const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("propose") }),
  z.object({ action: z.literal("from_decisions") }),
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
  // `reviewed_by` n'est plus lu : le relecteur est le compte administrateur connecté.
  z.object({
    action: z.literal("manifest"),
    reviewed_by: z.string().max(64).optional(),
  }),
]);

async function handleGET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await sessionAccess(request, params, "truth");
  if (!access.ok) return access.response;
  try {
    return NextResponse.json({
      validation: await readValidation(access.id),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Session introuvable" },
      { status: 404 },
    );
  }
}

/** Propose, modifie, aligne (modèle réel, peut durer) ou écrit dans le manifeste. */
async function handlePOST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await sessionAccess(request, params, "truth", {
    mutation: true,
  });
  if (!access.ok) return access.response;
  try {
    const id = access.id;
    const input = action.parse(await request.json());
    if (input.action === "propose")
      return NextResponse.json({ validation: await proposeValidation(id) });
    if (input.action === "from_decisions")
      return NextResponse.json({ validation: await proposeFromDecisions(id) });
    if (input.action === "align")
      return NextResponse.json({
        validation: await alignValidation(id, input.ids),
      });
    if (input.action === "manifest") {
      // Relecteur = le compte administrateur connecté, jamais un nom envoyé par le client.
      const { validation, report } = await writeManifest(
        id,
        access.user.username,
      );
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

export const GET = safe(handleGET);
export const POST = safe(handlePOST);
