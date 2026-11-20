// The Git effect over the git CLI, in the owner's checkout of the client repo.
// Commits are built in a temporary index and deploys happen in their own
// worktree, so the working tree only changes where a method says so: restore,
// moveTo with `match`, and revert.

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, readlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { DATE_TRAILER, type Draft, type Git } from '../release.ts';
import type { IsoDate, ProdTag, Sha } from '../types.ts';
import { exec, shell, type Ran } from './process.ts';

const CHANGE_FILE = /^changes\/[^/]+\.md$/;
const REVERTS = /^This reverts commit ([0-9a-f]{40})\.?$/m; // the line `git revert` writes
const LITERAL = { GIT_LITERAL_PATHSPECS: '1' }; // a file name with * or [ is still one file

export interface GitOptions {
  cwd: string; // the root of the checkout
  scratch: string; // temporary indexes and worktrees go here
  remote?: string; // default "origin"
}

/** "owner/name" from a remote's URL or path: its last two segments, with any .git dropped. */
export function repoOfRemote(url: string): string | null {
  const match = /(?:^|[:/])([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url.trim());
  return match ? `${match[1]}/${match[2]}` : null;
}

export function createGit({ cwd, scratch, remote = 'origin' }: GitOptions): Git {
  async function git(args: string[], options: { cwd?: string; env?: Record<string, string>; input?: Uint8Array; ok?: number[] } = {}): Promise<Ran> {
    const ran = await exec('git', args, { cwd: options.cwd ?? cwd, ...(options.env ? { env: options.env } : {}), ...(options.input ? { input: options.input } : {}) });
    if (!(options.ok ?? [0]).includes(ran.code)) throw new Error(`git ${args.join(' ')} exited ${ran.code}: ${ran.stderr.trim()}`);
    return ran;
  }
  const text = async (args: string[], options: Parameters<typeof git>[1] = {}): Promise<string> => (await git(args, options)).stdout.toString('utf8').trim();
  const lines = async (args: string[], options: Parameters<typeof git>[1] = {}): Promise<string[]> => (await text(args, options)).split('\n').filter(Boolean);
  const exists = async (at: Sha, path: string): Promise<boolean> => (await git(['cat-file', '-e', `${at}:${path}`], { ok: [0, 1, 128] })).code === 0;
  const isAncestor = async (ancestor: Sha, of: Sha): Promise<boolean> => (await git(['merge-base', '--is-ancestor', ancestor, of], { ok: [0, 1] })).code === 0;
  const readFile = async (at: Sha, path: string): Promise<Uint8Array> => {
    const ran = await git(['cat-file', 'blob', `${at}:${path}`], { ok: [0, 128] });
    if (ran.code !== 0) throw new Error(`${path} is not in commit ${at.slice(0, 7)}.`);
    return new Uint8Array(ran.stdout);
  };
  /** The mode a path has at a commit, such as 100755, or null when the commit doesn't have it. */
  const modeAt = async (at: Sha, path: string): Promise<string | null> => (await text(['ls-tree', at, '--', path], { env: LITERAL })).split(' ')[0] || null;
  const main = async (): Promise<Sha> => {
    await git(['fetch', '--no-tags', remote, `+refs/heads/main:refs/remotes/${remote}/main`]);
    return (await text(['rev-parse', '--verify', `refs/remotes/${remote}/main^{commit}`])) as Sha;
  };
  const worktree = async (at: Sha): Promise<string> => {
    const dir = join(scratch, `worktree-${randomUUID()}`);
    await git(['worktree', 'add', '--detach', dir, at]);
    return dir;
  };
  const removeWorktree = async (dir: string): Promise<void> => {
    await git(['worktree', 'remove', '--force', dir], { ok: [0, 128] });
    await rm(dir, { recursive: true, force: true });
  };

  /** One `git log` over `range`, as drafts and as the commits each commit says it reverts. */
  const history = async (range: string[]): Promise<{ drafts: Omit<Draft, 'released'>[]; reverted: Set<string> }> => {
    const format = `%H%x1f%P%x1f%(trailers:key=${DATE_TRAILER},valueonly,separator=%x20)%x1f%b%x1e`;
    const log = (await git(['log', '--first-parent', `--format=${format}`, ...range])).stdout.toString('utf8');
    const drafts: Omit<Draft, 'released'>[] = [];
    const reverted = new Set<string>();
    for (const record of log.split('\x1e')) {
      const [commit = '', parents = '', date = '', body = ''] = record.replace(/^\n/, '').split('\x1f');
      const sha = REVERTS.exec(body)?.[1];
      if (sha) reverted.add(sha);
      const [base, ...more] = parents.split(' ').filter(Boolean);
      if (/^\d{4}-\d{2}-\d{2}$/.test(date.trim()) && base && more.length === 0) {
        drafts.push({ commit: commit as Sha, base: base as Sha, date: date.trim() as IsoDate });
      }
    }
    return { drafts, reverted };
  };
  const tagged = async (tag: ProdTag): Promise<Sha | null> => {
    const ref = `refs/tags/${tag}`;
    const listed = await lines(['ls-remote', '--tags', remote, ref, `${ref}^{}`]);
    return ((listed.find(line => line.endsWith('^{}')) ?? listed[0])?.split('\t')[0] ?? null) as Sha | null;
  };
  const released = async (commit: Sha): Promise<boolean> => (await lines(['tag', '--points-at', commit, '--list', 'prod-*'])).length > 0;
  const withReleased = (drafts: Omit<Draft, 'released'>[]): Promise<Draft[]> => Promise.all(drafts.map(async draft => ({ ...draft, released: await released(draft.commit) })));

  return {
    async lastRelease(except) {
      // Prod tags never move (see tag()), so a plain fetch adds new ones and never rewrites one.
      await git(['fetch', '--no-tags', remote, 'refs/tags/prod-*:refs/tags/prod-*']);
      const refs = await lines(['for-each-ref', '--sort=-creatordate', '--format=%(refname:strip=2) %(objectname) %(*objectname)', 'refs/tags/prod-*']);
      for (const line of refs) {
        const [tag = '', object = '', peeled = ''] = line.split(' ');
        if (tag !== except) return { tag: tag as ProdTag, commit: (peeled || object) as Sha };
      }
      return null;
    },

    main,
    isAncestor,

    async head() {
      const branch = (await git(['symbolic-ref', '--quiet', '--short', 'HEAD'], { ok: [0, 1] })).stdout.toString('utf8').trim();
      return { branch: branch || null, commit: (await text(['rev-parse', '--verify', 'HEAD^{commit}'])) as Sha };
    },

    async subjects(from, to) {
      return lines(['log', '--reverse', '--format=%s', from ? `${from}..${to}` : to]);
    },

    async changeFiles(at) {
      const present = (await lines(['ls-tree', '--name-only', at, 'changes/'])).filter(file => CHANGE_FILE.test(file));
      // The order each file landed on main: first-parent history, a merge counted as what it brought in.
      // A revert puts files back where they were, so `ayr release undo` keeps the order they first landed in.
      const log = await text(['log', '--reverse', '--first-parent', '--diff-merges=first-parent', '--diff-filter=A', '--name-only', '--format=%x1e%b%x1f', at, '--', 'changes/']);
      const order = new Map<string, number>();
      let index = 0;
      for (const record of log.split('\x1e')) {
        const [body = '', names = ''] = record.split('\x1f');
        const revert = REVERTS.test(body);
        for (const file of names.split('\n').filter(Boolean)) {
          if (revert && order.has(file)) continue;
          order.delete(file);
          order.set(file, index++);
        }
      }
      const rank = (file: string): number => order.get(file) ?? Number.MAX_SAFE_INTEGER;
      const sorted = present.toSorted((a, b) => rank(a) - rank(b) || (a < b ? -1 : 1));
      return Promise.all(sorted.map(async file => ({ file, source: new TextDecoder().decode(await readFile(at, file)) })));
    },

    async headings(at) {
      if (!(await exists(at, 'PATCH_NOTES.md'))) return [];
      const notes = new TextDecoder().decode(await readFile(at, 'PATCH_NOTES.md'));
      return notes.split(/\r?\n/).filter(line => line.startsWith('## ')).map(line => line.slice(3).trim());
    },

    async changedFiles(from, to) {
      return from ? lines(['diff', '--name-only', '--no-renames', from, to]) : lines(['ls-tree', '-r', '--name-only', to]);
    },

    readFile,

    tree(at) {
      return (path: string) => new Uint8Array(execFileSync('git', ['cat-file', 'blob', `${at}:${path}`], { cwd, maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }));
    },

    async dirty() {
      const status = (await git(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames'])).stdout.toString('utf8');
      return status.split('\0').filter(Boolean).map(entry => entry.slice(3));
    },

    async restore(paths) {
      for (const path of paths) {
        if (await exists('HEAD' as Sha, path)) await git(['checkout', '--quiet', 'HEAD', '--', path], { env: LITERAL });
        else await rm(join(cwd, path), { force: true });
      }
    },

    checkout: worktree,
    drop: removeWorktree,

    async commit(parent, message, writes, deletes) {
      const index = join(scratch, `index-${randomUUID()}`);
      const env = { GIT_INDEX_FILE: index };
      try {
        await git(['read-tree', parent], { env });
        for (const [path, bytes] of writes) {
          // The mode comes from the working tree, so a script generate rewrote stays executable and
          // the checkout is clean once main moves here. A link is stored as a link, whatever bytes it reads as.
          const found = await lstat(join(cwd, path)).catch(() => null);
          const link = found?.isSymbolicLink() ? new TextEncoder().encode(await readlink(join(cwd, path))) : null;
          const mode = link ? '120000' : found ? (found.mode & 0o111 ? '100755' : '100644') : (await modeAt(parent, path)) ?? '100644';
          const blob = await text(['hash-object', '-w', '--stdin'], { input: link ?? bytes });
          await git(['update-index', '--add', '--cacheinfo', `${mode},${blob},${path}`], { env });
        }
        for (const path of deletes) await git(['update-index', '--force-remove', '--', path], { env });
        const tree = await text(['write-tree'], { env });
        return (await text(['commit-tree', tree, '-p', parent, '-F', '-'], { input: new TextEncoder().encode(message) })) as Sha;
      } finally {
        await rm(index, { force: true });
      }
    },

    async pushMain(sha) {
      await git(['push', remote, `${sha}:refs/heads/main`]);
    },

    async moveTo(sha, files) {
      await git(['reset', '--quiet', files === 'match' ? '--hard' : '--mixed', sha]);
    },

    async draft(at) {
      const [found] = await withReleased((await history(['-1', at])).drafts);
      return found ?? null;
    },

    async drafts(from, to) {
      const { drafts, reverted } = await history([from ? `${from}..${to}` : to]);
      return withReleased(drafts.filter(draft => !reverted.has(draft.commit)));
    },

    async revert(commit) {
      const ran = await git(['revert', '--no-edit', commit], { ok: [0, 1] });
      if (ran.code === 0) return (await text(['rev-parse', '--verify', 'HEAD^{commit}'])) as Sha;
      const conflict = await lines(['diff', '--name-only', '--diff-filter=U']);
      await git(['revert', '--abort'], { ok: [0, 1, 128] });
      if (conflict.length === 0) throw new Error(`git revert ${commit.slice(0, 7)} exited ${ran.code}: ${(ran.stderr || ran.stdout.toString('utf8')).trim()}`);
      return { conflict };
    },

    async resolve(prefix) {
      const ran = await git(['rev-parse', '--verify', `${prefix}^{commit}`], { ok: [0, 128] });
      if (ran.code === 0) return ran.stdout.toString('utf8').trim() as Sha;
      throw new Error(/ambiguous/.test(ran.stderr) ? `${prefix} matches more than one commit. Pass more of the commit id.` : `${prefix} is not a commit in this checkout.`);
    },

    tagged,

    async tag(tag, sha, message) {
      const ref = `refs/tags/${tag}`;
      const remoteAt = await tagged(tag);
      const refuse = (at: string) => new Error(`Refusing to reuse tag ${tag}: it points at ${at.slice(0, 7)}, not ${sha.slice(0, 7)}.`);
      if (remoteAt) {
        if (remoteAt !== sha) throw refuse(remoteAt);
        return;
      }
      const localAt = (await git(['rev-parse', '-q', '--verify', `${ref}^{commit}`], { ok: [0, 1] })).stdout.toString().trim();
      if (localAt && localAt !== sha) throw refuse(localAt);
      if (!localAt) await git(['tag', '-a', tag, sha, '-F', '-'], { input: new TextEncoder().encode(message) });
      await git(['push', remote, ref]);
    },

    run(command) {
      return shell(command, cwd);
    },

    runIn(dir, command) {
      return shell(command, dir);
    },
  };
}
