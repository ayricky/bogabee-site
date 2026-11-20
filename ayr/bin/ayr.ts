#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { parseConfig, type ClientConfig } from '../src/config.ts';
import { stampFor } from '../src/doctor.ts';
import { changeCommand, checkChangeFiles, hasChangeFiles, nextReleaseEmail } from './changes.ts';
import { isDate } from '../src/dates.ts';
import { dueItems } from '../src/due.ts';
import { checkEntries } from '../src/lint.ts';
import { entryText, parseNotes } from '../src/notes.ts';
import { renderRelease, type Email } from '../src/render.ts';
import { parseNumbers, parseUptime, renderMonthly, renderQuarterly, type UptimeReport } from '../src/report.ts';
import { sendRelease } from '../src/send.ts';
import { releaseCommand } from './release.ts';
import { parseTemplate, renderTemplate } from '../src/templates.ts';
import { hasReleaseTrigger, vendoredWorkflows } from '../src/workflows.ts';
import { mediaCommand, readChangeFiles } from './media.ts';

const KIT = resolve(import.meta.dirname, '..');
const WORKFLOWS = join('.github', 'workflows');
const RELEASE_LINE = 'node ayr/bin/ayr.ts latest | gh release create "prod-$(date +%F)-$(git rev-parse --short HEAD)" --target "$(git rev-parse HEAD)" --notes-file -';

const USAGE = `ayr: looks after a client after launch.

  ayr check [notes] --client x [--all] [--site-dir dir] [--pr base]
  ayr change <id>
  ayr preview release [--out dir]     the next release, from changes/
  ayr preview release|monthly|quarterly|<template> --client x --out dir [...]
  ayr send release --client x --notes f --tag prod-... [--to a,b] [--video f.mp4] [--picture f.jpg]...
  ayr latest [--notes f]
  ayr media [--client x] [--out dir]
  ayr message <template> --client x --set key=value ... [--out dir]
  ayr monthly --client x --month 2026-10 --notes f [--uptime f.json] [--backups text] [--out dir]
  ayr quarterly --client x --from d --to d --notes f --numbers f.json [--uptime f.json] [--out dir]
  ayr due [--date d] [--clients dir] [--json]
  ayr init <repo-path> --client x [--dry-run] [--force]
  ayr release status [--review-dir dir]             what is waiting on main: the last release, a draft, change files
  ayr release draft [--review-dir dir]              commit the next release to main and write its review page
  ayr release run --commit <sha> [--rehearsal] [--review-dir dir]
                                                    check, deploy, check live, tag, and have GitHub email the client
  ayr release undo [--review-dir dir]               take back a draft nobody released
  ayr release serve --review-dir dir --port n [--origin url --allow-login login] [--run-with "prefix"]
                                                    the review page with Release and Test on a preview buttons
  ayr release wait --review-dir dir [--timeout s]   return when a release of that draft ends
  ayr release doctor [--fix]                        whether this repo is set up to release; --fix makes the changes it can
`;

const { values: flags, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    all: { type: 'boolean' },
    'allow-login': { type: 'string', multiple: true },
    backups: { type: 'string' },
    client: { type: 'string' },
    clients: { type: 'string' },
    commit: { type: 'string' },
    date: { type: 'string' },
    'dry-run': { type: 'boolean' },
    fix: { type: 'boolean' },
    force: { type: 'boolean' },
    from: { type: 'string' },
    help: { type: 'boolean' },
    json: { type: 'boolean' },
    month: { type: 'string' },
    notes: { type: 'string' },
    numbers: { type: 'string' },
    origin: { type: 'string', multiple: true },
    out: { type: 'string' },
    port: { type: 'string' },
    pr: { type: 'string' },
    rehearsal: { type: 'boolean' },
    review: { type: 'string' },
    'review-dir': { type: 'string' },
    'run-with': { type: 'string' },
    set: { type: 'string', multiple: true },
    'site-dir': { type: 'string' },
    tag: { type: 'string' },
    timeout: { type: 'string' },
    to: { type: 'string' },
    uptime: { type: 'string' },
    picture: { type: 'string', multiple: true },
    video: { type: 'string', multiple: true },
  },
});

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing ${name}.\n\n${USAGE}`);
  return value;
}

// Every text file the command reads: a BOM goes, and a failure names the file.
function read(path: string): string {
  try {
    return readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
  } catch (error) {
    throw new Error(`Can't read ${path}: ${(error as NodeJS.ErrnoException).code}.`);
  }
}

function isPath(value: string, extension: string): boolean {
  return value.includes('/') || value.endsWith(extension);
}

// A client repo's copy of the kit has one client, so --client is optional there.
function clientPath(): string {
  const own = join(KIT, 'client.json');
  if (!flags.client && existsSync(own)) return own;
  const client = required('--client', flags.client);
  return isPath(client, '.json') ? client : join(KIT, 'clients', `${client}.json`);
}

function loadClient(): ClientConfig {
  const path = clientPath();
  return parseConfig(read(path), path);
}

function notesPath(): string {
  return flags.notes ?? 'PATCH_NOTES.md';
}

function dateFlag(name: string, value: string | undefined): string {
  const date = required(`--${name}`, value);
  if (!isDate(date)) throw new Error(`--${name} must be a real date as YYYY-MM-DD, got "${date}".`);
  return date;
}

function setValues(): Record<string, string> {
  return Object.fromEntries((flags.set ?? []).map((pair): [string, string] => {
    const equals = pair.indexOf('=');
    if (equals < 1) throw new Error(`--set needs key=value, got "${pair}".`);
    return [pair.slice(0, equals), pair.slice(equals + 1)];
  }));
}

function uptimeFile(config: ClientConfig, firstMonth: string, lastMonth: string): { uptime?: UptimeReport[] } {
  return flags.uptime ? { uptime: parseUptime(read(flags.uptime), config, firstMonth, lastMonth, flags.uptime) } : {};
}

function monthly(config: ClientConfig): Email {
  const month = required('--month', flags.month);
  if (!isDate(`${month}-01`)) throw new Error(`--month must be YYYY-MM, got "${month}".`);
  if (month >= new Date().toISOString().slice(0, 7)) throw new Error(`--month ${month} hasn't ended yet.`);
  return renderMonthly(config, parseNotes(read(notesPath())), {
    month,
    ...uptimeFile(config, month, month),
    ...(flags.backups ? { backups: flags.backups } : {}),
  });
}

function quarterly(config: ClientConfig): Email {
  const from = dateFlag('from', flags.from);
  const to = dateFlag('to', flags.to);
  if (from > to) throw new Error('--from must not be after --to.');
  const numbersPath = required('--numbers', flags.numbers);
  const numbers = parseNumbers(read(numbersPath), numbersPath);
  return renderQuarterly(config, parseNotes(read(notesPath())), {
    from,
    to,
    numbers,
    ...uptimeFile(config, from.slice(0, 7), to.slice(0, 7)),
  });
}

function template(config: ClientConfig, name: string): { email: Email; file: string } {
  const path = isPath(name, '.md') ? name : join(KIT, 'templates', 'messages', `${name}.md`);
  if (!existsSync(path)) throw new Error(`No template at ${path}.`);
  const file = basename(path, '.md');
  return { email: renderTemplate(parseTemplate(read(path), file), setValues(), config), file };
}

function write(email: Email, name: string, out: string): void {
  mkdirSync(out, { recursive: true });
  const html = join(out, `${name}.html`);
  const text = join(out, `${name}.txt`);
  writeFileSync(html, email.html);
  writeFileSync(text, email.text);
  console.log(`Subject: ${email.subject}\nWrote ${html}\nWrote ${text}`);
}

function deliver(email: Email, name: string): void {
  if (flags.out) write(email, name, flags.out);
  else console.log(`Subject: ${email.subject}\n\n${email.body}`);
}

function check(notes = 'PATCH_NOTES.md'): void {
  const config = loadClient();
  // A fresh client's PATCH_NOTES.md has no entries until its first release writes one.
  const text = read(notes);
  const entries = /^## /m.test(text) ? parseNotes(text) : [];
  const siteDir = flags['site-dir'];
  const findings = checkEntries(entries, config, {
    all: flags.all ?? false,
    ...(siteDir ? {
      siteFile: (path: string) => {
        const file = join(siteDir, path);
        return existsSync(file) ? readFileSync(file) : null;
      },
    } : {}),
  });
  for (const finding of findings) {
    console.log(`${notes}:${finding.line} ${finding.severity} ${finding.rule} [${finding.entry}] ${finding.message} Fix: ${finding.fix}`);
  }
  const errors = findings.filter(finding => finding.severity === 'error').length;
  const checked = flags.all ? entries.length : Math.min(entries.length, 1);
  console.log(`${checked} ${checked === 1 ? 'entry' : 'entries'} checked: ${errors} errors, ${findings.length - errors} warnings.`);
  if (errors + checkChangeFiles(config, flags.pr ?? null) > 0) process.exitCode = 1;
}

function preview(name: string | undefined): void {
  if (!name) throw new Error(`Missing what to preview.\n\n${USAGE}`);
  const config = loadClient();
  if (name === 'release' && !flags.notes && hasChangeFiles()) {
    const email = nextReleaseEmail(config, notesPath(), new Date());
    if (email) write(email, name, flags.out ?? join('.cache', 'ayr'));
    else console.log('Every change file is quiet, so this release sends no email.');
    return;
  }
  const out = required('--out', flags.out);
  if (name === 'release') {
    const [entry] = parseNotes(read(notesPath()));
    if (!entry) throw new Error('The notes contain no entries.');
    write(renderRelease(config, entry, { hasVideo: (flags.video ?? []).length > 0 }), name, out);
  } else if (name === 'monthly') {
    write(monthly(config), name, out);
  } else if (name === 'quarterly') {
    write(quarterly(config), name, out);
  } else {
    const { email, file } = template(config, name);
    write(email, file, out);
  }
}

async function send(what: string | undefined): Promise<void> {
  if (what !== 'release') throw new Error(`ayr send only sends a release.\n\n${USAGE}`);
  const id = await sendRelease({
    config: loadClient(),
    notes: read(required('--notes', flags.notes)),
    tag: required('--tag', flags.tag),
    ...(flags.to ? { to: flags.to } : {}),
    videos: flags.video ?? [],
    pictures: flags.picture ?? [],
    env: process.env,
    fetch,
  });
  console.log(`Sent. Resend id: ${id}`);
}

// The newest entry, whole, for the body of a GitHub Release.
function latest(): void {
  const [entry] = parseNotes(read(notesPath()));
  if (!entry) throw new Error('The notes contain no entries.');
  process.stdout.write(entryText(entry));
}

function due(): void {
  const dir = flags.clients ?? join(KIT, 'clients');
  if (!existsSync(dir)) {
    throw new Error(`No clients folder at ${dir}. ayr due lists every client, so run it from the ayr-client-kit repo, not a client's copy.`);
  }
  const configs = readdirSync(dir)
    .filter(file => file.endsWith('.json'))
    .map(file => parseConfig(read(join(dir, file)), join(dir, file)));
  const today = flags.date ? dateFlag('date', flags.date) : new Date().toISOString().slice(0, 10);
  const items = dueItems(configs, today);
  if (flags.json) {
    console.log(JSON.stringify(items, null, 2));
    return;
  }
  if (items.length === 0) console.log(`Nothing due on ${today}.`);
  for (const item of items) console.log(`${item.date}  ${item.client}  ${item.what}`);
}

function kitFiles(folder: string): string[] {
  const root = join(KIT, folder);
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter(file => statSync(join(root, file)).isFile())
    .map(file => join(folder, file));
}

// Workflows init doesn't write that run on a release: each would be a second sender.
function otherReleaseWorkflows(repo: string, ours: string[]): string[] {
  const folder = join(repo, WORKFLOWS);
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .filter(file => /\.ya?ml$/.test(file))
    .map(file => join(WORKFLOWS, file))
    .filter(path => !ours.includes(path) && hasReleaseTrigger(read(join(repo, path))));
}

// Previews land in .cache/, and a deploy can refuse a dirty tree.
function ignoreCache(repo: string, verb: string): void {
  const path = join(repo, '.gitignore');
  const current = existsSync(path) ? read(path) : '';
  if (/^\/?\.cache\/?\s*$/m.test(current)) {
    console.log('Unchanged .gitignore');
    return;
  }
  if (!flags['dry-run']) writeFileSync(path, `${current}${current && !current.endsWith('\n') ? '\n' : ''}.cache/\n`);
  console.log(`${verb} .gitignore, adding .cache/`);
}

// The kit commit a copy came from, so `ayr release doctor` can tell when the kit has moved on.
function kitStamp(): { path: string; content: Buffer }[] {
  const stamp = stampFor((...args) => execFileSync('git', ['-C', KIT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  if (!stamp) return [];
  if (stamp.commit === null) {
    console.log('The kit has uncommitted changes to files init copies, so ayr/kit.json names no commit and `ayr release doctor` will fail until the copy is made from a committed kit.');
  }
  return [{ path: join('ayr', 'kit.json'), content: Buffer.from(`${JSON.stringify(stamp)}\n`) }];
}

function init(repo: string | undefined): void {
  const target = required('<repo-path>', repo);
  if (!existsSync(target)) throw new Error(`No repo at ${target}.`);
  const config = loadClient(); // refuse a bad config before copying it
  const templates = join(KIT, 'templates', 'repo');
  if (!existsSync(templates)) throw new Error('No templates here. Run init from the kit, not a client copy.');
  const workflows = vendoredWorkflows(config.release)
    .map(name => ({ path: join(WORKFLOWS, name), content: readFileSync(join(templates, name)) }));

  const files: { path: string; content: Buffer }[] = [
    ...[...kitFiles('src'), ...kitFiles('bin'), ...kitFiles(join('templates', 'messages')), 'package.json'].map(file => ({
      path: join('ayr', file),
      content: readFileSync(join(KIT, file)),
    })),
    { path: join('ayr', 'client.json'), content: readFileSync(clientPath()) },
    // The kit commit this copy came from, so `ayr release doctor` can tell when the kit has moved on.
    ...kitStamp(),
    // No lockfile: package.json pins exact versions, and the workflows install from it.
    { path: join('ayr', '.gitignore'), content: Buffer.from('node_modules/\npackage-lock.json\n') },
    ...workflows,
  ];
  if (!existsSync(join(target, 'PATCH_NOTES.md'))) {
    files.push({ path: 'PATCH_NOTES.md', content: readFileSync(join(templates, 'PATCH_NOTES.md')) });
  }

  const existing = (path: string) => (existsSync(join(target, path)) ? readFileSync(join(target, path)) : null);
  const different = files.filter(({ path, content }) => {
    const current = existing(path);
    return current !== null && !current.equals(content);
  });
  const mailers = otherReleaseWorkflows(target, workflows.map(({ path }) => path));
  if ((different.length > 0 || mailers.length > 0) && !flags.force) {
    const paths = (list: string[]) => list.map(path => `  ${path}`).join('\n');
    throw new Error([
      'Refusing to go on. Nothing was written.',
      ...(different.length > 0 ? [`These files differ. --force replaces them.\n${paths(different.map(({ path }) => path))}`] : []),
      ...(mailers.length > 0 ? [`These workflows already run on a release, so the client would get a second email. --force leaves them in place and they keep running, so delete or disable them yourself.\n${paths(mailers)}`] : []),
    ].join('\n'));
  }

  const verb = flags['dry-run'] ? 'Would write' : 'Wrote';
  for (const { path, content } of files) {
    const current = existing(path);
    if (current?.equals(content)) {
      console.log(`Unchanged ${path}`);
      continue;
    }
    if (!flags['dry-run']) {
      mkdirSync(dirname(join(target, path)), { recursive: true });
      writeFileSync(join(target, path), content);
    }
    console.log(`${current ? (flags['dry-run'] ? 'Would replace' : 'Replaced') : verb} ${path}`);
  }
  ignoreCache(target, verb);
  for (const path of mailers) {
    console.log(`Left in place ${path}. It still runs on a release, so the client can get two emails. Delete or disable it.`);
  }
  if (config.release) {
    console.log('\nSet this in the repo settings:\n  secret: RESEND_API_KEY');
    console.log([
      '\nOn the devbox that releases, set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID, and install wrangler next to the kit:',
      '  npm install --prefix ayr --no-save wrangler@4',
      '\nA release is the client-release skill, from a checkout on main:',
      '  node ayr/bin/ayr.ts release draft                          commits the release to main and writes the review page',
      '  node ayr/bin/ayr.ts release run --commit <sha> --rehearsal  deploys to the ayr-rehearsal preview and checks it. Do this once first.',
      '  node ayr/bin/ayr.ts release run --commit <sha>              after the owner says to send it. <sha> is the commit draft printed.',
      'Merging to main releases nothing and emails nobody. Publishing the GitHub Release, which `release run` does last, sends the email.',
    ].join('\n'));
  } else {
    console.log('\nSet these in the repo settings:\n  secret: RESEND_API_KEY\n  variable: NOTIFY_EMAILS');
    console.log(`\nAn email goes out only when a GitHub Release tagged prod-* is published. A plain git tag sends nothing. After each deploy, from the repo root:\n  ${RELEASE_LINE}`);
  }
  console.log(`\nAdd ${join(templates, 'CLAUDE-section.md')} to the repo's CLAUDE.md.`);
}

async function main(): Promise<void> {
  const [command, argument] = positionals;
  if (flags.help) {
    console.log(USAGE);
    return;
  }
  switch (command) {
    case 'check': return check(argument);
    case 'change': return changeCommand(argument);
    case 'preview': return preview(argument);
    case 'send': return send(argument);
    case 'latest': return latest();
    case 'message': {
      if (!argument) throw new Error(`Missing template name.\n\n${USAGE}`);
      const { email, file } = template(loadClient(), argument);
      return deliver(email, file);
    }
    case 'monthly': return deliver(monthly(loadClient()), 'monthly');
    case 'quarterly': return deliver(quarterly(loadClient()), 'quarterly');
    case 'due': return due();
    case 'media': {
      await mediaCommand({ config: loadClient(), changes: readChangeFiles('changes'), out: flags.out ?? join('.cache', 'ayr') });
      return;
    }
    case 'init': return init(argument);
    case 'release': {
      const status = await releaseCommand(argument, {
        ...(flags.fix ? { fix: true } : {}),
        ...(flags.rehearsal ? { rehearsal: true } : {}),
        ...(flags['review-dir'] ? { reviewDir: flags['review-dir'] } : {}),
        ...(flags.commit === undefined ? {} : { commit: flags.commit }),
        ...(flags.review === undefined ? {} : { review: flags.review }),
        ...(flags.port === undefined ? {} : { port: flags.port }),
        ...(flags.origin === undefined ? {} : { origin: flags.origin }),
        ...(flags['allow-login'] === undefined ? {} : { allowLogin: flags['allow-login'] }),
        ...(flags['run-with'] === undefined ? {} : { runWith: flags['run-with'] }),
        ...(flags.timeout === undefined ? {} : { timeout: flags.timeout }),
      });
      if (status !== 0) process.exitCode = status;
      return;
    }
    default: throw new Error(command ? `Unknown command "${command}".\n\n${USAGE}` : USAGE);
  }
}

try {
  await main();
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
