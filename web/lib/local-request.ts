export function isLocalRequest(request: Request, mutation = false): boolean {
  const url = new URL(request.url);
  const local = (host: string) =>
    ["127.0.0.1", "localhost", "[::1]"].includes(host);
  if (!local(url.hostname)) return false;
  const origin = request.headers.get("origin");
  if (!mutation || !origin || origin === url.origin) return true;
  try {
    const source = new URL(origin);
    return (
      origin === source.origin &&
      local(source.hostname) &&
      source.protocol === url.protocol &&
      source.port === url.port
    );
  } catch {
    return false;
  }
}
