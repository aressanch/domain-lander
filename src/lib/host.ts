/**
 * Resolve and normalize the requested domain from an incoming request.
 *
 * Normalization rules (must stay in sync with the registry keys in domains.ts):
 *   - lowercase
 *   - strip the port (":3000")
 *   - strip a single leading "www."
 *
 * We read the Host header (what the client asked for). Behind Cloudflare the
 * original host is preserved in Host, so no X-Forwarded-Host gymnastics are
 * needed; we still fall back to it for portability to other proxies.
 */
export function normalizeHost(request: Request): string {
  const raw =
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    "";

  return normalizeHostname(raw);
}

/** Normalize a bare hostname string. Exported for tests / the API route. */
export function normalizeHostname(value: string): string {
  let host = value.trim().toLowerCase();

  // Strip port. Handles "example.com:8787" but leaves bare hostnames alone.
  const colon = host.indexOf(":");
  if (colon !== -1) host = host.slice(0, colon);

  // Strip a single leading "www."
  if (host.startsWith("www.")) host = host.slice(4);

  return host;
}
