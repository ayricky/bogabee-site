// GitHub through the REST API, with the owner's own token: the client's checks
// on a commit, the Release that records a production release, and the Notify
// release run that publishing it starts. A Release published with a person's
// token starts workflows, which is how the client email gets sent.

import type { Checks, GitHubRecord, Notify } from '../release.ts';
import { sha256Hex, type Sha } from '../types.ts';

const API = 'https://api.github.com';

interface Asset {
  id: number;
  name: string;
  size: number;
  digest?: string | null; // "sha256:<hex>", on assets uploaded since GitHub started recording it
}

interface Release {
  id: number;
  tag_name: string;
  draft: boolean;
  upload_url: string;
  html_url?: string;
  body?: string | null;
  assets: Asset[];
}

/** A release body as it compares: GitHub may store other line endings and drop trailing space. */
const normalized = (body: string | null | undefined): string => (body ?? '').replace(/\r\n?/g, '\n').split('\n').map(line => line.trimEnd()).join('\n').trim();
/** notify-release.yml puts every .mp4 and .jpg on the release in the email: the video, and each picture inline. */
const isVideo = (asset: Asset): boolean => asset.name.endsWith('.mp4');
const isMedia = (asset: Asset): boolean => isVideo(asset) || asset.name.endsWith('.jpg');

interface WorkflowRun {
  id: number;
  name: string;
  head_sha: string;
  head_branch: string | null;
  event: string;
  status: string;
  conclusion: string | null;
  html_url?: string;
  run_attempt?: number;
}

type Call = <T>(url: string, init?: { method?: string; body?: Uint8Array | string; type?: string }) => Promise<T>;

function caller(token: string, fetch: typeof globalThis.fetch): Call {
  return async function call<T>(url: string, init: { method?: string; body?: Uint8Array | string; type?: string } = {}): Promise<T> {
    const response = await fetch(url.startsWith('https://') ? url : `${API}${url}`, {
      method: init.method ?? 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'ayr-client-kit',
        ...(init.body === undefined ? {} : { 'Content-Type': init.type ?? 'application/json' }),
      },
      ...(init.body === undefined ? {} : { body: init.body }),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`GitHub ${init.method ?? 'GET'} ${url.replace(/\?.*$/, '')} answered ${response.status}: ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : null) as T;
  };
}

/** The newest push run of `workflow` on exactly `sha` on main: the same commit on another branch may skip main-only jobs. Needs `actions: read`. */
export function createChecks({ repo, token, workflow, fetch }: { repo: string; token: string; workflow: string; fetch: typeof globalThis.fetch }): Checks {
  const call = caller(token, fetch);
  return {
    async status(sha: Sha) {
      const { workflow_runs: runs } = await call<{ workflow_runs: WorkflowRun[] }>(`/repos/${repo}/actions/runs?branch=main&head_sha=${sha}&event=push&per_page=100`);
      const newest = runs.filter(run => run.name === workflow && run.head_sha === sha && run.head_branch === 'main' && run.event === 'push').toSorted((a, b) => b.id - a.id)[0];
      if (!newest || newest.status !== 'completed') return 'pending';
      return newest.conclusion === 'success' ? 'success' : 'failed';
    },
  };
}

/** The newest run of `workflow` that the Release for a tag started. A release run's head_branch is the tag. Needs `actions: write` to rerun. */
export function createNotify({ repo, token, workflow, fetch }: { repo: string; token: string; workflow: string; fetch: typeof globalThis.fetch }): Notify {
  const call = caller(token, fetch);
  return {
    async status(tag) {
      const { workflow_runs: runs } = await call<{ workflow_runs: WorkflowRun[] }>(`/repos/${repo}/actions/runs?event=release&per_page=100`);
      const newest = runs.filter(run => run.name === workflow && run.event === 'release' && run.head_branch === tag).toSorted((a, b) => b.id - a.id)[0];
      if (!newest) return { state: 'none' };
      const run = { id: newest.id, ...(newest.html_url ? { url: newest.html_url } : {}), ...(newest.run_attempt === undefined ? {} : { attempt: newest.run_attempt }) };
      if (newest.status !== 'completed') return { state: 'pending', ...run };
      return { state: newest.conclusion === 'success' ? 'success' : 'failed', ...run };
    },
    async rerun(id) {
      await call(`/repos/${repo}/actions/runs/${id}/rerun-failed-jobs`, { method: 'POST' });
    },
  };
}

export function createGitHub({ repo, token, fetch }: { repo: string; token: string; fetch: typeof globalThis.fetch }): GitHubRecord {
  const call = caller(token, fetch);
  /** An asset's bytes, through the API, which works for a draft's assets too. */
  const download = async (asset: Asset): Promise<Uint8Array> => {
    const path = `/repos/${repo}/releases/assets/${asset.id}`;
    const response = await fetch(`${API}${path}`, {
      headers: { Accept: 'application/octet-stream', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'ayr-client-kit' },
    });
    if (!response.ok) throw new Error(`GitHub GET ${path} answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
    return new Uint8Array(await response.arrayBuffer());
  };
  return {
    /**
     * A release that already has this tag is never trusted as it stands. A published one must hold
     * the reviewed note, pictures and video, or this throws. A draft is made to hold them before it goes
     * public. With `keep` the caller no longer has the reviewed files: the note is still enforced, and
     * whatever pictures and video the release holds stay.
     */
    async release(tag, title, body, media) {
      // Listed, not fetched by tag: a draft left by an interrupted run has no tag lookup.
      const existing = (await call<Release[]>(`/repos/${repo}/releases?per_page=100`)).find(release => release.tag_name === tag);
      const keepVideo = media.video === 'keep';
      const files = [
        ...media.pictures.map(picture => ({ ...picture, type: 'image/jpeg' })),
        ...(media.video && media.video !== 'keep' ? [{ ...media.video, sha256: null, type: 'video/mp4' }] : []),
      ];
      const wanted = await Promise.all(files.map(async file => ({
        ...file,
        size: file.bytes ? file.bytes.length : null,
        sha256: file.bytes ? await sha256Hex(file.bytes) : file.sha256,
      })));
      // A reviewed file by its content. A name and a size are not proof: another picture or recording can share both.
      // With no hash known nothing can show a file is the reviewed one, so none is taken for it.
      const reviewed = async (asset: Asset): Promise<boolean> => {
        const want = wanted.find(file => file.name === asset.name);
        if (!want) return keepVideo && isVideo(asset);
        if (want.sha256 === null) return false;
        if (asset.digest) return asset.digest === `sha256:${want.sha256}`;
        if (want.size !== null && asset.size !== want.size) return false;
        return (await sha256Hex(await download(asset))) === want.sha256;
      };
      const all = async (assets: Asset[]): Promise<boolean> => {
        for (const asset of assets) if (!(await reviewed(asset))) return false;
        return true;
      };
      const lost = (held: Set<string>): string[] => wanted.filter(file => !file.bytes && !held.has(file.name)).map(file => file.name);
      const refuseLost = (names: string[]): Error => new Error(`The Release has no reviewed ${names.join(', ')}, and this machine no longer has ${names.length === 1 ? 'it' : 'them'}, so the email can't be sent as reviewed. Nothing was published. Draft these changes again in a new release.`);
      if (existing && !existing.draft) {
        // Published already: its email may be out, and nothing new goes public here. A file this machine lost
        // with no hash to check is taken as the Release holds it, so a failed email job can still be run again.
        const held = existing.assets.filter(isMedia);
        const names = new Set(held.map(asset => asset.name));
        const unknown = new Set(wanted.filter(file => !file.bytes && file.sha256 === null).map(file => file.name));
        const checked = held.filter(asset => !unknown.has(asset.name));
        const sameMedia = (await all(checked)) && wanted.every(file => names.has(file.name));
        if (normalized(existing.body) !== normalized(body) || !sameMedia) {
          throw new Error(`A published release for ${tag} holds a different note, pictures or video from the ones reviewed: ${existing.html_url ?? `release ${existing.id}`}. Compare them before anything is sent again. To publish the reviewed ones, delete that release, keep the tag, and run this again.`);
        }
        return { made: 'already', video: held.some(isVideo) };
      }
      if (!existing) {
        const missing = lost(new Set());
        if (missing.length > 0) throw refuseLost(missing);
      }
      let release = existing;
      const attached = new Set<string>();
      if (release) {
        await call(`/repos/${repo}/releases/${release.id}`, { method: 'PATCH', body: JSON.stringify({ name: title, body }) });
        for (const asset of release.assets.filter(isMedia)) {
          if (await reviewed(asset)) attached.add(asset.name);
          else await call(`/repos/${repo}/releases/assets/${asset.id}`, { method: 'DELETE' });
        }
        // A draft stays a draft until it holds every reviewed file: publishing sends the email.
        const missing = lost(attached);
        if (missing.length > 0) throw refuseLost(missing);
      } else {
        release = await call<Release>(`/repos/${repo}/releases`, {
          method: 'POST',
          // With files to attach it stays a draft until every upload finishes, so the email never goes out without them.
          body: JSON.stringify({ tag_name: tag, name: title, body, draft: wanted.length > 0, make_latest: 'true' }),
        });
      }
      for (const want of wanted) {
        if (attached.has(want.name) || !want.bytes) continue;
        const upload = `${release.upload_url.replace(/\{.*\}$/, '')}?name=${encodeURIComponent(want.name)}`;
        await call(upload, { method: 'POST', body: want.bytes, type: want.type });
        attached.add(want.name);
      }
      if (release.draft) {
        await call(`/repos/${repo}/releases/${release.id}`, { method: 'PATCH', body: JSON.stringify({ draft: false }) });
      }
      return { made: 'published', video: [...attached].some(name => name.endsWith('.mp4')) };
    },
  };
}
