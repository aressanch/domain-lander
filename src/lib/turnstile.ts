import type { RuntimeEnv } from "./runtime";

const VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Verify a Turnstile token server-side. Returns true only on a confirmed pass.
 *
 * If no secret is configured we treat verification as DISABLED and return true,
 * so local dev / preview without Turnstile keys still works. Set TURNSTILE_SECRET
 * in production to actually enforce it.
 */
export async function verifyTurnstile(
  env: RuntimeEnv,
  token: string | undefined,
  remoteIp?: string,
): Promise<boolean> {
  const secret = env.TURNSTILE_SECRET;
  if (!secret) return true; // not configured -> skip (dev/preview)
  if (!token) return false;

  const body = new FormData();
  body.append("secret", secret);
  body.append("response", token);
  if (remoteIp && remoteIp !== "unknown") body.append("remoteip", remoteIp);

  try {
    const res = await fetch(VERIFY_URL, { method: "POST", body });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}
