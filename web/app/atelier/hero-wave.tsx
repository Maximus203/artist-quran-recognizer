/** Une onde dessinée pour le projet (vectoriel, aucune image externe) : l'« image » des écrans d'accueil. */
export function HeroWave() {
  const bars = Array.from({ length: 40 }, (_, i) => {
    const t = i / 39;
    const envelope = Math.exp(-Math.pow((t - 0.5) / 0.22, 2));
    const jitter = Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1;
    const height = 4 + envelope * (28 + jitter * 14);
    return { x: 4 + i * 5.2, height, center: t > 0.3 && t < 0.7 };
  });
  return (
    <svg
      className="hero-wave"
      viewBox="0 0 220 56"
      role="img"
      aria-label="Une onde sonore"
    >
      <g fill="var(--border-strong)">
        {bars.map((bar) => (
          <rect
            key={bar.x}
            className={bar.center ? "a" : undefined}
            x={bar.x}
            y={28 - bar.height / 2}
            width={2.4}
            height={bar.height}
            rx={1.2}
          />
        ))}
      </g>
      <path d="M4 52h212" stroke="var(--border)" strokeWidth="1" />
      <path d="M110 48l4 4-4 4-4-4z" fill="var(--text-3)" />
    </svg>
  );
}
