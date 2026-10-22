"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { ApiError, api } from "@/lib/api-client";
import { missingCharacters, passwordStrength } from "@/lib/password-strength";
import { TESTER_PATTERN, TESTER_RULE_MESSAGE } from "@/lib/tester";
import { FormAlert, PasswordField } from "../atelier/auth-parts";
import { Icon } from "../atelier/icons";

type Mode = "open" | "closed" | "code";
type Problem = { title: string; detail?: string };
type FieldErrors = Partial<Record<"username" | "password" | "code", string>>;

export function RegisterForm({
  mode,
  firstAccount,
}: {
  mode: Mode;
  /** Aucun compte n'existe encore : le premier inscrit sera administrateur. */
  firstAccount: boolean;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const userInput = useRef<HTMLInputElement>(null);
  const pwInput = useRef<HTMLInputElement>(null);
  const strength = passwordStrength(password, username);

  // Inscriptions fermées (sauf amorçage) : on le dit au lieu d'afficher un formulaire voué au refus.
  if (mode === "closed" && !firstAccount)
    return (
      <>
        <div>
          <h1>Inscriptions fermées</h1>
          <p className="lead">
            Cet atelier n’accepte pas de nouveaux comptes pour l’instant.
          </p>
        </div>
        <p className="note">
          <Icon name="info" />
          <span>
            Demande à l’administrateur de t’ouvrir un accès, ou{" "}
            <Link href="/login" className="link">
              connecte-toi
            </Link>{" "}
            si tu as déjà un compte.
          </span>
        </p>
      </>
    );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending) return;
    const found: FieldErrors = {};
    const name = username.trim();
    if (!name) found.username = "Choisis un pseudonyme.";
    else if (!TESTER_PATTERN.test(name)) found.username = TESTER_RULE_MESSAGE;
    if (!password) found.password = "Choisis un mot de passe.";
    else if (missingCharacters(password) > 0)
      found.password = `Il manque ${missingCharacters(password)} caractère${missingCharacters(password) > 1 ? "s" : ""} : 10 au minimum.`;
    else if (name.toLowerCase() === password.toLowerCase())
      found.password = "Le mot de passe doit différer du pseudonyme.";
    if (mode === "code" && !firstAccount && !code.trim())
      found.code = "Indique le code d’invitation.";
    setErrors(found);
    setProblem(null);
    if (Object.keys(found).length > 0) {
      (found.username ? userInput : pwInput).current?.focus();
      return;
    }
    setPending(true);
    try {
      await api("/api/auth/register", {
        method: "POST",
        json: {
          username: name,
          password,
          ...(mode === "code" && !firstAccount ? { code: code.trim() } : {}),
        },
      });
      location.assign("/");
    } catch (error) {
      setPending(false);
      if (error instanceof ApiError && error.field) {
        const field = error.field as keyof FieldErrors;
        const text =
          error.status === 409
            ? "Ce pseudonyme est déjà pris. Essaie-en un autre."
            : error.message;
        setErrors({ [field]: text });
        (field === "username" ? userInput : pwInput).current?.focus();
        return;
      }
      setProblem(
        error instanceof ApiError && error.status === 0
          ? {
              title: "Le serveur ne répond pas.",
              detail: "Rien n’est perdu : réessaie dans un instant.",
            }
          : {
              title:
                error instanceof ApiError
                  ? error.message
                  : "Inscription impossible.",
            },
      );
    }
  };

  return (
    <>
      <div>
        <h1>Créer un compte testeur</h1>
        <p className="lead">
          Un pseudonyme et un mot de passe suffisent. Pas d’e-mail.
        </p>
      </div>
      {firstAccount ? (
        <p className="note note--admin" data-testid="first-account-note">
          <Icon name="shield" />
          <span>
            <b>
              Tu es la première personne inscrite : ton compte sera
              administrateur.
            </b>{" "}
            Les suivants seront des testeurs.
          </span>
        </p>
      ) : null}
      {problem ? (
        <FormAlert title={problem.title} detail={problem.detail} />
      ) : null}
      <form
        noValidate
        onSubmit={(event) => void submit(event)}
        data-testid="register-form"
      >
        <div
          className="field"
          data-invalid={errors.username ? "true" : undefined}
        >
          <label htmlFor="reg-user">Pseudonyme</label>
          <input
            ref={userInput}
            id="reg-user"
            className="input"
            name="username"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={24}
            required
            aria-invalid={errors.username ? true : undefined}
            aria-describedby="reg-user-help reg-user-err"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
          <span className="help" id="reg-user-help">
            2 à 24 caractères : lettres, chiffres, espace, point, tiret,
            souligné. Il sera visible des autres testeurs.
          </span>
          <span className="err-msg" id="reg-user-err">
            <Icon name="alert" />
            <span>{errors.username}</span>
          </span>
        </div>
        <PasswordField
          label="Mot de passe"
          name="password"
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
          invalid={Boolean(errors.password)}
          error={errors.password}
          inputRef={pwInput}
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
              <span>
                10 caractères minimum. Une phrase longue vaut mieux qu’un mot
                compliqué.
              </span>
              <b data-testid="strength-label">{strength.label}</b>
            </span>
          </span>
        </PasswordField>
        {mode === "code" && !firstAccount ? (
          <div
            className="field"
            data-invalid={errors.code ? "true" : undefined}
          >
            <label htmlFor="reg-code">Code d’invitation</label>
            <input
              id="reg-code"
              className="input"
              name="code"
              type="text"
              autoComplete="off"
              spellCheck={false}
              required
              aria-invalid={errors.code ? true : undefined}
              aria-describedby="reg-code-err"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
            <span className="err-msg" id="reg-code-err">
              <Icon name="alert" />
              <span>{errors.code}</span>
            </span>
          </div>
        ) : null}
        <button
          className="btn btn--primary btn--lg btn--block"
          type="submit"
          data-testid="register-submit"
          disabled={pending}
          aria-busy={pending}
        >
          {pending ? "Envoi…" : "Créer mon compte"}
        </button>
      </form>
      <div style={{ display: "grid", gap: 10 }}>
        <p className="note">
          <Icon name="globe" />
          <span>
            <b>Tes audios sont visibles de tous les testeurs</b> avec leurs
            résultats, sauf ceux que tu marques comme privés.
          </span>
        </p>
        <p className="note">
          <Icon name="key" />
          <span>
            <b>Note ton mot de passe</b> dans un gestionnaire : sans e-mail,
            seul l’administrateur peut le réinitialiser.
          </span>
        </p>
      </div>
      <p className="auth-alt">
        Déjà un compte ? <Link href="/login">Se connecter</Link>
      </p>
    </>
  );
}
