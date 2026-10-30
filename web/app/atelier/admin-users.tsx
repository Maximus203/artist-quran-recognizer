"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { useShell } from "./shell";
import { UsersView, type UserRowView } from "./users-view";

/** Volet « Comptes » de l'administration : liste, mot de passe temporaire, rôle, désactivation. */
export function UsersPane() {
  const { user: me } = useShell();
  const [users, setUsers] = useState<UserRowView[] | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [problem, setProblem] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [reveal, setReveal] = useState<{
    username: string;
    password: string;
  } | null>(null);

  const load = useCallback(async () => {
    const data = await api<{ users: UserRowView[] }>("/api/admin/users");
    setUsers(data.users);
    setNow(Date.now());
  }, []);

  useEffect(() => {
    load().catch(() => setUsers([]));
  }, [load]);

  /** Une action sur un compte : confirmation, appel, rechargement ; l'erreur du serveur est dite telle quelle. */
  const act = async (
    user: UserRowView,
    confirmText: string,
    run: () => Promise<void>,
  ) => {
    if (busyId !== null || !window.confirm(confirmText)) return;
    setProblem("");
    setBusyId(user.id);
    try {
      await run();
      await load();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Action impossible.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <UsersView
      users={users}
      meId={me.id}
      now={now}
      reveal={reveal}
      problem={problem}
      busyId={busyId}
      onDismissReveal={() => setReveal(null)}
      onReset={(user) =>
        void act(
          user,
          `Réinitialiser le mot de passe de « ${user.username} » ? Ses connexions en cours seront coupées.`,
          async () => {
            const result = await api<{ username: string; password: string }>(
              `/api/admin/users/${user.id}/password`,
              { method: "POST" },
            );
            setReveal({ username: result.username, password: result.password });
          },
        )
      }
      onToggleDisabled={(user) =>
        void act(
          user,
          user.disabled
            ? `Réactiver « ${user.username} » ?`
            : `Désactiver « ${user.username} » ? Il sera déconnecté et ne pourra plus se connecter ; ses sessions restent.`,
          async () => {
            await api(`/api/admin/users/${user.id}`, {
              method: "PATCH",
              json: { disabled: !user.disabled },
            });
          },
        )
      }
      onToggleRole={(user) =>
        void act(
          user,
          user.role === "admin"
            ? `Rétrograder « ${user.username} » en testeur ?`
            : `Promouvoir « ${user.username} » administrateur ? Il pourra gérer les comptes et le moteur.`,
          async () => {
            await api(`/api/admin/users/${user.id}`, {
              method: "PATCH",
              json: { role: user.role === "admin" ? "user" : "admin" },
            });
          },
        )
      }
    />
  );
}
