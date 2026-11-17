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
  id: 'notify' | 'checks' | 'notes' | 'wrangler' | 'resend' | 'pages' | 'staging' | 'secrets';
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

export function diagnose(facts: Facts): Check[] {
  const { release } = facts;
  const checks: Check[] = [];
  const named = (name: string) => facts.workflows.find(workflow => nameOf(workflow.text) === name);
  const run = release.secrets ? `secrets run ${release.secrets} -- node ayr/bin/ayr.ts release doctor` : 'secrets run <client file> -- node ayr/bin/ayr.ts release doctor';

  const notify = named(release.notifyWorkflow);
  if (!notify) {
    checks.push({ id: 'notify', ok: false, detail: `No workflow is named "${release.notifyWorkflow}", so a published Release emails nobody.`, fix: 'Run `node <kit>/bin/ayr.ts init <repo> --client <config> --force` from the kit, which writes .github/workflows/notify-release.yml.' });
  } else if (!/release:[\s\S]*published/.test(triggers(notify.text)) || !/ayr\/bin\/ayr\.ts send release/.test(notify.text) || !/--picture/.test(notify.text)) {
    checks.push({ id: 'notify', ok: false, detail: `${notify.file} is named "${release.notifyWorkflow}" but is not the kit's: it must run on a published release and pass each picture to \`ayr send release\`.`, fix: 'Write it again with `ayr init --force` from the kit.' });
  } else {
    checks.push({ id: 'notify', ok: true, detail: `${notify.file} emails the client when a Release is published.` });
  }

  const ci = named(release.checksWorkflow);
  const onPush = ci ? /push:/.test(triggers(ci.text)) && /\bmain\b/.test(triggers(ci.text)) : false;
  checks.push(ci && onPush
    ? { id: 'checks', ok: true, detail: `${ci.file} runs "${release.checksWorkflow}" on every push to main.` }
    : {
      id: 'checks', ok: false,
      detail: ci ? `${ci.file} is named "${release.checksWorkflow}" but does not run on a push to main, where a draft lands.` : `No workflow is named "${release.checksWorkflow}", and \`ayr release run\` waits for it to pass on the draft.`,
      fix: 'Add a workflow with that `name:` that runs the site\'s build and tests `on: push: branches: [main]`, or set release.checksWorkflow to the one that does.',
    });

  checks.push(facts.notes !== null && /^-{3,}\s*$/m.test(facts.notes)
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

  checks.push(release.secrets
    ? { id: 'secrets', ok: true, detail: `The deploy token is in ${release.secrets}.` }
    : { id: 'secrets', ok: false, detail: 'release.secrets is not set, so the review page\'s buttons have no deploy token unless the page is served with --run-with.', fix: 'Set release.secrets to the client\'s secrets file, such as "bogabee-site/cloudflare-pages".' });

  return checks;
}

export function doctorLine(checks: Check[]): string {
  const failed = checks.filter(check => !check.ok);
  return [
    ...checks.map(check => `${check.ok ? 'ok  ' : check.skipped ? 'skip' : 'FAIL'} ${check.id}: ${check.detail}${check.ok || !check.fix ? '' : ` Fix: ${check.fix}`}`),
    failed.length === 0 ? 'Set up to release.' : `${failed.length} ${failed.length === 1 ? 'thing' : 'things'} to fix before this repo can release.`,
  ].join('\n');
}
