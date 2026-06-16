import type { RuntimeEnv } from "./runtime";

/**
 * Best-effort per-IP rate limit.
 *
 * Uses a Cloudflare KV namespace bound as `RATE_LIMIT` when present (durable
 * across isolates); otherwise falls back to an in-memory window that is
 * per-isolate and resets on cold start. This is intentionally lightweight — it
 * is a speed bump against spam, not a security control.
 */

const WINDOW_SECONDS = 60;
const MAX_PER_WINDOW = 5;

// In-memory fallback: ip -> timestamps (ms) within the current window.
const hits = new Map<string, number[]>();

export async function rateLimit(
  env: RuntimeEnv,
  ip: string,
  nowMs: number,
): Promise<boolean> {
  const kv = env.RATE_LIMIT;
  if (kv) return rateLimitKv(kv, ip, nowMs);
  return rateLimitMemory(ip, nowMs);
}

function rateLimitMemory(ip: string, nowMs: number): boolean {
  const cutoff = nowMs - WINDOW_SECONDS * 1000;
  const list = (hits.get(ip) ?? []).filter((t) => t > cutoff);
  if (list.length >= MAX_PER_WINDOW) {
    hits.set(ip, list);
    return false;
  }
  list.push(nowMs);
  hits.set(ip, list);
  return true;
}

async function rateLimitKv(
  kv: NonNullable<RuntimeEnv["RATE_LIMIT"]>,
  ip: string,
  nowMs: number,
): Promise<boolean> {
  const key = `rl:${ip}`;
  const cutoff = nowMs - WINDOW_SECONDS * 1000;
  let list: number[] = [];
  try {
    const raw = await kv.get(key);
    if (raw) list = (JSON.parse(raw) as number[]).filter((t) => t > cutoff);
  } catch {
    list = [];
  }
  if (list.length >= MAX_PER_WINDOW) return false;
  list.push(nowMs);
  try {
    await kv.put(key, JSON.stringify(list), { expirationTtl: WINDOW_SECONDS });
  } catch {
    // ignore write failures — best-effort only
  }
  return true;
}
