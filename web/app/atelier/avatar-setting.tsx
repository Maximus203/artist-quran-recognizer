"use client";
import { useEffect, useId, useRef, useState } from "react";
import { ApiError, api } from "@/lib/api-client";
import { AVATAR } from "@/lib/avatar-config";
import { checkPickedDimensions, checkPickedFile } from "@/lib/avatar-pick";
import type { PublicUser } from "@/lib/auth-response";
import { Avatar } from "./avatar";
import { Icon } from "./icons";
import { useShell } from "./shell";

type Staged = { file: File; url: string };

/**
 * Photo de profil (préférences) : choisir un fichier → aperçu rond → enregistrer ; ou retirer.
 * Le serveur relit le contenu, réencode en carré et ne garde que ce JPEG ; ici on ne fait que le
 * contrôle de confort (type annoncé, taille) pour éviter d'envoyer un fichier voué au refus.
 */
export function AvatarSetting() {
  const { user, setAvatarVersion } = useShell();
  const [staged, setStaged] = useState<Staged | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [status, setStatus] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const choose = useRef<HTMLButtonElement>(null);
  const [refocus, setRefocus] = useState(0);
  const helpId = useId();

  // Le bouton qu'on vient d'activer (« Utiliser cette photo », « Retirer ») disparaît : le focus
  // clavier revient sur « Choisir / Changer la photo » au lieu de tomber sur la page.
  useEffect(() => {
    if (refocus > 0) choose.current?.focus();
  }, [refocus]);
  const leave = () => {
    setStaged(null);
    setRefocus((n) => n + 1);
  };

  // L'aperçu est une URL locale : on la libère dès qu'elle ne sert plus.
  useEffect(
    () => () => {
      if (staged) URL.revokeObjectURL(staged.url);
    },
    [staged],
  );

  const pick = (file: File | undefined) => {
    if (!file) return;
    setStatus("");
    const refusal = checkPickedFile(file);
    if (refusal) {
      setProblem(refusal);
      setStaged(null);
      return;
    }
    setProblem("");
    setStaged({ file, url: URL.createObjectURL(file) });
  };

  const save = async () => {
    if (!staged || busy) return;
    setBusy(true);
    setProblem("");
    try {
      const { user: next } = await api<{ user: PublicUser }>("/api/me/avatar", {
        method: "PUT",
        body: staged.file,
      });
      setAvatarVersion(next.avatar_version);
      leave();
      setStatus("Photo enregistrée.");
    } catch (error) {
      setProblem(
        error instanceof ApiError || error instanceof Error
          ? error.message
          : "Envoi impossible.",
      );
      // Fichier refusé (format, taille, image abîmée) : inutile de le garder. Panne réseau ou
      // serveur : on garde l'aperçu pour réessayer.
      if (
        error instanceof ApiError &&
        error.status >= 400 &&
        error.status < 500
      )
        leave();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    setProblem("");
    try {
      await api("/api/me/avatar", { method: "DELETE" });
      setAvatarVersion(null);
      leave();
      setStatus("Photo retirée : ton initiale est de retour.");
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Action impossible.");
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    leave();
    setProblem("");
    if (input.current) input.current.value = "";
  };

  return (
    <div className="avatar-setting" data-testid="avatar-setting">
      <div className="avatar-stage">
        {staged ? (
          // eslint-disable-next-line @next/next/no-img-element -- aperçu local (blob:), jamais envoyé tel quel
          <img
            className="avatar-preview"
            src={staged.url}
            alt="Aperçu de la nouvelle photo, recadrée au carré"
            width={96}
            height={96}
            data-testid="avatar-preview"
            onError={() => {
              leave();
              setProblem(
                "Ton navigateur n’arrive pas à lire cette image : essaie-en une autre.",
              );
            }}
            onLoad={(event) => {
              // Mêmes bornes de dimensions que le serveur : pas d'aperçu pour un refus certain.
              const { naturalWidth, naturalHeight } = event.currentTarget;
              const refusal = checkPickedDimensions(
                naturalWidth,
                naturalHeight,
              );
              if (refusal) {
                leave();
                setProblem(refusal);
              }
            }}
          />
        ) : (
          <span className="avatar-current" data-testid="avatar-current">
            <Avatar person={user} size="lg" eager />
          </span>
        )}
        <div className="avatar-actions">
          <input
            ref={input}
            type="file"
            hidden
            accept={AVATAR.accept}
            data-testid="avatar-file"
            aria-describedby={helpId}
            onChange={(event) => {
              pick(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          {staged ? (
            <>
              <button
                type="button"
                className="btn btn--primary btn--sm"
                data-testid="avatar-save"
                disabled={busy}
                onClick={() => void save()}
              >
                {busy ? "Envoi…" : "Utiliser cette photo"}
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                data-testid="avatar-cancel"
                disabled={busy}
                onClick={cancel}
              >
                Annuler
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                ref={choose}
                className="btn btn--secondary btn--sm"
                data-testid="avatar-choose"
                disabled={busy}
                onClick={() => input.current?.click()}
              >
                <Icon name="upload" />
                {user.avatar_version ? "Changer la photo" : "Choisir une photo"}
              </button>
              {user.avatar_version ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  data-testid="avatar-remove"
                  disabled={busy}
                  onClick={() => void remove()}
                >
                  Retirer
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>
      <small id={helpId} className="avatar-help">
        JPEG, PNG ou WebP, {AVATAR.maxBytes / (1024 * 1024)} Mo au maximum.
        Recadrée au carré, au centre.
      </small>
      {problem ? (
        <p
          className="notice notice--error"
          role="alert"
          data-testid="avatar-error"
        >
          {problem}
        </p>
      ) : null}
      <p
        className="sr"
        role="status"
        aria-live="polite"
        data-testid="avatar-status"
      >
        {status}
      </p>
    </div>
  );
}
