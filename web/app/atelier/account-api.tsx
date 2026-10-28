"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import type { ApiTokenRow, TokenScope } from "@/lib/api-tokens";
import { Icon } from "./icons";

/**
 * API & MCP : créer et révoquer les jetons des applications et agents IA, et copier de quoi les
 * brancher (adresse, commande MCP, exemple d'appel, compétence d'agent). Le jeton n'est montré
 * qu'une fois, à sa création.
 */

const SCOPES: { id: TokenScope; label: string; help: string }[] = [
  {
    id: "read",
    label: "Lecture seule",
    help: "Lister, lire les versets et générer des sous-titres. Rien ne peut être importé ni supprimé.",
  },
  {
    id: "write",
    label: "Lecture et écriture",
    help: "Importer des audios, lancer des analyses, supprimer ses propres essais.",
  },
];

const dateFr = (iso: string | null): string =>
  iso
    ? new Date(iso).toLocaleDateString("fr-FR", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";

function tokenState(token: ApiTokenRow): "active" | "revoked" | "expired" {
  if (token.revoked_at) return "revoked";
  if (token.expires_at && Date.parse(token.expires_at) <= Date.now())
    return "expired";
  return "active";
}

function CopyBlock({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="api-copy">
      <div className="api-copy-head">
        <span>{label}</span>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(text)
              .then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1800);
              })
              .catch(() => undefined);
          }}
        >
          {copied ? "Copié" : "Copier"}
        </button>
      </div>
      <pre className="api-code">
        <code>{text}</code>
      </pre>
    </div>
  );
}

export function ApiPane() {
  const [tokens, setTokens] = useState<ApiTokenRow[] | null>(null);
  const [origin, setOrigin] = useState("http://127.0.0.1:3000");
  const [name, setName] = useState("");
  const [scope, setScope] = useState<TokenScope>("read");
  const [days, setDays] = useState("");
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [freshCopied, setFreshCopied] = useState(false);

  const load = useCallback(async () => {
    const data = await api<{ items: ApiTokenRow[] }>("/api/me/tokens");
    setTokens(data.items);
  }, []);

  useEffect(() => {
    setOrigin(window.location.origin);
    load().catch(() => setTokens([]));
  }, [load]);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setProblem("");
    if (!name.trim()) {
      setProblem("Donne un nom au jeton (l’application qui s’en servira).");
      return;
    }
    setPending(true);
    try {
      const created = await api<{ token: string }>("/api/me/tokens", {
        method: "POST",
        json: {
          name,
          scope,
          ...(days ? { expires_in_days: Number(days) } : {}),
        },
      });
      setFresh(created.token);
      setFreshCopied(false);
      setName("");
      setDays("");
      await load();
    } catch (error) {
      setProblem(
        error instanceof Error ? error.message : "Création impossible.",
      );
    } finally {
      setPending(false);
    }
  };

  const revoke = async (token: ApiTokenRow) => {
    if (
      !window.confirm(
        `Révoquer « ${token.name} » ? L’application qui l’utilise perdra l’accès immédiatement.`,
      )
    )
      return;
    try {
      await api(`/api/me/tokens/${token.id}`, { method: "DELETE" });
      await load();
    } catch (error) {
      setProblem(
        error instanceof Error ? error.message : "Révocation impossible.",
      );
    }
  };

  const shown = fresh ?? "qtr_VOTRE_JETON";
  const mcpCommand = `claude mcp add --transport http quran-tr ${origin}/mcp \\\n  --header "Authorization: Bearer ${shown}"`;
  const curlExample = `curl -H "Authorization: Bearer ${shown}" \\\n  "${origin}/api/v1/recordings?limit=5"`;
  const mcpJson = JSON.stringify(
    {
      mcpServers: {
        "quran-tr": {
          type: "http",
          url: `${origin}/mcp`,
          headers: { Authorization: `Bearer ${shown}` },
        },
      },
    },
    null,
    2,
  );

  return (
    <section
      style={{ display: "grid", gap: "var(--sp-5)" }}
      aria-labelledby="h-api"
      data-testid="api-pane"
    >
      <h2 id="h-api" className="sr">
        API et MCP
      </h2>

      <div className="card setgroup" aria-labelledby="g-tok">
        <header>
          <h2 id="g-tok">Jetons d’accès</h2>
          <p>
            Un jeton permet à une application ou à un agent IA d’utiliser Quran
            TR <b>avec les droits de ton compte</b> (tes essais, jamais ceux des
            autres, jamais l’administration). Crée-en un par application : tu
            pourras le révoquer sans toucher aux autres.
          </p>
        </header>

        {fresh ? (
          <div className="notice" role="status" data-testid="api-fresh">
            <p>
              <Icon name="key" /> <b>Copie ce jeton maintenant :</b> il ne sera
              plus jamais affiché.
            </p>
            <pre className="api-code">
              <code data-testid="api-fresh-token">{fresh}</code>
            </pre>
            <div style={{ display: "flex", gap: "var(--sp-2)" }}>
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(fresh)
                    .then(() => setFreshCopied(true))
                    .catch(() => undefined);
                }}
              >
                {freshCopied ? "Copié" : "Copier le jeton"}
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setFresh(null)}
              >
                J’ai copié le jeton
              </button>
            </div>
          </div>
        ) : null}

        <form
          className="srow2"
          style={{ gridTemplateColumns: "1fr", maxWidth: 520 }}
          noValidate
          onSubmit={(event) => void create(event)}
          data-testid="api-token-form"
        >
          {problem ? (
            <p className="notice notice--error" role="alert">
              {problem}
            </p>
          ) : null}
          <label className="field">
            <span>Nom de l’application</span>
            <input
              className="input"
              value={name}
              maxLength={60}
              placeholder="Ex. Mon agent Claude Code"
              data-testid="api-token-name"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <fieldset className="field" style={{ border: 0, padding: 0 }}>
            <legend>Droits</legend>
            {SCOPES.map((item) => (
              <label
                key={item.id}
                style={{ display: "flex", gap: "var(--sp-2)", margin: "6px 0" }}
              >
                <input
                  type="radio"
                  name="scope"
                  checked={scope === item.id}
                  data-testid={`api-scope-${item.id}`}
                  onChange={() => setScope(item.id)}
                />
                <span>
                  <b>{item.label}</b>
                  <br />
                  <small>{item.help}</small>
                </span>
              </label>
            ))}
          </fieldset>
          <label className="field">
            <span>Durée de validité (jours, facultatif)</span>
            <input
              className="input"
              inputMode="numeric"
              value={days}
              placeholder="Sans limite"
              data-testid="api-token-days"
              onChange={(event) =>
                setDays(event.target.value.replace(/\D/g, "").slice(0, 3))
              }
            />
          </label>
          <div>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={pending}
              data-testid="api-token-create"
            >
              {pending ? "Création…" : "Créer un jeton"}
            </button>
          </div>
        </form>

        <div data-testid="api-token-list">
          {tokens === null ? (
            <p>Chargement…</p>
          ) : tokens.length === 0 ? (
            <p className="mini">Aucun jeton pour le moment.</p>
          ) : (
            <ul className="api-tokens">
              {tokens.map((token) => {
                const state = tokenState(token);
                return (
                  <li key={token.id} data-state={state}>
                    <div>
                      <b>{token.name}</b>{" "}
                      <span className="badge badge--plain badge--outline">
                        {token.scope === "read" ? "lecture" : "écriture"}
                      </span>{" "}
                      {state !== "active" ? (
                        <span className="badge badge--plain badge--outline">
                          {state === "revoked" ? "révoqué" : "expiré"}
                        </span>
                      ) : null}
                      <br />
                      <small className="mono">qtr_{token.prefix}…</small>
                      <small>
                        {" "}
                        · créé le {dateFr(token.created_at)} · dernier usage{" "}
                        {dateFr(token.last_used_at)}
                        {token.expires_at
                          ? ` · expire le ${dateFr(token.expires_at)}`
                          : ""}
                      </small>
                    </div>
                    {state === "active" ? (
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        data-testid={`api-revoke-${token.id}`}
                        onClick={() => void revoke(token)}
                      >
                        Révoquer
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="card setgroup" aria-labelledby="g-mcp">
        <header>
          <h2 id="g-mcp">Brancher un agent IA (MCP)</h2>
          <p>
            Quran TR expose un serveur MCP à l’adresse <code>{origin}/mcp</code>
            . Il fonctionne même en local sur cette machine : l’agent doit
            seulement pouvoir joindre cette adresse. Outils : lister les essais,
            lire les versets, générer des sous-titres, importer un audio.
          </p>
        </header>
        <CopyBlock label="Claude Code" text={mcpCommand} />
        <CopyBlock label="Autres clients MCP (JSON)" text={mcpJson} />
      </div>

      <div className="card setgroup" aria-labelledby="g-rest">
        <header>
          <h2 id="g-rest">API REST</h2>
          <p>
            Mêmes droits que le MCP, pour une application ou un script :{" "}
            <code>{origin}/api/v1/recordings</code>.
          </p>
        </header>
        <CopyBlock label="Exemple" text={curlExample} />
      </div>

      <div className="card setgroup" aria-labelledby="g-skill">
        <header>
          <h2 id="g-skill">Compétence pour l’agent</h2>
          <p>
            Un fichier <code>SKILL.md</code> explique à un agent IA comment
            utiliser Quran TR (flux, outils, statuts de preuve, règles de
            citation). Place-le dans le dossier de compétences de ton agent, par
            exemple <code>~/.claude/skills/quran-tr/SKILL.md</code>.
          </p>
        </header>
        <div>
          <a
            className="btn btn--ghost"
            href="/agent/quran-tr/SKILL.md"
            download="SKILL.md"
            data-testid="api-skill-link"
          >
            <Icon name="download" /> Télécharger SKILL.md
          </a>
        </div>
      </div>
    </section>
  );
}
