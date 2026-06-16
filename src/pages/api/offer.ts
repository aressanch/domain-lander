import type { APIRoute } from "astro";
import { getEnv, getClientIp } from "../../lib/runtime";
import { verifyTurnstile } from "../../lib/turnstile";
import { rateLimit } from "../../lib/ratelimit";
import { sendOffer, type OfferLead } from "../../lib/notify";
import { normalizeHostname } from "../../lib/host";

export const prerender = false;

interface OfferBody {
  domain?: string;
  name?: string;
  email?: string;
  amount?: number | string;
  message?: string;
  website?: string; // honeypot
  turnstileToken?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export const POST: APIRoute = async ({ request, locals }) => {
  const env = getEnv(locals);

  let body: OfferBody;
  try {
    body = (await request.json()) as OfferBody;
  } catch {
    return json({ ok: false, error: "bad_request" }, 400);
  }

  // 1. Honeypot: silently accept and drop. Don't tip off bots.
  if (body.website && body.website.trim() !== "") {
    return json({ ok: true });
  }

  const ip = getClientIp(request);

  // 2. Turnstile verification (skipped only when no secret is configured).
  const ok = await verifyTurnstile(env, body.turnstileToken, ip);
  if (!ok) {
    return json({ ok: false, error: "turnstile_failed" }, 403);
  }

  // 3. Validate.
  const domain = normalizeHostname(String(body.domain ?? ""));
  const email = String(body.email ?? "").trim();
  const amount =
    typeof body.amount === "string" ? Number(body.amount) : body.amount ?? NaN;

  if (!domain) return json({ ok: false, error: "domain_required" }, 422);
  if (!EMAIL_RE.test(email))
    return json({ ok: false, error: "invalid_email" }, 422);
  if (!Number.isFinite(amount) || (amount as number) <= 0)
    return json({ ok: false, error: "invalid_amount" }, 422);

  // 3b. Best-effort per-IP rate limit.
  const allowed = await rateLimit(env, ip, Date.now());
  if (!allowed) {
    return json({ ok: false, error: "rate_limited" }, 429);
  }

  // 4. Send lead (email + optional webhook + optional PostHog).
  const lead: OfferLead = {
    domain,
    name: body.name ? String(body.name).slice(0, 200) : undefined,
    email,
    amount: amount as number,
    message: body.message ? String(body.message).slice(0, 4000) : undefined,
    receivedAt: new Date().toISOString(),
    ip,
  };

  try {
    await sendOffer(env, lead);
  } catch (err) {
    console.error("sendOffer failed:", err);
    return json({ ok: false, error: "send_failed" }, 502);
  }

  // 5. Done.
  return json({ ok: true });
};

// Anything other than POST is not allowed.
export const ALL: APIRoute = () =>
  json({ ok: false, error: "method_not_allowed" }, 405);
