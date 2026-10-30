"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { InvitationsView, type InvitationRowView } from "./invitations-view";

/** Volet « Invitations » de l'administration : crée le lien d'un testeur, liste, révoque. */
export function InvitationsPane() {
  const [items, setItems] = useState<InvitationRowView[] | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [label, setLabel] = useState("");
  const [days, setDays] = useState("14");
  const [maxUses, setMaxUses] = useState("1");
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState("");
  const [fresh, setFresh] = useState<{
    label: string;
    link: string;
    expires_at: string;
  } | null>(null);

  const load = useCallback(async () => {
    const data = await api<{ items: InvitationRowView[] }>(
      "/api/admin/invitations",
    );
    setItems(data.items);
    setNow(Date.now());
  }, []);

  useEffect(() => {
    load().catch(() => setItems([]));
  }, [load]);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setProblem("");
    if (!label.trim()) {
      setProblem("Écris le nom de la personne invitée.");
      return;
    }
    setPending(true);
    try {
      const created = await api<{
        token: string;
        invitation: InvitationRowView;
      }>("/api/admin/invitations", {
        method: "POST",
        json: {
          label,
          expires_in_days: Number(days),
          max_uses: Number(maxUses),
        },
      });
      setFresh({
        label: created.invitation.label,
        // Adresse de l'atelier telle que la voit l'administrateur : celle que le testeur ouvrira.
        link: `${window.location.origin}/access?invitation=${created.token}`,
        expires_at: created.invitation.expires_at,
      });
      setLabel("");
      await load();
    } catch (error) {
      setProblem(
        error instanceof Error ? error.message : "Création impossible.",
      );
    } finally {
      setPending(false);
    }
  };

  const revoke = async (invitation: InvitationRowView) => {
    if (
      !window.confirm(
        `Révoquer l’invitation de « ${invitation.label} » ? Son lien ne marchera plus. Son compte, s’il est créé, n’est pas touché.`,
      )
    )
      return;
    try {
      await api(`/api/admin/invitations/${invitation.id}`, {
        method: "DELETE",
      });
      await load();
    } catch (error) {
      setProblem(
        error instanceof Error ? error.message : "Révocation impossible.",
      );
    }
  };

  return (
    <InvitationsView
      invitations={items}
      now={now}
      fresh={fresh}
      problem={problem}
      label={label}
      days={days}
      maxUses={maxUses}
      pending={pending}
      onLabel={setLabel}
      onDays={setDays}
      onMaxUses={setMaxUses}
      onCreate={(event) => void create(event)}
      onRevoke={(invitation) => void revoke(invitation)}
      onCopy={(text) =>
        void navigator.clipboard?.writeText(text).catch(() => undefined)
      }
      onDismissFresh={() => setFresh(null)}
    />
  );
}
