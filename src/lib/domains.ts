import { normalizeHostname } from "./host";

export interface DomainListing {
  /** Canonical, normalized domain, e.g. "pixart.ai". */
  domain: string;
  status: "for-sale" | "sold" | "hidden";
  /** Buy Now price. Omit => offer-only. Ignored when sensitive. */
  bin?: number;
  /** Default "USD". */
  currency?: string;
  /**
   * External Buy Now link (marketplace / escrow). The app NEVER processes
   * payment itself — this is only ever an outbound link.
   */
  buyUrl?: string;
  /** Show the make-an-offer form. */
  offers: boolean;
  /** Short positioning line. IGNORED when sensitive=true. */
  tagline?: string;
  /**
   * Trademark-adjacent. Forces strictly generic copy: suppresses tagline,
   * price, Buy Now, and any urgency. The page reads as a neutral listing.
   */
  sensitive?: boolean;
  /** Optional hex accent, e.g. "#5b8cff". */
  accent?: string;
}

/**
 * The registry. Keys MUST be normalized hosts (lowercase, no port, no "www.").
 * Adding a domain here is only required to attach a price/tagline/accent — the
 * fallback below renders a safe page for any unknown host with no code change.
 */
export const listings: Record<string, DomainListing> = {
  "pixart.ai": {
    domain: "pixart.ai",
    status: "for-sale",
    offers: true,
    sensitive: true,
  },
  // Example non-sensitive entry (commented — illustrative only):
  // "example.ai": {
  //   domain: "example.ai",
  //   status: "for-sale",
  //   bin: 7500,
  //   currency: "USD",
  //   buyUrl: "https://www.afternic.com/domain/example.ai",
  //   offers: true,
  //   tagline: "A short brandable for AI tooling.",
  //   accent: "#5b8cff",
  // },
};

/**
 * Synthesize the safe default for an unregistered host. Strictly generic,
 * offer-only, no price — and flagged sensitive so all generic-copy rules apply.
 */
export function fallbackListing(host: string): DomainListing {
  return {
    domain: host,
    status: "for-sale",
    offers: true,
    sensitive: true,
  };
}

/**
 * Resolve a (already-normalized or raw) host to a listing. Returns the registry
 * entry when present, otherwise the synthesized sensitive fallback. Never throws.
 */
export function resolveListing(host: string): DomainListing {
  const normalized = normalizeHostname(host);
  const entry = normalized ? listings[normalized] : undefined;
  if (entry) return entry;
  return fallbackListing(normalized || "this domain");
}
