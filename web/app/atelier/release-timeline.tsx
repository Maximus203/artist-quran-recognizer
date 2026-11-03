"use client";
import { useMemo, useState } from "react";
import type { LinkMap } from "@/lib/docs-view";
import {
  RELEASE_TAG_LABELS,
  RELEASE_TAGS,
  parseReleaseNotes,
  pullRequestUrl,
  type ReleaseEntry,
  type ReleaseTag,
} from "@/lib/release-notes";
import { Icon, type IconName } from "./icons";
import { Markdown } from "./markdown";

const TAG_UI: Record<ReleaseTag, { icon: IconName; className: string }> = {
  utilisateur: { icon: "user", className: "tag tag--user" },
  technique: { icon: "code", className: "tag tag--tech" },
  decision: { icon: "signpost", className: "tag tag--decision" },
};

const MONTHS = [
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
];

const monthOf = (date: string): string => {
  const [year, month] = date.split("-").map(Number);
  return `${MONTHS[(month ?? 1) - 1] ?? date} ${year}`;
};
const dayLabel = (date: string): string =>
  new Date(`${date}T12:00:00`).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
  });

/** Notes de version : chronologie verticale, filtrable par type (utilisateur, technique, décision). */
export function ReleaseTimeline({
  markdown,
  repoUrl,
  links,
}: {
  markdown: string;
  repoUrl: string;
  links: LinkMap;
}) {
  const entries = useMemo(() => parseReleaseNotes(markdown), [markdown]);
  const [filter, setFilter] = useState<"all" | ReleaseTag>("all");
  const counts = useMemo(() => {
    const result: Record<"all" | ReleaseTag, number> = {
      all: entries.length,
      utilisateur: 0,
      technique: 0,
      decision: 0,
    };
    for (const entry of entries) for (const tag of entry.tags) result[tag] += 1;
    return result;
  }, [entries]);
  const shown = entries.filter(
    (entry) => filter === "all" || entry.tags.includes(filter),
  );
  const months: { month: string; entries: ReleaseEntry[] }[] = [];
  for (const entry of shown) {
    const month = monthOf(entry.date);
    const last = months[months.length - 1];
    if (last && last.month === month) last.entries.push(entry);
    else months.push({ month, entries: [entry] });
  }

  return (
    <>
      <h1>Notes de version</h1>
      <p className="lead">
        Ce qui change dans l’atelier, du plus récent au plus ancien. Filtre par
        type pour ne garder que ce qui te concerne.
      </p>
      <div className="rn-filters" role="group" aria-label="Filtrer par type">
        {(["all", ...RELEASE_TAGS] as const).map((tag) => (
          <button
            key={tag}
            className="chip"
            type="button"
            data-testid={`rn-filter-${tag}`}
            aria-pressed={filter === tag}
            onClick={() => setFilter(tag)}
          >
            {tag === "all" ? "Tout" : RELEASE_TAG_LABELS[tag]}{" "}
            <span className="n">{counts[tag]}</span>
          </button>
        ))}
      </div>
      <p className="sr" role="status" aria-live="polite">
        {shown.length} entrée{shown.length > 1 ? "s" : ""} affichée
        {shown.length > 1 ? "s" : ""}
      </p>
      {shown.length === 0 ? (
        <p className="hint" data-testid="rn-empty">
          Aucune note de version pour ce filtre.
        </p>
      ) : null}
      {months.map((group) => (
        <section key={group.month}>
          <div className="rn-month">
            <h2 style={{ border: 0, padding: 0, margin: 0 }}>{group.month}</h2>
          </div>
          <ol className="rn" data-testid="rn-list">
            {group.entries.map((entry, index) => (
              <li
                key={`${entry.date}-${index}-${entry.title}`}
                data-testid="rn-entry"
                data-tags={entry.tags.join(" ")}
              >
                <time dateTime={entry.date}>{dayLabel(entry.date)}</time>
                <div className="rn-card">
                  <h3>{entry.title}</h3>
                  {entry.tags.length > 0 ? (
                    <div className="tags" aria-label="Étiquettes">
                      {entry.tags.map((tag) => (
                        <span key={tag} className={TAG_UI[tag].className}>
                          <Icon name={TAG_UI[tag].icon} />
                          {RELEASE_TAG_LABELS[tag]}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <Markdown
                    source={entry.body}
                    links={links}
                    headings={false}
                  />
                  {entry.prs.length > 0 ? (
                    <div className="rn-foot">
                      {entry.prs.map((pr) => (
                        <a
                          key={pr}
                          className="pr"
                          href={pullRequestUrl(repoUrl, pr)}
                          target="_blank"
                          rel="noopener noreferrer"
                          data-testid="rn-pr"
                        >
                          <Icon name="branch" />
                          Demande de fusion n° {pr}
                        </a>
                      ))}
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </>
  );
}
