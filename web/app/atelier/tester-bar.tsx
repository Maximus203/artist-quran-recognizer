"use client";
import { useEffect, useRef, useState } from "react";
import { initialOf, validateTester } from "@/lib/tester";

type Props = {
  tester: string | null;
  recent: readonly string[];
  onTester: (name: string) => void;
  /** Quand un geste de revue exige un testeur, le champ prend le focus. */
  focusSignal: number;
};

/** « Qui teste ? » : un pseudonyme libre, mémorisé, joint à chaque signalement. */
export function TesterBar({ tester, recent, onTester, focusSignal }: Props) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(tester ?? "");
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const open = !tester || editing;
  useEffect(() => {
    if (open && focusSignal > 0) input.current?.focus();
  }, [focusSignal, open]);
  const submit = (candidate: string) => {
    const check = validateTester(candidate);
    if (!check.ok) {
      setError(check.message);
      input.current?.focus();
      return;
    }
    setError("");
    setEditing(false);
    setValue(check.value);
    onTester(check.value);
  };
  if (!open)
    return (
      <section className="tester" aria-label="Testeur" data-testid="tester">
        <div className="tester-row">
          <span className="av" aria-hidden="true">
            {initialOf(tester)}
          </span>
          <div className="who">
            <span className="eyebrow">Testeur</span>
            <b data-testid="tester-name">{tester}</b>
          </div>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            data-testid="tester-change"
            onClick={() => {
              setValue(tester);
              setEditing(true);
            }}
          >
            Changer
          </button>
        </div>
      </section>
    );
  const others = recent.filter((name) => name !== tester).slice(0, 5);
  return (
    <section className="tester" aria-label="Testeur" data-testid="tester">
      <form
        className="tester-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit(value);
        }}
      >
        <label className="field">
          <span>Qui teste ?</span>
          <input
            ref={input}
            className="input"
            data-testid="tester-input"
            maxLength={24}
            autoComplete="off"
            placeholder="Ton pseudonyme, ex. awa-tel"
            value={value}
            aria-describedby="tester-help tester-err"
            aria-invalid={error ? true : undefined}
            onChange={(event) => {
              setValue(event.target.value);
              if (error) setError("");
            }}
          />
        </label>
        <p className="hint hint--xs" id="tester-help">
          Un pseudonyme suffit : ni nom complet, ni e-mail. Il est joint à
          chacun de tes signalements et gardé dans ce navigateur.
        </p>
        <p
          className="err"
          id="tester-err"
          role="alert"
          data-testid="tester-error"
        >
          {error}
        </p>
        {others.length > 0 ? (
          <div>
            <span className="eyebrow">Testeurs récents sur cet appareil</span>
            <div className="recent">
              {others.map((name) => (
                <button
                  key={name}
                  type="button"
                  className="chip"
                  data-testid="tester-recent"
                  onClick={() => submit(name)}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="btnrow">
          <button
            type="submit"
            className="btn btn--primary"
            data-testid="tester-submit"
          >
            {tester ? "Enregistrer" : "Commencer"}
          </button>
          {tester ? (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                setEditing(false);
                setError("");
              }}
            >
              Annuler
            </button>
          ) : null}
        </div>
      </form>
    </section>
  );
}
