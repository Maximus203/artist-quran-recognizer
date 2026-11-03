"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { AgentsView, type AgentRowView } from "./agents-view";

type Listing = {
  remote: boolean;
  online: boolean;
  queue: { waiting: number; leased: number } | null;
  items: AgentRowView[];
};

/** Rafraîchissement de l'état du moteur : l'administrateur voit un agent se connecter ou tomber sans recharger. */
const REFRESH_MS = 10_000;

/** Volet « Moteur » de l'administration : charge l'état, crée et révoque les agents. */
export function AgentsPane() {
  const [listing, setListing] = useState<Listing | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState("");
  const [fresh, setFresh] = useState<{ name: string; token: string } | null>(
    null,
  );

  const load = useCallback(async () => {
    setListing(await api<Listing>("/api/admin/engine-agents"));
    setNow(Date.now());
  }, []);

  useEffect(() => {
    load().catch(() =>
      setListing({ remote: true, online: false, queue: null, items: [] }),
    );
    const timer = setInterval(
      () => void load().catch(() => undefined),
      REFRESH_MS,
    );
    return () => clearInterval(timer);
  }, [load]);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setProblem("");
    if (!name.trim()) {
      setProblem("Donne un nom à la machine qui fera tourner l’agent.");
      return;
    }
    setPending(true);
    try {
      const created = await api<{ token: string }>("/api/admin/engine-agents", {
        method: "POST",
        json: { name },
      });
      setFresh({ name: name.trim(), token: created.token });
      setName("");
      await load();
    } catch (error) {
      setProblem(
        error instanceof Error ? error.message : "Création impossible.",
      );
    } finally {
      setPending(false);
    }
  };

  const move = async (agent: AgentRowView, direction: "up" | "down") => {
    setProblem("");
    try {
      await api(`/api/admin/engine-agents/${agent.id}`, {
        method: "PATCH",
        json: { move: direction },
      });
      await load();
    } catch (error) {
      setProblem(
        error instanceof Error ? error.message : "Déplacement impossible.",
      );
    }
  };

  const revoke = async (agent: AgentRowView) => {
    if (
      !window.confirm(
        `Révoquer « ${agent.name} » ? Cet agent cessera immédiatement de recevoir des analyses.`,
      )
    )
      return;
    try {
      await api(`/api/admin/engine-agents/${agent.id}`, { method: "DELETE" });
      await load();
    } catch (error) {
      setProblem(
        error instanceof Error ? error.message : "Révocation impossible.",
      );
    }
  };

  return (
    <AgentsView
      online={listing?.online ?? false}
      remote={listing?.remote ?? true}
      queue={listing?.queue ?? null}
      agents={listing ? listing.items : null}
      now={now}
      fresh={fresh}
      problem={problem}
      name={name}
      pending={pending}
      onName={setName}
      onCreate={(event) => void create(event)}
      onRevoke={(agent) => void revoke(agent)}
      onMove={(agent, direction) => void move(agent, direction)}
      onDismissFresh={() => setFresh(null)}
    />
  );
}
