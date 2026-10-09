export const dynamic = "force-dynamic";
export default async function AccessPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const failed = Boolean((await searchParams).error);
  return (
    <main style={{ maxWidth: 420, margin: "12vh auto", padding: "0 16px" }}>
      <h1>Accès à l’atelier</h1>
      <p>Ce serveur est en mode test distant protégé.</p>
      <form method="post" action="/api/access">
        <label>
          Jeton d’accès
          <input
            name="token"
            type="password"
            autoComplete="off"
            required
            style={{ display: "block", width: "100%", margin: "8px 0" }}
          />
        </label>
        {failed ? <p role="alert">Jeton refusé.</p> : null}
        <button type="submit">Entrer</button>
      </form>
    </main>
  );
}
