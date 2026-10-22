"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { ApiError, api } from "@/lib/api-client";
import { FormAlert, PasswordField } from "../atelier/auth-parts";
import { Icon } from "../atelier/icons";

type Problem = { title: string; detail?: string };

/** Message d'échec de connexion : jamais de détail qui trahirait l'existence d'un compte. */
function problemOf(error: unknown): Problem {
  if (error instanceof ApiError) {
    if (error.status === 401)
      return {
        title: "Pseudonyme ou mot de passe incorrect.",
        detail: "Vérifie les deux champs et réessaie.",
      };
    if (error.status === 429)
      return {
        title: "Trop d’essais.",
        detail:
          "Par sécurité, la connexion est suspendue un moment. Réessaie ensuite.",
      };
    if (error.status === 0)
      return {
        title: "Le serveur ne répond pas.",
        detail: "Rien n’est perdu : réessaie dans un instant.",
      };
    return { title: error.message };
  }
  return {
    title: "Connexion impossible.",
    detail: "Réessaie dans un instant.",
  };
}

export function LoginForm({ next }: { next: string }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [missing, setMissing] = useState<{ user: boolean; pw: boolean }>({
    user: false,
    pw: false,
  });
  const userInput = useRef<HTMLInputElement>(null);
  const pwInput = useRef<HTMLInputElement>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending) return;
    const gaps = { user: !username.trim(), pw: !password };
    setMissing(gaps);
    if (gaps.user || gaps.pw) {
      setProblem(null);
      (gaps.user ? userInput : pwInput).current?.focus();
      return;
    }
    setPending(true);
    setProblem(null);
    try {
      await api("/api/auth/login", {
        method: "POST",
        json: { username: username.trim(), password },
      });
      // Rechargement complet : le serveur relit les préférences DU COMPTE avant le premier rendu.
      location.assign(next);
    } catch (error) {
      setProblem(problemOf(error));
      setPassword("");
      setPending(false);
      pwInput.current?.focus();
    }
  };

  return (
    <>
      <div>
        <h1>Se connecter</h1>
        <p className="lead">Entre ton pseudonyme et ton mot de passe.</p>
      </div>
      {problem ? (
        <FormAlert title={problem.title} detail={problem.detail} />
      ) : null}
      <form
        noValidate
        onSubmit={(event) => void submit(event)}
        data-testid="login-form"
      >
        <div className="field" data-invalid={missing.user ? "true" : undefined}>
          <label htmlFor="login-user">Pseudonyme</label>
          <input
            ref={userInput}
            id="login-user"
            className="input"
            name="username"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            aria-invalid={missing.user ? true : undefined}
            aria-describedby="login-user-err"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
          <span className="err-msg" id="login-user-err">
            <Icon name="alert" />
            <span>Indique ton pseudonyme.</span>
          </span>
        </div>
        <PasswordField
          label="Mot de passe"
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
          invalid={missing.pw}
          error="Indique ton mot de passe."
          inputRef={pwInput}
        />
        <button
          className="btn btn--primary btn--lg btn--block"
          type="submit"
          data-testid="login-submit"
          disabled={pending}
          aria-busy={pending}
        >
          {pending ? "Envoi…" : "Se connecter"}
        </button>
      </form>
      <p className="auth-alt">
        Pas encore de compte ? <Link href="/register">Créer un compte</Link>
      </p>
      <p className="note">
        <Icon name="info" />
        <span>
          Mot de passe perdu ? Il n’y a pas d’e-mail de récupération :{" "}
          <b>demande à l’administrateur</b> de le réinitialiser.
        </span>
      </p>
    </>
  );
}
