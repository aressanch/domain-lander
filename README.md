# domain-lander

One codebase, one deployment, **many "for sale" domains**. Point any domain's
DNS at this Cloudflare Pages project and it renders a clean, fast, legally-safe
"this domain is for sale" page for that domain — detected per-request from the
`Host` header. Unknown domains render a safe generic page with **no code change**.

- **SSR, not static.** Each request reads the host and emits the correct
  per-domain `<title>` and Open Graph tags, so shared links preview as
  "<domain> is for sale".
- **Registry-optional.** A domain only needs a registry entry to attach a
  price/tagline/accent. Everything else falls back to a safe generic listing.
- **No payments, ever.** "Buy it now" is only an external link (marketplace /
  Escrow.com). Offers are emailed — there is no database.

## How it works

1. `src/lib/host.ts` — `normalizeHost(request)`: lowercase, strip port, strip a
   leading `www.`.
2. `src/lib/domains.ts` — the typed registry + `resolveListing(host)`. Unknown
   hosts get a synthesized `{ status: "for-sale", offers: true, sensitive: true }`
   listing (strictly generic, no price).
3. `src/pages/index.astro` — resolves the listing, sets per-domain metadata,
   returns 404 for `status: "hidden"`, and renders `Lander.astro`.
4. `src/pages/api/offer.ts` — honeypot → Turnstile → validation → rate limit →
   `notify.sendOffer()` (email + optional webhook + optional PostHog).

### Legal-safety copy rules (enforced in code)

When a listing is `sensitive: true` (trademark-adjacent — `pixart.ai` is
pre-seeded this way), the page renders **only** "This domain is for sale." plus
the offer form. No tagline, no price, no Buy Now, no urgency, nothing naming or
alluding to any company or industry. The synthesized fallback is also
`sensitive`, so every unknown domain is safe by default. See `Lander.astro` —
the gate is real logic (`showPrice`, `showTagline`, `showBuyNow`), not docs.

## Stack

- **Astro** with on-demand (SSR) rendering via the **Cloudflare adapter**,
  deployed to **Cloudflare Pages**.
- The only host-specific assumption (runtime env access) is isolated in
  `src/lib/runtime.ts`. To move to Vercel/Node, swap the adapter in
  `astro.config.mjs` and `getEnv()` in that one file.
- **Cloudflare Turnstile** for bot protection.
- **Resend** for email by default; **AWS SES** behind the same `EmailProvider`
  interface (used automatically when `SES_*` creds are set). No SDKs — plain
  `fetch`, with SES SigV4 signed via Web Crypto.

No DB, no CMS, no auth, no admin panel, no CSS framework runtime. Target:
Lighthouse 100, sub-50KB JS (the only client JS is the form submit + Turnstile).

## Local development

```bash
npm install
cp .env.example .dev.vars     # fill in what you want to test (all optional locally)
npm run dev                   # http://localhost:4321
```

Local notes:

- **Test different domains** without editing hosts: send a `Host` header, e.g.
  `curl -H "Host: pixart.ai" http://localhost:4321/` (renders the sensitive
  listing) vs. `curl -H "Host: whatever.com" http://localhost:4321/` (fallback).
- With **no `TURNSTILE_SECRET`**, Turnstile verification is skipped so the offer
  form works locally. With **no `PUBLIC_TURNSTILE_SITE_KEY`**, the widget is
  omitted entirely.
- With no email provider configured, `POST /api/offer` returns `send_failed`
  (502) — set `RESEND_API_KEY` + `NOTIFY_EMAIL` to actually deliver.

Secrets in local dev go in `.dev.vars` (Cloudflare convention); `.env` also works
via the Node fallback in `getEnv()`.

## Deploy (Cloudflare Pages)

1. Push this repo to GitHub and create a **Pages project** connected to it, **or**
   deploy with Wrangler:
   ```bash
   npm run build
   npx wrangler pages deploy dist
   ```
2. Build settings (if using the Git integration):
   - Build command: `npm run build`
   - Output directory: `dist`
3. Add the secrets from `.env.example` as **Pages project environment variables**
   (Production + Preview). `PUBLIC_*` vars are exposed to the browser; the rest
   are server-only.
4. (Optional) Bind a **KV namespace** as `RATE_LIMIT` for durable rate limiting.
   Without it, rate limiting is best-effort in-memory per isolate.

## Adding a domain (DNS onboarding)

Each domain is its own DNS zone, so a wildcard does **not** span unrelated
domains — every domain must be added individually.

1. **Add it as a custom domain** on the Pages project — both apex and `www`.
   Use the script:
   ```bash
   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_PAGES_PROJECT=domain-lander \
     npm run add-domains -- pixart.ai another.com
   # or from a file (one domain per line):
   npm run add-domains -- ./domains.txt
   ```
   It registers apex + `www.` for each and prints the DNS records to set.
2. **Point DNS** per Cloudflare's instructions:
   - Apex: if the zone is on Cloudflare, a root `CNAME` to `<project>.pages.dev`
     is flattened automatically; if the zone is elsewhere, use the A/AAAA records
     the Pages custom-domain UI shows after step 1.
   - `www`: `CNAME` to `<project>.pages.dev`.
3. **(Optional) Add a registry entry** in `src/lib/domains.ts` for a price,
   tagline, accent, or `buyUrl`. Without an entry the safe fallback still renders
   — a newly pointed domain works immediately, no deploy required.

## Offer endpoint

`POST /api/offer`

```json
{ "domain": "pixart.ai", "name": "...", "email": "...", "amount": 5000,
  "message": "...", "website": "", "turnstileToken": "..." }
```

- `website` is a honeypot — non-empty → silently accepted and dropped.
- `turnstileToken` is verified server-side (skipped only if no secret is set).
- Validates email, positive amount, present domain; best-effort per-IP rate limit.
- On success: emails `NOTIFY_EMAIL`, POSTs the lead JSON to `COCKPIT_WEBHOOK_URL`
  (with `Authorization: Bearer COCKPIT_TOKEN`) if set, and captures an
  `offer_submitted` PostHog event if `PUBLIC_POSTHOG_KEY` is set. Returns
  `{ ok: true }`. **No offer is ever stored in a database.**

## Environment variables

See `.env.example`. Email (`RESEND_API_KEY` + `NOTIFY_EMAIL`, or `SES_*`),
Turnstile (`TURNSTILE_SECRET` + `PUBLIC_TURNSTILE_SITE_KEY`), and the optional
`COCKPIT_*` / `PUBLIC_POSTHOG_*` / `DEFAULT_BUY_URL`. The
`CLOUDFLARE_*` vars are only used by the onboarding script, not at runtime.

## Constraints (by design)

No database, no CMS, no accounts, no admin UI. No payment or escrow logic in-app
— "Buy it now" is only ever an external link. Adding a domain needs no code
change for the generic case. Dependencies are kept minimal on purpose.
