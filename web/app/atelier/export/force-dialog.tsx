"use client";
import { useRef } from "react";
import type { ExportPolicy } from "@/lib/export-options";
import {
  clock,
  forcedRule,
  itemTitle,
  plural,
  TYPE_LABEL,
} from "@/lib/export-text";
import type { ReadinessItem } from "@/lib/export-types";
import { useFocusTrap } from "../hooks";
import { Radio } from "./export-settings";

/**
 * « Forcer l'export ? » : un dialogue d'alerte (jamais un double-clic accidentel). Il dit ce qu'on fait des
 * passages ambigus, passage par passage, avant d'écrire quoi que ce soit : par défaut, omettre (nommer un
 * faux verset est pire que n'en nommer aucun).
 */
export function ForceDialog({
  open,
  unresolved,
  items,
  loading,
  policy,
  onPolicy,
  busy,
  error,
  onClose,
  onConfirm,
  returnTo,
}: {
  open: boolean;
  unresolved: number;
  items: ReadinessItem[];
  loading: boolean;
  policy: ExportPolicy;
  onPolicy: (policy: ExportPolicy) => void;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
  returnTo?: React.RefObject<HTMLElement | null>;
}) {
  const box = useRef<HTMLDivElement>(null);
  useFocusTrap(box, open, onClose, returnTo);
  if (!open) return null;
  return (
    <div
      className="ex-dlg-back"
      data-open="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="ex-dlg"
        ref={box}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="ex-force-h"
        aria-describedby="ex-force-p"
        data-testid="force-dialog"
      >
        <div>
          <h2 id="ex-force-h">Forcer l’export ?</h2>
          <p id="ex-force-p" style={{ marginTop: 6 }}>
            <b style={{ color: "var(--text)", fontWeight: 600 }}>
              {plural(unresolved, "passage ambigu", "passages ambigus")}
            </b>{" "}
            {unresolved > 1 ? "n’ont pas été corrigés" : "n’a pas été corrigé"}.
            Nommer un faux verset est pire que n’en nommer aucun : choisis ce
            qu’on en fait.
          </p>
        </div>
        <fieldset className="ex-rads" style={{ margin: 0, padding: 0 }}>
          <legend className="sr">Que faire des passages ambigus</legend>
          <Radio
            name="ex-policy"
            checked={policy === "omit"}
            onChange={() => onPolicy("omit")}
            testId="policy-omit"
            label={
              <>
                Les omettre{" "}
                <span className="ex-tag" style={{ marginLeft: 6 }}>
                  Recommandé
                </span>
              </>
            }
            hint="Aucun verset douteux n’est nommé ni sous-titré."
          />
          <Radio
            name="ex-policy"
            checked={policy === "marker"}
            onChange={() => onPolicy("marker")}
            testId="policy-marker"
            label="Les garder avec un marqueur"
            hint="« [incertain : 11:61 | 7:73] » à la place du texte, « [déduit] » pour les supposés."
          />
          <Radio
            name="ex-policy"
            checked={policy === "first"}
            onChange={() => onPolicy("first")}
            danger
            testId="policy-first"
            label="Prendre le premier candidat"
            hint={
              <span className="warn">
                Risque de nommer un faux verset. Le moteur ne classe pas ses
                candidats aujourd’hui.
              </span>
            }
          />
        </fieldset>
        <div className="scroll-x" aria-busy={loading}>
          <table className="ex-tbl" data-testid="force-table">
            <thead>
              <tr>
                <th scope="col">Temps</th>
                <th scope="col">Passage</th>
                <th scope="col">Dans l’export</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.key}>
                  <td className="num">{clock(item.t[0]).slice(0, 5)}</td>
                  <td>
                    <b style={{ fontWeight: 600, color: "var(--text)" }}>
                      {itemTitle(item)}
                    </b>{" "}
                    · {TYPE_LABEL[item.type].toLowerCase()}
                  </td>
                  <td>{forcedRule(item, policy)}</td>
                </tr>
              ))}
              {unresolved > items.length ? (
                <tr>
                  <td colSpan={3} className="muted">
                    … et {unresolved - items.length} autres, traités de la même
                    façon.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <p>
          Le fichier JSON portera la mention{" "}
          <span className="mono">forced: true</span> et le nombre de passages
          non résolus.
        </p>
        {error ? (
          <p className="notice notice--error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="ex-dlg-foot">
          <button
            className="btn btn--secondary"
            type="button"
            data-testid="force-cancel"
            onClick={onClose}
          >
            Revenir et corriger
          </button>
          <button
            className="btn btn--primary"
            type="button"
            data-testid="force-confirm"
            disabled={busy}
            onClick={onConfirm}
          >
            Exporter quand même
          </button>
        </div>
      </div>
    </div>
  );
}
