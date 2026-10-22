"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  groupDocs,
  readingMinutes,
  siblings,
  type DocLink,
  type LinkMap,
} from "@/lib/docs-view";
import { Icon } from "./icons";
import { Markdown } from "./markdown";
import { ReleaseTimeline } from "./release-timeline";
import { useFocusTrap, useMedia } from "./hooks";
import { useShell } from "./shell";

type Props = {
  docs: DocLink[];
  links: LinkMap;
  /** Document ouvert ; null = page d'accueil de la documentation. */
  current: { doc: DocLink; markdown: string } | null;
};

function DocsNav({
  docs,
  slug,
  query,
  onQuery,
  onNavigate,
}: {
  docs: DocLink[];
  slug: string | null;
  query: string;
  onQuery: (value: string) => void;
  onNavigate?: () => void;
}) {
  const groups = useMemo(() => groupDocs(docs, query), [docs, query]);
  return (
    <div className="docs-nav-inner">
      <div className="search">
        <Icon name="search" />
        <input
          className="input"
          type="search"
          placeholder="Filtrer les documents…"
          aria-label="Filtrer les documents"
          data-testid="docs-filter"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
        />
      </div>
      {groups.length === 0 ? (
        <p className="hint" role="status">
          Aucun document ne correspond.
        </p>
      ) : (
        groups.map((group) => (
          <div className="dgroup" key={group.section}>
            <h2 className="eyebrow">{group.section}</h2>
            {group.docs.map((doc) => (
              <Link
                key={doc.slug}
                className="dlink"
                href={`/docs/${doc.slug}`}
                data-testid="docs-link"
                data-slug={doc.slug}
                aria-current={doc.slug === slug ? "page" : undefined}
                onClick={onNavigate}
              >
                <span className="nm">{doc.title}</span>
              </Link>
            ))}
          </div>
        ))
      )}
    </div>
  );
}

type Heading = { id: string; text: string; level: 2 | 3 };

/** Sommaire de la page, relevé dans le document rendu, avec suivi de lecture. */
function useToc(rootRef: React.RefObject<HTMLElement | null>, key: string) {
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [activeId, setActiveId] = useState("");
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const nodes = Array.from(
      root.querySelectorAll<HTMLElement>("h2[id], h3[id]"),
    );
    setHeadings(
      nodes.map((node) => ({
        id: node.id,
        // le texte du titre sans le « # » d'ancre
        text: (node.firstChild?.textContent ?? node.textContent ?? "").trim(),
        level: node.tagName === "H2" ? 2 : 3,
      })),
    );
    setActiveId(nodes[0]?.id ?? "");
    if (nodes.length === 0 || typeof IntersectionObserver === "undefined")
      return;
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        const first = nodes.find((node) => visible.has(node.id));
        if (first) setActiveId(first.id);
      },
      { rootMargin: "-72px 0px -65% 0px" },
    );
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [rootRef, key]);
  return { headings, activeId };
}

function TocList({
  headings,
  activeId,
}: {
  headings: Heading[];
  activeId: string;
}) {
  return (
    <>
      {headings.map((heading) => (
        <a
          key={heading.id}
          href={`#${heading.id}`}
          className={heading.level === 3 ? "l3" : undefined}
          aria-current={heading.id === activeId ? "true" : undefined}
        >
          {heading.text}
        </a>
      ))}
    </>
  );
}

/** La documentation : navigation par document, texte, sommaire « Sur cette page ». */
export function DocsShell({ docs, links, current }: Props) {
  const { repoUrl } = useShell();
  const [query, setQuery] = useState("");
  const [drawer, setDrawer] = useState(false);
  const wide = useMedia("(min-width: 1024px)");
  const article = useRef<HTMLElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const pick = useRef<HTMLButtonElement>(null);
  const slug = current?.doc.slug ?? null;
  const isNotes = slug === "release-notes";
  const { headings, activeId } = useToc(article, `${slug}`);
  const { prev, next } = slug
    ? siblings(docs, slug)
    : { prev: null, next: null };
  const close = () => setDrawer(false);
  useFocusTrap(drawerRef, drawer && !wide, close, pick);
  useEffect(() => {
    if (wide) setDrawer(false);
  }, [wide]);
  useEffect(() => {
    document.title = current
      ? `${current.doc.title} · Documentation`
      : "Documentation · Atelier de revue";
  }, [current]);

  return (
    <div className="docs" data-testid="docs">
      <aside className="docs-nav" aria-label="Documents">
        <DocsNav docs={docs} slug={slug} query={query} onQuery={setQuery} />
      </aside>
      <div
        className="drawer-docs"
        data-open={drawer && !wide}
        ref={drawerRef}
        role={drawer && !wide ? "dialog" : undefined}
        aria-label="Documents"
        aria-modal={drawer && !wide ? true : undefined}
        tabIndex={-1}
      >
        {drawer && !wide ? (
          <aside className="docs-nav" aria-label="Documents">
            <DocsNav
              docs={docs}
              slug={slug}
              query={query}
              onQuery={setQuery}
              onNavigate={close}
            />
          </aside>
        ) : null}
      </div>
      {drawer && !wide ? (
        <div className="sheet-scrim" aria-hidden="true" onClick={close} />
      ) : null}

      <main className="docs-main" id="docs-main">
        <div className="docs-top">
          <nav className="crumbs" aria-label="Fil d’Ariane">
            <Link href="/docs">Documentation</Link>
            {current ? (
              <>
                <Icon name="chevron-r" />
                <span>{current.doc.section}</span>
                <Icon name="chevron-r" />
                <span aria-current="page">{current.doc.title}</span>
              </>
            ) : null}
          </nav>
          <button
            ref={pick}
            className="btn btn--secondary btn--sm docs-pick"
            type="button"
            aria-haspopup="dialog"
            aria-expanded={drawer}
            onClick={() => setDrawer(true)}
          >
            <Icon name="book" />
            Documents
            <Icon name="chevron-d" />
          </button>
        </div>

        {current && headings.length > 0 && !isNotes ? (
          <details className="toc-m">
            <summary>Sur cette page</summary>
            <ol className="toc-list">
              <TocList headings={headings} activeId={activeId} />
            </ol>
          </details>
        ) : null}

        {current ? (
          <article ref={article} className="prose doc" data-slug={slug ?? ""}>
            {isNotes ? (
              <ReleaseTimeline
                markdown={current.markdown}
                repoUrl={repoUrl}
                links={links}
              />
            ) : (
              <>
                <div className="meta-line">
                  <span>{current.doc.section}</span>
                  <span>
                    ≈ {readingMinutes(current.markdown)} min de lecture
                  </span>
                </div>
                <Markdown source={current.markdown} links={links} />
              </>
            )}
          </article>
        ) : (
          <article className="prose" data-testid="docs-home">
            <h1>Documentation</h1>
            <p className="lead">
              Comment fonctionne le système, ce qui a changé, et pourquoi.
              Choisis un document.
            </p>
            {groupDocs(docs).map((group) => (
              <section key={group.section}>
                <h2>{group.section}</h2>
                <ul>
                  {group.docs.map((doc) => (
                    <li key={doc.slug}>
                      <Link href={`/docs/${doc.slug}`}>{doc.title}</Link>
                      {doc.summary ? <> — {doc.summary}</> : null}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </article>
        )}

        {current && (prev || next) ? (
          <nav className="pn" aria-label="Documents voisins">
            {prev ? (
              <Link href={`/docs/${prev.slug}`} className="prev">
                <small>Précédent</small>
                <b>{prev.title}</b>
              </Link>
            ) : (
              <span />
            )}
            {next ? (
              <Link href={`/docs/${next.slug}`} className="next">
                <small>Suivant</small>
                <b>{next.title}</b>
              </Link>
            ) : null}
          </nav>
        ) : null}
      </main>

      {current && headings.length > 0 && !isNotes ? (
        <aside className="docs-toc" aria-label="Sur cette page">
          <span className="eyebrow">Sur cette page</span>
          <nav className="toc-list">
            <TocList headings={headings} activeId={activeId} />
          </nav>
        </aside>
      ) : null}
    </div>
  );
}
