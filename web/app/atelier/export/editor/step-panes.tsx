"use client";
import type { ReactNode } from "react";
import { BLOCK_LABEL, BLOCK_SHORT } from "@/lib/export-video-edit-text";
import type { BlockId, TextBlockId } from "@/lib/export-video-model";
import { TEXT_TABS, type TextTab } from "@/lib/export-video-steps";
import { XIcon } from "../export-icons";
import { Segmented, Switch } from "../export-ui";
import { EIcon } from "./editor-icons";
import type { EditorProps } from "./editor-types";
import { AdvancedSection, backgroundName, formatName } from "./frame-sections";
import { FrameSections } from "./inspector-sections";
import {
  ArabicLockNote,
  PanelSection,
  PositionSection,
  SizeSection,
  TextAdvancedSection,
  WaveSizeSection,
} from "./text-sections";
import type { EditorController } from "./use-editor-controller";

/**
 * Le contenu des trois étapes du pas à pas. Ce ne sont que des rangements : chaque réglage est une des
 * sections partagées (format, fond, taille, fond du texte, position, passages, avancé) et chaque
 * changement passe par le contrôleur de l'éditeur. Langage courant, une seule chose à faire par écran.
 */

/** Le titre d'une étape et sa phrase d'aide. Le titre reçoit le focus quand on change d'étape. */
export function PaneHead({ title, lead }: { title: string; lead: ReactNode }) {
  return (
    <div className="xp-head">
      <h2 tabIndex={-1} data-testid="pas-title">
        {title}
      </h2>
      <p>{lead}</p>
    </div>
  );
}

// ── étape 1 : le cadre ──────────────────────────────────────────────────────

/**
 * L'encart d'ouverture : la vidéo est déjà belle avec les réglages conseillés, on peut exporter tout de
 * suite. Sans passage à exporter il ne promet rien et propose d'en choisir un.
 */
export function ReadyCard({
  editor,
  onOpenPassages,
}: {
  editor: EditorProps;
  onOpenPassages: () => void;
}) {
  const { exportAction, passages } = editor;
  if (passages.count === 0)
    return (
      <div className="xp-ready" data-state="blocked" data-testid="pas-ready">
        <p className="xp-ready-title">Il manque un passage à exporter</p>
        <p>
          Choisis au moins un passage de la récitation pour fabriquer la vidéo.
        </p>
        <button
          type="button"
          className="btn btn--secondary xp-btn"
          aria-haspopup="dialog"
          data-testid="pas-ready-passages"
          onClick={onOpenPassages}
        >
          <XIcon name="passages" size={18} />
          Choisir les passages…
        </button>
      </div>
    );
  const busy = exportAction.status != null;
  return (
    <div className="xp-ready" data-testid="pas-ready">
      <p className="xp-ready-title">
        <XIcon name="check" size={18} />
        {busy ? exportAction.status : "Déjà prête avec nos réglages conseillés"}
      </p>
      {busy ? null : (
        <p>Tu peux exporter tout de suite, ou personnaliser en trois étapes.</p>
      )}
      <button
        type="button"
        className="btn btn--secondary xp-btn"
        aria-haspopup="dialog"
        disabled={exportAction.disabled}
        data-testid="pas-ready-export"
        onClick={exportAction.onOpen}
      >
        <XIcon name="download" size={18} />
        {busy ? exportAction.label : "Exporter maintenant"}
      </button>
    </div>
  );
}

/** Le cadre : le format, puis le fond (couleurs, images, vidéo de fond). */
export function FramePane({
  editor,
  onOpenPassages,
}: {
  editor: EditorProps;
  onOpenPassages: () => void;
}) {
  return (
    <>
      <PaneHead
        title="Le cadre"
        lead="Choisis la forme de ta vidéo et ce qu’il y a derrière le texte."
      />
      <ReadyCard editor={editor} onOpenPassages={onOpenPassages} />
      <FrameSections
        editor={editor}
        only="format"
        onOpenPassages={onOpenPassages}
      />
      <FrameSections
        editor={editor}
        only="fond"
        onOpenPassages={onOpenPassages}
      />
    </>
  );
}

// ── étape 2 : les textes ────────────────────────────────────────────────────

const SHOW_LABEL: Record<BlockId, string> = {
  arabic: "Afficher le texte arabe",
  translation: "Afficher la traduction",
  wave: "Afficher l’onde",
  ref: "Afficher la sourate et le verset",
};

const isText = (id: BlockId): id is TextBlockId => id !== "wave";

/**
 * Les textes : un onglet par élément, et pour l'élément ouvert sa taille (− / +), le fond de son texte, ses
 * flèches. L'aperçu se manipule en même temps (l'éditeur le déverrouille à cette étape). L'arabe affiche
 * son cadenas et sa phrase (jamais modifiable, I1) ; la traduction garde son attribution collée à elle (I2).
 */
export function TextsPane({
  controller,
  who,
  onWho,
  attribution,
}: {
  controller: EditorController;
  who: TextTab;
  onWho: (tab: TextTab) => void;
  attribution?: string | null;
}) {
  const shown = controller.visible[who];
  const canHide = controller.canHide(who);
  const box = controller.layout[who];
  return (
    <>
      <PaneHead
        title="Les textes"
        lead={
          <>
            Touche un texte dans l’aperçu pour le <b>déplacer</b>, tire ses
            coins pour <b>agrandir sa zone</b>, pince pour changer sa taille.
          </>
        }
      />
      <Segmented
        full
        label="Quel élément régler ?"
        testId="pas-tab"
        value={who}
        onPick={onWho}
        items={TEXT_TABS.map((id) => ({
          value: id,
          label: (
            <>
              {BLOCK_SHORT[id]}
              {controller.visible[id] ? null : (
                <>
                  <EIcon name="eye-off" size={14} />
                  <span className="sr"> (masqué)</span>
                </>
              )}
            </>
          ),
        }))}
      />
      <div className="xp-card" data-testid={`pas-card-${who}`}>
        <h3 className="xp-card-title">{BLOCK_LABEL[who]}</h3>
        {who === "arabic" ? <ArabicLockNote /> : null}
        {who === "translation" ? (
          <p className="xp-source" data-testid="translation-attribution">
            <XIcon name="lock" size={16} />
            <span>
              Traduction restituée telle quelle, avec sa source :{" "}
              <b>{attribution ?? "QuranEnc.com"}</b>
            </span>
          </p>
        ) : null}
        <Switch
          checked={shown}
          disabled={shown && !canHide}
          onChange={(next) => controller.setVisible(who, next)}
          testId={`pas-show-${who}`}
          label={SHOW_LABEL[who]}
          hint={
            shown && !canHide ? "Une des deux écritures reste affichée." : null
          }
        />
        {shown ? (
          <>
            {isText(who) ? (
              <SizeSection
                block={who}
                size={controller.sizes[who]}
                onStep={(direction) => controller.stepTextSize(who, direction)}
                onReset={() => controller.setSize(who, 1)}
                hint={false}
              />
            ) : (
              <WaveSizeSection
                box={box}
                onStep={(direction) => controller.stepWave(direction)}
              />
            )}
            {isText(who) ? (
              <PanelSection
                block={who}
                panel={controller.styles[who].panel}
                onChange={(change) => controller.setPanel(who, change)}
              />
            ) : null}
            <details className="xr-fine xe-advanced" data-testid="pas-arrows">
              <summary>
                <XIcon name="chev-r" />
                Placer avec les flèches
              </summary>
              <div>
                <PositionSection
                  box={box}
                  onNudge={(key, modifiers) =>
                    controller.nudge(who, key, modifiers)
                  }
                  onField={(field, percent) =>
                    controller.setField(who, field, percent)
                  }
                  onCenter={() => controller.center(who)}
                  onReset={() => controller.resetBlock(who)}
                />
              </div>
            </details>
            {isText(who) ? (
              <details className="xr-fine xe-advanced" data-testid="pas-more">
                <summary>
                  <XIcon name="chev-r" />
                  Plus de réglages
                </summary>
                <div>
                  <TextAdvancedSection
                    block={who}
                    style={controller.styles[who]}
                    onStyle={(change) => controller.setTextStyle(who, change)}
                    onPanel={(change) => controller.setPanel(who, change)}
                    accent={
                      who === "arabic"
                        ? {
                            value: controller.committed.accent,
                            onChange: controller.setAccent,
                          }
                        : undefined
                    }
                  />
                </div>
              </details>
            ) : null}
          </>
        ) : (
          <p className="xp-off" data-testid={`pas-off-${who}`}>
            Masqué : cet élément n’apparaît pas dans la vidéo. Active
            l’interrupteur pour le remettre.
          </p>
        )}
      </div>
    </>
  );
}

// ── étape 3 : exporter ──────────────────────────────────────────────────────

/** Le résumé court de ce qui va sortir, les passages, les réglages avancés. Le gros bouton est dans le pied. */
export function ExportPane({
  editor,
  controller,
  onOpenPassages,
}: {
  editor: EditorProps;
  controller: EditorController;
  onOpenPassages: () => void;
}) {
  const { prefs, frame, exportAction, advanced } = editor;
  const rows: [string, string][] = [
    ["Format", formatName(prefs.orientation)],
    ["Fond", backgroundName(frame.selectedBg, frame.upload !== null)],
    ["Traduction", controller.visible.translation ? "Affichée" : "Masquée"],
  ];
  return (
    <>
      <PaneHead
        title="Vérifier et exporter"
        lead="Regarde l’aperçu, puis exporte ta vidéo."
      />
      <dl className="xp-sum" data-testid="pas-summary">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <FrameSections
        editor={editor}
        only="passages"
        onOpenPassages={onOpenPassages}
      />
      <section className="xe-sec" aria-label="Réglages avancés">
        <AdvancedSection>{advanced}</AdvancedSection>
      </section>
      {exportAction.status ? (
        <p className="xp-state" role="status" data-testid="pas-export-status">
          {exportAction.status}
        </p>
      ) : null}
    </>
  );
}
