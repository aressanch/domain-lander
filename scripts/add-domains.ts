/**
 * Bulk-register domains as custom domains on the Cloudflare Pages project.
 *
 * Usage:
 *   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_PAGES_PROJECT=domain-lander \
 *     node --experimental-strip-types scripts/add-domains.ts pixart.ai foo.com
 *   # or read from a file (one domain per line, "#" comments allowed):
 *     node --experimental-strip-types scripts/add-domains.ts ./domains.txt
 *
 * For each domain it adds BOTH the apex and the www. host, then prints the DNS
 * records to set. The provider calls are isolated behind DomainProvider so a
 * Vercel variant is a small swap (implement the same two methods).
 *
 * This script does NOT touch DNS — each domain is its own zone (often at another
 * registrar), so you still point DNS per the printed instructions. Registering a
 * domain here is independent of adding a registry entry in src/lib/domains.ts.
 */

import { readFileSync } from "node:fs";

interface DomainProvider {
  /** Attach a custom domain (apex or www) to the deployment. Idempotent-ish. */
  addCustomDomain(host: string): Promise<{ added: boolean; note?: string }>;
  /** Human-readable DNS instructions for a host. */
  dnsInstructions(host: string): string;
}

// --- Cloudflare Pages implementation -------------------------------------
class CloudflareProvider implements DomainProvider {
  constructor(
    private accountId: string,
    private project: string,
    private token: string,
  ) {}

  private base() {
    return `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/pages/projects/${this.project}/domains`;
  }

  async addCustomDomain(
    host: string,
  ): Promise<{ added: boolean; note?: string }> {
    const res = await fetch(this.base(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: host }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      errors?: Array<{ code?: number; message?: string }>;
    };
    if (res.ok && data.success) return { added: true };

    // 8000007 / "already exists" style errors are non-fatal — treat as present.
    const msg = data.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}`;
    if (/already|exist/i.test(msg)) return { added: false, note: "already present" };
    throw new Error(`Cloudflare add failed for ${host}: ${msg}`);
  }

  dnsInstructions(host: string): string {
    const isWww = host.startsWith("www.");
    const target = `${this.project}.pages.dev`;
    if (isWww) {
      return `  ${host}\tCNAME\t${target}`;
    }
    // Apex: Cloudflare uses CNAME flattening. If the domain's DNS is on
    // Cloudflare, add a CNAME at the root to the project; Cloudflare flattens
    // it to A/AAAA automatically. If DNS is elsewhere, use the A/AAAA records
    // Cloudflare shows in the Pages custom-domain UI after this call.
    return `  ${host}\tCNAME (flattened)\t${target}`;
  }
}

// --- Runner --------------------------------------------------------------
function loadDomains(args: string[]): string[] {
  if (args.length === 0) {
    throw new Error(
      "Pass domains as args or a path to a file with one domain per line.",
    );
  }
  // Single arg that looks like a file path -> read it.
  if (
    args.length === 1 &&
    (args[0].includes("/") || args[0].endsWith(".txt"))
  ) {
    return readFileSync(args[0], "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
  }
  return args.map((a) => a.trim()).filter(Boolean);
}

function normalize(host: string): string {
  let h = host.toLowerCase().trim();
  const colon = h.indexOf(":");
  if (colon !== -1) h = h.slice(0, colon);
  if (h.startsWith("www.")) h = h.slice(4);
  return h;
}

async function main() {
  const { CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID } = process.env;
  const project = process.env.CLOUDFLARE_PAGES_PROJECT || "domain-lander";
  if (!CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ACCOUNT_ID) {
    console.error(
      "Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID (and optionally CLOUDFLARE_PAGES_PROJECT).",
    );
    process.exit(1);
  }

  const provider: DomainProvider = new CloudflareProvider(
    CLOUDFLARE_ACCOUNT_ID,
    project,
    CLOUDFLARE_API_TOKEN,
  );

  const apexes = [...new Set(loadDomains(process.argv.slice(2)).map(normalize))];
  if (apexes.length === 0) {
    console.error("No domains to add.");
    process.exit(1);
  }

  console.log(`Project: ${project}\n`);
  const dnsLines: string[] = ["DNS records to set (host\\ttype\\ttarget):"];

  for (const apex of apexes) {
    for (const host of [apex, `www.${apex}`]) {
      try {
        const r = await provider.addCustomDomain(host);
        console.log(`✓ ${host} — ${r.added ? "added" : r.note ?? "ok"}`);
        dnsLines.push(provider.dnsInstructions(host));
      } catch (err) {
        console.error(`✗ ${host} — ${(err as Error).message}`);
      }
    }
  }

  console.log("\n" + dnsLines.join("\n"));
  console.log(
    "\nNote: apex records depend on where each domain's DNS is hosted. After the\n" +
      "API call, the Cloudflare Pages UI shows the exact A/AAAA or CNAME values to\n" +
      "use if the zone is not on Cloudflare.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
