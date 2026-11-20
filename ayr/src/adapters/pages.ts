// Cloudflare Pages: deploy with wrangler (Direct Upload), and read or roll
// back production through the API. Pages Functions deploy with the site
// because wrangler runs from the root of the release commit's own tree.

import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Pages } from '../release.ts';
import { tail, type Exec } from './process.ts';

const API = 'https://api.cloudflare.com/client/v4';

export interface PagesOptions {
  accountId: string;
  token: string;
  fetch: typeof fetch;
  exec: Exec;
  wrangler: string; // path to the wrangler binary installed next to the kit
  scratch: string;
}

interface Deployment {
  id: string;
  url: string;
  created_on?: string;
  deployment_trigger?: { metadata?: { commit_hash?: string } };
  latest_stage?: { name?: string; status?: string };
}

const PER_PAGE = 25;
const MAX_PAGES = 20; // 500 deployments back

export function createPages({ accountId, token, fetch, exec, wrangler, scratch }: PagesOptions): Pages {
  async function api<T>(path: string, method: 'GET' | 'POST' = 'GET'): Promise<T> {
    const response = await fetch(`${API}/accounts/${accountId}/pages/projects/${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    const text = await response.text();
    let body: { success?: boolean; result?: T; errors?: { message?: string }[] } = {};
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      // the error below quotes the text
    }
    if (!response.ok || body.success !== true) {
      const errors = body.errors?.map(error => error.message).filter(Boolean).join('; ');
      throw new Error(`Cloudflare ${method} ${path} answered ${response.status}: ${errors || text.slice(0, 300)}`);
    }
    return body.result as T;
  }

  const commitOf = (deployment: Deployment): string | undefined => deployment.deployment_trigger?.metadata?.commit_hash;

  return {
    async productionDeployment(project, notCommit, lastRelease) {
      const current = (await api<{ canonical_deployment?: Deployment | null }>(project)).canonical_deployment;
      if (current && commitOf(current) !== notCommit) return current.id;
      // A resumed run: production already serves this commit. The one to return to is the last release's,
      // not merely the newest other one, which may be a draft that failed its checks and was rolled back.
      // Rejected drafts and retries can push the last release off the first page, so the search goes on
      // until it is found or the list ends. Cloudflare lists the newest first.
      const good: Deployment[] = [];
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const list = await api<Deployment[]>(`${project}/deployments?env=production&per_page=${PER_PAGE}&page=${page}`);
        good.push(...list.filter(deployment => deployment.latest_stage?.status === 'success' && commitOf(deployment) !== notCommit));
        if (!lastRelease || list.length < PER_PAGE || list.some(deployment => commitOf(deployment) === lastRelease)) break;
      }
      good.sort((a, b) => (b.created_on ?? '').localeCompare(a.created_on ?? ''));
      const released = lastRelease ? good.find(deployment => commitOf(deployment) === lastRelease) : undefined;
      return (released ?? good[0])?.id ?? null;
    },

    async productionCommit(project) {
      const current = (await api<{ canonical_deployment?: Deployment | null }>(project)).canonical_deployment;
      return (current && commitOf(current)) || null;
    },

    async deploy({ project, root, dir, branch, commit }) {
      const output = join(scratch, `wrangler-${randomUUID()}.json`);
      try {
        const ran = await exec(wrangler, ['pages', 'deploy', dir, '--project-name', project, '--branch', branch, '--commit-hash', commit, '--commit-dirty=true'], {
          cwd: root,
          env: { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: accountId, WRANGLER_OUTPUT_FILE_PATH: output, CI: 'true' },
        });
        const log = [ran.stdout.toString(), ran.stderr].filter(Boolean).join('\n');
        if (ran.code !== 0) throw new Error(`wrangler pages deploy exited ${ran.code}:\n${tail(log)}`);
        const detailed = parseOutput(await readFile(output, 'utf8').catch(() => ''));
        if (detailed) return detailed;
        // Older wranglers print the URL but write no output file: find its deployment by URL.
        const url = new RegExp(`https://[a-z0-9-]+\\.${project}\\.pages\\.dev`).exec(log)?.[0];
        if (!url) throw new Error(`wrangler pages deploy finished but named no deployment:\n${tail(log)}`);
        // The deploy is done by now. A lookup that fails must not report it as failed, or the caller
        // would skip the live check and the rollback, so the id is simply left out.
        const found = (await api<Deployment[]>(`${project}/deployments?per_page=25`).catch(() => [])).find(deployment => deployment.url === url);
        return { id: found?.id ?? null, url };
      } finally {
        await rm(output, { force: true });
      }
    },

    async rollback(project, deployment) {
      await api(`${project}/deployments/${deployment}/rollback`, 'POST');
    },
  };
}

/** wrangler's output file is one JSON object per line; the deploy writes a `pages-deploy-detailed` one. */
export function parseOutput(text: string): { id: string; url: string } | null {
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as { type?: unknown; deployment_id?: unknown; url?: unknown };
      if (entry.type === 'pages-deploy-detailed' && typeof entry.deployment_id === 'string' && typeof entry.url === 'string') {
        return { id: entry.deployment_id, url: entry.url };
      }
    } catch {
      // not ours
    }
  }
  return null;
}
