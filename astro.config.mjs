// @ts-check
import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";

// On-demand (SSR) rendering so each request can read the Host header and emit
// per-domain <title>/OG tags. The Cloudflare adapter is the only host-specific
// bit here; everything Cloudflare-aware is isolated in src/lib/runtime.ts so a
// Vercel/Node swap is just changing this adapter + that module.
export default defineConfig({
  output: "server",
  adapter: cloudflare({
    platformProxy: { enabled: true },
  }),
  // No client framework, no UI kit. Keep JS payload tiny.
  build: { inlineStylesheets: "always" },
});
