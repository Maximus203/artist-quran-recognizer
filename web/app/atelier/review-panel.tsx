"use client";
import { useRef } from "react";
import type { Me } from "@/lib/review-access";
import type { Annotation } from "@/lib/review";
import type { Store } from "@/lib/mini-store";
import ValidationPanel from "../validation-panel";
import { Icon } from "./icons";
import { ListTab } from "./list-tab";
import { SignalTab } from "./signal-tab";
import type { ReviewController } from "./use-review";
import type { PlayerState } from "./use-player";

export type ReviewTab = "sig" | "list" | "truth";

type Props = {
  sessionId: string;
  review: ReviewController;
  /** Le compte connecté : l'auteur des signalements posés ici. */
  me: Me;
  tab: ReviewTab;
  onTab: (tab: ReviewTab) => void;
  /** Onglet « Vérité terrain » : administrateurs seulement. */
  showTruth: boolean;
  store: Store<PlayerState>;
  duration: number;
  getPosition: () => number;
  contextAt: (time: number) => string | null;
  onListen: (a: Annotation) => void;
  onLoop: (on: boolean) => void;
  onJump: (a: Annotation) => void;
  onEdit: (a: Annotation) => void;
  playRange: (start: number, end: number) => void;
  resultReady: boolean;
  shortcuts: boolean;
  onShortcuts: (on: boolean) => void;
  onClose: () => void;
};

export function ReviewPanel(props: Props) {
  const tabs: { id: ReviewTab; label: string }[] = [
    { id: "sig", label: "Signaler" },
    { id: "list", label: "Signalements" },
    ...(props.showTruth
      ? [{ id: "truth" as const, label: "Vérité terrain" }]
      : []),
  ];
  const list = useRef<HTMLDivElement>(null);
  const onKey = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const index = tabs.findIndex((t) => t.id === props.tab);
    const next =
      tabs[
        (index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) %
          tabs.length
      ];
    props.onTab(next.id);
    list.current
      ?.querySelector<HTMLElement>(`[data-tab="${next.id}"]`)
      ?.focus();
  };
  const count = props.review.state.annotations.length;
  return (
    <div className="panel-in">
      <div className="panel-head">
        <h2>Revue humaine</h2>
        <button
          type="button"
          className="btn btn--ghost btn--icon btn--sm drawer-close only-drawer"
          aria-label="Fermer la revue humaine"
          onClick={props.onClose}
        >
          <Icon name="x" />
        </button>
      </div>
      <section
        className="tester"
        aria-label="Auteur des signalements"
        data-testid="tester"
      >
        <div className="tester-row">
          <span
            className="av av--sm"
            data-i={props.me.username.charAt(0).toLocaleUpperCase()}
            aria-hidden="true"
          />
          <div className="who">
            <span className="eyebrow">Tu signales en tant que</span>
            <b data-testid="tester-name">
              {props.me.username} <span className="you">(ton compte)</span>
            </b>
          </div>
        </div>
      </section>
      <div
        ref={list}
        className="tabs"
        role="tablist"
        aria-label="Revue humaine"
        onKeyDown={onKey}
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            data-tab={t.id}
            data-testid={`tab-${t.id}`}
            className={t.id === "truth" ? "tab-adv" : undefined}
            aria-selected={props.tab === t.id}
            aria-controls={`pn-${t.id}`}
            tabIndex={props.tab === t.id ? 0 : -1}
            onClick={() => props.onTab(t.id)}
          >
            {t.label}
            {t.id === "list" ? (
              <span className="count" data-testid="report-count">
                {count}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id="pn-sig"
        aria-labelledby="tab-sig"
        hidden={props.tab !== "sig"}
      >
        <SignalTab
          review={props.review}
          tester={props.me.username}
          store={props.store}
          getPosition={props.getPosition}
          contextAt={props.contextAt}
          onListen={props.onListen}
          onLoop={props.onLoop}
          onOpenList={() => props.onTab("list")}
        />
        <div className="panel-foot">
          <details
            className="acc"
            style={{ padding: 0, borderTop: "1px solid var(--border-subtle)" }}
          >
            <summary>Raccourcis clavier</summary>
            <div className="acc-body">
              <button
                type="button"
                className="switch"
                role="switch"
                data-testid="shortcuts-switch"
                aria-checked={props.shortcuts}
                onClick={() => props.onShortcuts(!props.shortcuts)}
              >
                <i />
                Raccourcis à une touche
              </button>
              <div className="keys">
                <kbd>M</kbd>
                <span>Poser le début, puis (même touche) la fin</span>
                <kbd>P</kbd>
                <span>Signaler un point à la position de lecture</span>
                <kbd>L</kbd>
                <span>Écouter la plage en boucle</span>
                <kbd>Échap</kbd>
                <span>Annuler la pose en cours</span>
                <kbd>Ctrl ↵</kbd>
                <span>Confirmer le signalement</span>
                <kbd>Espace</kbd>
                <span>Lecture / pause</span>
              </div>
            </div>
          </details>
        </div>
      </div>

      <div
        role="tabpanel"
        id="pn-list"
        aria-labelledby="tab-list"
        hidden={props.tab !== "list"}
      >
        <ListTab
          review={props.review}
          sessionId={props.sessionId}
          me={props.me}
          onJump={props.onJump}
          onListen={props.onListen}
          onEdit={props.onEdit}
        />
      </div>

      {props.showTruth ? (
        <div
          role="tabpanel"
          id="pn-truth"
          aria-labelledby="tab-truth"
          hidden={props.tab !== "truth"}
        >
          <ValidationPanel
            sessionId={props.sessionId}
            ready={props.resultReady}
            duration={props.duration}
            playRange={props.playRange}
            getPosition={props.getPosition}
          />
        </div>
      ) : null}
    </div>
  );
}
