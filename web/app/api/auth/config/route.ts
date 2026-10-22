import { PASSWORD_MAX, PASSWORD_MIN, signupStatus } from "@/lib/auth";
import { json } from "@/lib/http";
import { authDeps, authenticate } from "@/lib/route-guard";
import { TESTER_RULE_MESSAGE } from "@/lib/tester";
export const runtime = "nodejs";

/**
 * Ce qu'il faut savoir avant d'afficher /login et /register : inscription ouverte, fermée ou sur
 * code, et si l'atelier n'a encore aucun compte (le premier inscrit en sera l'administrateur).
 * Public, mais limité à l'accès local comme tout le reste.
 */
export async function GET(request: Request) {
  const guard = await authenticate(request, { anonymous: true });
  if (!guard.ok) return guard.response;
  const deps = await authDeps();
  return json({
    ...signupStatus(deps),
    authenticated: guard.user !== null,
    rules: {
      username: { min: 2, max: 24, message: TESTER_RULE_MESSAGE },
      password: { min: PASSWORD_MIN, max: PASSWORD_MAX },
    },
  });
}
