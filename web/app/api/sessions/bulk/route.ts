import { z } from "zod";
import { decide, type Ability } from "@/lib/access";
import { transaction } from "@/lib/db";
import { apiError, json, readJson, safe } from "@/lib/http";
import { metaFor, requireUser } from "@/lib/route-guard";
import { setFavorite, updateMeta } from "@/lib/session-index";
export const runtime = "nodejs";

const MAX_IDS = 100;
const body = z
  .object({
    ids: z.array(z.string().uuid()).min(1).max(MAX_IDS),
    action: z.enum([
      "archive",
      "unarchive",
      "favorite",
      "unfavorite",
      "set_visibility",
    ]),
    visibility: z.enum(["global", "private"]).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.action !== "set_visibility" || value.visibility !== undefined,
    {
      message: "visibility est requis pour set_visibility.",
    },
  );

type Status = "ok" | "not_found" | "forbidden";

/**
 * Action groupée sur au plus 100 sessions : `archive`, `unarchive`, `favorite`, `unfavorite`,
 * `set_visibility` (avec `visibility`). Chaque identifiant est contrôlé séparément :
 * `{ results: [{ id, status: "ok" | "not_found" | "forbidden" }], applied }`. Une session invisible
 * est « not_found » (jamais révélée) ; « forbidden » = visible mais ni propriétaire ni administrateur.
 */
async function handlePOST(request: Request) {
  const auth = await requireUser(request, { mutation: true });
  if (!auth.ok) return auth.response;
  const parsed = body.safeParse(await readJson(request));
  if (!parsed.success)
    return apiError(
      400,
      parsed.error.issues.map((issue) => issue.message).join(" · "),
      { code: "invalid" },
    );
  const { ids, action, visibility } = parsed.data;
  const ability: Ability =
    action === "favorite" || action === "unfavorite" ? "favorite" : "edit";
  const now = new Date().toISOString();
  const metas = new Map<string, Awaited<ReturnType<typeof metaFor>>>();
  for (const id of new Set(ids)) metas.set(id, await metaFor(auth.db, id));
  const results: Array<{ id: string; status: Status }> = [];
  transaction(auth.db, () => {
    for (const [id, meta] of metas) {
      const verdict = decide(auth.user, ability, meta);
      if (verdict !== "ok") {
        results.push({
          id,
          status: verdict === "absent" ? "not_found" : "forbidden",
        });
        continue;
      }
      if (action === "favorite" || action === "unfavorite")
        setFavorite(auth.db, auth.user.id, id, action === "favorite", now);
      else if (action === "set_visibility")
        updateMeta(auth.db, id, { visibility }, now);
      else
        updateMeta(
          auth.db,
          id,
          { archivedAt: action === "archive" ? now : null },
          now,
        );
      results.push({ id, status: "ok" });
    }
  });
  return json({
    results,
    applied: results.filter((r) => r.status === "ok").length,
  });
}

export const POST = safe(handlePOST);
