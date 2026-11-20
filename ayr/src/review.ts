// What the owner reads before saying "send it": the files of the review
// directory, and the page that shows them.
//
//   index.html    this page
//   email.html    the client's email (none for a quiet release)
//   video.mp4     the recording, when there is one
//   <picture>.jpg each picture of this release, read back from the draft commit
//   review.json   Review: what the page shows, and what `ayr release run` checks git against
//   status.json   Status: where the release stands, read by the page every two seconds

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { ChangeSummary, IsoDate, Probe, ProdTag, Sha, Sha256 } from './types.ts';

export const PAGE_FILE = 'index.html';
export const EMAIL_FILE = 'email.html';
export const VIDEO_FILE = 'video.mp4';
export const REVIEW_FILE = 'review.json';
export const STATUS_FILE = 'status.json';
/** Where the page asks whether it has buttons, relative to itself. `ayr release serve` answers it; a plain file server does not. */
export const API = 'api/release';

/** Everything here comes from git at the draft commit, except the video. */
export interface Review {
  version: 1;
  slug: string;
  repo: string;
  commit: Sha; // the draft commit: what deploys, byte for byte
  base: Sha; // its parent
  date: IsoDate;
  tag: ProdTag;
  heading: string | null; // null when nothing is told: a quiet release
  to: string[]; // empty for a quiet release
  changes: ChangeSummary[];
  prs: number[];
  /** From git: each picture's change, file name, and the address the email's copy names, a GitHub Release asset. */
  pictures: { id: string; file: string; url: string }[];
  /** Not in git: each picture's file as the draft made it, by its hash. They go in the email only, never on the site or in the repo. */
  shots: { file: string; sha256: Sha256; bytes: number }[];
  video: { name: string; sha256: Sha256; bytes: number } | null;
  probes: Probe[];
}

export const STEP_IDS = ['checks', 'deploy', 'live', 'record', 'email'] as const;
export type StepId = (typeof STEP_IDS)[number];
export type StepState = 'wait' | 'now' | 'ok' | 'failed';
export type FailedAt = 'review' | StepId;

export interface Status {
  version: 1;
  state: 'draft' | 'releasing' | 'done' | 'rehearsed' | 'failed' | 'withdrawn';
  tag: ProdTag;
  steps: { id: StepId; label: string; state: StepState; detail?: string }[];
  failure?: { at: FailedAt; reason: string; rolledBack: boolean };
  links?: { site?: string; release?: string; run?: string };
  updatedAt: string;
}

/** What each step is called on the page: what it will do, is doing, did, or failed at. A step that hasn't finished never reads as done. */
const LABELS: Record<StepId, Record<StepState, string>> = {
  checks: { wait: 'Run the checks', now: 'Waiting for checks', ok: 'Checks passed', failed: 'Checks failed' },
  deploy: { wait: 'Put live', now: 'Putting it live', ok: 'Put live', failed: 'Going live failed' },
  live: { wait: 'Check the live site', now: 'Checking the live site', ok: 'Live site checked', failed: 'Live check failed' },
  record: { wait: 'Tag the release', now: 'Tagging the release', ok: 'Release tagged', failed: 'Tagging failed' },
  email: { wait: 'Email the client', now: 'Emailing the client', ok: 'Client emailed', failed: 'Client email failed' },
};

export function stepLabel(id: StepId, state: StepState): string {
  return LABELS[id][state];
}

/**
 * What a press on the page names besides the commit: this exact review, pictures' and video's hashes
 * included. A draft rebuilt with new pictures keeps its commit, so a page left open from before would
 * otherwise release pictures nobody looked at.
 */
export function reviewDigest(review: Review): string {
  return createHash('sha256').update(JSON.stringify(review)).digest('hex');
}

const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');

/** review.json, checked at the boundary. Throws for a file this version did not write. */
export function parseReview(json: string): Review {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(json);
  } catch {
    // refused below
  }
  const raw: Partial<Record<keyof Review, unknown>> = typeof parsed === 'object' && parsed !== null ? parsed : {};
  const text = (['slug', 'repo', 'commit', 'base', 'date', 'tag'] as const).every(key => typeof raw[key] === 'string');
  const lists = [raw.changes, raw.pictures, raw.shots, raw.probes, raw.prs].every(Array.isArray);
  const video = raw.video as Review['video'] | undefined;
  const videoOk = video === null || (typeof video?.name === 'string' && typeof video.sha256 === 'string');
  if (raw.version !== 1 || !text || !lists || !strings(raw.to) || !(raw.heading === null || typeof raw.heading === 'string') || !videoOk) {
    throw new Error(`${REVIEW_FILE} is not a review this version of the kit wrote.`);
  }
  return raw as Review;
}

// ── The page ───────────────────────────────────────────────────────────────

const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);

/** Bold and link markers taken out of a change's line, which is Markdown. */
const plain = (line: string): string => line.replace(/\*\*|__/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');

// HTML's own white space. A no-break space is not one: it is part of a name.
const SPACE = '\t\n\f\r ';
/** Elements whose content is text, never tags. */
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext']);

/**
 * The start tags of some HTML, in order, each with the first value of every attribute, undecoded.
 * Read from the front one tag at a time as a browser does, so a "<a" inside another tag's
 * attribute, a comment or a script is never taken for a tag. Stops at a tag that never closes.
 */
function startTags(html: string): { name: string; attributes: Map<string, string> }[] {
  const tags: { name: string; attributes: Map<string, string> }[] = [];
  const until = (from: number, stop: string): number => {
    let at = from;
    while (at < html.length && !stop.includes(html[at] ?? '')) at += 1;
    return at;
  };
  const past = (from: number, skip: string): number => {
    let at = from;
    while (at < html.length && skip.includes(html[at] ?? '')) at += 1;
    return at;
  };
  let at = 0;
  for (;;) {
    at = html.indexOf('<', at);
    if (at === -1) return tags;
    if (html.startsWith('<!--', at)) {
      const end = html.indexOf('-->', at + 4);
      if (end === -1) return tags;
      at = end + 3;
      continue;
    }
    if (!/[A-Za-z]/.test(html[at + 1] ?? '')) {
      at += 1;
      continue;
    }
    let next = until(at + 1, `${SPACE}/>`);
    const name = html.slice(at + 1, next).toLowerCase();
    const attributes = new Map<string, string>();
    for (;;) {
      next = past(next, `${SPACE}/`);
      if (next >= html.length) return tags;
      if (html[next] === '>') break;
      const nameEnd = until(next + 1, `${SPACE}/=>`); // a name may begin with "="
      const attribute = html.slice(next, nameEnd).toLowerCase();
      next = past(nameEnd, SPACE);
      let value = '';
      if (html[next] === '=') {
        next = past(next + 1, SPACE);
        const quote = html[next];
        if (quote === '"' || quote === "'") {
          const close = html.indexOf(quote, next + 1);
          if (close === -1) return tags;
          value = html.slice(next + 1, close);
          next = close + 1;
        } else {
          const end = until(next, `${SPACE}>`);
          value = html.slice(next, end);
          next = end;
        }
      }
      if (!attributes.has(attribute)) attributes.set(attribute, value);
    }
    tags.push({ name, attributes });
    at = next + 1;
    if (RAW_TEXT.has(name)) {
      const close = html.toLowerCase().indexOf(`</${name}`, at);
      if (close === -1 || name === 'plaintext') return tags;
      at = close;
    }
  }
}

const NAMED = new Map([['amp', '&'], ['lt', '<'], ['gt', '>'], ['quot', '"'], ['apos', "'"]]);
/**
 * An attribute's value with its character references read as a browser reads them. Null when the
 * kit can't be sure what a browser would make of one: a named reference other than the five this
 * kit writes (it carries no table of the two thousand), or a number HTML treats specially, such
 * as a control character or the range it reads as Windows-1252. A guess would name the wrong address.
 */
function decodeAttribute(value: string): string | null {
  let unknown = false;
  const decoded = value.replace(/&(?:#(\d+);?|#[xX]([0-9a-fA-F]+);?|([A-Za-z][A-Za-z0-9]*)(;?))/g, (whole, decimal?: string, hex?: string, name?: string, semicolon?: string, at?: number) => {
    if (name === undefined) {
      const code = decimal !== undefined ? Number(decimal) : parseInt(hex ?? '', 16);
      const plain = code >= 0x20 && code <= 0x10ffff && !(code >= 0x7f && code <= 0x9f) && !(code >= 0xd800 && code <= 0xdfff) && !(code >= 0xfdd0 && code <= 0xfdef) && (code & 0xfffe) !== 0xfffe;
      if (plain) return String.fromCodePoint(code);
      unknown = true;
      return whole;
    }
    // In an attribute, a name with no semicolon that runs into a letter, a digit or "=" is plain text: "?a=1&b=2".
    const next = value[(at ?? 0) + whole.length] ?? '';
    if (semicolon === '' && /[A-Za-z0-9=]/.test(next)) return whole;
    const known = NAMED.get(name);
    if (known !== undefined && (semicolon === ';' || name !== 'apos')) return known;
    unknown = true;
    return whole;
  });
  return unknown ? null : decoded;
}

/** An absolute http or https address, or null. */
function web(address: string): URL | null {
  try {
    const url = new URL(address);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

/**
 * The pages on the client's site that the email links to, in its order, each once, written the
 * way a browser writes them (the root is `<site>/`). Read from the email's own HTML, so each
 * address is the one a tap in the email opens. The owner opens these on staging to try the change
 * before it is live. A link the kit can't read with certainty is left out, never guessed.
 */
export function linkedPages(emailHtml: string, site: string): string[] {
  const home = web(site)?.origin;
  const found = startTags(emailHtml).flatMap(tag => {
    const href = tag.name === 'a' ? tag.attributes.get('href') : undefined;
    const url = href === undefined ? null : web(decodeAttribute(href) ?? '');
    return url && url.origin === home ? [url.href] : [];
  });
  return [...new Set(found)];
}

// The page wears AYR's own sheet: the blueprint blue, the drafting grid, the three faces and the
// mark, all from ayrsoftware.com. They are inlined, so the page asks nothing of the network.
const asset = (name: string): Buffer => readFileSync(new URL(`./assets/${name}`, import.meta.url));
let dress: { fonts: string; logo: string } | null = null;
function ayr(): { fonts: string; logo: string } {
  if (dress) return dress;
  const face = (family: string, file: string, weight: string, more = ''): string =>
    `@font-face { font-family: "${family}"; font-style: normal; font-display: swap; font-weight: ${weight}; ${more}src: url(data:font/woff2;base64,${asset(file).toString('base64')}) format("woff2"); }`;
  dress = {
    fonts: [
      face('AYR Display', 'display.woff2', '600 800', 'font-stretch: 75% 100%; '),
      face('AYR Body', 'body.woff2', '400 700'),
      face('AYR Mono', 'mono.woff2', '100 800'),
    ].join('\n'),
    logo: `<span class="logo">${asset('ayr-mark.svg').toString('utf8')}${asset('ayr-word.svg').toString('utf8')}<span class="sr">AYR Software</span></span>`,
  };
  return dress;
}

const CSS = `
:root { color-scheme: dark; --bg: #071a3f; --panel: #0d2758; --ink: #eef4ff; --slate: #a3b6de; --pencil: #4fd8ff; --signal: #ffc94d; --live: #5fe39a; --danger: #ffa094; --line: rgb(238 244 255 / .14); --strong: rgb(238 244 255 / .34); --display: "AYR Display", "Arial Narrow", system-ui, sans-serif; --body: "AYR Body", system-ui, -apple-system, "Segoe UI", sans-serif; --mono: "AYR Mono", ui-monospace, "SFMono-Regular", Menlo, monospace; }
* { box-sizing: border-box; }
html { background: var(--bg); }
body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.5 var(--body); -webkit-text-size-adjust: 100%; }
main { max-width: 760px; margin: 0 auto; padding: 18px 16px 150px; }
p { margin: 8px 0; }
ul, ol { margin: 0; padding: 0; list-style: none; }
a { color: var(--pencil); text-underline-offset: 3px; overflow-wrap: anywhere; }
a:hover { color: var(--ink); }
a:focus-visible, summary:focus-visible { outline: 2px solid var(--pencil); outline-offset: 3px; border-radius: 2px; }
code, .mono { font-family: var(--mono); font-size: .9em; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
[hidden] { display: none !important; }

.top { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.logo { --u: .17px; display: inline-flex; align-items: flex-start; gap: calc(var(--u) * 62); color: var(--ink); }
.logo svg:nth-child(1) { height: calc(var(--u) * 180.1); width: auto; }
.logo svg:nth-child(2) { height: calc(var(--u) * 68.2); width: auto; margin-top: calc(var(--u) * 31.9); }
.chip { padding: 5px 11px; border-radius: 999px; border: 1px solid var(--strong); font: 600 12px/1.2 var(--mono); letter-spacing: .04em; text-transform: uppercase; white-space: nowrap; }
.chip[data-state="releasing"] { color: var(--pencil); border-color: currentColor; }
.chip[data-state="done"], .chip[data-state="rehearsed"] { color: var(--live); border-color: currentColor; }
.chip[data-state="failed"] { color: var(--danger); border-color: currentColor; }
.eyebrow { margin: 30px 0 8px; font: 500 12px/1.2 var(--mono); letter-spacing: .1em; text-transform: uppercase; color: var(--slate); }
h1 { margin: 0; font: 700 clamp(2.2rem, 1.4rem + 4vw, 3.4rem)/1 var(--display); font-stretch: 85%; letter-spacing: -.01em; text-wrap: balance; }
#lede { margin: 10px 0 0; color: var(--slate); font-size: 17px; }
#failure { margin-top: 14px; padding: 11px 13px; border: 1px solid var(--danger); border-radius: 4px; color: var(--danger); overflow-wrap: anywhere; }
#links { margin-top: 12px; }
#links a { margin-right: 18px; font-weight: 600; }

.tl { margin: 32px 0 0; padding-left: 38px; }
.node { position: relative; padding: 0 0 28px; }
.node::before { content: ""; position: absolute; left: -27px; top: 28px; bottom: 2px; width: 2px; background: var(--line); }
.node:last-child::before { display: none; }
.node[data-s="ok"]::before { background: var(--live); }
.dot { position: absolute; left: -38px; top: 0; width: 24px; height: 24px; border: 2px solid var(--strong); border-radius: 50%; background: var(--bg); }
.node[data-s="ok"] .dot { border-color: var(--live); background: var(--live) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M3.5 8.5l3 3 6-7' fill='none' stroke='%23071a3f' stroke-width='2.2' stroke-linecap='round'/%3E%3C/svg%3E") center / 14px no-repeat; }
.node[data-s="now"] .dot { border-color: var(--pencil); background: radial-gradient(var(--pencil) 0 4px, var(--bg) 5px); animation: ping 1.4s ease-out infinite; }
.node[data-s="here"] .dot { --ping: rgb(255 201 77 / .55); border-color: var(--signal); background: radial-gradient(var(--signal) 0 5px, var(--bg) 6px); animation: ping 1.8s ease-out infinite; }
.node[data-s="failed"] .dot { border-color: var(--danger); background: var(--danger) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M4.5 4.5l7 7M11.5 4.5l-7 7' fill='none' stroke='%23071a3f' stroke-width='2.2' stroke-linecap='round'/%3E%3C/svg%3E") center / 13px no-repeat; }
@keyframes ping { 0% { box-shadow: 0 0 0 0 var(--ping, rgb(79 216 255 / .55)); } 100% { box-shadow: 0 0 0 11px transparent; } }
@media (prefers-reduced-motion: reduce) { .node .dot { animation: none !important; } }
.node h3 { margin: 0; font: 600 17px/24px var(--body); }
.node[data-s="wait"] h3 { color: var(--slate); font-weight: 500; }
.node[data-s="here"] h3 { color: var(--signal); }
.node[data-s="failed"] h3, .node[data-s="failed"] .meta { color: var(--danger); }
.meta { margin: 2px 0 0; color: var(--slate); font-size: 14.5px; overflow-wrap: anywhere; }

details.look { margin-top: 12px; background: var(--panel); border: 1px solid var(--line); border-radius: 6px; }
details.look > summary { padding: 12px 16px; font: 500 11.5px/1.2 var(--mono); letter-spacing: .1em; text-transform: uppercase; color: var(--slate); cursor: pointer; }
details.look[open] > summary { padding-bottom: 0; }
.part { padding: 0 16px 16px; scroll-margin-top: 16px; }
.part:first-of-type { padding-top: 14px; }
.part + .part { padding-top: 12px; }
.part > h4 { margin: 0 0 10px; font: 500 11.5px/1.2 var(--mono); letter-spacing: .1em; text-transform: uppercase; color: var(--slate); }
.sheet { overflow: hidden; background: #fff; border-radius: 4px; }
iframe { display: block; width: 100%; height: 640px; border: 0; background: #fff; }
figure { margin: 0 0 18px; }
figure:last-child { margin-bottom: 0; }
figure a { display: block; }
img, video { display: block; width: 100%; height: auto; border-radius: 4px; }
figcaption { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 4px 16px; margin-top: 8px; font-size: 14.5px; }
figcaption a, .rows .go a { font-size: 14px; font-weight: 600; white-space: nowrap; }
.rows li { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 4px 16px; padding: 10px 0; border-top: 1px solid var(--line); overflow-wrap: anywhere; }
.rows li:first-child { border-top: 0; }
.rows .go { display: flex; gap: 16px; }
.rows small { flex-basis: 100%; color: var(--slate); font-size: 13.5px; }
details.checks > summary { margin-top: 2px; color: var(--pencil); font-size: 14.5px; cursor: pointer; }
details.checks > ul { margin-top: 6px; }

#bar { position: fixed; left: 0; right: 0; bottom: 0; padding: 12px 16px calc(12px + env(safe-area-inset-bottom)); background: rgb(7 26 63 / .94); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); border-top: 1px solid var(--line); text-align: center; }
#bar p { margin: 0; }
#say { font-size: 15px; font-weight: 600; }
#say code { padding: 1px 5px; border: 1px solid var(--strong); border-radius: 3px; }
#act { display: flex; gap: 10px; max-width: 728px; margin: 0 auto; }
#act button { min-height: 48px; padding: 0 16px; border: 2px solid var(--ink); border-radius: 4px; background: transparent; color: var(--ink); font: 700 16px/1.2 var(--body); cursor: pointer; }
#act button:focus-visible { outline: 3px solid var(--pencil); outline-offset: 2px; }
#act button:disabled { opacity: .5; cursor: default; }
#release { flex: 1; background: var(--ink) !important; color: var(--bg) !important; }
#release[data-armed="yes"] { background: var(--signal) !important; border-color: var(--signal) !important; color: #1b1400 !important; }
#told { margin-top: 8px !important; color: var(--slate); font-size: 14px; overflow-wrap: anywhere; }
`;

// Reads status.json every two seconds and redraws the chip and the steps. Every
// value goes in with textContent or setAttribute, never as HTML. A missing or
// half-written file keeps what the page already shows.
const SCRIPT = `
(function () {
  var CHIP = { draft: 'Draft, not sent', releasing: 'Releasing', done: 'Released', rehearsed: 'Tested on a preview', failed: 'Stopped', withdrawn: 'Taken back' };
  var el = function (id) { return document.getElementById(id); };
  var web = function (text) { return /^https:\\/\\/\\S+$/.test(text); };
  function link(href, text) {
    var a = document.createElement('a');
    if (web(href)) { a.setAttribute('href', href); a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener'); }
    a.textContent = text;
    return a;
  }
  // The bar. A draft can be sent, and so can one that was only rehearsed. Under a plain file server
  // the bar says how to send it in the thread. Under \`ayr release serve\` it has the buttons.
  var STEPS = ['checks', 'deploy', 'live', 'record', 'email'];
  var state = 'draft';
  var refused = false; // the last run stopped before it started anything, so the draft is still the owner's to send
  var api = null;
  var armed = null;
  var asking = false;
  var note = ''; // what the last press came to: that it is starting, or why it was refused
  function tell(text) {
    if (!el('told')) return;
    el('told').textContent = text;
    el('told').hidden = !text;
  }
  function disarm() {
    if (armed) clearTimeout(armed);
    armed = null;
    var button = el('release');
    if (!button) return;
    button.textContent = button.getAttribute('data-label');
    button.setAttribute('data-armed', 'no');
  }
  function bar() {
    var busy = asking || !!(api && api.running);
    // A run the server saw end badly while status.json still says releasing was cut off before it could say so.
    var cut = state === 'releasing' && !!api && !api.running && !!api.last && !api.last.ok;
    var open = state === 'draft' || state === 'rehearsed' || refused || cut;
    if (el('bar')) el('bar').hidden = !open;
    if (el('say')) el('say').hidden = !!api;
    if (el('act')) el('act').hidden = !api || cut;
    if (el('release')) el('release').disabled = busy;
    if (el('rehearse')) el('rehearse').disabled = busy;
    if (!open || busy) disarm();
    // One line under the buttons, the first of: what this tab's press came to; that a run is starting,
    // for a tab opened meanwhile; why the last run stopped before it wrote any progress.
    var text = note;
    if (!text && api && api.running) text = api.running.rehearsal ? 'A test is starting' : 'A release is starting';
    if (!text && api && api.last && !api.last.ok) text = (cut ? 'The release stopped before it finished. Ask in the thread. ' : '') + String(api.last.message);
    tell(open ? text : '');
    // status.json still says releasing, but the server saw the run end badly: the page must not say it keeps going.
    if (cut && el('head')) {
      el('chip').textContent = 'Stopped';
      el('chip').setAttribute('data-state', 'failed');
      el('head').textContent = el('head').getAttribute('data-failed');
      el('lede').textContent = 'It stopped before it finished.';
      el('lede').hidden = false;
      STEPS.forEach(function (id) { var node = el('step-' + id); if (node && node.getAttribute('data-s') === 'now') node.setAttribute('data-s', 'failed'); });
    }
  }
  var asked = 0;
  var answered = 0;
  function ask() {
    var mine = ++asked;
    fetch('${API}', { cache: 'no-store' })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (answer) {
        // An answer that took longer than a later one is old news.
        if (mine < answered || !answer || answer.version !== 1 || typeof answer.token !== 'string') return;
        answered = mine;
        // The run this tab was told about has ended: what it came to is in the answer, or on the page.
        if (api && api.running && !answer.running) note = '';
        api = answer;
        bar();
      })
      .catch(function () {});
  }
  function press(rehearsal) {
    if (!api || asking) return;
    asking = true;
    note = '';
    bar();
    fetch('${API}', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: api.token, commit: el('release').getAttribute('data-commit'), review: el('release').getAttribute('data-review'), rehearsal: rehearsal }) })
      .then(function (response) { return response.json().then(function (answer) { return { ok: response.ok, answer: answer }; }); })
      .then(function (got) {
        asking = false;
        if (got.ok) {
          // No answer asked before this press may undo it, including one still on its way.
          asked += 1;
          answered = asked;
          api.running = { rehearsal: rehearsal };
          api.last = null;
          note = rehearsal ? 'Starting the test' : 'Starting the release';
        } else note = String(got.answer && got.answer.error || 'That did not start.');
        bar();
      })
      .catch(function () { asking = false; note = 'The page could not reach its server. Reload it, or say “send it” in the thread.'; bar(); });
  }
  if (el('release')) el('release').addEventListener('click', function () {
    // Two taps: the first says what it will do, the second does it.
    if (!armed) {
      el('release').textContent = el('release').getAttribute('data-confirm');
      el('release').setAttribute('data-armed', 'yes');
      armed = setTimeout(disarm, 6000);
      return;
    }
    disarm();
    press(false);
  });
  if (el('rehearse')) el('rehearse').addEventListener('click', function () { disarm(); press(true); });

  // The timeline. Merged and Drafted are history. The review is where the owner is until a release
  // starts. Each later step is a node status.json names by id. A rehearsal runs the first three on
  // a preview and never tags or emails, so its run hides those two, and a passed one leaves the
  // nodes as they were: the real release is still ahead.
  function find(steps, id) { for (var i = 0; i < steps.length; i += 1) if (steps[i] && steps[i].id === id) return steps[i]; return null; }
  function fill(target, text) {
    target.textContent = '';
    // A detail that is one address, such as the live site or the rehearsal's preview, opens when tapped.
    if (web(text)) target.appendChild(link(text, text));
    else target.textContent = text;
  }
  function draw(status) {
    if (!status || !CHIP[status.state] || !Array.isArray(status.steps)) return;
    var shown = status.state === 'releasing' || status.state === 'done' || status.state === 'failed';
    var rehearsal = status.steps.length > 0 && !find(status.steps, 'record');
    // Refused before it began, a run started nothing, release or rehearsal: the review is still where the owner is.
    refused = status.state === 'failed' && !!status.failure && status.failure.at === 'review';
    var going = shown && !rehearsal && !refused;
    el('chip').textContent = rehearsal && status.state === 'releasing' ? 'Testing on a preview' : CHIP[status.state];
    el('chip').setAttribute('data-state', status.state);
    state = status.state;
    STEPS.forEach(function (id) {
      var node = el('step-' + id);
      if (!node) return;
      var step = shown ? find(status.steps, id) : null;
      node.setAttribute('data-s', step ? String(step.state) : 'wait');
      el('label-' + id).textContent = step ? String(step.label) : node.getAttribute('data-label');
      fill(el('detail-' + id), step && step.detail ? String(step.detail) : node.getAttribute('data-detail'));
      node.hidden = shown && rehearsal && (id === 'record' || id === 'email');
    });
    var review = el('review');
    review.setAttribute('data-s', going ? 'ok' : 'here');
    el('review-title').textContent = going ? 'Approved' : 'Your review';
    el('review-meta').textContent = going ? 'The release started.'
      : status.state === 'rehearsed' ? 'The test passed. Release when ready.'
      : refused ? 'It did not start.'
      : shown ? (status.state === 'failed' ? 'The test stopped.' : 'Testing on a preview. Nothing goes live and nobody is emailed.')
      : review.getAttribute('data-meta');
    // What goes out folds away once it is going out, and stays one tap away.
    el('look').open = !going;
    var head = el('head');
    var key = going ? status.state : 'draft';
    head.textContent = head.getAttribute('data-' + key);
    var lede = head.getAttribute('data-' + key + '-lede');
    el('lede').textContent = lede;
    el('lede').hidden = !lede;
    var failed = status.state === 'failed' && status.failure;
    el('failure').hidden = !failed;
    el('failure').textContent = failed ? String(status.failure.reason) : '';
    var links = el('links');
    links.textContent = '';
    var to = status.links || {};
    if (status.state === 'done' && to.site) links.appendChild(link(String(to.site), 'Live site'));
    if (status.state === 'done' && to.release) links.appendChild(link(String(to.release), 'GitHub Release'));
    if (status.state === 'done' && to.run) links.appendChild(link(String(to.run), 'Email job'));
    if (status.state === 'rehearsed' && to.site) links.appendChild(link(String(to.site), 'Test preview'));
    links.hidden = !links.firstChild;
    bar();
  }
  var polled = 0;
  var drew = 0;
  function poll() {
    var mine = ++polled;
    fetch('${STATUS_FILE}', { cache: 'no-store' })
      .then(function (response) { return response.ok ? response.text() : ''; })
      .then(function (text) {
        // A read that took longer than a later one would put an older state back, and its buttons with it.
        if (mine < drew) return;
        drew = mine;
        try { draw(JSON.parse(text)); } catch (error) { /* half-written: the next read gets it */ }
      })
      .catch(function () {});
  }
  // The frame runs no scripts. Same-origin only lets this page read the email's height, so it shows whole.
  var email = el('email');
  function fit() {
    try { email.style.height = email.contentDocument.documentElement.scrollHeight + 'px'; } catch (error) { /* keeps its minimum height */ }
  }
  if (email) {
    email.addEventListener('load', function () { fit(); setTimeout(fit, 800); });
    fit();
  }
  poll();
  ask();
  setInterval(function () { poll(); if (api) ask(); }, 2000);
})();
`;

/** What the page needs of a client: its name, and where its site and its staging copy live. */
export interface ReviewClient {
  name: string;
  site?: string;
  release?: { staging?: string };
}

const count = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** "2026-11-16" as "November 16, 2026". The date is the client's own day, so no time zone moves it. */
const longDate = (date: string): string => {
  const at = new Date(`${date}T12:00:00Z`);
  return Number.isNaN(at.getTime()) ? date : at.toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' });
};

/**
 * Pure. One self-contained page: no outside requests, phone first. `pages` are the client's pages
 * the note links to (`linkedPages`), which the owner can open on staging.
 *
 * The page is the release's timeline: merged, drafted, the owner's review, then each step
 * `ayr release run` takes. The script moves it along as status.json changes.
 */
export function renderReviewPage(review: Review, client: ReviewClient, pages: string[] = []): string {
  const e = escapeHtml;
  const { fonts, logo } = ayr();
  const out = (href: string, text: string): string => `<a href="${e(href)}" target="_blank" rel="noopener">${e(text)}</a>`;
  const lineOf = new Map(review.changes.map(change => [change.id, plain(change.line)]));
  const told = review.changes.filter(change => change.kind !== 'quiet');
  const quiet = review.changes.filter(change => change.kind === 'quiet');
  const sends = review.heading !== null;
  const site = client.site;
  const host = site ? site.replace(/^https?:\/\//, '') : 'the live site';
  const staging = client.release?.staging;
  const home = site ? web(site)?.origin : undefined;
  /** A page's address without the site: "/start#book". The whole address when it is on another site. */
  const pathOf = (url: string): string => {
    const at = web(url);
    return at && at.origin === home ? `${at.pathname}${at.search}${at.hash}` : url;
  };
  const onStaging = (url: string): string | null => (staging && web(url)?.origin === home ? `${staging}${pathOf(url)}` : null);
  const rows = (items: string[]): string => `<ul class="rows">${items.map(item => `<li>${item}</li>`).join('')}</ul>`;
  const part = (id: string, title: string, body: string): string => `<div class="part" id="${id}">\n<h4>${title}</h4>\n${body}\n</div>`;
  const people = count(review.to.length, 'person', 'people');
  const checks = count(review.probes.length, 'check');

  // What goes out: everything the owner reads before releasing.
  const parts: string[] = [];
  if (sends) {
    parts.push(part('note', 'The note', `<div class="sheet"><iframe id="email" src="${EMAIL_FILE}" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" title="The email your client gets"></iframe></div>`));
  }
  if (review.pictures.length > 0) {
    parts.push(part('pictures', review.pictures.length === 1 ? 'Picture' : 'Pictures',
      review.pictures.map(picture => {
        const file = e(encodeURI(picture.file));
        return `<figure><a href="${file}" target="_blank" rel="noopener"><img src="${file}" alt="${e(lineOf.get(picture.id) ?? '')}"></a><figcaption><span>${e(lineOf.get(picture.id) ?? picture.id)}</span>${out(picture.file, 'Full size')}</figcaption></figure>`;
      }).join('\n')));
  }
  if (review.video) parts.push(part('recording', 'Recording', `<div class="sheet"><video controls playsinline preload="metadata" src="${VIDEO_FILE}"></video></div>`));
  if (pages.length > 0) {
    parts.push(part('try', staging ? 'Try it on staging' : 'Try it',
      rows(pages.map(url => {
        const there = onStaging(url);
        return `<span class="mono">${e(pathOf(url))}</span><span class="go">${there ? out(there, 'Staging') : ''}${out(url, 'Live')}</span>`;
      }))));
  }
  if (sends) parts.push(part('to', 'Emailed to', rows(review.to.map(address => e(address)))));
  const unsaid = sends ? quiet : review.changes;
  if (unsaid.length > 0) parts.push(part('quiet', sends ? 'Left out of the email' : 'In this release', rows(unsaid.map(change => e(plain(change.line))))));

  // A step's node, as it reads before the release: what it will do, and a detail. The script puts both back after a rehearsal.
  const step = (id: StepId, detail: string, more = ''): string => {
    const label = stepLabel(id, 'wait');
    return `<li class="node" id="step-${id}" data-s="wait" data-label="${e(label)}" data-detail="${e(detail)}"><span class="dot"></span><h3 id="label-${id}">${e(label)}</h3><p class="meta" id="detail-${id}">${e(detail)}</p>${more}</li>`;
  };
  const merged = review.prs.length > 0 ? review.prs.map(pr => out(`https://github.com/${review.repo}/pull/${pr}`, `#${pr}`)).join(', ') : 'No pull requests';
  const nodes = [
    `<li class="node" data-s="ok"><span class="dot"></span><h3>Merged</h3><p class="meta">${merged}</p></li>`,
    `<li class="node" data-s="ok"><span class="dot"></span><h3>Drafted</h3><p class="meta">${out(`https://github.com/${review.repo}/commit/${review.commit}`, review.commit.slice(0, 7))} · ${e(longDate(review.date))} · <span class="mono">${e(review.tag)}</span></p></li>`,
    `<li class="node" id="review" data-s="here" data-meta="Read it, try it, then release."><span class="dot"></span><h3 id="review-title">Your review</h3><p class="meta" id="review-meta">Read it, try it, then release.</p>
<details class="look" id="look" open><summary>What goes out</summary>
${parts.join('\n')}
</details></li>`,
    step('checks', 'On GitHub'),
    step('deploy', host),
    step('live', checks, `<details class="checks" id="checks"><summary>What is checked</summary>${rows(review.probes.map(probe => `${out(probe.url, probe.url.replace(/^https:\/\//, ''))}<small>${probe.expect.kind === 'page' ? `Must show “${e(probe.expect.contains)}”` : 'Must match the file in this release'}</small>`))}</details>`),
    step('record', review.tag),
    ...(sends ? [step('email', people)] : []),
  ];

  // The headline for each state the script can show, so the top of the page always says where it is.
  const heads: [string, string, string][] = [
    ['draft', sends ? `${count(told.length, 'change')} for ${client.name}.` : 'Quiet release.', sends ? `${people} ${review.to.length === 1 ? 'is' : 'are'} emailed when you release.` : 'Nobody is emailed.'],
    ['releasing', 'Releasing.', 'You can close this page. It keeps going.'],
    ['done', 'Released.', sends ? `Live on ${host}. ${people} emailed.` : `Live on ${host}. Nobody was emailed.`],
    ['failed', 'Stopped.', ''],
  ];
  const headAttributes = heads.map(([key, head, lede]) => `data-${key}="${e(head)}" data-${key}-lede="${e(lede)}"`).join(' ');
  // What the second tap on Release says: where it goes and who hears of it, so the tap is an informed one.
  const confirm = sends ? `Tap again: goes live on ${host} and emails ${people}` : `Tap again: goes live on ${host}, nobody is emailed`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#071a3f">
<title>${e(client.name)} release review</title>
<style>${fonts}${CSS}</style>
</head>
<body>
<main>
<header>
<div class="top">${logo}<span id="chip" class="chip" data-state="draft">Draft, not sent</span></div>
<p class="eyebrow">Release review · ${e(client.name)}</p>
<h1 id="head" ${headAttributes}>${e(heads[0]![1])}</h1>
<p id="lede">${e(heads[0]![2])}</p>
<p id="failure" hidden></p>
<p id="links" hidden></p>
</header>
<ol class="tl">
${nodes.join('\n')}
</ol>
</main>
<div id="bar">
<p id="say">Reply “send it” in the thread to release <code>${e(review.commit.slice(0, 7))}</code></p>
<div id="act" hidden>
<button id="rehearse" type="button">Test on a preview</button>
<button id="release" type="button" data-commit="${e(review.commit)}" data-review="${reviewDigest(review)}" data-label="Release ${e(review.commit.slice(0, 7))}" data-confirm="${e(confirm)}">Release ${e(review.commit.slice(0, 7))}</button>
</div>
<p id="told" role="status" hidden></p>
</div>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
