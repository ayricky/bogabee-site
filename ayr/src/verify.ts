// "Check the live site", as code. The probes are planned when the draft is
// made, so the review page lists them, and `ayr release run` runs them after
// the deploy.
//
// A release has gone live when every file it changed is served by production
// exactly as committed. That is a stronger fact than "the homepage answers
// 200", and it needs no version file on the site.

import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import type { ClientConfig } from './config.ts';
import { IMAGE, type Entry } from './notes.ts';
import { sha256Hex, type Probe, type Sha256 } from './types.ts';

export const MAX_PROBES = 40;
export const VERIFY_DEADLINE_MS = 3 * 60_000; // edge propagation; retried with backoff until then
export const USER_AGENT = 'AYR release check (+https://ayrsoftware.com)';

const FIRST_RETRY_MS = 1000;
const MAX_RETRY_MS = 15_000;
const REQUEST_TIMEOUT_MS = 15_000;


const LINK = /(?<!!)\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const TITLE = /<title[^>]*>([\s\S]*?)<\/title>/i;

/**
 * Pure. In priority order, capped at MAX_PROBES:
 * 1. every picture in the entry (bytes),
 * 2. the history page, containing the new heading (page), when updatesUrl is set,
 * 3. every page the entry links to (page, containing its own <title>),
 * 4. the homepage, containing config.monitor.expect if set (page),
 * 5. other files under deploy.dir changed since the last release: non-HTML as bytes, HTML as page.
 * `tree` reads a file at the release commit and throws for one that isn't there.
 * `changed` comes from git diff --name-only.
 */
export function planProbes(input: {
  entry: Entry | null;
  changed: string[];
  tree: (path: string) => Uint8Array;
  config: ClientConfig;
}): Probe[] {
  const { entry, changed, tree, config } = input;
  if (!config.release) throw new Error(`${config.slug} has no release block, so there is nothing to probe.`);
  const dir = config.release.deploy.dir.replace(/^\.\/|\/+$/g, '') || '.';
  const prefix = dir === '.' ? '' : `${dir}/`;
  const site = new URL(config.site);
  const read = (file: string): Uint8Array | null => {
    try {
      return tree(file);
    } catch {
      return null;
    }
  };
  const fileOf = (url: URL): string => posix.join(dir, decodeURIComponent(url.pathname));
  // A page's own title, read from the HTML Pages would serve for that URL.
  const titleAt = (url: URL): string | null => {
    const path = fileOf(url);
    for (const file of path.endsWith('/') ? [`${path}index.html`] : [path, `${path}.html`, `${path}/index.html`]) {
      const bytes = read(file);
      if (bytes) return titleOf(bytes);
    }
    return null;
  };
  const onSite = (raw: string): URL | null => {
    try {
      const url = new URL(raw, site);
      const bare = (host: string) => host.replace(/^www\./, '');
      // Probed on the site's own origin, so every probe shares it.
      return url.protocol === 'https:' && bare(url.hostname) === bare(site.hostname) ? new URL(url.pathname + url.search, site) : null;
    } catch {
      return null;
    }
  };

  const probes: Probe[] = [];
  const seen = new Set<string>();
  const add = (url: URL, expect: Probe['expect']) => {
    const href = withoutHash(url);
    if (seen.has(href)) return;
    seen.add(href);
    probes.push({ url: href, expect });
  };
  const bytesProbe = (url: URL, bytes: Uint8Array) => add(url, { kind: 'bytes', sha256: sha256Sync(bytes) });
  const pageProbe = (url: URL, contains: string | null) => add(url, { kind: 'page', contains: contains || '<html' });

  const body = entry?.body ?? '';
  for (const [, , raw = ''] of body.matchAll(IMAGE)) {
    const url = onSite(raw);
    const bytes = url && read(fileOf(url));
    if (url && bytes) bytesProbe(url, bytes);
  }
  if (entry && config.updatesUrl) pageProbe(new URL(config.updatesUrl), entry.heading);
  for (const [, raw = ''] of body.matchAll(LINK)) {
    const url = onSite(raw);
    if (url) pageProbe(url, titleAt(url));
  }
  const home = new URL('/', site);
  pageProbe(home, config.monitor?.expect ?? titleAt(home));
  for (const file of changed) {
    if (!file.startsWith(prefix)) continue;
    const path = `/${file.slice(prefix.length)}`; // "/about/index.html"
    if (/^\/_(headers|redirects|routes\.json)$/.test(path)) continue; // Pages reads these, never serves them
    const bytes = read(file);
    if (!bytes) continue; // deleted in this release
    if (path.endsWith('.html')) pageProbe(new URL(pageUrl(path), site), titleOf(bytes));
    else bytesProbe(new URL(path, site), bytes);
  }
  return probes.slice(0, MAX_PROBES);
}

// Where Pages serves an HTML file: /about.html at /about, /about/index.html at /about/.
function pageUrl(path: string): string {
  if (path.endsWith('/index.html')) return path.slice(0, -'index.html'.length);
  return path.slice(0, -'.html'.length);
}

function titleOf(bytes: Uint8Array): string | null {
  const title = TITLE.exec(new TextDecoder().decode(bytes))?.[1]?.trim();
  return title ? title : null;
}

function withoutHash(url: URL): string {
  const copy = new URL(url);
  copy.hash = '';
  return copy.href;
}

// Same value as sha256Hex, synchronously, so planning stays a plain function.
function sha256Sync(bytes: Uint8Array): Sha256 {
  return createHash('sha256').update(bytes).digest('hex') as Sha256;
}

export interface ProbeResult {
  probe: Probe;
  ok: boolean;
  detail: string; // "200, bytes match" or "404" or "200, text missing" or "timed out"
}

/**
 * Runs every probe until all pass or `deadline` (epoch ms) passes. Probes
 * that pass are not fetched again; the rest are retried with backoff. Never
 * throws: a failure is a result. no-store, our own User-Agent.
 */
export async function runProbes(probes: Probe[], fetcher: typeof fetch, deadline: number): Promise<ProbeResult[]> {
  const results = new Map<Probe, ProbeResult>();
  let pending = probes;
  let delay = FIRST_RETRY_MS;
  for (;;) {
    const round = await Promise.all(pending.map(probe => runProbe(probe, fetcher, deadline)));
    for (const result of round) results.set(result.probe, result);
    pending = round.filter(result => !result.ok).map(result => result.probe);
    const left = deadline - Date.now();
    if (pending.length === 0 || left <= 0) break;
    await new Promise(resolve => setTimeout(resolve, Math.min(delay, left)));
    delay = Math.min(delay * 2, MAX_RETRY_MS);
  }
  return probes.map(probe => results.get(probe) as ProbeResult);
}

async function runProbe(probe: Probe, fetcher: typeof fetch, deadline: number): Promise<ProbeResult> {
  const result = (ok: boolean, detail: string): ProbeResult => ({ probe, ok, detail });
  const timeout = Math.max(1000, Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now()));
  try {
    const response = await fetcher(probe.url, {
      headers: { 'user-agent': USER_AGENT, 'cache-control': 'no-store', pragma: 'no-cache' }, // Node's fetch keeps no cache of its own
      redirect: 'follow',
      signal: AbortSignal.timeout(timeout),
    });
    if (response.status !== 200) {
      await response.body?.cancel();
      return result(false, String(response.status));
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (probe.expect.kind === 'bytes') {
      return (await sha256Hex(bytes)) === probe.expect.sha256 ? result(true, '200, bytes match') : result(false, '200, bytes differ');
    }
    return new TextDecoder().decode(bytes).includes(probe.expect.contains) ? result(true, '200, text found') : result(false, '200, text missing');
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') return result(false, 'timed out');
    return result(false, `no answer: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** One line for the owner: "3 of 12 failed: /updates answered 404, …". */
export function describeFailures(results: ProbeResult[]): string {
  const failed = results.filter(result => !result.ok);
  if (failed.length === 0) return `All ${results.length} checks passed.`;
  const shown = failed.slice(0, 5).map(({ probe, detail }) => `${where(probe.url)} ${plain(detail)}`);
  const more = failed.length > shown.length ? `, and ${failed.length - shown.length} more` : '';
  return `${failed.length} of ${results.length} failed: ${shown.join(', ')}${more}.`;
}

function where(url: string): string {
  try {
    const { pathname, search } = new URL(url);
    return pathname + search;
  } catch {
    return url;
  }
}

function plain(detail: string): string {
  if (/^\d{3}$/.test(detail)) return `answered ${detail}`;
  if (detail === '200, bytes differ') return 'came back different from the release';
  if (detail === '200, text missing') return 'answered without the expected text';
  return detail;
}
