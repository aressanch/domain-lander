import type { RuntimeEnv } from "./runtime";

export interface OfferLead {
  domain: string;
  name?: string;
  email: string;
  amount: number;
  message?: string;
  /** ISO timestamp set by the endpoint. */
  receivedAt: string;
  ip?: string;
}

/** Email provider interface. Resend and SES both implement this. */
export interface EmailProvider {
  readonly name: string;
  send(msg: {
    to: string;
    from: string;
    replyTo?: string;
    subject: string;
    text: string;
  }): Promise<void>;
}

/**
 * Orchestrate a lead: send the notification email, then fan out to the optional
 * Cockpit webhook and PostHog capture. Email failure throws (caller decides how
 * to surface it); the optional sinks never block or fail the request.
 */
export async function sendOffer(
  env: RuntimeEnv,
  lead: OfferLead,
): Promise<void> {
  await sendEmail(env, lead);

  // Optional, fire-and-forget-ish. Awaited so they run on Workers, but their
  // failures are swallowed — the lead email already succeeded.
  await Promise.allSettled([postWebhook(env, lead), capturePosthog(env, lead)]);
}

async function sendEmail(env: RuntimeEnv, lead: OfferLead): Promise<void> {
  const to = env.NOTIFY_EMAIL;
  if (!to) {
    throw new Error("NOTIFY_EMAIL is not configured");
  }

  const provider = pickProvider(env);
  const subject = `Offer: ${lead.domain} — ${formatAmount(lead.amount)}`;
  const text = renderLeadText(lead);
  const from = providerFrom(env, provider, to);

  await provider.send({
    to,
    from,
    replyTo: lead.email,
    subject,
    text,
  });
}

/** SES when its credentials are present, otherwise Resend. */
function pickProvider(env: RuntimeEnv): EmailProvider {
  if (env.SES_ACCESS_KEY_ID && env.SES_SECRET_ACCESS_KEY) {
    return new SesProvider(env);
  }
  return new ResendProvider(env);
}

function providerFrom(
  env: RuntimeEnv,
  provider: EmailProvider,
  to: string,
): string {
  if (provider.name === "ses") return env.SES_FROM ?? to;
  // Resend: prefer an explicit verified From, else the safe shared sandbox.
  return env.RESEND_FROM ?? "Domain Offers <onboarding@resend.dev>";
}

function renderLeadText(lead: OfferLead): string {
  return [
    `New offer for ${lead.domain}`,
    ``,
    `Amount:  ${formatAmount(lead.amount)}`,
    `Name:    ${lead.name || "(not provided)"}`,
    `Email:   ${lead.email}`,
    `Message: ${lead.message || "(none)"}`,
    ``,
    `Received: ${lead.receivedAt}`,
    `IP:       ${lead.ip || "unknown"}`,
  ].join("\n");
}

function formatAmount(amount: number): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `$${amount}`;
  }
}

// ---------------------------------------------------------------------------
// Resend (default) — plain fetch, no SDK.
// ---------------------------------------------------------------------------
class ResendProvider implements EmailProvider {
  readonly name = "resend";
  constructor(private env: RuntimeEnv) {}

  async send(msg: {
    to: string;
    from: string;
    replyTo?: string;
    subject: string;
    text: string;
  }): Promise<void> {
    const key = this.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY is not configured");

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: msg.from,
        to: [msg.to],
        reply_to: msg.replyTo,
        subject: msg.subject,
        text: msg.text,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Resend send failed (${res.status}): ${detail}`);
    }
  }
}

// ---------------------------------------------------------------------------
// AWS SES v2 — SigV4-signed fetch (Web Crypto), no SDK. Same interface.
// ---------------------------------------------------------------------------
class SesProvider implements EmailProvider {
  readonly name = "ses";
  constructor(private env: RuntimeEnv) {}

  async send(msg: {
    to: string;
    from: string;
    replyTo?: string;
    subject: string;
    text: string;
  }): Promise<void> {
    const region = this.env.SES_REGION ?? "us-east-1";
    const host = `email.${region}.amazonaws.com`;
    const path = "/v2/email/outbound-emails";
    const payload = JSON.stringify({
      FromEmailAddress: msg.from,
      Destination: { ToAddresses: [msg.to] },
      ReplyToAddresses: msg.replyTo ? [msg.replyTo] : undefined,
      Content: {
        Simple: {
          Subject: { Data: msg.subject, Charset: "UTF-8" },
          Body: { Text: { Data: msg.text, Charset: "UTF-8" } },
        },
      },
    });

    const headers = await signRequest({
      method: "POST",
      host,
      path,
      region,
      service: "ses",
      accessKeyId: this.env.SES_ACCESS_KEY_ID!,
      secretAccessKey: this.env.SES_SECRET_ACCESS_KEY!,
      payload,
      contentType: "application/json",
    });

    const res = await fetch(`https://${host}${path}`, {
      method: "POST",
      headers,
      body: payload,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`SES send failed (${res.status}): ${detail}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Optional sinks.
// ---------------------------------------------------------------------------
async function postWebhook(env: RuntimeEnv, lead: OfferLead): Promise<void> {
  const url = env.COCKPIT_WEBHOOK_URL;
  if (!url) return;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (env.COCKPIT_TOKEN) headers.Authorization = `Bearer ${env.COCKPIT_TOKEN}`;
  await fetch(url, { method: "POST", headers, body: JSON.stringify(lead) });
}

async function capturePosthog(env: RuntimeEnv, lead: OfferLead): Promise<void> {
  const key = env.PUBLIC_POSTHOG_KEY;
  if (!key) return;
  const host = env.PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com";
  await fetch(`${host.replace(/\/$/, "")}/i/v0/e/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: key,
      event: "offer_submitted",
      distinct_id: lead.email,
      properties: { domain: lead.domain, amount: lead.amount },
      timestamp: lead.receivedAt,
    }),
  });
}

// ---------------------------------------------------------------------------
// Minimal AWS SigV4 signer using Web Crypto (available on Workers + Node 18+).
// ---------------------------------------------------------------------------
interface SignInput {
  method: string;
  host: string;
  path: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  payload: string;
  contentType: string;
}

async function signRequest(i: SignInput): Promise<Record<string, string>> {
  const now = new Date();
  const amzDate = now
    .toISOString()
    .replace(/[:-]|\.\d{3}/g, "")
    .replace(/(\d{8})(\d{6})Z?$/, "$1T$2Z");
  const dateStamp = amzDate.slice(0, 8);

  const payloadHash = toHex(await sha256(i.payload));
  const canonicalHeaders =
    `content-type:${i.contentType}\n` +
    `host:${i.host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";

  const canonicalRequest = [
    i.method,
    i.path,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${i.region}/${i.service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    toHex(await sha256(canonicalRequest)),
  ].join("\n");

  const kDate = await hmac(`AWS4${i.secretAccessKey}`, dateStamp);
  const kRegion = await hmac(kDate, i.region);
  const kService = await hmac(kRegion, i.service);
  const kSigning = await hmac(kService, "aws4_request");
  const signature = toHex(await hmac(kSigning, stringToSign));

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${i.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    "Content-Type": i.contentType,
    "X-Amz-Date": amzDate,
    "X-Amz-Content-Sha256": payloadHash,
    Authorization: authorization,
  };
}

async function sha256(data: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
}

async function hmac(
  key: string | ArrayBuffer,
  data: string,
): Promise<ArrayBuffer> {
  const keyData =
    typeof key === "string" ? new TextEncoder().encode(key) : new Uint8Array(key);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
