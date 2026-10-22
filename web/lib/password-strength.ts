/**
 * Jauge de mot de passe de l'inscription : sobre (trois crans et un libellé), sans rouge-vert.
 * Elle AIDE ; la règle qui s'impose est celle du serveur (10 à 128 caractères, différent du
 * pseudonyme). Pur.
 */
export const PASSWORD_MIN_LENGTH = 10;

export type Strength = {
  /** 0 = rien ou trop faible, 1 = acceptable, 2 = bon, 3 = solide. */
  level: 0 | 1 | 2 | 3;
  label: string;
};

export const missingCharacters = (password: string): number =>
  Math.max(0, PASSWORD_MIN_LENGTH - password.length);

const classes = (password: string): number =>
  [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password))
    .length;

export function passwordStrength(password: string, username: string): Strength {
  if (!password) return { level: 0, label: "" };
  if (password.trim().toLowerCase() === username.trim().toLowerCase())
    return { level: 0, label: "Identique au pseudonyme" };
  if (password.length < PASSWORD_MIN_LENGTH)
    return {
      level: 0,
      label: `Trop court (${password.length}/${PASSWORD_MIN_LENGTH})`,
    };
  const words = password.trim().split(/\s+/).filter(Boolean).length;
  if (
    password.length >= 16 ||
    (password.length >= 12 && classes(password) >= 3) ||
    words >= 3
  )
    return { level: 3, label: "Solide" };
  if (password.length >= 12) return { level: 2, label: "Bon" };
  return { level: 1, label: "Acceptable" };
}
