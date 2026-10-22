import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadDocsIndex, readDoc, summarize } from "./docs";
import { REPO } from "./store";

let repo: string;
let outside: string;
beforeEach(async () => {
  repo = await mkdtemp(path.join(os.tmpdir(), "aqr-docs-"));
  outside = await mkdtemp(path.join(os.tmpdir(), "aqr-outside-"));
  await mkdir(path.join(repo, "docs"), { recursive: true });
  await mkdir(path.join(repo, ".claude"), { recursive: true });
  await writeFile(path.join(repo, "docs", "ARCH.md"), "# Architecture");
  await writeFile(path.join(repo, "README.md"), "# Racine");
  await writeFile(path.join(repo, ".claude", "secret.md"), "SECRET");
  await writeFile(path.join(outside, "dehors.md"), "DEHORS");
  await writeFile(path.join(repo, "docs", "notes.txt"), "pas du markdown");
});
afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

const index = (entries: unknown) =>
  writeFile(
    path.join(repo, "docs", "docs-index.json"),
    JSON.stringify(entries),
  );
const entry = (slug: string, file: string) => ({
  slug,
  title: `Titre ${slug}`,
  section: "Section",
  file,
});

describe("documentation servie (liste blanche)", () => {
  it("sert un document de l'index, relatif à la racine ou à docs/", async () => {
    await index([
      entry("arch", "docs/ARCH.md"),
      entry("racine", "README.md"),
      entry("court", "ARCH.md"),
    ]);
    expect(await readDoc("arch", repo)).toBe("# Architecture");
    expect(await readDoc("racine", repo)).toBe("# Racine");
    expect(await readDoc("court", repo)).toBe("# Architecture");
  });

  it("ne liste jamais le chemin du fichier", async () => {
    await index([entry("arch", "docs/ARCH.md")]);
    expect((await loadDocsIndex(repo)).map(summarize)).toEqual([
      { slug: "arch", title: "Titre arch", section: "Section" },
    ]);
  });

  it("404 (null) pour un slug hors de l'index, mal formé ou piégé", async () => {
    await index([entry("arch", "docs/ARCH.md")]);
    for (const slug of [
      "autre",
      "../docs/ARCH",
      "arch/../../x",
      "ARCH",
      "",
      "a".repeat(80),
      "arch.md",
      "%2e%2e",
    ])
      expect(await readDoc(slug, repo), slug).toBeNull();
  });

  it("refuse dans l'index les chemins dangereux", async () => {
    await index([
      entry("a", "../x.md"),
      entry("b", "/etc/passwd.md"),
      entry("c", "docs/../../x.md"),
      entry("d", "docs\\ARCH.md"),
      entry("e", ".claude/secret.md"),
      entry("f", "docs/notes.txt"),
      entry("g", "C:/Windows/x.md"),
      entry("h", "docs//ARCH.md"),
      entry("ok", "docs/ARCH.md"),
    ]);
    const slugs = (await loadDocsIndex(repo)).map((e) => e.slug);
    expect(slugs).toEqual(["ok"]);
    expect(await readDoc("e", repo)).toBeNull();
  });

  it("ignore les doublons de slug et les entrées incomplètes", async () => {
    await index([
      entry("arch", "docs/ARCH.md"),
      entry("arch", "README.md"),
      { slug: "x" },
      "bizarre",
      null,
    ]);
    expect(await loadDocsIndex(repo)).toHaveLength(1);
    expect(await readDoc("arch", repo)).toBe("# Architecture");
  });

  it("renvoie un index vide sans fichier d'index ou avec un JSON invalide", async () => {
    expect(await loadDocsIndex(repo)).toEqual([]);
    await writeFile(path.join(repo, "docs", "docs-index.json"), "{pas du json");
    expect(await loadDocsIndex(repo)).toEqual([]);
    await index({ pas: "un tableau" });
    expect(await loadDocsIndex(repo)).toEqual([]);
  });

  it("un fichier déclaré mais absent donne null", async () => {
    await index([entry("fantome", "docs/ABSENT.md")]);
    expect(await readDoc("fantome", repo)).toBeNull();
  });

  it("refuse un lien symbolique qui sort du dépôt", async () => {
    try {
      await symlink(
        path.join(outside, "dehors.md"),
        path.join(repo, "docs", "lien.md"),
      );
    } catch {
      return; // création de liens non permise sur cette machine : cas non testable ici
    }
    await index([entry("lien", "docs/lien.md")]);
    expect(await readDoc("lien", repo)).toBeNull();
  });
});

// Garde-fou : l index réellement versionné doit rester servable par l API (chaque entrée valide et lisible).
describe("docs/docs-index.json du dépôt", () => {
  it("est entièrement accepté par la liste blanche et chaque document se lit", async () => {
    const raw = JSON.parse(
      await readFile(path.join(REPO, "docs", "docs-index.json"), "utf8"),
    ) as unknown[];
    const entries = await loadDocsIndex();
    expect(entries).toHaveLength(raw.length);
    for (const item of entries) {
      const text = await readDoc(item.slug);
      expect(text, item.slug).not.toBeNull();
      expect((text as string).length, item.slug).toBeGreaterThan(0);
    }
  });
});
