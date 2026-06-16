/**
 * Host-platform isolation layer.
 *
 * The ONLY Cloudflare-specific assumption in the app lives here: server secrets
 * arrive on `locals.runtime.env` (injected by @astrojs/cloudflare). To move to
 * Vercel/Node, swap this file's `getEnv` to read `process.env` — nothing else in
 * the codebase touches the platform directly.
 */

export interface RuntimeEnv {
  // Email — Resend (default)
  RESEND_API_KEY?: string;
  NOTIFY_EMAIL?: string;
  RESEND_FROM?: string;
  // Email — AWS SES (alternative)
  SES_ACCESS_KEY_ID?: string;
  SES_SECRET_ACCESS_KEY?: string;
  SES_REGION?: string;
  SES_FROM?: string;
  // Turnstile
  TURNSTILE_SECRET?: string;
  // Optional integrations
  COCKPIT_WEBHOOK_URL?: string;
  COCKPIT_TOKEN?: string;
  PUBLIC_POSTHOG_KEY?: string;
  PUBLIC_POSTHOG_HOST?: string;
  DEFAULT_BUY_URL?: string;
  // Optional KV namespace for rate limiting (best-effort if absent)
  RATE_LIMIT?: KVNamespaceLike;
}

/** Minimal shape we use from a Cloudflare KV namespace (keeps this swappable). */
export interface KVNamespaceLike {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    opts?: { expirationTtl?: number },
  ): Promise<void>;
}

/**
 * Read the runtime environment for the current request.
 * Cloudflare puts secrets on `locals.runtime.env`; we fall back to `process.env`
 * so the same code runs under Node/Vercel adapters unchanged.
 */
export function getEnv(locals: unknown): RuntimeEnv {
  const cf = (locals as { runtime?: { env?: RuntimeEnv } } | undefined)?.runtime
    ?.env;
  if (cf) return cf;

  if (typeof process !== "undefined" && process.env) {
    return process.env as unknown as RuntimeEnv;
  }
  return {};
}

/** Best-effort client IP for rate limiting, across common proxy headers. */
export function getClientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}
