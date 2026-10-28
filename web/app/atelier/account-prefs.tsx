"use client";
import { useState } from "react";
import {
  AUDIO_OFFSET,
  clampAudioOffset,
  formatAudioOffset,
} from "@/lib/audio-offset";
import type { Preferences } from "@/lib/preferences-schema";
import { QURAN_FONTS, type QuranFontId } from "@/lib/quran-fonts";
import { QURAN_SIZE, clampQuranSize } from "@/lib/ui-prefs";
import { AvatarSetting } from "./avatar-setting";
import { Avatar } from "./avatar";
import { Switch, SegControl } from "./controls";
import { FONT_SAMPLE } from "./font-picker";
import { Icon } from "./icons";
import { useShell } from "./shell";

const FONT_NOTES: Record<QuranFontId, string> = {
  "amiri-quran": "Naskh classique dessiné pour le Coran. Licence OFL.",
  scheherazade: "Formes ouvertes, très lisible en petit. Licence OFL.",
  "noto-naskh": "Sobre et neutre. Licence OFL.",
  "kfgqpc-hafs":
    "Écriture du Mushaf de Médine. Licence : usage local seulement, jamais servie à distance.",
};

const WINDOWS: { value: string; label: string }[] = [
  { value: "10", label: "10 secondes" },
  { value: "30", label: "30 secondes" },
  { value: "120", label: "2 minutes" },
  { value: "600", label: "10 minutes" },
  { value: "0", label: "Tout le fichier" },
];
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

const speedLabel = (rate: number): string =>
  `${String(rate).replace(".", ",")}×`;

/** Une ligne de réglage : libellé et aide à gauche, contrôle à droite. */
function Setting({
  id,
  label,
  help,
  wide,
  children,
}: {
  id: string;
  label: string;
  help?: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`srow2${wide ? " srow2--wide" : ""}`}>
      <div className="lab">
        <b id={id}>{label}</b>
        {help ? <small>{help}</small> : null}
      </div>
      <div className="ctl">{children}</div>
    </div>
  );
}

/** Préférences du compte : chaque changement est appliqué tout de suite et enregistré côté serveur. */
export function PreferencesPane() {
  const { prefs, update, reset, font, fontAvailability, user } = useShell();
  const [announce, setAnnounce] = useState("");
  const size = prefs.arabicSize;
  const shownSize = clampQuranSize(size ?? QURAN_SIZE.fallback);
  const speeds = SPEEDS.includes(prefs.playbackRate)
    ? SPEEDS
    : [...SPEEDS, prefs.playbackRate].sort((a, b) => a - b);
  const windowValue = String(prefs.visibleSpanSeconds ?? 0);
  const joined = new Date(user.created_at).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return (
    <section
      aria-labelledby="h-prefs"
      style={{ display: "grid", gap: "var(--sp-5)" }}
    >
      <h2 id="h-prefs" className="sr">
        Préférences
      </h2>
      <div className="card acct-id">
        <Avatar person={user} size="lg" eager />
        <div style={{ flex: 1, minWidth: 0 }}>
          <b>{user.username}</b>
          <small>Inscrit le {joined}</small>
        </div>
        {user.role === "admin" ? (
          <span className="badge badge--outline">
            <Icon name="shield" />
            Administrateur
          </span>
        ) : null}
      </div>

      <div className="card setgroup" aria-labelledby="g-pro">
        <header>
          <h2 id="g-pro">Profil</h2>
          <p>
            Ton pseudo et ta photo apparaissent à côté des audios que tu
            importes, pour que chacun voie qui a testé quoi.
          </p>
        </header>
        <Setting
          id="lab-photo"
          label="Photo de profil"
          help="Visible des autres testeurs. Sans photo, ton initiale s’affiche."
          wide
        >
          <AvatarSetting />
        </Setting>
      </div>

      <div className="card setgroup" aria-labelledby="g-aff">
        <header>
          <h2 id="g-aff">Affichage</h2>
          <p>
            Appliqué partout, sur tous tes appareils, dès que tu te connectes.
          </p>
        </header>
        <Setting
          id="lab-theme"
          label="Thème"
          help="« Système » suit le réglage clair ou sombre de ton appareil."
        >
          <SegControl
            labelledBy="lab-theme"
            testId="pref-theme"
            value={prefs.theme}
            onChange={(theme) => update({ theme })}
            options={[
              { value: "system", label: "Système" },
              { value: "light", label: "Clair" },
              { value: "dark", label: "Sombre" },
            ]}
          />
        </Setting>
        <Setting
          id="lab-font"
          label="Police du texte arabe"
          help="Seule la police change : le texte vient toujours du corpus."
          wide
        >
          <div
            className="fontpick"
            role="radiogroup"
            aria-labelledby="lab-font"
            data-testid="pref-font"
          >
            {QURAN_FONTS.map((entry) => {
              const local = entry.source === "local";
              const unavailable = local && !fontAvailability[entry.id];
              return (
                <button
                  key={entry.id}
                  className="radio-card"
                  type="button"
                  role="radio"
                  data-font={entry.id}
                  data-testid={`font-${entry.id}`}
                  aria-checked={font === entry.id}
                  aria-disabled={unavailable || undefined}
                  onClick={() => {
                    if (!unavailable) update({ arabicFont: entry.id });
                  }}
                >
                  <span className="radio" aria-hidden="true" />
                  <b>
                    {entry.name}
                    {prefs.arabicFont === null && font === entry.id ? (
                      <small
                        className="muted"
                        style={{ fontWeight: 400, fontSize: "var(--fs-xs)" }}
                      >
                        automatique
                      </small>
                    ) : null}
                  </b>
                  <span className="d">
                    {unavailable
                      ? "Indisponible ici : sa licence interdit de la servir sans accord écrit du Complexe du Roi Fahd."
                      : FONT_NOTES[entry.id]}
                  </span>
                  <span className="sample" lang="ar" dir="rtl">
                    {FONT_SAMPLE}
                  </span>
                </button>
              );
            })}
          </div>
        </Setting>
        <Setting
          id="lab-size"
          label="Taille du texte arabe"
          help="De 28 à 72 px, par pas de 4. « Automatique » : 40 px sur ordinateur, 32 px sur téléphone."
        >
          <div className="slider-line">
            <input
              type="range"
              data-testid="pref-size"
              min={QURAN_SIZE.min}
              max={QURAN_SIZE.max}
              step={QURAN_SIZE.step}
              value={shownSize}
              disabled={size === null}
              aria-labelledby="lab-size"
              aria-valuetext={`${shownSize} pixels`}
              style={
                {
                  "--p": `${((shownSize - QURAN_SIZE.min) / (QURAN_SIZE.max - QURAN_SIZE.min)) * 100}%`,
                } as React.CSSProperties
              }
              onChange={(event) =>
                update({
                  arabicSize: clampQuranSize(Number(event.target.value)),
                })
              }
            />
            <output htmlFor="pref-size">
              {size === null ? "auto" : `${size} px`}
            </output>
          </div>
          <label className="check" style={{ width: "100%" }}>
            <input
              type="checkbox"
              data-testid="pref-size-auto"
              checked={size === null}
              onChange={(event) =>
                update({
                  arabicSize: event.target.checked ? null : shownSize,
                })
              }
            />
            Automatique selon l’écran
          </label>
        </Setting>
        <Setting
          id="lab-tr"
          label="Afficher la traduction"
          help="Sous chaque verset : traduction officielle QuranEnc, sans modification."
        >
          <Switch
            label="Afficher la traduction"
            testId="pref-translation"
            checked={prefs.translation}
            onChange={(translation) => update({ translation })}
          />
        </Setting>
        <Setting
          id="lab-live"
          label="Surligner en direct"
          help="Pendant la lecture, marque le mot arabe récité et le fragment de traduction qui lui correspond. Sans temps de mots dans le résultat, seul le passage entier est marqué."
        >
          <Switch
            label="Surligner en direct"
            testId="pref-live-highlight"
            checked={prefs.liveHighlight}
            onChange={(liveHighlight) => update({ liveHighlight })}
          />
        </Setting>
        <Setting
          id="lab-offset"
          label="Décalage audio"
          help="Si le mot surligné devance la voix (écouteurs Bluetooth : 100 à 300 ms), retarde le surlignage. Seul l’affichage change, jamais l’audio. Pour caler à l’oreille, ouvre une session et utilise « Caler à l’oreille » sous le passage."
        >
          <div className="slider-line">
            <input
              type="range"
              id="pref-offset"
              data-testid="pref-offset"
              min={AUDIO_OFFSET.min}
              max={AUDIO_OFFSET.max}
              step={AUDIO_OFFSET.step}
              value={prefs.audioOffsetMs}
              aria-labelledby="lab-offset"
              aria-valuetext={formatAudioOffset(prefs.audioOffsetMs)}
              style={
                {
                  "--p": `${((prefs.audioOffsetMs - AUDIO_OFFSET.min) / (AUDIO_OFFSET.max - AUDIO_OFFSET.min)) * 100}%`,
                } as React.CSSProperties
              }
              onChange={(event) =>
                update({
                  audioOffsetMs: clampAudioOffset(Number(event.target.value)),
                })
              }
            />
            <output htmlFor="pref-offset" data-testid="pref-offset-value">
              {formatAudioOffset(prefs.audioOffsetMs)}
            </output>
          </div>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            data-testid="pref-offset-zero"
            disabled={prefs.audioOffsetMs === 0}
            onClick={() => update({ audioOffsetMs: 0 })}
          >
            Remettre à 0
          </button>
        </Setting>
        <div className="preview-ar" aria-label="Aperçu">
          <p className="eyebrow lbl">
            <span>Aperçu</span>
            <span className="mono">
              {QURAN_FONTS.find((f) => f.id === font)?.name} · {shownSize} px
            </span>
          </p>
          <p className="arabic" lang="ar" dir="rtl" data-testid="pref-preview">
            {FONT_SAMPLE}
          </p>
        </div>
      </div>

      <div className="card setgroup" aria-labelledby="g-lec">
        <header>
          <h2 id="g-lec">Lecture</h2>
          <p>
            Les réglages du lecteur que tu retrouves à chaque ouverture d’une
            session.
          </p>
        </header>
        <Setting
          id="lab-win"
          label="Fenêtre visible par défaut"
          help="La partie de l’onde affichée à l’ouverture. Tu peux toujours zoomer ensuite."
        >
          <select
            className="input"
            data-testid="pref-window"
            aria-labelledby="lab-win"
            value={windowValue}
            onChange={(event) => {
              const seconds = Number(event.target.value);
              update({
                visibleSpanSeconds: (seconds === 0
                  ? null
                  : seconds) as Preferences["visibleSpanSeconds"],
              });
            }}
          >
            {WINDOWS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Setting>
        <Setting
          id="lab-fol"
          label="Suivre la lecture"
          help="L’onde et la liste des intervalles suivent la tête de lecture."
        >
          <Switch
            label="Suivre la lecture"
            testId="pref-follow"
            checked={prefs.followPlayback}
            onChange={(followPlayback) => update({ followPlayback })}
          />
        </Setting>
        <Setting
          id="lab-spd"
          label="Vitesse de lecture"
          help="Appliquée à l’ouverture. Se met à jour quand tu la changes dans le lecteur."
        >
          <select
            className="input"
            data-testid="pref-speed"
            aria-labelledby="lab-spd"
            value={prefs.playbackRate}
            onChange={(event) =>
              update({ playbackRate: Number(event.target.value) })
            }
          >
            {speeds.map((rate) => (
              <option key={rate} value={rate}>
                {speedLabel(rate)}
              </option>
            ))}
          </select>
        </Setting>
        <Setting
          id="lab-vol"
          label="Volume"
          help="Se met à jour quand tu le changes dans le lecteur."
        >
          <div className="slider-line">
            <input
              type="range"
              data-testid="pref-volume"
              min={0}
              max={100}
              step={5}
              value={Math.round(prefs.volume * 100)}
              aria-labelledby="lab-vol"
              style={{ "--p": `${prefs.volume * 100}%` } as React.CSSProperties}
              onChange={(event) =>
                update({ volume: Number(event.target.value) / 100 })
              }
            />
            <output htmlFor="pref-volume">
              {Math.round(prefs.volume * 100)} %
            </output>
          </div>
        </Setting>
        <Setting
          id="lab-keys"
          label="Raccourcis à une touche"
          help="M, P, L et Espace dans l’atelier. Désactivables (accessibilité)."
        >
          <Switch
            label="Raccourcis à une touche"
            testId="pref-shortcuts"
            checked={prefs.shortcutsEnabled}
            onChange={(shortcutsEnabled) => update({ shortcutsEnabled })}
          />
        </Setting>
      </div>

      <div className="card setgroup" aria-labelledby="g-esp">
        <header>
          <h2 id="g-esp">Espace de travail</h2>
          <p>
            Comment l’atelier s’ouvre. Un panneau que tu ouvres ou fermes
            pendant ta séance garde ce nouvel état.
          </p>
        </header>
        <Setting
          id="lab-left"
          label="Panneau Sessions ouvert"
          help="La colonne de gauche : favoris et sessions récentes. Sur téléphone, c’est un tiroir et il reste fermé."
        >
          <Switch
            label="Panneau Sessions ouvert au démarrage"
            testId="pref-left"
            yes="Ouvert"
            no="Fermé"
            checked={prefs.leftPanelOpen !== false}
            onChange={(leftPanelOpen) => update({ leftPanelOpen })}
          />
        </Setting>
        <Setting
          id="lab-right"
          label="Panneau Revue ouvert"
          help="La colonne de droite : signalements et vérité terrain."
        >
          <Switch
            label="Panneau Revue ouvert au démarrage"
            testId="pref-right"
            yes="Ouvert"
            no="Fermé"
            checked={prefs.rightPanelOpen !== false}
            onChange={(rightPanelOpen) => update({ rightPanelOpen })}
          />
        </Setting>
        <Setting
          id="lab-scope"
          label="Portée des nouveaux essais"
          help="Les audios importés ou enregistrés sont privés par défaut : toi seul les vois, y compris quand l’atelier est ouvert à des testeurs. Tu peux changer la portée de chacun ensuite."
        >
          <SegControl
            labelledBy="lab-scope"
            testId="pref-scope"
            value={prefs.defaultVisibility}
            onChange={(defaultVisibility) => update({ defaultVisibility })}
            options={[
              {
                value: "global",
                label: (
                  <>
                    <Icon name="globe" />
                    Partagé
                  </>
                ),
              },
              {
                value: "private",
                label: (
                  <>
                    <Icon name="lock" />
                    Privé
                  </>
                ),
              },
            ]}
          />
        </Setting>
      </div>
      <p
        className="hint"
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <Icon name="check" />
        <span>
          Chaque réglage est enregistré sur ton compte dès que tu le changes.
        </span>
        <button
          className="btn btn--ghost btn--sm"
          type="button"
          data-testid="reset-prefs"
          onClick={() => {
            void reset().then(() =>
              setAnnounce("Réglages par défaut rétablis"),
            );
          }}
        >
          Rétablir les réglages par défaut
        </button>
      </p>
      <div className="sr" role="status" aria-live="polite">
        {announce}
      </div>
    </section>
  );
}
