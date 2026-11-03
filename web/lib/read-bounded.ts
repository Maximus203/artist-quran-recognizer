/**
 * Lit le corps d'une requête en mémoire, à `maxBytes` près, SANS se fier à `Content-Length` (absent avec un corps
 * en flux, ou menteur) : la lecture s'arrête dès que le plafond est franchi. Rend `null` si le corps est trop gros.
 */
export async function readBoundedBody(
  request: Request,
  maxBytes: number,
): Promise<Buffer | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
