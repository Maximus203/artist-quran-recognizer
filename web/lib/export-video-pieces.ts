/**
 * Découpage des segments H.264 en morceaux d'envoi. Le serveur remet les parties bout à bout (Annex B) :
 * un morceau n'a donc pas à tomber sur une image clé. Un morceau reste sous le plafond d'une requête
 * (`CHUNK_BODY_MAX`, 8 Mio) et sous les 60 s que le reverse proxy d'Alpha accorde à une requête.
 */
export const VIDEO_PIECE_BYTES = 4 * 1024 * 1024;

export type VideoPiece = { index: number; last: boolean; data: Uint8Array };

export function videoPieces(
  segments: { data: Uint8Array }[],
  pieceBytes: number = VIDEO_PIECE_BYTES,
): VideoPiece[] {
  const pieces: VideoPiece[] = [];
  for (const segment of segments)
    for (let at = 0; at < segment.data.length; at += pieceBytes)
      pieces.push({
        index: pieces.length,
        last: false,
        data: segment.data.subarray(at, at + pieceBytes),
      });
  if (pieces.length > 0) pieces[pieces.length - 1].last = true;
  return pieces;
}
