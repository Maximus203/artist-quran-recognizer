"use client";
import { useRef, useState } from "react";
import { ApiError, api } from "@/lib/api-client";
import { missingCharacters, passwordStrength } from "@/lib/password-strength";
import { FormAlert, PasswordField } from "./auth-parts";
import { Icon } from "./icons";
import { useShell } from "./shell";

/** Sécurité : changer le mot de passe (les autres appareils sont déconnectés) et se déconnecter. */
export function SecurityPane() {
  const { user } = useShell();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<{ current?: string; next?: string }>({});
  const [problem, setProblem] = useState("");
  const [done, setDone] = useState(false);
  const currentInput = useRef<HTMLInputElement>(null);
  const nextInput = useRef<HTMLInputElement>(null);
  const strength = passwordStrength(next, user.username);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setDone(false);
    setProblem("");
    const found: typeof errors = {};
    if (!current) found.current = "Indique ton mot de passe actuel.";
    if (!next) found.next = "Choisis un nouveau mot de passe.";
    else if (missingCharacters(next) > 0)
      found.next = `Il manque ${missingCharacters(next)} caractère${missingCharacters(next) > 1 ? "s" : ""} : 10 au minimum.`;
    else if (next.toLowerCase() === user.username.toLowerCase())
      found.next = "Le mot de passe doit différer du pseudonyme.";
    setErrors(found);
    if (found.current || found.next) {
      (found.current ? currentInput : nextInput).current?.focus();
      return;
    }
    setPending(true);
    try {
      await api("/api/me/password", {
        method: "POST",
        json: { current, next },
      });
      setCurrent("");
      setNext("");
      setDone(true);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setErrors({ current: "Le mot de passe actuel est incorrect." });
        currentInput.current?.focus();
      } else if (error instanceof ApiError && error.field === "password") {
        setErrors({ next: error.message });
        nextInput.current?.focus();
      } else
        setProblem(
          error instanceof Error ? error.message : "Changement impossible.",
        );
    } finally {
      setPending(false);
    }
  };

  return (
    <section
      style={{ display: "grid", gap: "var(--sp-5)" }}
      aria-labelledby="h-sec"
    >
      <h2 id="h-sec" className="sr">
        Sécurité
      </h2>
      <div className="card setgroup" aria-labelledby="g-pw">
        <header>
          <h2 id="g-pw">Mot de passe</h2>
          <p>
            10 caractères minimum. Sans e-mail, il n’y a pas de récupération
            automatique : garde-le dans un gestionnaire de mots de passe.
          </p>
        </header>
        <form
          className="srow2"
          style={{ gridTemplateColumns: "1fr", maxWidth: 480 }}
          noValidate
          onSubmit={(event) => void submit(event)}
          data-testid="password-form"
        >
          <input
            className="sr"
            type="text"
            name="username"
            value={user.username}
            autoComplete="username"
            readOnly
            tabIndex={-1}
            aria-hidden="true"
          />
          {problem ? <FormAlert title={problem} /> : null}
          {done ? (
            <p className="notice" role="status" data-testid="password-done">
              <Icon name="check" /> Mot de passe changé. Tes autres appareils
              sont déconnectés.
            </p>
          ) : null}
          <PasswordField
            label="Mot de passe actuel"
            name="current"
            autoComplete="current-password"
            value={current}
            onChange={setCurrent}
            invalid={Boolean(errors.current)}
            error={errors.current}
            inputRef={currentInput}
          />
          <PasswordField
            label="Nouveau mot de passe"
            name="next"
            autoComplete="new-password"
            value={next}
            onChange={setNext}
            invalid={Boolean(errors.next)}
            error={errors.next}
            inputRef={nextInput}
            help="10 caractères minimum."
          >
            <span
              className="strength"
              data-level={strength.level}
              aria-live="polite"
            >
              <span className="bars" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span className="lbl">
                <b>{strength.label}</b>
              </span>
            </span>
          </PasswordField>
          <div>
            <button
              className="btn btn--primary"
              type="submit"
              disabled={pending}
              aria-busy={pending}
              data-testid="password-submit"
            >
              {pending ? "Envoi…" : "Changer le mot de passe"}
            </button>
          </div>
        </form>
      </div>
      <div className="card setgroup" aria-labelledby="g-dev">
        <header>
          <h2 id="g-dev">Appareils connectés</h2>
          <p>
            Tu restes connecté jusqu’à 30 jours sur un appareil. Changer ton mot
            de passe ferme toutes tes autres connexions.
          </p>
        </header>
      </div>
    </section>
  );
}
