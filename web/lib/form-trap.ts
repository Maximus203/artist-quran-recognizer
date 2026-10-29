import { audit } from "./audit";
import { BlockList } from "./blocklist";
import type { Db } from "./db";
import { checkForm } from "./honeypot";

/**
 * Verdict « robot » sur un formulaire. Un champ leurre rempli est un signal FORT (un humain ne le voit
 * pas) : refus silencieux, passage journalisé et adresse bloquée si elle est connue (durée croissante,
 * voir `blocklist.ts`). Un envoi trop rapide est un signal FAIBLE (un gestionnaire de mots de passe peut
 * remplir et valider en moins de 2 secondes) : refus silencieux et journal, MAIS aucun blocage. Rend
 * `true` quand il faut refuser : l'appelant répond comme pour un échec ordinaire, sans rien révéler.
 */
export function formTrapped(
  db: Db,
  ip: string,
  fields: Record<string, unknown>,
  now = Date.now(),
): boolean {
  const verdict = checkForm(fields, now);
  if (verdict.ok) return false;
  if (verdict.reason === "decoy_filled") {
    try {
      new BlockList(db).strike(ip, "formulaire leurre", now);
    } catch {
      /* sans base, le refus silencieux suffit */
    }
  }
  audit("honeypot.form", { ip, reason: verdict.reason });
  return true;
}
