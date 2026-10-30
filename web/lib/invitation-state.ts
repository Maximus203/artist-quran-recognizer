/** État d'une invitation : logique pure, sans dépendance serveur (utilisée aussi par l'interface). */
export type InvitationState = "active" | "used_up" | "expired" | "revoked";

export function invitationState(
  row: {
    expires_at: string;
    max_uses: number;
    uses: number;
    revoked_at: string | null;
  },
  now = new Date(),
): InvitationState {
  if (row.revoked_at) return "revoked";
  if (Date.parse(row.expires_at) <= now.getTime()) return "expired";
  return row.uses >= row.max_uses ? "used_up" : "active";
}
