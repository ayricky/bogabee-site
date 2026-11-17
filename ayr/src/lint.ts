// The rules behind `ayr check`. Pure: file access comes in as siteFile.

import { marked } from 'marked';
import type { ClientConfig } from './config.ts';
import { isDate } from './dates.ts';
import { ACTION_LINE, COMMENT, FOOTER, IMAGE, stripFooter, type Entry, type Item } from './notes.ts';

type Severity = 'error' | 'warning';

export interface Finding {
  entry: string;
  line: number;
  rule: string;
  severity: Severity;
  message: string;
  fix: string;
}

type Issue = Omit<Finding, 'entry'>;

interface Options {
  all?: boolean; // every entry, not just the newest
  siteFile?: (path: string) => Uint8Array | null; // reads a file from the built site
}

const IMAGE_WIDTH = 1072;

const JARGON = [
  // One Stop's written list
  'refactor', 'component', 'selector', 'CSS', 'API', 'deploy', 'PR', 'commit', 'noindex',
  'automated coverage', 'responsive', 'keyboard-accessible', 'markup',
  // added by the kit
  'deployed', 'backend', 'frontend', 'database migration', 'cache', 'repo', 'repository',
  'merge', 'branch', 'bug', 'endpoint', 'webhook', 'server', 'staging',
];

function termPattern(term: string): string {
  return `\\b${term.replace(/\s+/g, '[\\s-]+')}(?:es|s)?\\b`;
}

const WORD_RULES: {
  rule: string;
  severity: Severity;
  terms: (config: ClientConfig) => string[];
  message: (word: string) => string;
  fix: string;
}[] = [
  {
    rule: 'jargon',
    severity: 'error',
    terms: config => {
      const allowed = new Set(config.jargonAllow?.map(word => word.toLowerCase()));
      return JARGON.filter(word => !allowed.has(word.toLowerCase()));
    },
    message: word => `Banned word "${word}".`,
    fix: 'Say it the way the business owner would, or add the word to jargonAllow.',
  },
  {
    rule: 'apology',
    severity: 'warning',
    terms: () => ['sorry', 'apolog\\w*', 'unfortunately'],
    message: word => `Apology "${word}".`,
    fix: 'Keep fixes short and plain: say what works now.',
  },
  {
    rule: 'selling',
    severity: 'error',
    terms: () => ['upgrade', 'add-on', 'special offer', 'limited time', 'discount'],
    message: word => `Selling word "${word}".`,
    fix: 'Service messages never sell. Remove it.',
  },
];

const CLAIMS = /\bbefore\s+every\s+update\b|\b(?:always|never)\b(?:\W+\w+){0,2}\W+checks?\b|\bchecks?\b(?:\W+\w+){0,2}\W+(?:always|never)\b/gi;

// Blanks URLs and bare domains, keeping every offset, so the word rules skip
// them and still report the right line.
function maskUrls(text: string): string {
  return text.replace(
    /\bhttps?:\/\/[^\s)]+|\b[\w-]+(?:\.[a-z]{2,})+(?:\/[^\s)\]]*)?/g,
    match => ' '.repeat(match.length),
  );
}

function lineOf(text: string, index: number, firstLine: number): number {
  return firstLine + text.slice(0, index).split('\n').length - 1;
}

export function onDomain(url: string, config: ClientConfig): boolean {
  if (!URL.canParse(url)) return false;
  const bare = (host: string) => host.replace(/^www\./, '');
  const { hostname, protocol } = new URL(url);
  const host = bare(hostname);
  const site = bare(new URL(config.site).hostname);
  return protocol === 'https:' && (host === site || host.endsWith(`.${site}`));
}

// Reads the width from a PNG or JPEG header. Null for anything else.
export function imageWidth(bytes: Uint8Array): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 24 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a) {
    return view.getUint32(16);
  }
  if (bytes.length < 4 || view.getUint16(0) !== 0xffd8) return null;
  let offset = 2;
  while (offset + 9 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1] ?? 0;
    if (marker === 0xff) { // fill byte
      offset += 1;
      continue;
    }
    const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isFrame) return view.getUint16(offset + 7);
    offset += 2 + view.getUint16(offset + 2);
  }
  return null;
}

function headingRule(entry: Entry, entries: Entry[]): Issue[] {
  const issue = { line: entry.line, rule: 'heading', severity: 'error' as const };
  const issues: Issue[] = [];
  if (!entry.date || !isDate(entry.date)) {
    issues.push({ ...issue, message: `Heading "${entry.heading}" is not a real date.`, fix: 'Use "## Month D, YYYY", with an optional " — label".' });
  }
  if (entries.some(other => other !== entry && other.heading === entry.heading)) {
    issues.push({ ...issue, message: `Heading "${entry.heading}" appears more than once.`, fix: 'Add a label, such as " — evening".' });
  }
  return issues;
}

function leadRule(entry: Entry): Issue[] {
  const issue = { rule: 'lead', severity: 'error' as const };
  const fix = 'Start with **New — , **Changed — or **Fixed — .';
  const issues: Issue[] = entry.items
    .filter(item => item.kind === null)
    .map(item => ({ ...issue, line: item.line, message: 'Bullet has no New, Changed or Fixed lead.', fix }));
  const hoods = entry.items.filter(item => item.kind === 'hood');
  for (const hood of hoods.slice(1)) {
    issues.push({ ...issue, line: hood.line, message: 'More than one Under the hood bullet.', fix: 'Merge them into one, or cut this one.' });
  }
  if (entry.items.length === 0) {
    issues.push({ ...issue, line: entry.line, message: 'Entry has no bullets.', fix });
  }
  return issues;
}

// Accepts several pages after the arrow, joined with " · ". Under the hood
// bullets have no page to link to, so they're exempt.
function linkRule(entry: Entry, config: ClientConfig): Issue[] {
  const issue = { rule: 'link', severity: 'error' as const };
  return entry.items.filter(item => item.kind !== 'hood').flatMap((item): Issue[] => {
    const tail = /→[^→]*\]\([^)\s]+\)$/.exec(item.text.replace(IMAGE, '').trim());
    if (!tail) {
      return [{ ...issue, line: item.line, message: 'Bullet does not end with a page link.', fix: 'End it with → [Page](url).' }];
    }
    return [...tail[0].matchAll(/\]\(([^)\s]+)\)/g)].flatMap(([, url = '']) => (onDomain(url, config) ? [] : [{
      ...issue,
      line: item.line,
      message: `Link ${url} is not on ${config.site}.`,
      fix: 'Link a page on the client\'s own site, over https.',
    }]));
  });
}

function actionLineRule(entry: Entry, config: ClientConfig): Issue[] {
  if (!config.notesSince || (entry.date && entry.date < config.notesSince)) return [];
  const issue = { rule: 'action-line', severity: 'error' as const };
  const paragraphs = entry.body.split(/\n\s*\n/).map(part => part.trim().replace(/\s+/g, ' ')).filter(Boolean);
  const found = paragraphs.filter(paragraph => ACTION_LINE.test(paragraph)).length;
  const issues: Issue[] = [];
  if (!ACTION_LINE.test(paragraphs[0] ?? '')) {
    issues.push({
      ...issue,
      line: entry.line,
      message: found > 0 ? 'The action line is not first.' : 'Entry does not start with an action line.',
      fix: 'Start with **Nothing you need to do.** or **You need to: <what>.**',
    });
  }
  if (found > 1) {
    issues.push({ ...issue, line: entry.line, message: 'Entry has more than one action line.', fix: 'Keep the first one only.' });
  }
  return issues;
}

function wordRules(entry: Entry, config: ClientConfig): Issue[] {
  const text = maskUrls(`${entry.heading}\n${entry.body}`);
  const issues: Issue[] = [];
  for (const { rule, severity, terms, message, fix } of WORD_RULES) {
    const pattern = new RegExp(terms(config).map(termPattern).join('|'), 'gi');
    for (const match of text.matchAll(pattern)) {
      issues.push({
        rule,
        severity,
        line: lineOf(text, match.index, entry.line),
        message: message(match[0].replace(/\s+/g, ' ')),
        fix,
      });
    }
  }
  for (const match of text.matchAll(CLAIMS)) {
    issues.push({
      rule: 'claims',
      severity: 'warning',
      line: lineOf(text, match.index, entry.line),
      message: `Overclaim "${match[0].replace(/\s+/g, ' ')}".`,
      fix: 'Say what actually happens, and only if it is true for every release.',
    });
  }
  return issues;
}

function countSentences(item: Item): number {
  const prose = item.text
    .replace(/^\*\*.+?\*\*/s, '') // the lead
    .replace(IMAGE, '')
    .replace(/→[\s\S]*$/, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .trim();
  return prose.split(/(?<=[.!?]["'”’)]*)\s+(?=["“'‘(]?[A-Z0-9])/).filter(part => /\w/.test(part)).length;
}

function lengthRule(entry: Entry): Issue[] {
  return entry.items.flatMap(item => {
    const sentences = countSentences(item);
    return sentences > 3
      ? [{ line: item.line, rule: 'length', severity: 'warning' as const, message: `Bullet has ${sentences} sentences.`, fix: 'Keep it to three.' }]
      : [];
  });
}

function imageRule(entry: Entry, config: ClientConfig, siteFile: Options['siteFile']): Issue[] {
  const issues: Issue[] = [];
  // A picture named the reference way ("![alt][id]") hides its address from every rule below.
  marked.walkTokens(marked.lexer(entry.body, { gfm: true }), token => {
    if (token.type !== 'image' || new RegExp(IMAGE.source).test(token.raw)) return;
    const at = entry.body.indexOf(token.raw);
    issues.push({
      line: lineOf(entry.body, at < 0 ? 0 : at, entry.line + 1), rule: 'image', severity: 'error',
      message: `Picture ${token.raw} names its address elsewhere.`, fix: 'Write it as ![alt](address), or ask for it with `picture:` in the change file.',
    });
  });
  for (const match of entry.body.matchAll(IMAGE)) {
    const [, alt = '', url = ''] = match;
    const issue = { line: lineOf(entry.body, match.index, entry.line + 1), rule: 'image', severity: 'error' as const };
    if (alt.trim() === '') {
      issues.push({ ...issue, message: `Image ${url} has no alt text.`, fix: 'Describe the picture between the brackets.' });
    }
    // The email's copy of an entry shows each picture from its Release, and the email carries it inline.
    if (config.repo && url.startsWith(`https://github.com/${config.repo}/releases/download/prod-`)) continue;
    if (!onDomain(url, config)) {
      issues.push({ ...issue, message: `Image ${url} is not on ${config.site}.`, fix: 'Ask for the picture with `picture:` in the change file. It goes in the email only.' });
      continue;
    }
    if (!siteFile) continue;
    const path = decodeURIComponent(new URL(url).pathname).replace(/^\/+/, '');
    const bytes = siteFile(path);
    if (!bytes) {
      issues.push({ ...issue, message: `Image file ${path} is not in the site folder.`, fix: 'Add the file, or correct the URL.' });
      continue;
    }
    const width = imageWidth(bytes);
    if (width !== IMAGE_WIDTH) {
      issues.push({
        ...issue,
        message: width === null ? `Image ${path} is not a readable PNG or JPEG.` : `Image ${path} is ${width}px wide.`,
        fix: `Export it as a PNG or JPEG ${IMAGE_WIDTH}px wide.`,
      });
    }
  }
  return issues;
}

function commentRule(entry: Entry): Issue[] {
  return [...entry.raw.matchAll(COMMENT)].map(match => ({
    line: lineOf(entry.raw, match.index, entry.line + 1),
    rule: 'comment',
    severity: 'error' as const,
    message: 'HTML comment. A note to self can reach the client.',
    fix: 'Delete it.',
  }));
}

function footerRule(entry: Entry, config: ClientConfig): Issue[] {
  const issue = { line: entry.line, rule: 'footer', severity: 'error' as const };
  const fix = 'End the entry with *Internal: `old` → `new` — PR #N.*';
  const paragraphs = entry.raw
    .replace(/\n\s*-{3,}\s*$/, '')
    .trim()
    .split(/\n\s*\n/);
  const firstFooter = entry.raw.search(FOOTER);
  const stranded = firstFooter >= 0 && stripFooter(entry.raw.slice(firstFooter)) !== '';
  const unclosed = [...entry.raw.matchAll(FOOTER)].some(([line]) => !/[*_]\s*$/.test(line));
  const issues: Issue[] = [];
  if (stranded || unclosed) {
    issues.push({ ...issue, message: 'Text follows a history or Internal line.', fix: 'Move the text above them. Those lines come last.' });
  } else if (!/^\*Internal:/.test(paragraphs.at(-1) ?? '')) {
    issues.push({ ...issue, message: 'The Internal line is not the last line of the entry.', fix });
  }
  if (/\bInternal:/i.test(entry.body)) {
    issues.push({ ...issue, message: 'An Internal line sits inside the client-visible text.', fix: 'Move it to its own paragraph at the end.' });
  }
  if (config.updatesUrl && !/^\*See every past update:/m.test(entry.raw)) {
    issues.push({ ...issue, message: 'The history line is missing.', fix: `Add *See every past update: [Full update history](${config.updatesUrl})* above the Internal line.` });
  }
  return issues;
}

// A note is Markdown. HTML in it is dropped or mangled by mail clients, and it is the one way a
// note could carry a script, a frame or a redirect into the owner's review page.
function htmlRule(entry: Entry): Issue[] {
  const issues: Issue[] = [];
  marked.walkTokens(marked.lexer(entry.raw, { gfm: true }), token => {
    if (token.type !== 'html' || COMMENT_START.test(token.raw)) return; // commentRule names a comment, closed or not
    const at = entry.raw.indexOf(token.raw);
    issues.push({
      line: lineOf(entry.raw, at < 0 ? 0 : at, entry.line + 1),
      rule: 'html',
      severity: 'error' as const,
      message: `HTML in the note: ${token.raw.trim().slice(0, 40)}. Mail clients drop or change it.`,
      fix: 'Write it in Markdown.',
    });
  });
  return issues;
}
const COMMENT_START = /^\s*<!--/;

export function checkEntries(entries: Entry[], config: ClientConfig, { all = false, siteFile }: Options = {}): Finding[] {
  return (all ? entries : entries.slice(0, 1)).flatMap(entry => [
    ...headingRule(entry, entries),
    ...leadRule(entry),
    ...linkRule(entry, config),
    ...actionLineRule(entry, config),
    ...wordRules(entry, config),
    ...lengthRule(entry),
    ...imageRule(entry, config, siteFile),
    ...commentRule(entry),
    ...htmlRule(entry),
    ...footerRule(entry, config),
  ].map(issue => ({ entry: entry.heading, ...issue })).sort((a, b) => a.line - b.line));
}
