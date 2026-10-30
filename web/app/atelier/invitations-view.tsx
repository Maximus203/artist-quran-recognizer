import { seenLabel } from "@/lib/agent-status";
import { invitationState, type InvitationState } from "@/lib/invitation-state";
import { Icon } from "./icons";

/**
 * Invitations de testeurs, vues par l'administrateur : créer un lien pour UNE personne (montré une seule fois),
 * voir qui l'a ouvert, révoquer. Composant d'AFFICHAGE : les appels réseau vivent dans `InvitationsPane`.
 */
export type InvitationRowView = {
  id: number;
  label: string;
  prefix: string;
  created_by: number;
  created_at: string;
  expires_at: string;
  max_uses: number;
  uses: number;
  last_used_at: string | null;
  revoked_at: string | null;
};

export type InvitationsViewProps = {
  invitations: InvitationRowView[] | null;
  now: number;
  fresh: { label: string; link: string; expires_at: string } | null;
  problem: string;
  label: string;
  days: string;
  maxUses: string;
  pending: boolean;
  onLabel: (value: string) => void;
  onDays: (value: string) => void;
  onMaxUses: (value: string) => void;
  onCreate: (event: React.FormEvent) => void;
  onRevoke: (invitation: InvitationRowView) => void;
  onCopy: (text: string) => void;
  onDismissFresh: () => void;
};

/** Une seule colonne : `.srow2` est une grille « libellé / contrôle » par défaut. */
const ROW = { gridTemplateColumns: "1fr" } as const;

const STATE_LABEL: Record<InvitationState, string> = {
  active: "Active",
  used_up: "Épuisée",
  expired: "Expirée",
  revoked: "Révoquée",
};

const DAYS = ["7", "14", "30", "90"];
const USES = ["1", "2", "5", "10"];

const dateFr = (iso: string): string =>
  new Date(iso).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

/** Message prêt à envoyer : le lien et sa date limite, rien d'autre. */
export function inviteMessage(link: string, expiresAt: string): string {
  return `Salam, voici ton accès pour tester Quran TR : ${link}\n(valable jusqu'au ${dateFr(expiresAt)}). Ouvre le lien, accepte l'invitation, puis crée ton compte.`;
}

export function InvitationsView(props: InvitationsViewProps) {
  const { invitations, now, fresh, problem, pending } = props;
  return (
    <section
      style={{ display: "grid", gap: "var(--sp-5)" }}
      aria-labelledby="h-invitations"
      data-testid="invitations-pane"
    >
      <h2 id="h-invitations" className="sr">
        Invitations
      </h2>

      <div className="card setgroup" aria-labelledby="g-invitations">
        <header>
          <h2 id="g-invitations">Inviter un testeur</h2>
          <p>
            Crée un lien pour <b>une personne</b> et envoie-le-lui : il lui
            donne l’accès à l’atelier et lui permet de créer son compte, sans
            que tu aies à lui communiquer le moindre secret du serveur. Tu peux
            le révoquer à tout moment.
          </p>
        </header>

        {fresh ? (
          <div className="srow2" style={ROW}>
            <div
              className="notice"
              role="status"
              data-testid="invitation-fresh"
            >
              <p>
                <Icon name="key" /> <b>Copie ce lien maintenant :</b> il ne sera
                plus jamais affiché. Il est destiné à « {fresh.label} ».
              </p>
              <pre className="api-code">
                <code data-testid="invitation-fresh-link">{fresh.link}</code>
              </pre>
              <p className="mini">Message prêt à envoyer :</p>
              <pre className="api-code">
                <code>{inviteMessage(fresh.link, fresh.expires_at)}</code>
              </pre>
              <div style={{ display: "flex", gap: "var(--sp-2)" }}>
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  data-testid="invitation-copy-message"
                  onClick={() =>
                    props.onCopy(inviteMessage(fresh.link, fresh.expires_at))
                  }
                >
                  Copier le message
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  data-testid="invitation-copy-link"
                  onClick={() => props.onCopy(fresh.link)}
                >
                  Copier le lien
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  data-testid="invitation-fresh-done"
                  onClick={props.onDismissFresh}
                >
                  J’ai transmis le lien
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <form
          className="srow2"
          style={{ ...ROW, maxWidth: 520 }}
          noValidate
          onSubmit={props.onCreate}
          data-testid="invitation-form"
        >
          {problem ? (
            <p className="notice notice--error" role="alert">
              {problem}
            </p>
          ) : null}
          <label className="field">
            <span>Nom de la personne invitée</span>
            <input
              className="input"
              value={props.label}
              maxLength={60}
              placeholder="Ex. Aminata, cousin de Moussa"
              data-testid="invitation-label"
              onChange={(event) => props.onLabel(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Valable pendant</span>
            <select
              className="input"
              value={props.days}
              data-testid="invitation-days"
              onChange={(event) => props.onDays(event.target.value)}
            >
              {DAYS.map((v) => (
                <option key={v} value={v}>
                  {v} jours
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Comptes que ce lien peut créer</span>
            <select
              className="input"
              value={props.maxUses}
              data-testid="invitation-max-uses"
              onChange={(event) => props.onMaxUses(event.target.value)}
            >
              {USES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <div>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={pending}
              data-testid="invitation-create"
            >
              {pending ? "Création…" : "Créer une invitation"}
            </button>
          </div>
        </form>

        <div className="srow2" style={ROW} data-testid="invitation-list">
          {invitations === null ? (
            <p>Chargement…</p>
          ) : invitations.length === 0 ? (
            <p className="mini">
              Aucune invitation pour le moment. Écris le nom de la personne
              ci-dessus pour savoir ensuite qui est invité.
            </p>
          ) : (
            <>
              <p className="mini">
                Chaque ligne dit qui est invité, si le lien a servi et jusqu’à
                quand il marche.
              </p>
              <ul className="api-tokens">
                {invitations.map((inv) => {
                  const state = invitationState(inv, new Date(now));
                  const opens = state === "active" || state === "used_up";
                  return (
                    <li key={inv.id} data-state={opens ? "active" : "revoked"}>
                      <div>
                        <b>{inv.label}</b>{" "}
                        <span
                          className="badge badge--plain badge--outline"
                          data-testid={`invitation-state-${inv.id}`}
                        >
                          {STATE_LABEL[state]}
                        </span>
                        <br />
                        <small className="mono">inv_{inv.prefix}…</small>
                        <small>
                          {" "}
                          · {inv.uses} / {inv.max_uses} inscription
                          {inv.max_uses > 1 ? "s" : ""} · expire le{" "}
                          {dateFr(inv.expires_at)} · dernière ouverture{" "}
                          {seenLabel(inv.last_used_at, now)}
                        </small>
                      </div>
                      {opens ? (
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          data-testid={`invitation-revoke-${inv.id}`}
                          onClick={() => props.onRevoke(inv)}
                        >
                          Révoquer
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
