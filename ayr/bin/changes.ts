// The change file commands: `ayr change`, the change file half of `ayr check`,
// and `ayr preview release` from changes/. Argument handling and file access
// only; the rules live in src/changes.ts.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assembleEntry, CHANGE_DIR, ChangeError, changeFile, checkChanges, checkPullRequest, entryHeading, isChangeId, parseChange, prNumbers,
  type Change, type Range,
} from '../src/changes.ts';
import type { ClientConfig } from '../src/config.ts';
import type { Finding } from '../src/lint.ts';
import { parseNotes } from '../src/notes.ts';
import { clientDate } from '../src/release.ts';
import { renderRelease, type Email } from '../src/render.ts';

/** Runs git in the working folder. Null when git fails, for callers that can do without it. */
export type Git = (args: string[]) => string | null;

export const git: Git = args => {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    return null;
  }
};

function gitOrThrow(run: Git, args: string[]): string {
  const output = run(args);
  if (output === null) throw new Error(`git ${args.join(' ')} failed. Run it yourself to see why.`);
  return output;
}

const lines = (output: string | null): string[] => (output ?? '').split('\n').filter(Boolean);

const SCAFFOLD = `---
quiet:
action:
picture:
alt:
record:
step:
---
`;

const GUIDE = `Fill in the keys and write one bullet below the second ---:
  action:  none, or You need to: <what>.
  picture: after|compare both|phone|desktop /path [#section], or none. both shows phone and desktop
  alt:     what the picture shows
  record:  phone /path, then step: lines ending with a see step
  step:    tap "text" | type "field" "text" | see "text" | scroll "text" | wait 1500 | back
  quiet:   <why>, alone and with no bullet, for a change the client won't notice
Then run: node ayr/bin/ayr.ts check`;

/** `ayr change online-booking`: writes the file only if absent, prints its path. */
export function changeCommand(id: string | undefined): void {
  if (!id) throw new Error('Missing the change id, such as online-booking.');
  if (!isChangeId(id)) throw new Error(`"${id}" is not a change id. Use lowercase letters, digits and hyphens, such as online-booking.`);
  const file = changeFile(id);
  if (existsSync(file)) throw new Error(`${file} already exists. Pick another id, or edit that file.`);
  mkdirSync(CHANGE_DIR, { recursive: true });
  writeFileSync(file, SCAFFOLD, { flag: 'wx' });
  console.log(`Wrote ${file}\n${GUIDE}`);
}

function parseFile(file: string): Change | Finding {
  try {
    return parseChange(file, readFileSync(file, 'utf8'));
  } catch (error) {
    if (!(error instanceof ChangeError)) throw error;
    // The message already says the fix.
    const problem = error.message.slice(`${file}:${error.line}: `.length);
    return { entry: file, line: error.line, rule: 'change-file', severity: 'error', message: problem, fix: '' };
  }
}

function isChange(value: Change | Finding): value is Change {
  return 'kind' in value;
}

function changePaths(): string[] {
  if (!existsSync(CHANGE_DIR)) return [];
  return readdirSync(CHANGE_DIR).filter(name => name.endsWith('.md')).sort().map(name => `${CHANGE_DIR}/${name}`);
}

function print(finding: Finding): void {
  const where = finding.line > 0 ? `${finding.entry}:${finding.line}` : finding.entry;
  const fix = finding.fix ? ` Fix: ${finding.fix}` : '';
  console.log(`${where} ${finding.severity} ${finding.rule} ${finding.message}${fix}`);
}

/**
 * The change file half of `ayr check`: every changes/*.md, and with `pr` the
 * pull request rules over `git diff --name-only <pr>...HEAD`.
 * Prints each finding and a count, and returns the number of errors.
 */
export function checkChangeFiles(config: ClientConfig, pr: string | null, run: Git = git): number {
  const parsed = changePaths().map(parseFile);
  const changes = parsed.filter(isChange);
  const findings: Finding[] = [...parsed.filter((result): result is Finding => !isChange(result)), ...checkChanges(changes, config)];
  if (pr !== null) {
    const range = `${pr}...HEAD`;
    const changedFiles = lines(gitOrThrow(run, ['diff', '--name-only', range]));
    const createdFiles = lines(gitOrThrow(run, ['diff', '--name-only', '--diff-filter=A', range]));
    const added = new Set(createdFiles.filter(path => path.startsWith(`${CHANGE_DIR}/`)));
    findings.push(...checkPullRequest({ changedFiles, addedChanges: changes.filter(change => added.has(change.file)), config, createdFiles }));
  }
  if (parsed.length === 0 && pr === null) return 0;
  findings.forEach(print);
  const errors = findings.filter(finding => finding.severity === 'error').length;
  const files = parsed.length === 1 ? 'change file' : 'change files';
  console.log(`${parsed.length} ${files}${pr === null ? '' : ' and the pull request'} checked: ${errors} errors, ${findings.length - errors} warnings.`);
  return errors;
}

/** changes/*.md in the order each landed on this branch (as `ayr release draft` orders them), then any not committed yet, by name. */
function inMergeOrder(paths: string[], run: Git): string[] {
  const added = lines(run(['log', '--first-parent', '--diff-merges=first-parent', '--diff-filter=A', '--name-only', '--format=', '--reverse', '--', CHANGE_DIR]));
  const known = new Set(paths);
  const ordered = [...new Set(added.toReversed())].toReversed().filter(path => known.has(path));
  return [...ordered, ...paths.filter(path => !ordered.includes(path))];
}

// The range since the newest prod-* tag. Only the Internal line uses it, and the
// email leaves that line out, so a folder with no git gets a placeholder.
function currentRange(run: Git): Range {
  const short = (ref: string) => run(['rev-parse', '--short', ref])?.trim() ?? null;
  const to = short('HEAD') ?? '0000000';
  const tag = lines(run(['tag', '--list', 'prod-*', '--sort=-creatordate']))[0];
  const from = tag ? short(`${tag}^{commit}`) : null;
  const subjects = lines(run(['log', '--format=%s', from ? `${from}..HEAD` : 'HEAD']));
  return { from, to, prs: prNumbers(subjects) };
}

function headings(notes: string): string[] {
  if (!existsSync(notes)) return [];
  try {
    return parseNotes(readFileSync(notes, 'utf8')).map(entry => entry.heading);
  } catch {
    return [];
  }
}

/** True when changes/ holds change files, so `ayr preview release` previews them. */
export function hasChangeFiles(): boolean {
  return changePaths().length > 0;
}

/**
 * The next release's email from changes/, as `ayr release draft` would assemble
 * it today. Refuses a change file that fails to parse. Null when every change
 * is quiet, because then nothing is sent.
 */
export function nextReleaseEmail(config: ClientConfig, notes: string, now: Date, run: Git = git): Email | null {
  const changes = inMergeOrder(changePaths(), run).map(file => {
    const result = parseFile(file);
    if (!isChange(result)) throw new Error(`${file}:${result.line}: ${result.message}`);
    return result;
  });
  if (changes.every(change => change.kind === 'quiet')) return null;
  const date = clientDate(now, config.timezone);
  const heading = entryHeading(date, now, config.timezone, headings(notes));
  // The email shows each picture from the email itself. `ayr media` writes them into the same folder as this preview.
  const [entry] = parseNotes(assembleEntry({ changes, heading, date, range: currentRange(run), config, pictures: file => file }));
  if (!entry) throw new Error('The assembled entry did not parse.');
  const hasVideo = changes.some(change => change.kind === 'item' && change.recording !== null);
  return renderRelease(config, entry, { hasVideo });
}
