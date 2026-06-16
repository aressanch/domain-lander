/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

type KVNamespace = import("@cloudflare/workers-types").KVNamespace;

// Cloudflare bindings/secrets available at runtime. Mirrors RuntimeEnv in
// src/lib/runtime.ts; consumed via getEnv(Astro.locals).
interface CloudflareEnv {
  RESEND_API_KEY?: string;
  NOTIFY_EMAIL?: string;
  RESEND_FROM?: string;
  SES_ACCESS_KEY_ID?: string;
  SES_SECRET_ACCESS_KEY?: string;
  SES_REGION?: string;
  SES_FROM?: string;
  TURNSTILE_SECRET?: string;
  COCKPIT_WEBHOOK_URL?: string;
  COCKPIT_TOKEN?: string;
  PUBLIC_POSTHOG_KEY?: string;
  PUBLIC_POSTHOG_HOST?: string;
  DEFAULT_BUY_URL?: string;
  RATE_LIMIT?: KVNamespace;
}

type Runtime = import("@astrojs/cloudflare").Runtime<CloudflareEnv>;

declare namespace App {
  interface Locals extends Runtime {}
}

interface ImportMetaEnv {
  readonly PUBLIC_TURNSTILE_SITE_KEY?: string;
  readonly PUBLIC_POSTHOG_KEY?: string;
  readonly PUBLIC_POSTHOG_HOST?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
