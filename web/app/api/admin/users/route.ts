import { json } from "@/lib/http";
import { requireAdmin } from "@/lib/route-guard";
import { ownedTotals } from "@/lib/session-index";
import { listUsers } from "@/lib/users";
export const runtime = "nodejs";

/** Liste des comptes (administrateurs seulement) avec leur usage : sessions, octets, tests. */
export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const tests = new Map(
    (
      auth.db
        .prepare(
          "SELECT user_id, COUNT(*) AS n FROM analysis_log WHERE outcome = 'done' GROUP BY user_id",
        )
        .all() as Array<{ user_id: number | null; n: number }>
    ).map((row) => [row.user_id, row.n]),
  );
  return json({
    users: listUsers(auth.db).map((user) => {
      const owned = ownedTotals(auth.db, user.id);
      return {
        id: user.id,
        username: user.username,
        role: user.role,
        disabled: user.disabled_at !== null,
        created_at: user.created_at,
        last_login_at: user.last_login_at,
        sessions: owned.sessions,
        used_bytes: owned.bytes,
        tests: tests.get(user.id) ?? 0,
      };
    }),
  });
}
