import { pageVisibleTo, type PageId } from "@/lib/role-view";
import type { Role } from "@/lib/users";
import type { IconName } from "./icons";

/**
 * SOURCE UNIQUE des entrées de navigation de l'atelier. La barre du haut (bureau, tablette) et la
 * feuille du menu (téléphone) se construisent toutes deux depuis `navTree` : une page ajoutée ici
 * apparaît partout, pour le bon rôle, sans second endroit à tenir à jour (le test `nav-entries.test.ts`
 * le garantit). Pur : aucun accès aux données, la sécurité reste dans `access.ts` (le serveur refuse
 * quoi que l'interface affiche).
 */
export type AdminId = "admin-moteur" | "admin-comptes" | "admin-invitations";
export type NavLeafId = PageId | AdminId;

export type NavLeaf = {
  id: NavLeafId;
  href: string;
  label: string;
  icon: IconName;
};

export type NavNode =
  | ({ kind: "link" } & NavLeaf)
  | {
      kind: "group";
      id: "library" | "admin";
      label: string;
      icon: IconName;
      items: NavLeaf[];
    };

const PAGES: Record<PageId, NavLeaf> = {
  revue: { id: "revue", href: "/", label: "Lecture", icon: "wave" },
  sessions: {
    id: "sessions",
    href: "/sessions",
    label: "Récitations",
    icon: "list",
  },
  playlists: {
    id: "playlists",
    href: "/playlists",
    label: "Playlists",
    icon: "playlist",
  },
  downloads: {
    id: "downloads",
    href: "/telechargements",
    label: "Téléchargements",
    icon: "download",
  },
  perf: {
    id: "perf",
    href: "/performance",
    label: "Performance",
    icon: "gauge",
  },
  live: { id: "live", href: "/direct", label: "En direct", icon: "live" },
  docs: { id: "docs", href: "/docs", label: "Documentation", icon: "book" },
};

/** Les pages qui se rangent sous « Récitations » : la liste, les playlists, puis les téléchargements. */
const LIBRARY: PageId[] = ["sessions", "playlists", "downloads"];
/** Le reste, à plat, dans l'ordre de la barre. */
const FLAT_AFTER: PageId[] = ["perf", "live", "docs"];

/** Administration : réservée à l'administrateur. */
export const ADMIN_ITEMS: readonly NavLeaf[] = [
  {
    id: "admin-moteur",
    href: "/gestion/moteur",
    label: "Moteur",
    icon: "live",
  },
  {
    id: "admin-comptes",
    href: "/gestion/comptes",
    label: "Comptes",
    icon: "users",
  },
  {
    id: "admin-invitations",
    href: "/gestion/invitations",
    label: "Invitations",
    icon: "key",
  },
];

const leaf = (id: PageId): NavNode => ({ kind: "link", ...PAGES[id] });

/** L'arbre de navigation d'un rôle, dans l'ordre d'affichage. */
export function navTree(role: Role): NavNode[] {
  const visible = (id: PageId) => pageVisibleTo(role, id);
  const nodes: NavNode[] = [];
  if (visible("revue")) nodes.push(leaf("revue"));
  const library = LIBRARY.filter(visible).map((id) => PAGES[id]);
  if (library.length > 0)
    nodes.push({
      kind: "group",
      id: "library",
      label: "Récitations",
      icon: "list",
      items: library,
    });
  for (const id of FLAT_AFTER) if (visible(id)) nodes.push(leaf(id));
  if (role === "admin")
    nodes.push({
      kind: "group",
      id: "admin",
      label: "Administration",
      icon: "shield",
      items: [...ADMIN_ITEMS],
    });
  return nodes;
}

/**
 * Cette entrée est-elle la page courante ? `active` est l'identifiant de page de l'en-tête ; sur les
 * pages d'administration (`"admin"`), `activeAdmin` précise la section (moteur par défaut).
 */
export const isCurrent = (
  entry: NavLeaf,
  active: string,
  activeAdmin?: string,
): boolean =>
  entry.id === active ||
  (active === "admin" && entry.id === (activeAdmin ?? "admin-moteur"));

/** Toutes les pages atteignables (les groupes déployés), dans l'ordre. */
export const navLeaves = (tree: readonly NavNode[]): NavLeaf[] =>
  tree.flatMap((node) => (node.kind === "group" ? node.items : [node]));
