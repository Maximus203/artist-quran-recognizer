import type { Db } from "./db";
import { transaction } from "./db";
import { log } from "./log";
import {
  PREFERENCE_DEFAULTS,
  preferencesShape as shape,
  type PreferenceKey,
  type Preferences,
  type PreferencesPatch,
} from "./preferences-schema";

/**
 * Lecture et écriture serveur des préférences d'un utilisateur. Le schéma, les types et les valeurs
 * par défaut vivent dans `preferences-schema.ts` (importable par le navigateur, sans accès base) ;
 * ils sont ré-exportés ici pour que le serveur garde un point d'entrée unique.
 */
export * from "./preferences-schema";

export type PreferencesView = {
  /** Valeurs effectives : choix de l'utilisateur, sinon défaut. */
  preferences: Preferences;
  /** Dernière modification de chaque clé réellement choisie (ISO). Absente = valeur par défaut. */
  updated_at: Partial<Record<PreferenceKey, string>>;
  defaults: Preferences;
};

export function readPreferences(db: Db, userId: number): PreferencesView {
  const rows = db
    .prepare("SELECT key, value, updated_at FROM preferences WHERE user_id = ?")
    .all(userId) as Array<{ key: string; value: string; updated_at: string }>;
  const preferences: Preferences = structuredClone(PREFERENCE_DEFAULTS);
  const updated_at: PreferencesView["updated_at"] = {};
  for (const row of rows) {
    if (!(row.key in shape)) continue; // clé retirée depuis : ignorée
    const key = row.key as PreferenceKey;
    // Jamais fiable : une valeur corrompue ou devenue invalide retombe sur le défaut.
    const parsed = shape[key].safeParse(safeJson(row.value));
    if (!parsed.success) {
      log.warn("preferences", `valeur invalide ignorée pour « ${key} »`);
      continue;
    }
    (preferences as Record<string, unknown>)[key] = parsed.data;
    updated_at[key] = row.updated_at;
  }
  return {
    preferences,
    updated_at,
    defaults: structuredClone(PREFERENCE_DEFAULTS),
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Fusion partielle : seules les clés fournies changent, chacune avec son propre horodatage. */
export function patchPreferences(
  db: Db,
  userId: number,
  patch: PreferencesPatch,
  now = new Date().toISOString(),
): PreferencesView {
  transaction(db, () => {
    const statement = db.prepare(
      `INSERT INTO preferences (user_id, key, value, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    );
    for (const [key, value] of Object.entries(patch))
      if (value !== undefined)
        statement.run(userId, key, JSON.stringify(value), now);
  });
  return readPreferences(db, userId);
}

/** Remet une clé (ou toutes) à sa valeur par défaut. */
export function resetPreferences(
  db: Db,
  userId: number,
  key?: PreferenceKey,
): PreferencesView {
  if (key)
    db.prepare("DELETE FROM preferences WHERE user_id = ? AND key = ?").run(
      userId,
      key,
    );
  else db.prepare("DELETE FROM preferences WHERE user_id = ?").run(userId);
  return readPreferences(db, userId);
}
