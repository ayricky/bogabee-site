// Change files: changes/<id>.md, one per change, written by the agent in the
// pull request that makes the change. It is the only place a note is written.
//
// The directory is the release queue. A file on main is unreleased; the
// release commit deletes it. Nothing else records what is pending, so there is
// nothing to keep in sync. Two pull requests never touch the same file, so the
// queue has no merge conflicts (separate-before-serializing).
//
// The body is one bullet in exactly today's PATCH_NOTES format, so the agent
// writes what it already knows how to write, and parseItem/checkEntries from
// notes.ts and lint.ts judge it unchanged. The front matter holds only what
// the bullet can't: the action, the picture, the recording, or "quiet".
//
//   ---
//   action: none
//   picture: compare phone /start #book
//   alt: The booking form on a phone, before and after this update
//   record: phone /start
//   step: tap "Book a call"
//   step: tap "Mon 9:00 AM"
//   step: tap "Book it"
//   step: see "Booked"
//   ---
//   **New — customers can book a call from their phone.** They pick a time
//   and get a confirmation on the spot. → [Get Started](https://onestopgroup.us/start#book)
//
// Front matter is `key: value` lines, like templates/messages. Only `step`
// repeats, in order. A key with a blank value counts as absent, so the file
// `ayr change` scaffolds can list every key. No YAML dependency.

import type { ClientConfig } from './config.ts';
import { longDate } from './dates.ts';
import { checkEntries, type Finding } from './lint.ts';
import { IMAGE, parseNotes, type Kind } from './notes.ts';

/** The file stem: lowercase letters, digits and hyphens. Also the picture's file name. */
export type ChangeId = string & { readonly __brand: 'ChangeId' };

/** A path on the client's site, always starting with "/". Resolved against the live site or the local server. */
export type SitePath = `/${string}`;

export type Viewport = 'phone' | 'desktop';

/**
 * `after` shoots this release. `compare` also shoots the live site, which is the
 * last release, and stacks them with Before and After labels, 1072px wide.
 * The file says `picture: none` to mean null: the key is required on every
 * New, Changed or Fixed change, so leaving a picture out is a decision.
 */
export interface Picture {
  show: 'after' | 'compare';
  on: Viewport;
  path: SitePath;
  selector: string | null; // crop to this element; the whole first screen when null
  alt: string; // required, from `alt:`
}

/** One line of `step:`. Steps find things by what a visitor sees, never by CSS selector. */
export type Step =
  | { do: 'tap'; text: string } // tap "Book it"
  | { do: 'type'; field: string; text: string } // type "Your name" "Pat Doe"
  | { do: 'see'; text: string } // see "Booked": waits for it, and holds the frame a second
  | { do: 'scroll'; text: string } // scroll "Our team"
  | { do: 'wait'; ms: number } // wait 1500, at most 3000
  | { do: 'back' };

/** A phone recording of an interaction. Always phone-sized: it is attached to an email read on a phone. */
export interface Recording {
  start: SitePath;
  steps: [Step, ...Step[]]; // at least one; parseChange also requires the last one to be `see`
}

/** `action: none`, or `action: You need to: <what>.` The entry's action line is derived from these. */
export type Action = { needed: false } | { needed: true; what: string };

interface Located {
  id: ChangeId;
  file: string; // changes/<id>.md, for findings
  line: number; // first body line, for findings
}

/**
 * The three things a change file can be. Kind comes from the bullet itself
 * (its bold lead, or `*Under the hood:*`), never from a second field that
 * could disagree with it.
 */
export type Change =
  | (Located & {
      kind: 'item';
      lead: Kind; // New | Changed | Fixed
      bullet: string; // the body as written: bold lead, sentences, → link
      action: Action;
      picture: Picture | null;
      recording: Recording | null;
    })
  | (Located & { kind: 'hood'; sentence: string }) // folded into the entry's one Under the hood bullet
  | (Located & { kind: 'quiet'; why: string }); // ships, never told; `quiet: <why>` and an empty body

export class ChangeError extends Error {
  file: string;
  line: number;

  constructor(file: string, line: number, problem: string) {
    super(`${file}:${line}: ${problem}`);
    this.name = 'ChangeError';
    this.file = file;
    this.line = line;
  }
}

const ID = /^[a-z0-9][a-z0-9-]*$/;
const KEYS = ['quiet', 'action', 'picture', 'alt', 'record', 'step'] as const;
type Key = (typeof KEYS)[number];
const HOOD = /^\*Under the hood:\*\s*/;
const MAX_WAIT = 3000;
const LEADS: Kind[] = ['New', 'Changed', 'Fixed'];

const STEP_FORMS = 'tap "text", type "field" "text", see "text", scroll "text", wait 1500 or back';
const ACTION_FIX = 'Write `action: none`, or `action: You need to: <what>`.';
const PICTURE_FIX = 'Write `picture: after phone /path`, `picture: compare desktop /path #section`, or `picture: none`.';

export const CHANGE_DIR = 'changes';

export function changeFile(id: string): string {
  return `${CHANGE_DIR}/${id}.md`;
}

export function isChangeId(value: string): value is ChangeId {
  return ID.test(value);
}

interface Value {
  value: string;
  line: number;
}

// The front matter's lines, numbered, and where the body starts. A file with no
// opening --- is all body.
function split(file: string, lines: string[]): { meta: { key: Key; value: string; line: number }[]; bodyStart: number } {
  if (lines[0]?.trim() !== '---') return { meta: [], bodyStart: 0 };
  const close = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (close < 0) throw new ChangeError(file, 1, 'The front matter has no closing ---. Add a line with --- above the bullet.');
  const meta = lines.slice(1, close).flatMap((text, index) => {
    const line = index + 2;
    if (text.trim() === '') return [];
    const match = /^([A-Za-z]+):(.*)$/.exec(text.trim());
    if (!match) throw new ChangeError(file, line, `Expected "key: value", got "${text.trim()}".`);
    const key = match[1] ?? '';
    if (!(KEYS as readonly string[]).includes(key)) {
      throw new ChangeError(file, line, `Unknown key "${key}". The keys are ${KEYS.join(', ')}.`);
    }
    const value = (match[2] ?? '').trim();
    return value === '' ? [] : [{ key: key as Key, value, line }];
  });
  return { meta, bodyStart: close + 1 };
}

function quoted(rest: string): string[] {
  const args: string[] = [];
  let remaining = rest.trim();
  while (remaining !== '') {
    const match = /^"((?:[^"\\]|\\.)*)"(?:\s+|$)/.exec(remaining);
    if (!match) throw new Error(`Expected a quoted text, got ${remaining}.`);
    args.push((match[1] ?? '').replace(/\\(.)/g, '$1'));
    remaining = remaining.slice(match[0].length);
  }
  return args;
}

export function parseStep(line: string): Step {
  const [, verb = '', rest = ''] = /^(\S+)\s*(.*)$/.exec(line.trim()) ?? [];
  const fail = (problem: string): never => {
    throw new Error(`${problem} Write a step as ${STEP_FORMS}.`);
  };
  const texts = (count: number): string[] => {
    let args: string[] = [];
    try {
      args = quoted(rest);
    } catch (error) {
      fail((error as Error).message);
    }
    if (args.length !== count || args.some(arg => arg.trim() === '')) {
      fail(`"${verb}" takes ${count === 1 ? 'one quoted text' : `${count} quoted texts`}.`);
    }
    return args;
  };
  switch (verb) {
    case 'tap':
    case 'see':
    case 'scroll': {
      const [text = ''] = texts(1);
      return { do: verb, text };
    }
    case 'type': {
      const [field = '', text = ''] = texts(2);
      return { do: 'type', field, text };
    }
    case 'wait': {
      if (!/^\d+$/.test(rest) || Number(rest) < 1 || Number(rest) > MAX_WAIT) {
        fail(`"wait" takes milliseconds from 1 to ${MAX_WAIT}, got "${rest}".`);
      }
      return { do: 'wait', ms: Number(rest) };
    }
    case 'back': {
      if (rest !== '') fail('"back" takes nothing after it.');
      return { do: 'back' };
    }
    default:
      return fail(`Unknown step "${verb}".`);
  }
}

function parseAction(file: string, { value, line }: Value): Action {
  if (value === 'none') return { needed: false };
  const match = /^You need to: ([^*]+?)\.?$/.exec(value);
  if (!match || /\.$/.test(match[1] ?? '')) {
    throw new ChangeError(file, line, `"${value}" is not an action. ${ACTION_FIX}`);
  }
  return { needed: true, what: match[1] ?? '' };
}

function parsePicture(file: string, picture: Value, alt: Value | undefined, fallback: number): Picture | null {
  if (picture.value === 'none') {
    if (alt) throw new ChangeError(file, alt.line, '`alt:` describes a picture, and this change has `picture: none`. Remove it.');
    return null;
  }
  const match = /^(after|compare)\s+(phone|desktop)\s+(\/\S*)(?:\s+(.+))?$/.exec(picture.value);
  if (!match) throw new ChangeError(file, picture.line, `"${picture.value}" is not a picture. ${PICTURE_FIX}`);
  if (!alt) {
    throw new ChangeError(file, fallback, 'Missing `alt:`. Describe the picture for someone who can\'t see it.');
  }
  // The alt text goes inside ![…](…) in the email's copy of the note. A bracket there would end it early and start
  // something else, and a backslash would escape the bracket that ends it.
  if (/[[\]\\]/.test(alt.value)) {
    throw new ChangeError(file, alt.line, '`alt:` has a square bracket or a backslash, which would break the picture in the email. Describe it in plain words.');
  }
  return {
    show: match[1] as Picture['show'],
    on: match[2] as Viewport,
    path: match[3] as SitePath,
    selector: match[4]?.trim() ?? null,
    alt: alt.value,
  };
}

function parseRecording(file: string, record: Value | undefined, steps: Value[]): Recording | null {
  if (!record) {
    if (steps[0]) throw new ChangeError(file, steps[0].line, 'Steps without `record:`. Add `record: phone /path`, or remove the steps.');
    return null;
  }
  const match = /^phone\s+(\/\S*)$/.exec(record.value);
  if (!match) {
    throw new ChangeError(file, record.line, `"${record.value}" is not a recording. Write \`record: phone /path\`: recordings are always phone-sized.`);
  }
  const parsed = steps.map(step => {
    try {
      return parseStep(step.value);
    } catch (error) {
      throw new ChangeError(file, step.line, (error as Error).message);
    }
  });
  const [first, ...rest] = parsed;
  if (!first) throw new ChangeError(file, record.line, '`record:` has no steps. Add `step:` lines, ending with a `see` step.');
  if (parsed.at(-1)?.do !== 'see') {
    throw new ChangeError(file, steps.at(-1)?.line ?? record.line, 'The last step must be `see "text"`, so the recording ends on the result.');
  }
  return { start: match[1] as SitePath, steps: [first, ...rest] };
}

// The kind the release will see, judged by notes.ts's own item parser.
function bulletKind(bullet: string): Kind | 'hood' | null {
  const item = parseNotes(`## draft\n- ${bullet.replace(/\n/g, '\n  ')}`)[0]?.items[0];
  return item?.kind ?? null;
}

/** Boundary parser. Everything after it trusts Change. Throws ChangeError naming the line and the fix. */
export function parseChange(file: string, source: string): Change {
  const stem = /([^/\\]+)\.md$/.exec(file)?.[1] ?? '';
  if (!isChangeId(stem)) {
    throw new ChangeError(file, 1, 'The file name must be lowercase letters, digits and hyphens, ending in .md, such as online-booking.md.');
  }
  const id = stem;
  const lines = source.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const { meta, bodyStart } = split(file, lines);

  const one = new Map<Key, Value>();
  const steps: Value[] = [];
  for (const { key, value, line } of meta) {
    if (key === 'step') {
      steps.push({ value, line });
      continue;
    }
    const earlier = one.get(key);
    if (earlier) throw new ChangeError(file, line, `"${key}" is already set on line ${earlier.line}. Keep one.`);
    one.set(key, { value, line });
  }

  const body = lines.slice(bodyStart).map((text, index) => ({ text: text.trim(), line: bodyStart + index + 1 }));
  while (body[0]?.text === '') body.shift();
  while (body.at(-1)?.text === '') body.pop();
  const first = body[0];
  const fallback = Math.max(bodyStart, 1);
  const set = (keys: readonly Key[]) => meta.find(entry => keys.includes(entry.key));

  const quiet = one.get('quiet');
  if (quiet) {
    if (first) throw new ChangeError(file, first.line, 'A quiet change has no bullet: the client never sees it. Remove the bullet, or remove `quiet:`.');
    const other = set(KEYS.filter(key => key !== 'quiet'));
    if (other) throw new ChangeError(file, other.line, `A quiet change takes no other keys. Remove "${other.key}".`);
    return { kind: 'quiet', id, file, line: quiet.line, why: quiet.value };
  }
  if (!first) {
    throw new ChangeError(file, fallback, 'No bullet. Write one in the PATCH_NOTES style, or set `quiet: <why>` if the client won\'t notice this change.');
  }
  const gap = body.find(line => line.text === '');
  if (gap) throw new ChangeError(file, gap.line, 'A change is one bullet, with no blank lines. Join the paragraphs, or split them into two change files.');
  if (/^[-*+] /.test(first.text)) {
    throw new ChangeError(file, first.line, 'Drop the leading "- ": the release adds it.');
  }
  const image = body.find(line => new RegExp(IMAGE.source).test(line.text));
  if (image) throw new ChangeError(file, image.line, 'Pictures come from `picture:` and `alt:`, never the bullet. Remove the image.');

  const bullet = body.map(line => line.text).join('\n');
  const kind = bulletKind(bullet);
  const located = { id, file, line: first.line };
  if (kind === 'hood') {
    const other = set(KEYS);
    if (other) throw new ChangeError(file, other.line, `An Under the hood change has no action, picture or recording. Remove "${other.key}".`);
    const sentence = bullet.replace(HOOD, '');
    if (sentence.trim() === '') throw new ChangeError(file, first.line, 'Say the one thing the owner would care about after *Under the hood:*.');
    return { kind: 'hood', ...located, sentence };
  }
  if (kind === null) {
    throw new ChangeError(file, first.line, 'Start the bullet with **New — , **Changed — , **Fixed — , or *Under the hood:*.');
  }
  const action = one.get('action');
  if (!action) throw new ChangeError(file, fallback, `Missing \`action:\`. ${ACTION_FIX}`);
  const picture = one.get('picture');
  if (!picture) throw new ChangeError(file, fallback, `Missing \`picture:\`. ${PICTURE_FIX}`);
  return {
    kind: 'item',
    ...located,
    lead: kind,
    bullet,
    action: parseAction(file, action),
    picture: parsePicture(file, picture, one.get('alt'), picture.line),
    recording: parseRecording(file, one.get('record'), steps),
  };
}

// ── Assembly ───────────────────────────────────────────────────────────────

/** Where a line of an assembled entry came from, so a finding on it points at the change file. */
interface Line {
  text: string;
  from: { file: string; line: number } | null;
}

function joinList(parts: string[]): string {
  if (parts.length <= 2) return parts.join(' and ');
  return `${parts.slice(0, -1).join(', ')}, and ${parts.at(-1)}`;
}

/** "**Nothing you need to do.**", or one "**You need to: a, and b.**" line from every item that asks. */
export function actionLine(actions: Action[]): string {
  const asks = actions.flatMap(action => (action.needed ? [action.what] : []));
  return asks.length === 0 ? '**Nothing you need to do.**' : `**You need to: ${joinList(asks)}.**`;
}

/**
 * A change's picture's file name: "2026-11-online-booking.jpg". Pictures go in the email only. They
 * are never written to the site or the repo: the release carries them as GitHub Release assets, and
 * the email shows them inline.
 */
export function pictureFile(id: ChangeId, date: string): string {
  return `${date.slice(0, 7)}-${id}.jpg`;
}

/** The code range the Internal line names. `from` is null on a client's first release. */
export interface Range {
  from: string | null; // short sha of the last prod-* tag's commit
  to: string; // short sha of main when the draft was made
  prs: number[];
}

function internalLine({ from, to, prs }: Range): string {
  const range = from ? `\`${from}\` → \`${to}\`` : `\`${to}\``;
  const numbers = prs.length > 0 ? ` — ${prs.map(pr => `PR #${pr}`).join(', ')}` : '';
  return `*Internal: ${range}${numbers}.*`;
}

// One bullet: "- " on the first line, two spaces on the rest.
function bulletLines(text: string, file: string, line: number, prefix = ''): Line[] {
  return `${prefix}${text}`.split('\n').map((part, index) => ({
    text: `${index === 0 ? '- ' : '  '}${part}`,
    from: { file, line: line + index },
  }));
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function layout(input: Parameters<typeof assembleEntry>[0]): Line[] {
  const { changes, heading, date, range, config, pictures } = input;
  const plain = (text: string): Line => ({ text, from: null });
  const items = LEADS.flatMap(lead => changes.flatMap(change => (change.kind === 'item' && change.lead === lead ? [change] : [])));
  const hoods = changes.flatMap(change => (change.kind === 'hood' ? [change] : []));

  const lines: Line[] = [plain(`## ${heading}`), plain(''), plain(actionLine(items.map(item => item.action))), plain('')];
  // A picture shows only where `pictures` says where it is: in the email's copy of the entry.
  const shown = (item: (typeof items)[number]): boolean => pictures !== undefined && item.picture !== null;
  items.forEach((item, index) => {
    const previous = items[index - 1];
    if (previous && (shown(previous) || shown(item))) lines.push(plain(''));
    lines.push(...bulletLines(item.bullet, item.file, item.line));
    if (pictures && item.picture) {
      lines.push(plain(''), { text: `  ![${item.picture.alt}](${pictures(pictureFile(item.id, date))})`, from: { file: item.file, line: item.line } });
    }
  });
  const [firstHood, ...moreHoods] = hoods;
  if (firstHood) {
    const last = items.at(-1);
    if (last && shown(last)) lines.push(plain(''));
    const sentences = [firstHood, ...moreHoods].flatMap((hood, index) =>
      bulletLines(index === 0 ? hood.sentence : capitalize(hood.sentence), hood.file, hood.line));
    lines.push(...sentences.map((line, index) => ({
      text: index === 0 ? line.text.replace(/^- /, '- *Under the hood:* ') : line.text.replace(/^- /, '  '),
      from: line.from,
    })));
  }
  lines.push(plain(''));
  if (config.updatesUrl) lines.push(plain(`*See every past update: [Full update history](${config.updatesUrl})*`), plain(''));
  lines.push(plain(internalLine(range)), plain(''), plain('---'), plain(''));
  return lines;
}

/**
 * The entry in PATCH_NOTES format: heading, action line, items ordered New,
 * Changed, Fixed (each in merge order), one Under the hood bullet from every
 * hood file, the history line when config.updatesUrl is set, and the Internal
 * line. Quiet changes add nothing. With `pictures`, each item's picture line
 * goes under it, at the address `pictures` gives its file: that copy is the
 * email's, and PATCH_NOTES.md never holds one.
 * Pure: the same input always gives the same bytes.
 */
export function assembleEntry(input: {
  changes: Change[]; // already in merge order
  heading: string;
  date: string;
  range: Range;
  config: ClientConfig;
  pictures?: (file: string) => string;
}): string {
  return layout(input).map(line => line.text).join('\n');
}

/**
 * The email's copy of an entry PATCH_NOTES.md holds: each pictured change's picture line under its
 * bullet, at the address `url` gives its file, spaced as assembleEntry spaces them. Read from the entry
 * itself, so a release tagged since the draft, which changes nothing in it, changes nothing here.
 * Throws when a pictured change's bullet isn't in the entry: then the entry isn't the one its change
 * files make.
 */
export function withPictures(entry: string, changes: Change[], date: string, url: (file: string) => string): string {
  const lines = entry.split('\n');
  // In the order the entry lists them, so two changes with the same words each find their own bullet.
  const items = LEADS.flatMap(lead => changes.flatMap(change => (change.kind === 'item' && change.lead === lead ? [change] : [])));
  let from = 0;
  for (const item of items) {
    const bullet = bulletLines(item.bullet, item.file, item.line).map(line => line.text);
    // A whole bullet: the next line is not one of its own, so a shorter bullet never matches the start of a longer one.
    const whole = (at: number): boolean => bullet.every((text, offset) => lines[at + offset] === text) && !(lines[at + bullet.length] ?? '').startsWith('  ');
    let start = -1;
    for (let at = from; at < lines.length; at += 1) if (whole(at)) { start = at; break; }
    if (start < 0) throw new Error(`${item.file}'s bullet is not in the entry, so the entry is not the one its change files make.`);
    from = start + bullet.length;
    if (!item.picture) continue;
    const end = start + bullet.length;
    const after = lines[end] ?? '';
    const added = ['', `  ![${item.picture.alt}](${url(pictureFile(item.id, date))})`, ...(after.trim() === '' ? [] : [''])];
    lines.splice(end, 0, ...added);
    from = end + added.length;
    // A picture sets its bullet apart from the one above too.
    const before = lines[start - 1] ?? '';
    if (before.startsWith('- ') || before.startsWith('  ')) {
      lines.splice(start, 0, '');
      from += 1;
    }
  }
  return lines.join('\n');
}

/** Puts the entry first, directly below the `---` after the file's opening lines. */
export function insertEntry(notes: string, entry: string): string {
  const firstHeading = notes.search(/^## /m);
  const opening = firstHeading < 0 ? notes : notes.slice(0, firstHeading);
  const rule = /^-{3,}[ \t]*$/m.exec(opening);
  if (!rule) throw new Error('PATCH_NOTES.md has no --- line below its opening lines, so there is no place for the newest entry.');
  const end = rule.index + rule[0].length;
  const rest = notes.slice(end).replace(/^\s*\n/, '');
  return `${notes.slice(0, end)}\n\n${entry.endsWith('\n') ? entry : `${entry}\n`}${rest === '' ? '' : `\n${rest}`}`;
}

/** "Merge pull request #52 from …" and "Title (#52)", in order, each once. */
export function prNumbers(subjects: string[]): number[] {
  const numbers = subjects.flatMap(subject => {
    const match = /^Merge pull request #(\d+)\b/.exec(subject) ?? /\(#(\d+)\)\s*$/.exec(subject);
    return match ? [Number(match[1])] : [];
  });
  return [...new Set(numbers)];
}

function period(at: Date, timezone: string): 'morning' | 'afternoon' | 'evening' {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', hourCycle: 'h23' })
    .formatToParts(at)
    .find(part => part.type === 'hour')?.value);
  if (hour < 12) return 'morning';
  return hour < 17 ? 'afternoon' : 'evening';
}

/**
 * "November 9, 2026", or with a label when that heading already exists:
 * " — morning", " — afternoon", " — evening" by the hour in the client's time
 * zone, then " — 2", " — 3". The lint's duplicate-heading rule can then never fire
 * on an assembled entry.
 */
export function entryHeading(date: string, at: Date, timezone: string, existing: string[]): string {
  const taken = new Set(existing);
  const base = longDate(date);
  for (const heading of [base, `${base} — ${period(at, timezone)}`]) {
    if (!taken.has(heading)) return heading;
  }
  for (let count = 2; ; count += 1) {
    if (!taken.has(`${base} — ${count}`)) return `${base} — ${count}`;
  }
}

// ── Checks ─────────────────────────────────────────────────────────────────

// Any real date and range: the draft only exists to run checkEntries.
const DRAFT = { heading: 'January 1, 2000', date: '2000-01-01', range: { from: '0000000', to: '0000000', prs: [] } };

/**
 * Lints change files by assembling them into a draft entry and running the
 * existing checkEntries over it, so every rule (jargon, lead, link, length,
 * selling, claims, comment) applies with no second copy. Adds the rules only a
 * change file has: duplicate ids, two hood files that together pass three
 * sentences, more than one change asking the client to act (a warning).
 * Quiet files skip the word rules: they never reach the client.
 * Each finding's `entry` is the change file and `line` a line in it.
 */
export function checkChanges(changes: Change[], config: ClientConfig): Finding[] {
  const findings: Finding[] = [];
  const seen = new Map<string, Change>();
  for (const change of changes) {
    const earlier = seen.get(change.id);
    if (earlier) {
      findings.push({
        entry: change.file, line: change.line, rule: 'change-id', severity: 'error',
        message: `${earlier.file} has the same id, ${change.id}.`, fix: 'Rename one of them.',
      });
    }
    seen.set(change.id, change);
  }

  const asking = changes.filter(change => change.kind === 'item' && change.action.needed);
  for (const change of asking.slice(1)) {
    findings.push({
      entry: change.file, line: change.line, rule: 'action', severity: 'warning',
      message: `${asking.length} changes ask the client to act: ${asking.map(other => other.file).join(', ')}.`,
      fix: 'Ask once if one action covers them, or check each one is really needed.',
    });
  }

  const told = changes.filter(change => change.kind !== 'quiet');
  if (told.length === 0) return findings;
  // With each picture in, as the email has it, so its alt text is checked too. The site here only satisfies the address rule.
  const lines = layout({ changes: told, ...DRAFT, config, pictures: file => `${config.site}/${file}` });
  const [draft] = parseNotes(lines.map(line => line.text).join('\n'));
  if (!draft) return findings;
  const hoods = told.filter(change => change.kind === 'hood');
  const fallback = told[0] as Change;

  for (const finding of checkEntries([draft], config)) {
    const from = lines[finding.line - 1]?.from ?? { file: fallback.file, line: fallback.line };
    const merged = hoods.length > 1 && finding.rule === 'length' && hoods.some(hood => hood.file === from.file);
    findings.push({
      ...finding,
      entry: from.file,
      line: from.line,
      ...(merged ? {
        message: `${finding.message.replace(/^Bullet/, 'The one Under the hood bullet')} The files ${hoods.map(hood => hood.file).join(', ')} all go in it.`,
        fix: 'Keep it to three: cut a sentence, or make one of them quiet.',
      } : {}),
    });
  }
  return findings.sort((a, b) => a.entry.localeCompare(b.entry) || a.line - b.line);
}

function under(path: string, prefix: string): boolean {
  return prefix.endsWith('/') ? path.startsWith(prefix) : path === prefix || path.startsWith(`${prefix}/`);
}

// The paths the release writes: PATCH_NOTES.md and the history page.
function releaseOwned(config: ClientConfig): string[] {
  const { release } = config;
  if (!release) return ['PATCH_NOTES.md'];
  const dir = release.deploy.dir;
  const page = config.updatesUrl ? new URL(config.updatesUrl).pathname.replace(/\/+$/, '') : '';
  return [
    'PATCH_NOTES.md',
    ...(page ? [`${dir}${page}.html`, `${dir}${page}/index.html`, `${dir}${page}`] : []),
  ];
}

/**
 * The pull request rules, so no agent has to remember them:
 * - A pull request that changes what ships (config.release.deploy.dir, or any
 *   path in config.release.ships) adds at least one change file. A change the
 *   client won't notice uses `quiet:`.
 * - It never edits PATCH_NOTES.md, the generated history page, or a change
 *   file that is not its own: those belong to the release.
 */
export function checkPullRequest(input: {
  changedFiles: string[];
  addedChanges: Change[];
  config: ClientConfig;
  /** Files the pull request creates. A client's setup creates PATCH_NOTES.md, which only the release edits after. */
  createdFiles?: string[];
}): Finding[] {
  const { changedFiles, addedChanges, config } = input;
  const created = new Set(input.createdFiles ?? []);
  const findings: Finding[] = [];
  const own = new Set(addedChanges.map(change => change.file));
  const owned = releaseOwned(config);
  const release = (path: string, message: string, fix: string): Finding =>
    ({ entry: path, line: 0, rule: 'pull-request', severity: 'error', message, fix });

  for (const path of changedFiles) {
    if (path === 'PATCH_NOTES.md' && created.has(path)) continue;
    if (owned.some(prefix => under(path, prefix))) {
      findings.push(release(path, 'The release writes this file. A pull request never edits it.', `Undo the edit (git checkout origin/main -- ${path}) and describe the change in a change file.`));
    } else if (/^changes\/[^/]+\.md$/.test(path) && !own.has(path)) {
      findings.push(release(path, 'This change file belongs to an earlier pull request. It ships, and is deleted, with the next release.', `Undo the edit (git checkout origin/main -- ${path}), and add your own change file.`));
    }
  }

  // Only a client whose notes are written in each pull request needs one here. By default the release writes them.
  const ships = config.release?.notes === 'in-pull-request' ? [`${config.release.deploy.dir}/`, ...config.release.ships] : [];
  const shipped = changedFiles.filter(path => ships.some(prefix => under(path, prefix)) && !owned.some(prefix => under(path, prefix)));
  if (shipped.length > 0 && addedChanges.length === 0) {
    const named = shipped.slice(0, 3).join(', ') + (shipped.length > 3 ? `, and ${shipped.length - 3} more` : '');
    findings.push(release(
      'changes/',
      `This pull request changes what ships (${named}) and adds no change file.`,
      'Run `node ayr/bin/ayr.ts change <id>` and write the bullet, or set `quiet: <why>` if the client won\'t notice.',
    ));
  }
  return findings;
}
