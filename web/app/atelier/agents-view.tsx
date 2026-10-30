import { agentState, seenLabel, type AgentState } from "@/lib/agent-status";
import { Icon } from "./icons";

/**
 * Agents du moteur d'analyse à distance (ADR-0017), vus par l'administrateur : état du moteur, liste des agents,
 * création (le jeton n'est montré qu'une fois) et révocation. Composant d'AFFICHAGE : les appels réseau et l'état
 * vivent dans `AgentsPane`, ce qui le rend testable en HTML statique.
 */

/** Une seule colonne : `.srow2` est une grille « libellé / contrôle » par défaut. */
const ROW = { gridTemplateColumns: "1fr" } as const;
export type AgentRowView = {
  id: number;
  name: string;
  prefix: string;
  created_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
  /** Plus petit = plus préféré (la liste arrive déjà triée). */
  priority: number;
};

export type AgentsViewProps = {
  /** Au moins un agent a donné signe de vie récemment. */
  online: boolean;
  /** `AQR_ENGINE=remote` : les analyses attendent un agent. Sinon le moteur tourne sur le serveur. */
  remote: boolean;
  queue: { waiting: number; leased: number } | null;
  agents: AgentRowView[] | null;
  now: number;
  fresh: { name: string; token: string } | null;
  problem: string;
  name: string;
  pending: boolean;
  onName: (value: string) => void;
  onCreate: (event: React.FormEvent) => void;
  onRevoke: (agent: AgentRowView) => void;
  onMove: (agent: AgentRowView, direction: "up" | "down") => void;
  onDismissFresh: () => void;
};

const STATE_LABEL: Record<AgentState, string> = {
  online: "En ligne",
  silent: "Silencieux",
  never: "Jamais vu",
  revoked: "Révoqué",
};

const dateFr = (iso: string): string =>
  new Date(iso).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

const INSTALL_COMMAND = `sudo install -d -m 755 /etc/aqr
sudo sh -c 'umask 077; cat > /etc/aqr/engine-agent.token'
# colle le jeton, puis Entrée et Ctrl-D : il n'entre ni dans l'historique du terminal ni dans un fichier lisible
sudo systemctl restart aqr-engine-agent`;

function EngineBanner({
  online,
  remote,
  queue,
}: Pick<AgentsViewProps, "online" | "remote" | "queue">) {
  if (!remote)
    return (
      <p className="notice" data-testid="engine-banner" data-state="local">
        <Icon name="check" /> Le moteur tourne sur cette machine : aucun agent à
        distance n’est nécessaire.
      </p>
    );
  if (online)
    return (
      <p className="notice" data-testid="engine-banner" data-state="online">
        <Icon name="check" /> <b>Moteur en ligne.</b>
        {queue && queue.leased > 0
          ? ` ${queue.leased} analyse${queue.leased > 1 ? "s" : ""} en cours.`
          : ""}
      </p>
    );
  const waiting = queue?.waiting ?? 0;
  return (
    <p
      className={waiting > 0 ? "notice notice--error" : "notice"}
      role={waiting > 0 ? "alert" : undefined}
      data-testid="engine-banner"
      data-state="offline"
    >
      <Icon name="alert" /> <b>Aucun agent en ligne.</b>{" "}
      {waiting > 0
        ? `${waiting} analyse${waiting > 1 ? "s" : ""} attendent un moteur : elles démarreront dès qu’un agent se reconnecte.`
        : "Les nouvelles analyses attendront qu’un agent se reconnecte."}
    </p>
  );
}

export function AgentsView(props: AgentsViewProps) {
  const {
    agents,
    now,
    fresh,
    problem,
    name,
    pending,
    onName,
    onCreate,
    onRevoke,
    onMove,
    onDismissFresh,
  } = props;
  // Ordre de préférence : les agents actifs, dans l'ordre reçu (déjà trié par le serveur).
  const active = (agents ?? []).filter((agent) => !agent.revoked_at);
  return (
    <section
      style={{ display: "grid", gap: "var(--sp-5)" }}
      aria-labelledby="h-agents"
      data-testid="agents-pane"
    >
      <h2 id="h-agents" className="sr">
        Moteur d’analyse
      </h2>

      <div className="card setgroup" aria-labelledby="g-agents">
        <header>
          <h2 id="g-agents">Agents du moteur</h2>
          <p>
            Un agent est le programme qui analyse les enregistrements, sur Atlas
            ou sur un poste à GPU. Il appelle l’atelier avec son propre jeton,
            distinct de tous les autres : tu peux en créer un par machine et le
            révoquer sans toucher aux autres.
          </p>
          {active.length > 1 ? (
            <p>
              Le <b>premier choix</b> reçoit les analyses. Le secours ne
              travaille que si le premier choix est éteint ou occupé : monte la
              machine la plus rapide (le poste à GPU) en premier.
            </p>
          ) : null}
        </header>

        <div className="srow2" style={ROW}>
          <EngineBanner
            online={props.online}
            remote={props.remote}
            queue={props.queue}
          />
        </div>

        {fresh ? (
          <div className="srow2" style={ROW}>
            <div className="notice" role="status" data-testid="agent-fresh">
              <p>
                <Icon name="key" /> <b>Copie ce jeton maintenant :</b> il ne
                sera plus jamais affiché. Il est destiné à la machine «{" "}
                {fresh.name} ».
              </p>
              <pre className="api-code">
                <code data-testid="agent-fresh-token">{fresh.token}</code>
              </pre>
              <p className="mini">
                Sur cette machine, dépose-le dans{" "}
                <code>/etc/aqr/engine-agent.token</code> (lecture réservée à
                root) :
              </p>
              <pre className="api-code">
                <code>{INSTALL_COMMAND}</code>
              </pre>
              <div style={{ display: "flex", gap: "var(--sp-2)" }}>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  data-testid="agent-fresh-done"
                  onClick={onDismissFresh}
                >
                  J’ai copié le jeton
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <form
          className="srow2"
          style={{ gridTemplateColumns: "1fr", maxWidth: 520 }}
          noValidate
          onSubmit={onCreate}
          data-testid="agent-form"
        >
          {problem ? (
            <p className="notice notice--error" role="alert">
              {problem}
            </p>
          ) : null}
          <label className="field">
            <span>Nom de la machine</span>
            <input
              className="input"
              value={name}
              maxLength={60}
              placeholder="Ex. Atlas, poste GPU"
              data-testid="agent-name"
              onChange={(event) => onName(event.target.value)}
            />
          </label>
          <div>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={pending}
              data-testid="agent-create"
            >
              {pending ? "Création…" : "Créer un agent"}
            </button>
          </div>
        </form>

        <div className="srow2" style={ROW} data-testid="agent-list">
          {agents === null ? (
            <p>Chargement…</p>
          ) : agents.length === 0 ? (
            <p className="mini">
              Aucun agent pour le moment : sans agent, les analyses ne démarrent
              pas.
            </p>
          ) : (
            <ul className="api-tokens">
              {agents.map((agent) => {
                const state = agentState(agent, now);
                const rank = active.findIndex((a) => a.id === agent.id);
                return (
                  <li key={agent.id} data-state={state}>
                    <div>
                      <b>{agent.name}</b>{" "}
                      <span
                        className="badge badge--plain badge--outline"
                        data-testid={`agent-state-${agent.id}`}
                      >
                        {STATE_LABEL[state]}
                      </span>{" "}
                      {rank >= 0 && active.length > 1 ? (
                        <span
                          className="badge badge--plain badge--outline"
                          data-testid={`agent-rank-${agent.id}`}
                        >
                          {rank === 0 ? "Premier choix" : "Secours"}
                        </span>
                      ) : null}
                      <br />
                      <small className="mono">qea_{agent.prefix}…</small>
                      <small>
                        {" "}
                        · créé le {dateFr(agent.created_at)} · dernière activité{" "}
                        {seenLabel(agent.last_seen_at, now)}
                        {agent.revoked_at
                          ? ` · révoqué le ${dateFr(agent.revoked_at)}`
                          : ""}
                      </small>
                    </div>
                    {state !== "revoked" ? (
                      <div
                        style={{
                          display: "flex",
                          gap: "var(--sp-2)",
                          flexWrap: "wrap",
                          justifyContent: "flex-end",
                        }}
                      >
                        {active.length > 1 ? (
                          <>
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              disabled={rank === 0}
                              data-testid={`agent-up-${agent.id}`}
                              onClick={() => onMove(agent, "up")}
                            >
                              Monter
                            </button>
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              disabled={rank === active.length - 1}
                              data-testid={`agent-down-${agent.id}`}
                              onClick={() => onMove(agent, "down")}
                            >
                              Descendre
                            </button>
                          </>
                        ) : null}
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          data-testid={`agent-revoke-${agent.id}`}
                          onClick={() => onRevoke(agent)}
                        >
                          Révoquer
                        </button>
                      </div>
                    ) : null}
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
