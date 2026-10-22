export const dynamic = "force-dynamic";
export default async function AccessPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const failed = Boolean((await searchParams).error);
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
      <p className="hint">Ce serveur est en mode test distant protégé.</p>
      <form
        method="post"
        action="/api/access"
        style={{ display: "grid", gap: "var(--sp-3)" }}
      >
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
        {failed ? (
          <p className="notice notice--error" role="alert">
            Jeton refusé.
          </p>
        ) : null}
        <button type="submit" className="btn btn--primary">
          Entrer
        </button>
      </form>
    </main>
  );
}
