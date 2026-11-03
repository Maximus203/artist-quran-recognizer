"use client";
import {
  Children,
  isValidElement,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { headingId, resolveDocLink, type LinkMap } from "@/lib/docs-view";
import { Icon } from "./icons";

/** Texte brut d'un arbre React (titres, blocs de code). */
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node))
    return textOf((node.props as { children?: ReactNode }).children);
  return "";
}

const BOX_DRAWING = /[─│┌┐└┘├┤┬┴┼═║╔╗╚╝▶▼▲◀]/;

function CodeBlock({ children }: { children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const code = Children.toArray(children).find(isValidElement);
  const className =
    (code?.props as { className?: string } | undefined)?.className ?? "";
  const language = /language-([\w-]+)/.exec(className)?.[1] ?? "";
  const text = textOf(children).replace(/\n$/, "");
  const diagram =
    language === "text" || language === "diagram" || BOX_DRAWING.test(text);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* presse-papiers refusé : rien à faire de plus */
    }
  };
  return (
    <div className="codebox">
      <header>
        <span>{diagram ? "schéma" : language || "code"}</span>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          style={{ marginLeft: "auto" }}
          onClick={() => void copy()}
          aria-label="Copier le code"
        >
          <Icon name={copied ? "check" : "copy"} size={16} />
          <span aria-live="polite">{copied ? "Copié" : "Copier"}</span>
        </button>
      </header>
      <pre
        className={diagram ? "diagram" : undefined}
        tabIndex={0}
        aria-label={diagram ? "Schéma" : "Bloc de code"}
      >
        {children}
      </pre>
    </div>
  );
}

/**
 * Rendu Markdown sûr de la documentation : GFM, JAMAIS de HTML brut, aucune image distante, et un
 * lien n'existe que si sa destination est connue (ancre, document de l'index, adresse `http(s)`).
 * Les titres reçoivent une ancre stable ; chaque tableau reçoit un nom accessible unique.
 */
export function Markdown({
  source,
  links,
  headings = true,
}: {
  source: string;
  links: LinkMap;
  /** Faux pour un court récit (notes de version) : pas d'ancres sur les titres. */
  headings?: boolean;
}) {
  // L'arbre rendu est mémorisé : un changement de l'état du parent (sommaire, survol) ne le
  // reconstruit pas, donc les titres gardent leurs éléments (suivi de lecture, ancres).
  return useMemo(() => {
    // Compteurs propres à ce rendu : l'ordre de rendu est celui du document.
    const seen = new Map<string, number>();
    let tables = 0;
    let lastHeading = "";
    const anchored = (level: 1 | 2 | 3) =>
      function Heading({ children }: { children?: ReactNode }) {
        const text = textOf(children);
        lastHeading = text;
        const base = headingId(text);
        const n = seen.get(base) ?? 0;
        seen.set(base, n + 1);
        const id = n === 0 ? base : `${base}-${n + 1}`;
        const Tag = `h${level}` as "h1" | "h2" | "h3";
        return (
          <Tag id={headings ? id : undefined}>
            {children}
            {headings && level > 1 ? (
              <a
                className="anchor"
                href={`#${id}`}
                aria-label={`Lien vers la section : ${text}`}
              >
                #
              </a>
            ) : null}
          </Tag>
        );
      };

    const components: Components = {
      h1: anchored(1),
      h2: anchored(2),
      h3: anchored(3),
      a({ href, children }) {
        const link = resolveDocLink(href, links);
        if (link.kind === "none") return <span>{children}</span>;
        if (link.kind === "external")
          return (
            <a href={link.href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          );
        return <a href={link.href}>{children}</a>;
      },
      // Aucune image distante (vie privée, hors ligne) : on garde le texte alternatif.
      img({ alt }) {
        return <span className="muted">[image{alt ? ` : ${alt}` : ""}]</span>;
      },
      pre({ children }) {
        return <CodeBlock>{children}</CodeBlock>;
      },
      table({ children }) {
        tables += 1;
        return (
          <div
            className="tbl"
            tabIndex={0}
            role="region"
            aria-label={`Tableau ${tables}${lastHeading ? ` : ${lastHeading}` : ""}`}
          >
            <table>{children}</table>
          </div>
        );
      },
    };

    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={components}
        skipHtml
      >
        {source}
      </ReactMarkdown>
    );
  }, [source, links, headings]);
}
