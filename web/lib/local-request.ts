export function isLocalRequest(request: Request, mutation = false): boolean {
  const url = new URL(request.url);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return false;
  const origin = request.headers.get("origin");
  return !mutation || !origin || origin === url.origin;
}
