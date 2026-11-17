// `ayr release status|draft|run|undo`, on the owner's devbox, from a checkout of
// the client repo. Each is a few lines over runStatus, runDraft, runRelease or
// runUndo, with Deps wired from the checkout and the environment.

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createGit, repoOfRemote } from '../src/adapters/git.ts';
import { createChecks, createGitHub, createNotify } from '../src/adapters/github.ts';
import { createPages } from '../src/adapters/pages.ts';
import { exec as realExec, type Exec } from '../src/adapters/process.ts';
import { createReviewDir } from '../src/adapters/review-dir.ts';
import { createWorkTree } from '../src/adapters/work.ts';
import { createButton, PRESS_FILE } from '../src/button.ts';
import { diagnose, doctorLine, type Facts } from '../src/doctor.ts';
import { parseConfig } from '../src/config.ts';
import { makeMedia } from '../src/media.ts';
import {
  DERIVE, runDraft, runRelease, runStatus, runUndo,
  type Deps, type DraftDeps, type DraftOutcome, type ReleaseClient, type RunOutcome, type Standing, type UndoOutcome,
} from '../src/release.ts';
import { REVIEW_FILE, STATUS_FILE, type Status } from '../src/review.ts';
import { startServer } from '../src/serve.ts';
import { runProbes } from '../src/verify.ts';

const KIT = resolve(import.meta.dirname, '..');
const CLOUDFLARE = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'];
const USAGE = [
  'Usage: ayr release status [--review-dir dir]',
  '       ayr release draft [--review-dir dir]',
  '       ayr release run --commit <sha> [--rehearsal] [--review-dir dir]',
  '       ayr release undo [--review-dir dir]',
  '       ayr release serve --review-dir dir --port n [--origin url --allow-login login]... [--run-with "command prefix"]',
  '       ayr release wait --review-dir dir [--timeout seconds]',
  '       ayr release doctor',
].join('\n');

type Env = Record<string, string | undefined>;

export interface WiringOptions {
  config?: string; // default <kit>/client.json
  cwd?: string;
  reviewDir?: string; // --review-dir
  home?: string;
  fetch?: typeof fetch;
  exec?: Exec;
  wrangler?: string;
}

const sleep = (ms: number): Promise<void> => new Promise(done => setTimeout(done, ms));
// stdout carries the outcome alone, so progress goes to stderr.
const log = (event: string, fields: Record<string, unknown>): void => console.error(`${event} ${JSON.stringify(fields)}`);

function loadReleaseClient(path: string): ReleaseClient {
  const config = parseConfig(readFileSync(path, 'utf8').replace(/^﻿/, ''), path);
  if (!config.release) throw new Error(`${path} has no release block, so this repo has no \`ayr release\`.`);
  return { ...config, release: config.release };
}

/**
 * What `draft` and `undo` need: the checkout, its config and the review
 * directory. No Cloudflare or GitHub token. Refuses a checkout whose origin is
 * not the repo the config names.
 */
export async function localDeps(env: Env, options: WiringOptions = {}): Promise<DraftDeps & { scratch: string }> {
  const exec = options.exec ?? realExec;
  const config = loadReleaseClient(options.config ?? join(KIT, 'client.json'));
  const here = options.cwd ?? process.cwd();
  const top = await exec('git', ['rev-parse', '--show-toplevel'], { cwd: here });
  if (top.code !== 0) throw new Error(`${here} is not inside a git checkout. Run this from the client repo.`);
  const cwd = top.stdout.toString('utf8').trim();
  const remote = await exec('git', ['remote', 'get-url', 'origin'], { cwd });
  const origin = remote.code === 0 ? repoOfRemote(remote.stdout.toString('utf8')) : null;
  if (origin?.toLowerCase() !== config.repo?.toLowerCase()) {
    throw new Error(`This checkout's origin is ${origin ?? 'not set'}, but the client config is for ${config.repo}.`);
  }
  const scratch = mkdtempSync(join(tmpdir(), 'ayr-'));
  const { release } = config;
  return {
    config,
    git: createGit({ cwd, scratch }),
    work: createWorkTree(cwd),
    review: createReviewDir(resolve(here, options.reviewDir ?? env.AYR_REVIEW_DIR ?? join(options.home ?? homedir(), '.cache', 'ayr-release', config.slug))),
    derive: DERIVE,
    makeMedia: (changes, sites, date) => makeMedia(changes, sites, date),
    serve: () => startServer(release.serve.command, release.serve.url),
    now: () => new Date(),
    log,
    scratch,
  };
}

/** GH_TOKEN, else GITHUB_TOKEN, else what `gh auth token` prints. */
async function githubToken(env: Env, exec: Exec): Promise<string> {
  const set = env.GH_TOKEN || env.GITHUB_TOKEN;
  if (set) return set;
  const ran = await exec('gh', ['auth', 'token']).catch(() => null);
  const token = ran?.code === 0 ? ran.stdout.toString('utf8').trim() : '';
  if (!token) throw new Error('No GitHub token. Set GH_TOKEN, or sign in with `gh auth login`.');
  return token;
}

/**
 * Everything `run` needs. The Cloudflare variables, wrangler and the GitHub
 * token are all checked first, so a missing one stops the command before it
 * touches anything.
 */
export async function runDeps(env: Env, options: WiringOptions = {}): Promise<Deps & { scratch: string }> {
  const exec = options.exec ?? realExec;
  const fetcher = options.fetch ?? fetch;
  const missing = CLOUDFLARE.filter(name => !env[name]);
  if (missing.length > 0) throw new Error(`Missing ${missing.join(', ')}. \`ayr release run\` deploys to Cloudflare Pages, so set ${missing.length === 1 ? 'it' : 'them'} in the environment.`);
  const wrangler = options.wrangler ?? join(KIT, 'node_modules', '.bin', 'wrangler');
  if (!existsSync(wrangler)) throw new Error(`No wrangler at ${wrangler}. Install it with:\n  npm install --prefix ${KIT} --no-save wrangler@4`);
  const token = await githubToken(env, exec);
  const local = await localDeps(env, options);
  const { config, scratch } = local;
  const repo = config.repo ?? '';
  return {
    ...local,
    pages: createPages({ accountId: env.CLOUDFLARE_ACCOUNT_ID ?? '', token: env.CLOUDFLARE_API_TOKEN ?? '', fetch: fetcher, exec, wrangler, scratch }),
    github: createGitHub({ repo, token, fetch: fetcher }),
    notify: createNotify({ repo, token, workflow: config.release.notifyWorkflow, fetch: fetcher }),
    checks: createChecks({ repo, token, workflow: config.release.checksWorkflow, fetch: fetcher }),
    runProbes: (probes, deadline) => runProbes(probes, fetcher, deadline),
    sleep,
  };
}

export function draftLine(outcome: DraftOutcome): string {
  if (outcome.kind === 'nothing') return 'Nothing to release: main has no change files.';
  const what = outcome.heading === null ? 'a quiet release that sends nothing' : `"${outcome.heading}", going to ${outcome.to.join(', ')}`;
  const verb = outcome.kind === 'drafted' ? `Drafted ${what} as ${outcome.commit.slice(0, 7)}` : `Rebuilt the review of ${outcome.commit.slice(0, 7)}, ${what}`;
  return `${verb}. The review page is ${join(outcome.reviewDir, 'index.html')}.`;
}

export function runLine(outcome: RunOutcome): string {
  switch (outcome.kind) {
    case 'done': {
      const email = outcome.recordingLost
        ? 'The client email went out without the recording, which was lost with the review directory.'
        : outcome.sent ? 'The client email went out.' : 'A quiet release, so no email went out.';
      return `Released ${outcome.tag}. ${email}`;
    }
    case 'rehearsed': return `The rehearsal passed at ${outcome.url}. Nothing was tagged, released or emailed.`;
    case 'failed': return `Stopped at ${outcome.at}${outcome.rolledBack ? ', rolled back' : ''}. ${outcome.reason}`;
  }
}

export function undoLine(outcome: UndoOutcome): string {
  if (outcome.kind === 'nothing') return 'Nothing to undo: main has no unreleased draft.';
  return `Took back the draft ${outcome.draft.slice(0, 7)} with ${outcome.commit.slice(0, 7)}. Back in the repo: ${outcome.restored.join(', ') || 'no change files'}.`;
}

export function statusLine({ draft, changeFiles }: Standing): string {
  const waiting = `${changeFiles.length} change ${changeFiles.length === 1 ? 'file' : 'files'}`;
  if (!draft) return changeFiles.length === 0 ? 'Nothing is waiting: main has no draft and no change files.' : `No draft yet. Main has ${waiting} to draft from.`;
  const what = `${draft.commit.slice(0, 7)}, ${draft.heading === null ? 'a quiet release' : `"${draft.heading}"`},`;
  const review = draft.reviewOnThisMachine ? 'Its review is on this machine.' : 'Its review is not on this machine, and `ayr release draft` rebuilds it.';
  if (draft.released) {
    const left = draft.heading === null ? 'It sends no email, so nothing is left to do.' : `\`ayr release run --commit ${draft.commit}\` finishes its client email if that has not gone.`;
    return `${what} is released as ${draft.tag}. ${left}`;
  }
  if (!draft.atTip) return `The draft ${what} was never released, and main has moved past it. \`ayr release undo\` takes it back.`;
  return `The draft ${what} is on main and not released. ${review}`;
}

export interface ServeOptions {
  dir: string;
  port: number;
  origins: string[]; // where the owner opens the page from, besides this machine's own loopback
  /** Tailnet logins that may press. Needed whenever `origins` names anywhere but this machine. */
  logins: string[];
  /** A command to run `ayr release run` under, such as `secrets run client/cloudflare-pages --`, so the deploy token is loaded for the release and not held while the page waits. Split on spaces; no shell reads it. */
  runWith: string;
  cwd?: string;
  spawn?: typeof spawn;
  log?: typeof log;
}

/** The last line of some output that says anything. */
const lastLine = (text: string): string => text.trim().split('\n').map(line => line.trim()).filter(Boolean).pop() ?? '';

/**
 * `ayr release serve`: the review page with its Release and Rehearse buttons. Resolves once it
 * listens, with a way to stop it. A press runs `ayr release run` for the page's draft from `cwd`,
 * the client checkout, exactly as the thread would.
 */
export function serveReview(options: ServeOptions): Promise<{ port: number; origins: string[]; stop(): Promise<void> }> {
  const { dir } = options;
  const say = options.log ?? log;
  if (!existsSync(join(dir, REVIEW_FILE))) throw new Error(`No review in ${dir}. Run \`ayr release draft --review-dir ${dir}\` first.`);
  // Off this machine, anyone on the tailnet can reach the page, so the buttons need to know whose they are.
  if (options.origins.length > 0 && options.logins.length === 0) throw new Error('Missing --allow-login. With --origin the page is open to the tailnet, so name the tailnet login that may press its buttons.');
  let going: Promise<unknown> | null = null;
  const prefix = options.runWith.split(/\s+/).filter(Boolean);
  const start = ({ commit, review, rehearsal }: { commit: string; review: string; rehearsal: boolean }): Promise<{ ok: boolean; message: string }> => new Promise(resolve => {
    // --review: the review the owner pressed on. Rebuilt between the press and the release reading it, it is refused.
    const argv = [...prefix, process.execPath, join(KIT, 'bin', 'ayr.ts'), 'release', 'run', '--commit', commit, '--review', review, '--review-dir', dir, ...(rehearsal ? ['--rehearsal'] : [])];
    // Its own process group, so a Ctrl+C meant for the page's server can't cut a deploy short. stop() waits for it instead.
    const child = (options.spawn ?? spawn)(argv[0] ?? '', argv.slice(1), { cwd: options.cwd ?? process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let out = '';
    let err = '';
    child.stdout?.on('data', (chunk: Buffer) => { out = (out + chunk.toString()).slice(-8000); process.stdout.write(chunk); });
    child.stderr?.on('data', (chunk: Buffer) => { err = (err + chunk.toString()).slice(-8000); process.stderr.write(chunk); });
    child.on('error', error => resolve({ ok: false, message: `The release could not start: ${error.message}` }));
    child.on('close', code => resolve({ ok: code === 0, message: lastLine(out) || lastLine(err) || `\`ayr release run\` ended with status ${code}.` }));
  });
  const run = (input: { commit: string; review: string; rehearsal: boolean }): Promise<{ ok: boolean; message: string }> => {
    const ending = start(input);
    going = ending;
    return ending;
  };
  // A run that stops before it writes status.json leaves no other trace for `ayr release wait`.
  const ended = (press: { commit: string; rehearsal: boolean; ok: boolean; message: string }): void => {
    const temporary = join(dir, `.${PRESS_FILE}.${process.pid}.tmp`);
    writeFileSync(temporary, `${JSON.stringify({ version: 1, ...press, endedAt: new Date().toISOString() })}\n`);
    renameSync(temporary, join(dir, PRESS_FILE));
  };
  // Port 0 asks for any free port, so the names this server answers to are known only once it listens.
  let handler: ReturnType<typeof createButton> | null = null;
  const server = createServer((request, response) => {
    if (handler) handler(request, response);
    else response.destroy();
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    // Loopback only. The devbox decides who else can reach it.
    server.listen(options.port, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      const origins = [...options.origins, `http://127.0.0.1:${port}`, `http://localhost:${port}`];
      handler = createButton({ dir, origins, logins: options.logins, token: randomBytes(32).toString('base64url'), run, ended, log: say });
      resolve({
        port,
        origins,
        // A release that a press started is let finish, with the page still showing it, before the server goes.
        stop: async () => {
          while (going) {
            const current = going;
            await current;
            if (going === current) going = null;
          }
          await new Promise<void>(done => { server.closeAllConnections(); server.close(() => done()); });
        },
      });
    });
  });
}

const ENDED: Status['state'][] = ['done', 'rehearsed', 'failed', 'withdrawn'];

export function waitLine(status: Status | null): string {
  switch (status?.state) {
    case 'done': return `Released ${status.tag}.`;
    case 'rehearsed': return 'The rehearsal passed. Nothing was tagged, released or emailed.';
    case 'failed': return status.failure ? `Stopped at ${status.failure.at}${status.failure.rolledBack ? ', rolled back' : ''}. ${status.failure.reason}` : 'The release stopped.';
    case 'withdrawn': return 'The draft was taken back.';
    default: return 'Nothing has run. The draft is still waiting.';
  }
}

/** What `ayr release serve` leaves in the review directory when a run it started ends. */
interface Press {
  commit: string;
  rehearsal: boolean;
  ok: boolean;
  message: string;
  endedAt: string;
}

export interface Waited {
  /** 0 released or rehearsed, 1 stopped, taken back or replaced, 2 nothing ended in time. */
  code: 0 | 1 | 2;
  status: Status | null;
  /** One sentence for the thread. */
  line: string;
}

/**
 * `ayr release wait`: returns when a release of the draft in `dir` ends, however it was started,
 * so a thread that gave the owner the page hears what their press came to. It is the wait for one
 * draft: the one whose review is in `dir` when it begins. If the directory comes to hold another,
 * it says so instead of taking that one's release for this one's.
 */
export async function waitForRelease(dir: string, { timeoutMs, pollMs = 2000, pause = sleep, now = () => Date.now() }: { timeoutMs: number; pollMs?: number; pause?: typeof sleep; now?: () => number }): Promise<Waited> {
  const read = <T>(name: string): T | null => {
    try {
      return JSON.parse(readFileSync(join(dir, name), 'utf8')) as T;
    } catch {
      return null; // missing or half-written: the next read gets it
    }
  };
  const draft = read<{ commit?: string; tag?: string }>(REVIEW_FILE);
  if (typeof draft?.commit !== 'string' || typeof draft.tag !== 'string') throw new Error(`No review in ${dir}. Run \`ayr release draft --review-dir ${dir}\` first.`);
  const first = read<Status>(STATUS_FILE);
  const pressed = read<Press>(PRESS_FILE)?.endedAt;
  const deadline = now() + timeoutMs;
  for (;;) {
    const review = read<{ commit?: string }>(REVIEW_FILE);
    if (review && review.commit !== draft.commit) return { code: 1, status: null, line: `The review directory now holds another draft, ${String(review.commit).slice(0, 7)}, not the ${draft.commit.slice(0, 7)} this was waiting on.` };
    const status = read<Status>(STATUS_FILE);
    // What had already ended when the wait began is not news, and neither is another draft's status.
    if (status && status.tag === draft.tag && ENDED.includes(status.state) && status.updatedAt !== first?.updatedAt) {
      return { code: status.state === 'done' || status.state === 'rehearsed' ? 0 : 1, status, line: waitLine(status) };
    }
    // A press whose run stopped before it wrote any progress: the page's server noted how it ended.
    const press = read<Press>(PRESS_FILE);
    if (press && press.commit === draft.commit && press.endedAt !== pressed && !press.ok) {
      return { code: 1, status, line: `The ${press.rehearsal ? 'rehearsal' : 'release'} the owner pressed did not start. ${press.message}` };
    }
    if (now() >= deadline) {
      const going = status?.tag === draft.tag && status.state === 'releasing';
      return { code: 2, status, line: going ? 'A release of this draft is still running.' : waitLine(null) };
    }
    await pause(pollMs);
  }
}

/**
 * What `ayr release doctor` looks at, read from the checkout, GitHub and Cloudflare. A source that can't
 * be asked (no GitHub login, no Cloudflare token) is null, and the doctor says so rather than guess.
 */
export async function gatherFacts(env: Env, options: WiringOptions = {}): Promise<Facts> {
  const exec = options.exec ?? realExec;
  const fetcher = options.fetch ?? fetch;
  const config = loadReleaseClient(options.config ?? join(KIT, 'client.json'));
  const here = options.cwd ?? process.cwd();
  const top = await exec('git', ['rev-parse', '--show-toplevel'], { cwd: here });
  if (top.code !== 0) throw new Error(`${here} is not inside a git checkout. Run this from the client repo.`);
  const root = top.stdout.toString('utf8').trim();
  const repo = config.repo ?? '';
  const remote = await exec('git', ['remote', 'get-url', 'origin'], { cwd: root });
  const origin = remote.code === 0 ? repoOfRemote(remote.stdout.toString('utf8')) : null;
  let secretsFile: boolean | null = null;
  if (config.release.secrets) {
    const listed = await exec('secrets', ['ls'], { cwd: root }).catch(() => null);
    const name = config.release.secrets;
    if (listed?.code === 0) secretsFile = listed.stdout.toString('utf8').split('\n').some(line => [`projects/${name}.env`, `providers/${name}.env`, `${name}.env`].includes(line.trim().split(/\s+/)[0] ?? ''));
  }
  const folder = join(root, '.github', 'workflows');
  const workflows = existsSync(folder)
    ? readdirSync(folder).filter(file => /\.ya?ml$/.test(file)).sort().map(file => ({ file: join('.github', 'workflows', file), text: readFileSync(join(folder, file), 'utf8') }))
    : [];
  const notes = existsSync(join(root, 'PATCH_NOTES.md')) ? readFileSync(join(root, 'PATCH_NOTES.md'), 'utf8') : null;
  const wrangler = existsSync(options.wrangler ?? join(KIT, 'node_modules', '.bin', 'wrangler'));

  let resendSecret: boolean | null = null;
  try {
    const token = await githubToken(env, exec);
    const answer = await fetcher(`https://api.github.com/repos/${repo}/actions/secrets/RESEND_API_KEY`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'ayr-client-kit' },
    });
    resendSecret = answer.status === 200 ? true : answer.status === 404 ? false : null;
  } catch {
    resendSecret = null;
  }

  let pages: Facts['pages'] = null;
  if (env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_ACCOUNT_ID) {
    try {
      const answer = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/pages/projects/${config.release.deploy.project}`, {
        headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
      });
      const body = (await answer.json().catch(() => ({}))) as { success?: boolean; result?: { source?: unknown; production_branch?: string } };
      if (answer.status === 404) pages = 'missing';
      else if (answer.ok && body.success && body.result) pages = { gitConnected: Boolean(body.result.source), productionBranch: body.result.production_branch ?? '' };
    } catch {
      pages = null;
    }
  }

  let staging: number | null = null;
  if (config.release.staging) {
    staging = await fetcher(config.release.staging, { method: 'GET', redirect: 'follow' }).then(answer => answer.status, () => null);
  }
  return { release: config.release, repo, origin, secretsFile, workflows, notes, wrangler, resendSecret, pages, staging };
}

export interface ReleaseFlags {
  rehearsal?: boolean;
  reviewDir?: string;
  commit?: string;
  port?: string;
  review?: string;
  origin?: string[];
  allowLogin?: string[];
  runWith?: string;
  timeout?: string;
}

/**
 * Prints the outcome as one JSON line, then one sentence. Exit status 1 when
 * the release stopped. Any other failure throws, and the caller prints it.
 */
export async function releaseCommand(what: string | undefined, flags: ReleaseFlags, env: Env = process.env): Promise<number> {
  if (what !== 'status' && what !== 'draft' && what !== 'run' && what !== 'undo' && what !== 'serve' && what !== 'wait' && what !== 'doctor') throw new Error(USAGE);
  if (what === 'doctor') {
    const checks = diagnose(await gatherFacts(env));
    console.log(`${JSON.stringify({ kind: 'doctor', ok: checks.every(check => check.ok), checks })}\n${doctorLine(checks)}`);
    return checks.every(check => check.ok) ? 0 : 1;
  }
  if (flags.rehearsal && what !== 'run') throw new Error(`--rehearsal goes with run.\n${USAGE}`);
  if (flags.commit !== undefined && what !== 'run') throw new Error(`--commit goes with run.\n${USAGE}`);
  if (flags.review !== undefined && what !== 'run') throw new Error(`--review goes with run.\n${USAGE}`);
  if (what === 'serve' || what === 'wait') {
    if (!flags.reviewDir) throw new Error(`Missing --review-dir.\n${USAGE}`);
    const dir = resolve(flags.reviewDir);
    if (what === 'wait') {
      const seconds = Number(flags.timeout ?? 6900); // under the two hours a background task may run
      if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`--timeout is a number of seconds.\n${USAGE}`);
      const { status, code, line } = await waitForRelease(dir, { timeoutMs: seconds * 1000 });
      const kind = code === 2 ? 'waiting' : code === 0 ? (status?.state ?? 'done') : status?.state === 'failed' ? 'failed' : 'stopped';
      console.log(`${JSON.stringify({ kind, ...(status?.failure && kind === 'failed' ? { failure: status.failure } : {}), ...(status?.links && code === 0 ? { links: status.links } : {}) })}\n${line}`);
      return code;
    }
    const port = Number(flags.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`--port is the local port to listen on.\n${USAGE}`);
    // Without --run-with, a press loads the deploy token from the client's own secrets file, when the config names one.
    let runWith = flags.runWith;
    if (runWith === undefined) {
      try {
        const secrets = loadReleaseClient(join(KIT, 'client.json')).release.secrets;
        runWith = secrets ? `secrets run ${secrets} --` : '';
      } catch {
        runWith = '';
      }
    }
    const serving = await serveReview({ dir, port, origins: flags.origin ?? [], logins: (flags.allowLogin ?? []).filter(Boolean), runWith });
    console.log(`${JSON.stringify({ kind: 'serving', dir, port: serving.port, origins: serving.origins })}\nServing the review page on 127.0.0.1:${serving.port}, with its buttons.`);
    // Until stopped.
    await new Promise<void>(done => { process.once('SIGTERM', done); process.once('SIGINT', done); });
    await serving.stop();
    return 0;
  }
  const options: WiringOptions = flags.reviewDir ? { reviewDir: flags.reviewDir } : {};
  const print = (outcome: object, line: string): void => console.log(`${JSON.stringify(outcome)}\n${line}`);
  if (what === 'run') {
    // The owner said to send one draft. Naming its commit keeps a review of another draft from going out on that word.
    const { commit } = flags;
    if (!commit) throw new Error(`Missing --commit. Pass the commit \`ayr release draft\` printed, the one the owner said to send.\n${USAGE}`);
    const deps = await runDeps(env, options);
    try {
      const outcome = await runRelease(deps, { rehearsal: flags.rehearsal ?? false, commit, ...(flags.review === undefined ? {} : { review: flags.review }) });
      print(outcome, runLine(outcome));
      return outcome.kind === 'failed' ? 1 : 0;
    } finally {
      rmSync(deps.scratch, { recursive: true, force: true });
    }
  }
  const deps = await localDeps(env, options);
  try {
    if (what === 'draft') {
      const outcome = await runDraft(deps);
      print(outcome, draftLine(outcome));
    } else if (what === 'undo') {
      const outcome = await runUndo(deps);
      print(outcome, undoLine(outcome));
    } else {
      const standing = await runStatus(deps);
      print(standing, statusLine(standing));
    }
    return 0;
  } finally {
    rmSync(deps.scratch, { recursive: true, force: true });
  }
}
