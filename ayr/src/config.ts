// The client config, read once at the boundary. Everything past parseConfig
// trusts the ClientConfig type.

import { isDate } from './dates.ts';

export const PLANS = ['none', 'care', 'run', 'grow'] as const;
export type Plan = (typeof PLANS)[number];

const ROLES = ['owner', 'backup', 'team'] as const;
type Role = (typeof ROLES)[number];

const MIN_CONTRAST = 4.5;

export interface Brand {
  logoUrl?: string;
  logoWidth?: number;
  accent: string;
  ink: string;
  body: string;
  muted: string;
  paper: string;
  line: string;
  headingFont: string;
  bodyFont: string;
  footer: string;
}

export interface Contact {
  name: string;
  email: string;
  role: Role;
}

export interface Renewal {
  what: string;
  date: string;
  cost?: string;
  yearly?: boolean; // rolls to its next date once this one passes
}

/**
 * How `ayr release` drafts, deploys and announces this client's releases.
 * Absent: the client has no `ayr release`, and sends from a hand-made GitHub Release.
 */
export interface ReleaseConfig {
  /** Who gets the release email. Each must be one of contacts[].email, or the replyTo address, so the owner can keep a copy. Replaces the NOTIFY_EMAILS repo variable. */
  to: string[];
  /** Today only Cloudflare Pages Direct Upload. A union so another host is one more variant, not a flag. */
  /**
   * `build`: commands run in the release's own checkout before the deploy, for a site that builds into
   * `dir` (`npm run build` into `dist`). Without it, `dir` deploys as git holds it.
   */
  deploy: { kind: 'pages'; project: string; dir: string; build: string[] };
  /**
   * The secrets file that holds this client's deploy token, as `secrets run` names it
   * ("bogabee-site/cloudflare-pages"). `ayr release serve` loads it for a press, and `ayr release doctor`
   * says to run under it.
   */
  secrets?: string;
  /** Paths outside deploy.dir that still ship (Pages Functions). A pull request touching them needs a change file. */
  ships: string[];
  /** Serves deploy.dir locally for pictures and recordings, the way the smoke job already does. url is loopback only. */
  serve: { command: string; url: string };
  /** Run once before anything else in `ayr release draft`, e.g. `npm install --prefix tools`. */
  setup: string[];
  /** Run after the entry is written into PATCH_NOTES.md. Their output is part of the draft commit. */
  generate: string[];
  /** Must pass on the draft's files before it is committed. */
  checks: string[];
  /**
   * The client's staging site, when pushing to main deploys it. A draft is on main, so staging
   * shows it before the release: the review page links each page the note names there.
   */
  staging?: string;
  /** The `name:` of the client's checks workflow. `ayr release run` waits for it to pass on the draft commit. Defaults to CI. */
  checksWorkflow: string;
  /** The `name:` of the workflow that emails the client when a Release is published. Defaults to Notify release. */
  notifyWorkflow: string;
  /**
   * When the client notes are written. "at-release" (the default): the client-release skill drafts them
   * from what merged, so pull requests need none. "in-pull-request": every pull request that changes what
   * ships adds its own change file, and CI fails without one.
   */
  notes: 'at-release' | 'in-pull-request';
}

export interface ClientConfig {
  slug: string;
  name: string;
  plan: Plan;
  launched: string;
  repo?: string;
  site: string;
  updatesUrl?: string;
  noun: string;
  from: string;
  replyTo: string;
  notesSince?: string;
  timezone: string; // shown in client-facing times, defaults to New York
  jargonAllow?: string[];
  brand: Brand;
  contacts: Contact[];
  renewals?: Renewal[];
  monitor?: { url: string; expect?: string };
  example?: boolean; // a made-up client, left out of `ayr due`
  release?: ReleaseConfig;
}

export class ConfigError extends Error {
  field: string;

  constructor(field: string, problem: string) {
    super(`${field}: ${problem}`);
    this.name = 'ConfigError';
    this.field = field;
  }
}

type Fields = Record<string, unknown>;

function fields(value: unknown, field: string, known: string[]): Fields {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ConfigError(field, 'must be an object');
  }
  for (const key of Object.keys(value)) {
    if (!known.includes(key)) {
      throw new ConfigError(field === 'config' ? key : `${field}.${key}`, 'is not a known field');
    }
  }
  return value as Fields;
}

function list(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new ConfigError(field, 'must be a list');
  return value;
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ConfigError(field, 'must be a non-empty string');
  }
  return value;
}

/** A site's root exactly as a browser writes its origin: scheme and host, nothing after. So a path can be added to it as text. */
function isRoot(value: string, protocols: string[]): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return protocols.includes(url.protocol) && url.origin === value;
}

function matching(value: unknown, field: string, test: (value: string) => boolean, wanted: string): string {
  const string = text(value, field);
  if (!test(string)) throw new ConfigError(field, `must be ${wanted}, got "${string}"`);
  return string;
}

function oneOf<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (!allowed.includes(value as T)) throw new ConfigError(field, `must be one of ${allowed.join(', ')}`);
  return value as T;
}

function date(value: unknown, field: string): string {
  return matching(value, field, isDate, 'a real date as YYYY-MM-DD');
}

function url(value: unknown, field: string): string {
  return matching(value, field, value => URL.canParse(value) && /^https:/.test(value), 'an https URL');
}

function flag(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new ConfigError(field, 'must be true or false');
  return value;
}

function isEmail(value: string): boolean {
  return /^[^\s@<>,]+@[^\s@<>,]+\.[^\s@<>,]+$/.test(value);
}

export function isMailbox(value: string): boolean {
  const named = /^[^<>]*<([^<>]+)>$/.exec(value);
  return isEmail(named?.[1] ?? value);
}

/** The address inside a mailbox, lowercased: "Ann <A@x.com>" and "a@x.com" are one recipient. */
export function mailboxAddress(mailbox: string): string {
  return (/<([^<>]+)>$/.exec(mailbox)?.[1] ?? mailbox).toLowerCase();
}

function color(value: unknown, field: string): string {
  return matching(value, field, value => /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value), 'a hex color, #rgb or #rrggbb');
}

// WCAG contrast against white, the card every message sits on.
function contrastOnWhite(hex: string): number {
  const digits = hex.length === 4 ? hex.slice(1).replace(/./g, '$&$&') : hex.slice(1);
  const [red = 0, green = 0, blue = 0] = (digits.match(/../g) ?? []).map(pair => {
    const channel = parseInt(pair, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 1.05 / (0.2126 * red + 0.7152 * green + 0.0722 * blue + 0.05);
}

function textColor(value: unknown, field: string): string {
  const hex = color(value, field);
  const ratio = contrastOnWhite(hex);
  if (ratio < MIN_CONTRAST) {
    throw new ConfigError(field, `${hex} has ${ratio.toFixed(1)}:1 contrast on the white card, needs ${MIN_CONTRAST}:1`);
  }
  return hex;
}

// Fonts go inside a double-quoted style attribute.
function font(value: unknown, field: string): string {
  return matching(value, field, value => !/["<>;]/.test(value), 'a font list with no " < > or ;');
}

function parseBrand(value: unknown): Brand {
  const raw = fields(value, 'brand', [
    'logoUrl', 'logoWidth', 'accent', 'ink', 'body', 'muted', 'paper', 'line', 'headingFont', 'bodyFont', 'footer',
  ]);
  if (raw.logoWidth !== undefined && !(Number.isInteger(raw.logoWidth) && (raw.logoWidth as number) > 0)) {
    throw new ConfigError('brand.logoWidth', 'must be a positive whole number');
  }
  return {
    ...(raw.logoUrl === undefined ? {} : { logoUrl: url(raw.logoUrl, 'brand.logoUrl') }),
    ...(raw.logoWidth === undefined ? {} : { logoWidth: raw.logoWidth as number }),
    accent: textColor(raw.accent, 'brand.accent'),
    ink: textColor(raw.ink, 'brand.ink'),
    body: textColor(raw.body, 'brand.body'),
    muted: color(raw.muted, 'brand.muted'),
    paper: color(raw.paper, 'brand.paper'),
    line: color(raw.line, 'brand.line'),
    headingFont: font(raw.headingFont, 'brand.headingFont'),
    bodyFont: font(raw.bodyFont, 'brand.bodyFont'),
    footer: text(raw.footer, 'brand.footer'),
  };
}

function parseContacts(value: unknown, plan: Plan): Contact[] {
  const contacts = list(value, 'contacts').map((item, index): Contact => {
    const field = `contacts[${index}]`;
    const raw = fields(item, field, ['name', 'email', 'role']);
    return {
      name: text(raw.name, `${field}.name`),
      email: matching(raw.email, `${field}.email`, isEmail, 'an email address'),
      role: oneOf(raw.role, `${field}.role`, ROLES),
    };
  });
  if (!contacts.some(contact => contact.role === 'owner')) {
    throw new ConfigError('contacts', 'needs at least one contact with role owner');
  }
  if (plan !== 'none' && !contacts.some(contact => contact.role === 'backup')) {
    throw new ConfigError('contacts', `needs a contact with role backup on the ${plan} plan`);
  }
  return contacts;
}

function parseRenewal(item: unknown, index: number): Renewal {
  const field = `renewals[${index}]`;
  const raw = fields(item, field, ['what', 'date', 'cost', 'yearly']);
  return {
    what: text(raw.what, `${field}.what`),
    date: date(raw.date, `${field}.date`),
    ...(raw.cost === undefined ? {} : { cost: text(raw.cost, `${field}.cost`) }),
    ...(raw.yearly === undefined ? {} : { yearly: flag(raw.yearly, `${field}.yearly`) }),
  };
}

function parseMonitor(value: unknown): { url: string; expect?: string } {
  const raw = fields(value, 'monitor', ['url', 'expect']);
  return {
    url: url(raw.url, 'monitor.url'),
    ...(raw.expect === undefined ? {} : { expect: text(raw.expect, 'monitor.expect') }),
  };
}

// A path inside the repo: relative, forward slashes, never climbing out.
function repoPath(value: unknown, field: string, { folder = false } = {}): string {
  return matching(
    value,
    field,
    value => !/^\/|\\|\s|(?:^|\/)\.\.?(?:\/|$)|\/\//.test(value) && (folder || !value.endsWith('/')),
    folder ? 'a path inside the repo, such as functions/' : 'a path inside the repo with no trailing slash',
  );
}

function commands(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  return list(value, field).map((command, index) => text(command, `${field}[${index}]`));
}

function loopback(value: unknown, field: string): string {
  return matching(value, field, value => {
    if (!URL.canParse(value)) return false;
    const { protocol, hostname, pathname, search, hash } = new URL(value);
    return /^https?:$/.test(protocol)
      && ['127.0.0.1', 'localhost', '[::1]'].includes(hostname)
      && pathname === '/' && !value.endsWith('/') && search === '' && hash === '';
  }, 'a loopback URL with no path, such as http://127.0.0.1:8765');
}

function parseRelease(value: unknown, contacts: Contact[], replyTo: unknown): ReleaseConfig {
  const raw = fields(value, 'release', ['to', 'deploy', 'secrets', 'ships', 'serve', 'staging', 'setup', 'generate', 'checks', 'checksWorkflow', 'notifyWorkflow', 'notes']);
  // The contacts, and the address replies go to, so whoever answers the client can get a copy.
  const known = new Set(contacts.map(contact => contact.email.toLowerCase()));
  if (typeof replyTo === 'string') known.add(mailboxAddress(replyTo));
  const to = list(raw.to, 'release.to').map((address, index) => {
    const field = `release.to[${index}]`;
    return matching(address, field, value => known.has(value.toLowerCase()), 'the email of one of the contacts, or the replyTo address');
  });
  if (to.length === 0) throw new ConfigError('release.to', 'needs at least one address');
  const repeated = to.find((address, index) => to.findIndex(other => other.toLowerCase() === address.toLowerCase()) !== index);
  if (repeated) throw new ConfigError('release.to', `lists ${repeated} twice`);
  const deploy = fields(raw.deploy, 'release.deploy', ['kind', 'project', 'dir', 'build']);
  const serve = fields(raw.serve, 'release.serve', ['command', 'url']);
  return {
    to,
    deploy: {
      kind: oneOf(deploy.kind, 'release.deploy.kind', ['pages'] as const),
      project: matching(deploy.project, 'release.deploy.project', value => /^[a-z0-9][a-z0-9-]*$/.test(value), 'a Pages project name'),
      dir: repoPath(deploy.dir, 'release.deploy.dir'),
      build: commands(deploy.build, 'release.deploy.build'),
    },
    // As `secrets run` names it: without the providers/ or projects/ folder it adds itself.
    ...(raw.secrets === undefined ? {} : { secrets: matching(raw.secrets, 'release.secrets', value => /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/.test(value) && !/^(providers|projects)\//.test(value), 'a secrets name as `secrets run` takes it, such as bogabee-site/cloudflare-pages, without providers/ or projects/') }),
    ships: raw.ships === undefined
      ? []
      : list(raw.ships, 'release.ships').map((path, index) => repoPath(path, `release.ships[${index}]`, { folder: true })),
    serve: { command: text(serve.command, 'release.serve.command'), url: loopback(serve.url, 'release.serve.url') },
    ...(raw.staging === undefined ? {} : { staging: matching(url(raw.staging, 'release.staging'), 'release.staging', value => isRoot(value, ['https:']), 'an https site root: no path, query or fragment') }),
    setup: commands(raw.setup, 'release.setup'),
    generate: commands(raw.generate, 'release.generate'),
    checks: commands(raw.checks, 'release.checks'),
    checksWorkflow: raw.checksWorkflow === undefined ? 'CI' : text(raw.checksWorkflow, 'release.checksWorkflow'),
    notifyWorkflow: raw.notifyWorkflow === undefined ? 'Notify release' : text(raw.notifyWorkflow, 'release.notifyWorkflow'),
    notes: raw.notes === undefined ? 'at-release' : oneOf(raw.notes, 'release.notes', ['at-release', 'in-pull-request'] as const),
  };
}

function timezone(value: unknown): string {
  if (value === undefined) return 'America/New_York';
  const zone = text(value, 'timezone');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
  } catch {
    throw new ConfigError('timezone', `"${zone}" is not a time zone`);
  }
  return zone;
}

export function validateConfig(value: unknown): ClientConfig {
  const raw = fields(value, 'config', [
    'slug', 'name', 'plan', 'launched', 'repo', 'site', 'updatesUrl', 'noun', 'from', 'replyTo',
    'notesSince', 'timezone', 'jargonAllow', 'brand', 'contacts', 'renewals', 'monitor', 'example', 'release',
  ]);
  const plan = oneOf(raw.plan, 'plan', PLANS);
  const contacts = parseContacts(raw.contacts, plan);
  // The release commands refuse a checkout whose origin is another repo, and the review page links its pull requests.
  if (raw.release !== undefined && raw.repo === undefined) throw new ConfigError('repo', 'is needed when release is set');
  return {
    slug: matching(raw.slug, 'slug', value => /^[a-z0-9][a-z0-9-]*$/.test(value), 'lowercase letters, digits and hyphens'),
    name: text(raw.name, 'name'),
    plan,
    launched: date(raw.launched, 'launched'),
    ...(raw.repo === undefined ? {} : { repo: matching(raw.repo, 'repo', value => /^[\w.-]+\/[\w.-]+$/.test(value), 'owner/name') }),
    site: matching(url(raw.site, 'site'), 'site', value => isRoot(value, ['https:', 'http:']), 'a site root with no trailing slash, query or fragment'),
    ...(raw.updatesUrl === undefined ? {} : { updatesUrl: url(raw.updatesUrl, 'updatesUrl') }),
    noun: text(raw.noun, 'noun'),
    from: matching(raw.from, 'from', isMailbox, 'an address, with or without a display name'),
    replyTo: matching(raw.replyTo, 'replyTo', isMailbox, 'an address, with or without a display name'),
    timezone: timezone(raw.timezone),
    ...(raw.notesSince === undefined ? {} : { notesSince: date(raw.notesSince, 'notesSince') }),
    ...(raw.jargonAllow === undefined
      ? {}
      : { jargonAllow: list(raw.jargonAllow, 'jargonAllow').map((word, index) => text(word, `jargonAllow[${index}]`)) }),
    brand: parseBrand(raw.brand),
    contacts,
    ...(raw.renewals === undefined ? {} : { renewals: list(raw.renewals, 'renewals').map(parseRenewal) }),
    ...(raw.monitor === undefined ? {} : { monitor: parseMonitor(raw.monitor) }),
    ...(raw.example === undefined ? {} : { example: flag(raw.example, 'example') }),
    ...(raw.release === undefined ? {} : { release: parseRelease(raw.release, contacts, raw.replyTo) }),
  };
}

export function parseJson(json: string, source: string): unknown {
  try {
    return JSON.parse(json);
  } catch (error) {
    throw new Error(`${source}: is not valid JSON: ${(error as Error).message}`);
  }
}

export function parseConfig(json: string, source: string): ClientConfig {
  const value = parseJson(json, source);
  try {
    return validateConfig(value);
  } catch (error) {
    throw new Error(`${source}: ${(error as Error).message}`, { cause: error });
  }
}
