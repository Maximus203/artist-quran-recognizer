"use client";
import { modeLabel, type LiveMode } from "@/lib/live-mode";
import { SURAH_NAMES } from "@/lib/surahs";

/**
 * Choix du mode d'écoute, avant de démarrer : « Récitation guidée » (on annonce la sourate : le moteur
 * ne cherche que dans celle-ci et enchaîne les versets suivants, bien plus fiable) ou « Écoute
 * classique » (le moteur cherche dans tout le Coran). Pendant l'écoute, le choix est figé et rappelé.
 */
export function ModePicker({
  mode,
  onChange,
  locked,
}: {
  mode: LiveMode;
  onChange: (next: LiveMode) => void;
  locked: boolean;
}) {
  if (locked)
    return (
      <p className="lv-mode-locked" data-testid="live-mode-locked">
        {modeLabel(mode)}
      </p>
    );
  return (
    <section
      className="lv-mode"
      aria-label="Mode d’écoute"
      data-testid="live-mode"
    >
      <div
        className="lv-mode-tabs"
        role="radiogroup"
        aria-label="Mode d’écoute"
      >
        <button
          type="button"
          role="radio"
          aria-checked={mode.kind === "guided"}
          data-testid="live-mode-guided"
          className={mode.kind === "guided" ? "is-active" : undefined}
          onClick={() =>
            onChange({
              kind: "guided",
              surah: mode.kind === "guided" ? mode.surah : null,
            })
          }
        >
          <b>Récitation guidée</b>
          <small>Tu choisis la sourate : plus fiable</small>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={mode.kind === "classic"}
          data-testid="live-mode-classic"
          className={mode.kind === "classic" ? "is-active" : undefined}
          onClick={() => onChange({ kind: "classic" })}
        >
          <b>Écoute classique</b>
          <small>Le moteur cherche dans tout le Coran</small>
        </button>
      </div>
      {mode.kind === "guided" ? (
        <label className="lv-mode-surah">
          <span>Sourate que tu vas réciter</span>
          <select
            value={mode.surah ?? ""}
            data-testid="live-mode-surah"
            onChange={(event) =>
              onChange({
                kind: "guided",
                surah: event.target.value ? Number(event.target.value) : null,
              })
            }
          >
            <option value="">Choisir une sourate…</option>
            {SURAH_NAMES.map((name, index) => (
              <option key={name} value={index + 1}>
                {index + 1} · {name}
              </option>
            ))}
          </select>
          <small>
            Le moteur ne cherche que dans cette sourate et suit les versets qui
            viennent après, même si tu commences au milieu.
          </small>
        </label>
      ) : null}
    </section>
  );
}
