import { looksLikeInvitation } from "@/lib/invitations";

export const dynamic = "force-dynamic";
export default async function AccessPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; invitation?: string }>;
}) {
  const params = await searchParams;
  const failed = Boolean(params.error);
  // Lien d'invitation : le visiteur n'a rien à saisir ; il confirme d'un clic (jamais d'envoi automatique).
  const invitation = looksLikeInvitation(params.invitation)
    ? params.invitation
    : null;
  return (
    <main
      className="card card-pad"
      style={{
        maxWidth: 420,
        margin: "12vh auto",
        display: "grid",
        gap: "var(--sp-4)",
      }}
    >
      <h1 style={{ font: "400 var(--fs-2xl)/1.1 var(--font-display)" }}>
        Accès à l’atelier
      </h1>
      <p className="hint">
        {invitation
          ? "Tu as reçu une invitation pour tester l’atelier."
          : "Ce serveur est en mode test distant protégé."}
      </p>
      <form
        method="post"
        action="/api/access"
        style={{ display: "grid", gap: "var(--sp-3)" }}
      >
        {invitation ? (
          <input type="hidden" name="invitation" value={invitation} />
        ) : (
          <label className="field">
            Jeton d’accès
            <input
              className="input"
              name="token"
              type="password"
              autoComplete="off"
              required
            />
          </label>
        )}
        {failed ? (
          <p className="notice notice--error" role="alert">
            {invitation ? "Invitation refusée ou expirée." : "Jeton refusé."}
          </p>
        ) : null}
        <button type="submit" className="btn btn--primary">
          {invitation ? "Accepter l’invitation" : "Entrer"}
        </button>
      </form>
    </main>
  );
}
