// `ayr release doctor`: whether a client repo is set up to release, one check per thing that has to
// be true, each with what to do when it isn't. Pure: bin/release.ts gathers the facts and prints.
//
// It is what makes a new client a checklist the kit runs, not one an agent remembers. The
// client-release skill runs it before anything else, and a new client is set up when it passes.

import type { ReleaseConfig } from './config.ts';

/** What the doctor is told about a client repo, its GitHub repo and its Cloudflare project. Null: could not be looked at. */
export interface Facts {
  release: ReleaseConfig;
  repo: string;
  /** The repo the checkout's origin names, as owner/name, or null when it has none. */
  origin: string | null;
  /** Whether `secrets ls` lists release.secrets. Null: no `secrets` here, or no release.secrets to look for. */
  secretsFile: boolean | null;
  /** Every workflow under .github/workflows, by file name. */
  workflows: { file: string; text: string }[];
  /** PATCH_NOTES.md, or null when the repo has none. */
  notes: string | null;
  wrangler: boolean;
  /** Whether the repo has the RESEND_API_KEY secret. Null: GitHub could not be asked. */
  resendSecret: boolean | null;
  /** The Pages project production deploys to. Null: no Cloudflare token here. `missing`: no such project. */
  pages: { gitConnected: boolean; productionBranch: string } | 'missing' | null;
  /** What the staging site answered, when the config names one. Null: not asked, or no answer. */
  staging: number | null;
}

export interface Check {
  id: 'origin' | 'notify' | 'checks' | 'notes' | 'wrangler' | 'resend' | 'pages' | 'staging' | 'secrets';
  ok: boolean;
  /** Only for a check that needs something the machine can't give right now, such as a token. */
  skipped?: true;
  detail: string;
  fix?: string;
}

const nameOf = (text: string): string | null => /^name:\s*['"]?(.+?)['"]?\s*$/m.exec(text)?.[1] ?? null;

/** The `on:` block of a workflow, as text: from `on:` to the next line that starts at the margin. */
function triggers(text: string): string {
  const at = /^(?:on|'on'|"on"):.*$/m.exec(text);
  if (!at) return '';
  const rest = text.slice(at.index + at[0].length);
  const end = rest.search(/^\S/m);
  return at[0] + (end < 0 ? rest : rest.slice(0, end));
}

/** The items of a YAML list written `[a, b]`, or as `- a` lines under a key, unquoted. */
function items(block: string, key: string): string[] | null {
  const inline = new RegExp(`^[ \\t]*${key}:[ \\t]*\\[([^\\]]*)\\]`, 'm').exec(block);
  if (inline) return (inline[1] ?? '').split(',').map(item => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  const single = new RegExp(`^[ \\t]*${key}:[ \\t]*(['"]?)([^\\s'"#]+)\\1[ \\t]*$`, 'm').exec(block);
  if (single) return [single[2] ?? ''];
  const at = new RegExp(`^([ \\t]*)${key}:[ \\t]*$`, 'm').exec(block);
  if (!at) return null;
  const indent = (at[1] ?? '').length;
  const found: string[] = [];
  for (const line of block.slice(at.index + at[0].length).split('\n').slice(1)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    // YAML lets a list's `- ` items sit at the key's own indent, or further in.
    const match = /^(\s*)-\s*['"]?([^'"#\s]+)['"]?/.exec(line);
    if (!match || (match[1] ?? '').length < indent) break;
    found.push(match[2] ?? '');
  }
  return found;
}

/**
 * Whether the step that runs `ayr send release` passes each picture and has the RESEND_API_KEY secret
 * in its own env: a key mapped on another step, or commented out, never reaches the send.
 */
function sendStep(text: string): boolean {
  const lines = text.split('\n').filter(line => !/^\s*#/.test(line));
  const sends = lines.findIndex(line => /ayr\/bin\/ayr\.ts send release/.test(line));
  if (sends < 0) return false;
  // The step is the lines from its `- ` up to the next step at the same indent.
  let start = sends;
  while (start > 0 && !/^\s*- /.test(lines[start] ?? '')) start -= 1;
  const indent = (lines[start] ?? '').search(/-/);
  let end = start + 1;
  while (end < lines.length && !((lines[end] ?? '').search(/\S/) <= indent && /\S/.test(lines[end] ?? ''))) end += 1;
  const step = lines.slice(start, end).join('\n');
  return /--picture/.test(step) && /^\s*RESEND_API_KEY:\s*\$\{\{\s*secrets\.RESEND_API_KEY\s*\}\}\s*$/m.test(step);
}

/** Whether a path list takes a file, as GitHub reads it: in order, the last pattern that matches decides, and `!` takes a file back out. */
function filtered(patterns: string[], file: string): boolean {
  let taken = false;
  for (const pattern of patterns) {
    if (pattern.startsWith('!')) {
      if (globMatch(pattern.slice(1), file)) taken = false;
    } else if (globMatch(pattern, file)) {
      taken = true;
    }
  }
  return taken;
}

/** GitHub's path glob, as far as a workflow uses it: `**` any depth, `*` within one folder, `?` one character. */
function globMatch(pattern: string, file: string): boolean {
  const source = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\/?/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '.*');
  return new RegExp(`^${source}$`).test(file);
}

/** Whether a branch filter pattern takes main: main itself, or a glob GitHub reads as every branch. */
const takesMain = (pattern: string): boolean => pattern === 'main' || pattern === '*' || pattern === '**' || pattern === 'refs/heads/main';

/** Whether a workflow runs on a push to main, as GitHub reads its `on:`. */
export function runsOnPushToMain(text: string): boolean {
  const on = triggers(text);
  if (!on) return false;
  const head = /^(?:on|'on'|"on"):[ \t]*(.*)$/m.exec(on)?.[1]?.trim() ?? '';
  // `on: push` or `on: [push, pull_request]`: every push, main's included.
  if (head && !head.startsWith('#')) return /^\[?\s*(?:[\w-]+\s*,\s*)*push\b/.test(head.replace(/['"]/g, ''));
  const push = /^([ \t]+)push:[ \t]*(.*)$/m.exec(on);
  if (!push) return false;
  if ((push[2] ?? '').trim() && !(push[2] ?? '').trim().startsWith('#')) return (push[2] ?? '').trim() !== 'null' ? false : true;
  // Its own block: the lines under push: indented past it.
  const indent = (push[1] ?? '').length;
  const lines: string[] = [];
  for (const line of on.slice(push.index + push[0].length).split('\n').slice(1)) {
    if (line.trim() && line.search(/\S/) <= indent) break;
    lines.push(line);
  }
  const block = lines.join('\n');
  // A path filter must let every draft through. The one file each draft changes is a change file it deletes:
  // a quiet release changes nothing else, so a filter that skips changes/ would start no run for it, and
  // `run` would wait for nothing.
  const always = 'changes/a-change.md';
  const paths = items(block, 'paths');
  if (paths && !filtered(paths, always)) return false;
  const pathsIgnore = items(block, 'paths-ignore');
  if (pathsIgnore && filtered(pathsIgnore, always)) return false;
  const branches = items(block, 'branches');
  const ignored = items(block, 'branches-ignore');
  if (branches) return branches.some(takesMain) && !branches.some(pattern => pattern === '!main');
  if (ignored) return !ignored.some(takesMain);
  // Only tags or paths named: tags alone never run on a branch push.
  return items(block, 'tags') === null;
}

export function diagnose(facts: Facts): Check[] {
  const { release } = facts;
  const checks: Check[] = [];
  const named = (name: string) => facts.workflows.find(workflow => nameOf(workflow.text) === name);
  const run = release.secrets ? `secrets run ${release.secrets} -- node ayr/bin/ayr.ts release doctor` : 'secrets run <client file> -- node ayr/bin/ayr.ts release doctor';

  checks.push(facts.origin !== null && facts.origin.toLowerCase() === facts.repo.toLowerCase()
    ? { id: 'origin', ok: true, detail: `This checkout is of ${facts.repo}.` }
    : { id: 'origin', ok: false, detail: `This checkout's origin is ${facts.origin ?? 'not set'}, but the config is for ${facts.repo}. The release commands refuse it.`, fix: 'Run this from a checkout of the client repo, or correct `repo` in the config.' });

  const notify = named(release.notifyWorkflow);
  if (!notify) {
    checks.push({ id: 'notify', ok: false, detail: `No workflow is named "${release.notifyWorkflow}", so a published Release emails nobody.`, fix: 'Run `node <kit>/bin/ayr.ts init <repo> --client <config> --force` from the kit, which writes .github/workflows/notify-release.yml.' });
  } else if (!/release:[\s\S]*published/.test(triggers(notify.text)) || !sendStep(notify.text)) {
    checks.push({ id: 'notify', ok: false, detail: `${notify.file} is named "${release.notifyWorkflow}" but is not the kit's: it must run on a published release, give the send the RESEND_API_KEY secret, and pass each picture to \`ayr send release\`.`, fix: 'Write it again with `ayr init --force` from the kit.' });
  } else {
    checks.push({ id: 'notify', ok: true, detail: `${notify.file} emails the client when a Release is published.` });
  }

  const ci = named(release.checksWorkflow);
  const onPush = ci ? runsOnPushToMain(ci.text) : false;
  checks.push(ci && onPush
    ? { id: 'checks', ok: true, detail: `${ci.file} runs "${release.checksWorkflow}" on every push to main.` }
    : {
      id: 'checks', ok: false,
      detail: ci ? `${ci.file} is named "${release.checksWorkflow}" but does not run on a push to main, where a draft lands.` : `No workflow is named "${release.checksWorkflow}", and \`ayr release run\` waits for it to pass on the draft.`,
      fix: 'Add a workflow with that `name:` that runs the site\'s build and tests `on: push: branches: [main]`, or set release.checksWorkflow to the one that does.',
    });

  // The newest entry goes under the `---` that ends the file's opening, before any entry, as insertEntry puts it.
  const opening = facts.notes === null ? '' : facts.notes.slice(0, facts.notes.search(/^## /m) < 0 ? facts.notes.length : facts.notes.search(/^## /m));
  checks.push(facts.notes !== null && /^-{3,}[ \t]*$/m.test(opening)
    ? { id: 'notes', ok: true, detail: 'PATCH_NOTES.md is ready for entries.' }
    : { id: 'notes', ok: false, detail: facts.notes === null ? 'There is no PATCH_NOTES.md, where each release writes its note.' : 'PATCH_NOTES.md has no `---` line under its opening, where the newest entry goes.', fix: '`ayr init` writes one.' });

  checks.push(facts.wrangler
    ? { id: 'wrangler', ok: true, detail: 'wrangler is installed next to the kit.' }
    : { id: 'wrangler', ok: false, detail: 'wrangler is not installed next to the kit, and `ayr release run` deploys with it.', fix: 'npm install --prefix ayr --no-save wrangler@4' });

  if (facts.resendSecret === null) {
    checks.push({ id: 'resend', ok: false, skipped: true, detail: `GitHub could not be asked whether ${facts.repo} has a RESEND_API_KEY secret.`, fix: 'Sign in with `gh auth login`, then run this again.' });
  } else {
    checks.push(facts.resendSecret
      ? { id: 'resend', ok: true, detail: `${facts.repo} has a RESEND_API_KEY secret for the email job.` }
      : { id: 'resend', ok: false, detail: `${facts.repo} has no RESEND_API_KEY secret, so the email job can't send.`, fix: `Make a Resend key that may send only from the domain in "from", and set it with \`gh secret set RESEND_API_KEY -R ${facts.repo}\`.` });
  }

  const project = release.deploy.project;
  if (facts.pages === null) {
    checks.push({ id: 'pages', ok: false, skipped: true, detail: `Cloudflare could not be asked about the Pages project ${project}: no token here.`, fix: `Run it with the deploy token: ${run}` });
  } else if (facts.pages === 'missing') {
    checks.push({ id: 'pages', ok: false, detail: `There is no Pages project ${project}.`, fix: `Make it as a Direct Upload project, with production branch main: npx wrangler pages project create ${project} --production-branch main` });
  } else if (facts.pages.gitConnected) {
    checks.push({ id: 'pages', ok: false, detail: `The Pages project ${project} deploys from git, so a draft would go live the moment it lands on main.`, fix: 'Production needs a Direct Upload project. Make one, move the custom domains to it, and keep the git-connected one as staging. docs/release.md, "Adding a client", has the steps.' });
  } else if (facts.pages.productionBranch !== 'main') {
    checks.push({ id: 'pages', ok: false, detail: `The Pages project ${project} has production branch ${facts.pages.productionBranch}, and \`ayr release run\` deploys to main.`, fix: 'Set its production branch to main.' });
  } else {
    checks.push({ id: 'pages', ok: true, detail: `${project} is a Direct Upload project with production branch main.` });
  }

  if (release.staging) {
    checks.push(facts.staging !== null && facts.staging < 400
      ? { id: 'staging', ok: true, detail: `${release.staging} answers.` }
      : { id: 'staging', ok: false, detail: `${release.staging} did not answer${facts.staging === null ? '' : ` (${facts.staging})`}, and the review page links each page there.`, fix: 'Point release.staging at the site that deploys main, or leave it out.' });
  }

  if (!release.secrets) {
    checks.push({ id: 'secrets', ok: false, detail: 'release.secrets is not set, so the review page\'s buttons have no deploy token unless the page is served with --run-with.', fix: 'Set release.secrets to the client\'s secrets file, such as "bogabee-site/cloudflare-pages".' });
  } else if (facts.secretsFile === null) {
    checks.push({ id: 'secrets', ok: false, skipped: true, detail: `\`secrets ls\` could not be run here, so ${release.secrets} could not be looked for.`, fix: 'Run this on the devbox that releases.' });
  } else {
    checks.push(facts.secretsFile
      ? { id: 'secrets', ok: true, detail: `The deploy token is in ${release.secrets}.` }
      : { id: 'secrets', ok: false, detail: `\`secrets ls\` lists no ${release.secrets}, so a press on the review page would start a release with no deploy token.`, fix: `Add it with \`secrets set\`, or correct release.secrets.` });
  }

  return checks;
}

export function doctorLine(checks: Check[]): string {
  const failed = checks.filter(check => !check.ok);
  return [
    ...checks.map(check => `${check.ok ? 'ok  ' : check.skipped ? 'skip' : 'FAIL'} ${check.id}: ${check.detail}${check.ok || !check.fix ? '' : ` Fix: ${check.fix}`}`),
    failed.length === 0 ? 'Set up to release.' : `${failed.length} ${failed.length === 1 ? 'thing' : 'things'} to fix before this repo can release.`,
  ].join('\n');
}
