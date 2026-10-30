import { seenLabel } from "@/lib/agent-status";
import { formatBytesFr } from "@/lib/format";
import { Icon } from "./icons";

/**
 * Comptes de l'atelier, vus par l'administrateur : qui est inscrit, son usage, et les gestes d'administration
 * (mot de passe temporaire, désactivation, rôle). Composant d'AFFICHAGE : les appels réseau vivent dans `UsersPane`.
 */

/** Une seule colonne : `.srow2` est une grille « libellé / contrôle » par défaut. */
const ROW = { gridTemplateColumns: "1fr" } as const;
export type UserRowView = {
  id: number;
  username: string;
  role: "user" | "admin";
  disabled: boolean;
  created_at: string;
  last_login_at: string | null;
  sessions: number;
  used_bytes: number;
  tests: number;
};

export type UsersViewProps = {
  users: UserRowView[] | null;
  /** Compte de l'administrateur connecté : aucune action sur lui-même. */
  meId: number;
  now: number;
  reveal: { username: string; password: string } | null;
  problem: string;
  /** Ligne dont une action est en cours (boutons désactivés). */
  busyId: number | null;
  onReset: (user: UserRowView) => void;
  onToggleDisabled: (user: UserRowView) => void;
  onToggleRole: (user: UserRowView) => void;
  onDismissReveal: () => void;
};

const dateFr = (iso: string): string =>
  new Date(iso).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

export function UsersView(props: UsersViewProps) {
  const { users, meId, now, reveal, problem, busyId } = props;
  return (
    <section
      style={{ display: "grid", gap: "var(--sp-5)" }}
      aria-labelledby="h-users"
      data-testid="users-pane"
    >
      <h2 id="h-users" className="sr">
        Comptes
      </h2>

      <div className="card setgroup" aria-labelledby="g-users">
        <header>
          <h2 id="g-users">Comptes</h2>
          <p>
            Les personnes inscrites à l’atelier. Il n’y a pas d’e-mail : si
            quelqu’un perd son mot de passe, tu lui en donnes un temporaire,
            qu’il change ensuite dans Compte &gt; Sécurité.
          </p>
        </header>

        {problem ? (
          <div className="srow2" style={ROW}>
            <p className="notice notice--error" role="alert">
              {problem}
            </p>
          </div>
        ) : null}

        {reveal ? (
          <div className="srow2" style={ROW}>
            <div className="notice" role="status" data-testid="user-reveal">
              <p>
                <Icon name="key" /> <b>Mot de passe temporaire de </b>
                <b>{reveal.username}</b> : il ne sera plus jamais affiché.
              </p>
              <pre className="api-code">
                <code data-testid="user-reveal-password">
                  {reveal.password}
                </code>
              </pre>
              <p className="mini">
                Transmets-le par un canal privé. Toutes ses connexions en cours
                ont été coupées. Il devra le changer dans Compte &gt; Sécurité
                dès sa première connexion.
              </p>
              <div style={{ display: "flex", gap: "var(--sp-2)" }}>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  data-testid="user-reveal-done"
                  onClick={props.onDismissReveal}
                >
                  J’ai transmis le mot de passe
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <div className="srow2" style={ROW} data-testid="user-list">
          {users === null ? (
            <p>Chargement…</p>
          ) : users.length === 0 ? (
            <p className="mini">Aucun compte pour le moment.</p>
          ) : (
            <ul className="api-tokens">
              {users.map((u) => {
                const me = u.id === meId;
                const busy = busyId === u.id;
                return (
                  <li key={u.id} data-state={u.disabled ? "revoked" : "active"}>
                    <div>
                      <b>{u.username}</b>{" "}
                      <span className="badge badge--plain badge--outline">
                        {u.role === "admin" ? "Administrateur" : "Testeur"}
                      </span>{" "}
                      {u.disabled ? (
                        <span className="badge badge--plain badge--outline">
                          Désactivé
                        </span>
                      ) : null}
                      {me ? <small> · c’est toi</small> : null}
                      <br />
                      <small>
                        inscrit le {dateFr(u.created_at)} ·{" "}
                        {u.last_login_at
                          ? `dernière connexion ${seenLabel(u.last_login_at, now)}`
                          : "jamais connecté"}{" "}
                        · {u.sessions} session{u.sessions > 1 ? "s" : ""} ·{" "}
                        {formatBytesFr(u.used_bytes)} · {u.tests} analyse
                        {u.tests > 1 ? "s" : ""}
                      </small>
                    </div>
                    {me ? null : (
                      <div
                        style={{
                          display: "flex",
                          gap: "var(--sp-2)",
                          flexWrap: "wrap",
                          justifyContent: "flex-end",
                        }}
                      >
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          disabled={busy}
                          data-testid={`user-reset-${u.id}`}
                          onClick={() => props.onReset(u)}
                        >
                          Mot de passe
                        </button>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          disabled={busy}
                          data-testid={`user-role-${u.id}`}
                          onClick={() => props.onToggleRole(u)}
                        >
                          {u.role === "admin" ? "Rétrograder" : "Promouvoir"}
                        </button>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          disabled={busy}
                          data-testid={`user-toggle-${u.id}`}
                          onClick={() => props.onToggleDisabled(u)}
                        >
                          {u.disabled ? "Réactiver" : "Désactiver"}
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
