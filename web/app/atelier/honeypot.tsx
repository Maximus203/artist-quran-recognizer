"use client";
import { useRef } from "react";

/**
 * Champ leurre des formulaires de connexion et d'inscription : invisible et inaccessible au clavier
 * pour un humain, mais rempli par un robot qui remplit tout. Avec le jeton d'horodatage signé par le
 * serveur (`issueFormToken`), il permet de refuser en silence un formulaire rempli par un automate ou
 * envoyé moins de 2 secondes après son affichage. À glisser dans le `<form>` ; `fields()` donne ce qu'il
 * faut ajouter au corps JSON.
 */
export function useHoneypot(token: string) {
  const ref = useRef<HTMLInputElement>(null);
  const node = (
    <div className="hp" aria-hidden="true">
      <label>
        Ne pas remplir ce champ
        <input
          ref={ref}
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          defaultValue=""
        />
      </label>
    </div>
  );
  const fields = () => ({ website: ref.current?.value ?? "", _t: token });
  return { node, fields };
}
