"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon, type IconName } from "./icons";
import { useShell } from "./shell";

export type AccountTab = "preferences" | "statistiques" | "securite" | "api";

const TABS: { id: AccountTab; href: string; label: string; icon: IconName }[] =
  [
    {
      id: "preferences",
      href: "/compte",
      label: "Préférences",
      icon: "sliders",
    },
    {
      id: "statistiques",
      href: "/compte/statistiques",
      label: "Statistiques",
      icon: "chart",
    },
    {
      id: "securite",
      href: "/compte/securite",
      label: "Sécurité",
      icon: "shield",
    },
    {
      id: "api",
      href: "/compte/api",
      label: "API & MCP",
      icon: "code",
    },
  ];

/**
 * Pastille d'enregistrement : « Enregistrement… » seulement si l'envoi dure, « Enregistré » 2,4 s,
 * puis rien. En cas d'échec elle reste, avec « Réessayer ». Région `role="status"` toujours présente.
 */
function Autosave() {
  const { status, retry } = useShell();
  const [text, setText] = useState("");
  const [kind, setKind] = useState<"" | "ok" | "err">("");
  useEffect(() => {
    if (status === "saving") {
      const timer = setTimeout(() => {
        setText("Enregistrement…");
        setKind("");
      }, 600);
      return () => clearTimeout(timer);
    }
    if (status === "saved") {
      setText("Enregistré");
      setKind("ok");
      const timer = setTimeout(() => setText(""), 2400);
      return () => clearTimeout(timer);
    }
    if (status === "error") {
      setText("Non enregistré");
      setKind("err");
      return;
    }
    setText("");
  }, [status]);
  return (
    <div className="autosave-wrap">
      <div
        className="autosave"
        role="status"
        aria-live="polite"
        data-testid="autosave"
        data-show={text !== ""}
        data-kind={kind}
      >
        {text ? (
          <>
            <Icon
              name={
                kind === "ok" ? "check" : kind === "err" ? "alert" : "refresh"
              }
            />
            <span>{text}</span>
            {kind === "err" ? (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={retry}
              >
                Réessayer
              </button>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

/** Cadre de la page Compte : titre, sections (Préférences · Statistiques · Sécurité) et contenu. */
export function AccountFrame({
  tab,
  children,
}: {
  tab: AccountTab;
  children: React.ReactNode;
}) {
  return (
    <div className="page" style={{ maxWidth: 1080 }} data-testid="account-page">
      <div className="pg-title">
        <div>
          <h1>Compte</h1>
          <p>
            Tes préférences, tes chiffres, ta sécurité et l’accès des
            applications.
          </p>
        </div>
      </div>
      <Autosave />
      <div className="acct-layout">
        <nav className="subnav" aria-label="Sections du compte">
          {TABS.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              data-testid={`account-tab-${item.id}`}
              aria-current={tab === item.id ? "page" : undefined}
            >
              <Icon name={item.icon} />
              {item.label}
            </Link>
          ))}
        </nav>
        <div style={{ display: "grid", gap: "var(--sp-5)", minWidth: 0 }}>
          {children}
        </div>
      </div>
    </div>
  );
}
