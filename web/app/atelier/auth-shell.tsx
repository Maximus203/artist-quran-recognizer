import Link from "next/link";
import { AuthThemeToggle } from "./auth-parts";
import { IconSprite } from "./icons";

/**
 * Forme d'onde d'exemple de la page de connexion : trois passages (reconnu, déduit, incertain)
 * sur des barres déterministes. Une illustration dessinée pour le projet, pas une donnée.
 */
function bars(count: number): { x: number; h: number }[] {
  return Array.from({ length: count }, (_, i) => {
    const wobble =
      Math.sin(i * 0.9) * 0.28 + Math.sin(i * 0.37 + 1.3) * 0.34 + 0.52;
    const dip = i > 13 && i < 22 ? 0.4 : 1;
    return { x: i * 6.25, h: Math.max(14, Math.min(104, 104 * wobble * dip)) };
  });
}

function WaveMini() {
  const items = bars(96);
  return (
    <svg
      className="wave-mini"
      viewBox="0 0 600 120"
      role="img"
      aria-label="Exemple : une forme d’onde avec un passage reconnu, un déduit et un incertain"
      preserveAspectRatio="none"
    >
      <defs>
        <pattern
          id="hatch-m"
          width="7"
          height="7"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <path
            d="M0 0H7"
            stroke="var(--seg-inferred-edge)"
            strokeWidth="1.6"
            opacity=".55"
          />
        </pattern>
        <pattern id="dots-m" width="7" height="7" patternUnits="userSpaceOnUse">
          <circle
            cx="3.5"
            cy="3.5"
            r="1.2"
            fill="var(--seg-uncertain-edge)"
            opacity=".7"
          />
        </pattern>
      </defs>
      <rect className="seg-r" x="30" y="0" width="190" height="120" rx="3" />
      <rect className="seg-r-edge" x="30" y="0" width="190" height="3" />
      <rect className="seg-i" x="232" y="0" width="130" height="120" rx="3" />
      <rect
        x="232"
        y="0"
        width="130"
        height="120"
        rx="3"
        fill="url(#hatch-m)"
      />
      <path
        d="M232 1.5H362"
        stroke="var(--seg-inferred-edge)"
        strokeWidth="3"
        strokeDasharray="14 5"
      />
      <rect className="seg-u" x="378" y="0" width="150" height="120" rx="3" />
      <rect x="378" y="0" width="150" height="120" rx="3" fill="url(#dots-m)" />
      <path
        d="M378 1.5H528"
        stroke="var(--seg-uncertain-edge)"
        strokeWidth="3"
        strokeDasharray="2 4"
      />
      {items.map((bar) => (
        <rect
          key={bar.x}
          className={bar.x < 231 ? "p" : "b"}
          x={bar.x}
          y={(120 - bar.h) / 2}
          width="3.8"
          height={bar.h}
          rx="1.4"
        />
      ))}
    </svg>
  );
}

/** Cadre des pages publiques (connexion, inscription) : visuel à gauche, formulaire à droite. */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-shell">
      <IconSprite />
      <header className="auth-top">
        <Link className="brand" href="/login" aria-label="Quran TR">
          <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <circle
              cx="16"
              cy="16"
              r="14"
              stroke="var(--accent)"
              strokeWidth="1.6"
            />
            <path
              d="M9.5 16h0M13 12v8M16 8.5v15M19 11v10M22.5 14v4"
              stroke="var(--text)"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
          <b>
            Quran <em>TR</em>
          </b>
        </Link>
        <span className="spacer" />
        <AuthThemeToggle />
      </header>
      <div className="auth">
        <section className="auth-visual" aria-labelledby="vis-h">
          <p className="eyebrow">Quran TR</p>
          <h2 id="vis-h">
            Écoute, compare, <em>corrige.</em>
          </h2>
          <p className="lead">
            Un pupitre de relecteur : le moteur propose, tu vérifies à
            l’oreille, verset par verset.
          </p>
          <figure className="auth-figure">
            <WaveMini />
            <div className="auth-verse">
              <p className="arabic" lang="ar" dir="rtl">
                بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ
              </p>
              <div className="cap">
                <span>
                  Au nom d’Allah, le Tout Miséricordieux, le Très
                  Miséricordieux.
                </span>
                <span className="mono">1:1</span>
              </div>
            </div>
            <ul className="legend-mini" aria-label="Légende des intervalles">
              <li>
                <span>
                  <i className="sw s-recognized" aria-hidden="true" />
                  Reconnu
                </span>
              </li>
              <li>
                <span>
                  <i className="sw s-inferred" aria-hidden="true" />
                  Déduit de la position
                </span>
              </li>
              <li>
                <span>
                  <i className="sw s-uncertain" aria-hidden="true" />
                  Incertain
                </span>
              </li>
            </ul>
            <figcaption className="foot-note" style={{ padding: 0 }}>
              Texte : corpus Tanzil, non modifié. Traduction : QuranEnc.
            </figcaption>
          </figure>
        </section>
        <main className="auth-main" id="main">
          <div className="auth-card">{children}</div>
        </main>
      </div>
    </div>
  );
}
