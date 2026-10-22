/**
 * Documentation affichée dans l'atelier : liens, ancres, regroupement, lecture. Pur. La sécurité du
 * rendu repose sur deux règles tenues ici : jamais de HTML brut (le rendu Markdown l'interdit) et
 * jamais un lien dont la destination n'est pas connue (document de l'index, ancre, ou adresse
 * `http(s)` explicite) : tout le reste est affiché comme du texte.
 */
/** Un document tel que le navigateur le connaît : jamais son chemin de fichier. */
export type DocLink = {
  slug: string;
  title: string;
  section: string;
  summary?: string;
};

/** Nom de fichier (minuscules) → identifiant de page : sert à réécrire les liens `.md`. */
export type LinkMap = Readonly<Record<string, string>>;

const baseName = (path: string): string =>
  path.split("/").pop()?.toLowerCase() ?? "";

/** Construit la table de liens côté serveur, où les chemins sont connus. */
export function buildLinkMap(
  entries: readonly { slug: string; file: string }[],
): LinkMap {
  const map: Record<string, string> = {};
  for (const entry of entries) map[baseName(entry.file)] = entry.slug;
  return map;
}

const strip = (text: string): string =>
  text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Ancre d'un titre : minuscules, sans accent, tirets. « section » quand rien de latin ne reste. */
export function headingId(text: string): string {
  const id = strip(text)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return id || "section";
}

export type ResolvedLink =
  | { kind: "anchor"; href: string }
  | { kind: "external"; href: string }
  | { kind: "doc"; href: string }
  | { kind: "none" };

export function resolveDocLink(
  href: string | undefined,
  links: LinkMap,
): ResolvedLink {
  const value = (href ?? "").trim();
  if (!value) return { kind: "none" };
  if (value.startsWith("#")) return { kind: "anchor", href: value };
  if (/^https?:\/\//i.test(value)) return { kind: "external", href: value };
  // Tout autre schéma (javascript:, data:, mailto:…) ou adresse relative au protocole (//hôte) : refus.
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//"))
    return { kind: "none" };
  const [pathPart, anchor] = value.split("#");
  if (!pathPart.toLowerCase().endsWith(".md")) return { kind: "none" };
  const slug = links[baseName(pathPart)];
  if (!slug) return { kind: "none" };
  return { kind: "doc", href: `/docs/${slug}${anchor ? `#${anchor}` : ""}` };
}

export type DocGroup = { section: string; docs: DocLink[] };

/** Documents regroupés par section, dans l'ordre de l'index ; `query` filtre sur titre et résumé. */
export function groupDocs(docs: readonly DocLink[], query = ""): DocGroup[] {
  const needle = strip(query.trim());
  const groups: DocGroup[] = [];
  for (const doc of docs) {
    if (needle && !strip(`${doc.title} ${doc.summary ?? ""}`).includes(needle))
      continue;
    let group = groups.find((g) => g.section === doc.section);
    if (!group) groups.push((group = { section: doc.section, docs: [] }));
    group.docs.push(doc);
  }
  return groups;
}

export function siblings(
  docs: readonly DocLink[],
  slug: string,
): { prev: DocLink | null; next: DocLink | null } {
  const index = docs.findIndex((d) => d.slug === slug);
  if (index < 0) return { prev: null, next: null };
  return { prev: docs[index - 1] ?? null, next: docs[index + 1] ?? null };
}

/** Durée de lecture : ~200 mots par minute, blocs de code exclus, une minute au moins. */
export function readingMinutes(markdown: string): number {
  const words = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}
