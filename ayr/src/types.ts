// The small types a release is described with, and the one hash they share.

/** A full 40-hex git commit id. */
export type Sha = string & { readonly __brand: 'Sha' };
/** A 64-hex SHA-256. */
export type Sha256 = string & { readonly __brand: 'Sha256' };
/** prod-<YYYY-MM-DD>-<short sha of commit>. Also the Resend idempotency key's suffix: <slug>-<tag>. */
export type ProdTag = `prod-${string}`;
/** YYYY-MM-DD in the client's time zone. */
export type IsoDate = string & { readonly __brand: 'IsoDate' };

/**
 * One thing the live check fetches from production after the deploy.
 * `bytes`: a file this release changed, which must come back byte for byte.
 * `page`: an HTML page, which must answer 200 and contain the text (HTML can be
 * rewritten on the way out by zone features, so it isn't compared byte for byte).
 */
export interface Probe {
  url: string;
  expect: { kind: 'bytes'; sha256: Sha256 } | { kind: 'page'; contains: string };
}

export interface ChangeSummary {
  id: string;
  kind: 'item' | 'hood' | 'quiet';
  line: string; // the lead for an item, the sentence for hood, the reason for quiet: shown on the review page
}

/** Lowercase hex SHA-256 of bytes. */
export async function sha256Hex(bytes: Uint8Array | string): Promise<Sha256> {
  const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('') as Sha256;
}
