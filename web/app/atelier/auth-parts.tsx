"use client";
import { useEffect, useId, useState } from "react";
import { PREFS_CACHE_KEY } from "@/lib/prefs-sync";
import { Icon } from "./icons";

/** Champ mot de passe avec bouton « afficher » (remplace le champ de confirmation). */
export function PasswordField({
  label,
  name,
  value,
  onChange,
  autoComplete,
  invalid,
  error,
  help,
  children,
  inputRef,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  invalid?: boolean;
  error?: string;
  help?: React.ReactNode;
  /** Sous le champ (jauge de force). */
  children?: React.ReactNode;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  const [shown, setShown] = useState(false);
  const id = useId();
  return (
    <div className="field" data-invalid={invalid ? "true" : undefined}>
      <label htmlFor={id}>{label}</label>
      <span className="pw">
        <input
          ref={inputRef}
          id={id}
          className="input"
          name={name}
          type={shown ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          required
          aria-invalid={invalid ? true : undefined}
          aria-describedby={`${id}-help ${id}-err`}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          className="toggle"
          aria-label={
            shown ? "Masquer le mot de passe" : "Afficher le mot de passe"
          }
          aria-pressed={shown}
          onClick={() => setShown((v) => !v)}
        >
          <Icon name={shown ? "eye-off" : "eye"} />
        </button>
      </span>
      {help ? (
        <span className="help" id={`${id}-help`}>
          {help}
        </span>
      ) : (
        <span id={`${id}-help`} hidden />
      )}
      {children}
      <span className="err-msg" id={`${id}-err`}>
        <Icon name="alert" />
        <span>{error}</span>
      </span>
    </div>
  );
}

/** Bascule clair/sombre des pages publiques : le choix est repris par le script d'amorçage. */
export function AuthThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const forced = root.getAttribute("data-theme");
    setDark(
      forced
        ? forced === "dark"
        : window.matchMedia("(prefers-color-scheme: dark)").matches,
    );
  }, []);
  const toggle = () => {
    const next = dark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    setDark(!dark);
    try {
      window.localStorage.setItem(
        PREFS_CACHE_KEY,
        JSON.stringify({ v: 1, user: 0, prefs: { theme: next }, pending: {} }),
      );
    } catch {
      /* stockage bloqué : le choix ne dure que pour cette page */
    }
  };
  return (
    <button
      type="button"
      className="btn btn--ghost btn--icon btn--sm"
      aria-label="Basculer le thème clair / sombre"
      onClick={toggle}
    >
      <Icon name={dark ? "sun" : "moon"} />
    </button>
  );
}

/** Bandeau d'erreur d'un formulaire (annoncé tout de suite aux lecteurs d'écran). */
export function FormAlert({
  title,
  detail,
}: {
  title: string;
  detail?: string;
}) {
  return (
    <div className="form-alert" role="alert" data-testid="form-alert">
      <Icon name="alert" />
      <div>
        <b>{title}</b>
        {detail ? (
          <>
            <br />
            <span>{detail}</span>
          </>
        ) : null}
      </div>
    </div>
  );
}
