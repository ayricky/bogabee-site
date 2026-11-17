// A release, as three commands run on the owner's devbox from a checkout of
// the client repo on main. Every effect is injected, so the order of the steps
// lives here, typed and tested with doubles.
//
//   ayr release draft   writes the release commit on main and the review directory
//   ayr release run     checks, deploys, checks the live site, tags, and has GitHub email the client
//   ayr release undo    reverts a draft nobody released, so its notes can be edited
//
// There is no database. Git, the tag and the GitHub Release are the record,
// and the review directory is a copy for the owner to read. Publishing the
// GitHub Release starts the client repo's Notify release workflow, which sends
// the email. Nothing here sends mail.

import { posix } from 'node:path';
import { assembleEntry, entryHeading, insertEntry, parseChange, pictureFile, prNumbers, withPictures, type Change, type Range } from './changes.ts';
import type { ClientConfig, ReleaseConfig } from './config.ts';
import { checkEntries } from './lint.ts';
import type { Made, Sites } from './media.ts';
import { entryText, parseNotes, type Entry } from './notes.ts';
import { renderRelease } from './render.ts';
import {
  EMAIL_FILE, linkedPages, PAGE_FILE, parseReview, renderReviewPage, reviewDigest, REVIEW_FILE, STATUS_FILE, stepLabel, VIDEO_FILE,
  type FailedAt, type Review, type Status, type StepId, type StepState,
} from './review.ts';
import { MAX_VIDEO_BYTES } from './send.ts';
import { sha256Hex, type ChangeSummary, type IsoDate, type Probe, type ProdTag, type Sha, type Sha256 } from './types.ts';
import { describeFailures, planProbes, VERIFY_DEADLINE_MS, type ProbeResult } from './verify.ts';

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const short = (sha: Sha): string => sha.slice(0, 7);

export const REHEARSAL_BRANCH = 'ayr-rehearsal';
/** The trailer that makes a commit a draft. Its value is the client's date for the heading, picture names and tag. */
export const DATE_TRAILER = 'Ayr-Release-Date';
export const CHECKS_POLL_MS = 15_000;
export const CHECKS_WAIT_MS = 20 * 60_000;
export const NOTIFY_POLL_MS = 10_000;
export const NOTIFY_START_MS = 3 * 60_000;
export const NOTIFY_WAIT_MS = 15 * 60_000;
/** How long a `releasing` status.json counts as a release still running. `run` saves it on every poll. */
export const RUNNING_MS = 30 * 60_000;
export const SERVING_POLL_MS = 5_000;
export const SERVING_WAIT_MS = 60_000;

/** A client config with the release block: the release commands refuse a config without it. */
export type ReleaseClient = ClientConfig & { release: ReleaseConfig };

// ── Effects ────────────────────────────────────────────────────────────────

/** A commit `ayr release draft` made on main. It is unreleased while no prod-* tag points at it. */
export interface Draft {
  commit: Sha;
  base: Sha; // its parent
  date: IsoDate; // from the trailer
  released: boolean;
}

export interface Git {
  /**
   * Newest prod-* tag by creation date, and its commit, skipping `except`.
   * Reads the remote's tags first, so a release tagged from another machine counts.
   */
  lastRelease(except?: ProdTag): Promise<{ tag: ProdTag; commit: Sha } | null>;
  /** Fetches main from the remote and returns its commit. */
  main(): Promise<Sha>;
  /** The checkout's own branch (null when detached) and commit. */
  head(): Promise<{ branch: string | null; commit: Sha }>;
  isAncestor(ancestor: Sha, of: Sha): Promise<boolean>;
  subjects(from: Sha | null, to: Sha): Promise<string[]>;
  /** changes/*.md at a commit, in the order each landed on main (first-parent history, oldest first). */
  changeFiles(at: Sha): Promise<{ file: string; source: string }[]>;
  headings(at: Sha): Promise<string[]>; // every "## " heading in PATCH_NOTES.md
  changedFiles(from: Sha | null, to: Sha): Promise<string[]>;
  readFile(at: Sha, path: string): Promise<Uint8Array>;
  /** A synchronous reader of files at a commit, for planProbes. Throws on a missing file. */
  tree(at: Sha): (path: string) => Uint8Array;
  /** Paths in the working tree that differ from HEAD, added or deleted ones included, ignored files left out. */
  dirty(): Promise<string[]>;
  /** Puts each path back as HEAD has it, and removes one HEAD doesn't have. */
  restore(paths: string[]): Promise<void>;
  /** A directory holding the whole tree at `at`, so the deploy ships exactly that commit. `drop` removes it. */
  checkout(at: Sha): Promise<string>;
  drop(dir: string): Promise<void>;
  /** Writes files and deletions on top of `parent` as one commit by the checkout's own git identity, each file with the mode it has in the working tree. Moves nothing. */
  commit(parent: Sha, message: string, writes: Map<string, Uint8Array>, deletes: string[]): Promise<Sha>;
  /** `git push origin <sha>:refs/heads/main`, never forced. Throws when the remote refuses it. */
  pushMain(sha: Sha): Promise<void>;
  /** Moves the checkout's branch to `sha`. `keep` leaves the files on disk as they are; `match` makes them the commit's. */
  moveTo(sha: Sha, files: 'keep' | 'match'): Promise<void>;
  /** The commit as a draft, or null when it has no date trailer. Reads tags as lastRelease last fetched them. */
  draft(at: Sha): Promise<Draft | null>;
  /** The drafts on main's first-parent line in from..to, newest first, without any a later commit there reverts. */
  drafts(from: Sha | null, to: Sha): Promise<Draft[]>;
  /** `git revert --no-edit` on the checkout's branch. A conflict aborts the revert and names its paths. */
  revert(commit: Sha): Promise<Sha | { conflict: string[] }>;
  /** The one commit a prefix of its id names. Throws when none does, or more than one. */
  resolve(prefix: string): Promise<Sha>;
  /** The commit the remote's tag points at, or null. */
  tagged(tag: ProdTag): Promise<Sha | null>;
  /** Creates and pushes the annotated tag if missing; refuses one that points elsewhere. Idempotent. */
  tag(tag: ProdTag, sha: Sha, message: string): Promise<void>;
  run(command: string): Promise<void>; // config.release.setup, generate and checks
  /** Runs a shell command in another folder, such as a release's own checkout: config.release.deploy.build. */
  runIn(dir: string, command: string): Promise<void>;
}

/** The client's checks workflow (release.checksWorkflow) on one exact commit pushed to main: its newest run. No run yet is pending. */
export interface Checks {
  status(sha: Sha): Promise<'success' | 'pending' | 'failed'>;
}

export interface GitHubRecord {
  /**
   * A published Release with the email's note as body and the pictures and video attached. Idempotent.
   * Publishing it with the owner's token starts the client's Notify release workflow, which puts them in
   * the email. `already`: it was public before this call, with this note and these files. A public one
   * that holds anything else throws.
   * A picture this machine no longer has must already be on the Release as the reviewed file, by its hash:
   * else it throws before anything is published, since the email can't go without it.
   * The answer says whether the Release ends up with a video.
   */
  release(tag: ProdTag, title: string, body: string, media: ReleaseMedia): Promise<{ made: 'published' | 'already'; video: boolean }>;
}

/**
 * A file for the Release, by name. `bytes` null: this machine no longer has the reviewed copy, so the
 * Release must already hold it, checked by `sha256` when the review still names it.
 */
export interface ReleaseFile {
  name: string;
  bytes: Uint8Array | null;
  sha256: Sha256 | null;
}

/** What a Release carries for the email: the reviewed pictures, and the recording. */
export interface ReleaseMedia {
  pictures: ReleaseFile[];
  /** `keep`: this machine no longer has the reviewed recording, so the Release keeps whatever it holds, and the email may go without one. */
  video: { name: string; bytes: Uint8Array } | 'keep' | null;
}

/** The errors `ayr send release` would refuse a note for, as one line, or null when it has none. */
export function emailErrors(config: ClientConfig, note: string): string | null {
  const errors = checkEntries(parseNotes(note), config).filter(finding => finding.severity === 'error');
  return errors.length > 0 ? errors.map(finding => `${finding.rule}: ${finding.message}`).join(' ') : null;
}

/** Pictures and a recording together, past what one email can carry, as a reason; null when they fit. */
export function overLimit(sizes: number[]): string | null {
  const total = sizes.reduce((sum, size) => sum + size, 0);
  if (total <= MAX_VIDEO_BYTES) return null;
  return `The pictures and the recording come to ${(total / 1024 / 1024).toFixed(1)} MiB, over the ${MAX_VIDEO_BYTES / 1024 / 1024} MiB one email can carry. Shorten the recording or drop a picture, then draft again.`;
}

/** Where a Release's asset is: what the email's copy of the note names each picture by. */
export function assetUrl(repo: string, tag: ProdTag, file: string): string {
  return `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(file)}`;
}

/** The Notify release workflow's newest run for a tag. `attempt` rises when a run is rerun. */
export interface Notify {
  status(tag: ProdTag): Promise<{ state: 'none' | 'pending' | 'success' | 'failed'; url?: string; id?: number; attempt?: number }>;
  rerun(id: number): Promise<void>;
}

export interface Pages {
  /**
   * The deployment a rollback returns to: what production serves now. When that is already `notCommit`
   * (a run resumed after its deploy), the newest good deployment of `lastRelease`, so a draft that was
   * itself rolled back is never the target. With no such deployment, the newest good one of another commit.
   */
  productionDeployment(project: string, notCommit: Sha, lastRelease: Sha | null): Promise<string | null>;
  /**
   * wrangler pages deploy <dir> --project-name <project> --branch <branch> --commit-hash <sha>, run from `root`.
   * Returns the deployment's URL, and its id when Cloudflare gave one. A throw means the deploy may or may not have happened.
   */
  deploy(input: { project: string; root: string; dir: string; branch: string; commit: Sha }): Promise<{ id: string | null; url: string }>;
  /** The commit of the deployment production serves now, or null when it has none or Cloudflare recorded no commit for it. */
  productionCommit(project: string): Promise<string | null>;
  /** POST …/pages/projects/<project>/deployments/<id>/rollback */
  rollback(project: string, deployment: string): Promise<void>;
}

/** The checkout, where the entry, pictures and generated files are written before they become the draft commit. Paths are repo-relative. */
export interface WorkTree {
  read(path: string): Uint8Array | null;
  write(path: string, bytes: Uint8Array): void;
  remove(path: string): void;
}

/** The review directory. `write` replaces a file in one step, so a reader never sees half of it. */
export interface ReviewDir {
  path: string;
  read(name: string): Uint8Array | null;
  write(name: string, bytes: Uint8Array): void;
  remove(name: string): void;
  /** Creates the directory and empties it. Only files go, and only from a folder that is empty or holds a review.json or status.json this kit wrote. */
  clear(): void;
}

/** The pure work of other modules, behind one seam, so the order and failure handling are tested on their own. */
export interface Derive {
  parseChange: typeof parseChange;
  pictureFile: typeof pictureFile;
  planProbes: typeof planProbes;
  describeFailures: typeof describeFailures;
}
export const DERIVE: Derive = { parseChange, pictureFile, planProbes, describeFailures };

export interface Deps {
  config: ReleaseClient;
  git: Git;
  work: WorkTree;
  review: ReviewDir;
  pages: Pages;
  github: GitHubRecord;
  notify: Notify;
  checks: Checks;
  derive: Derive;
  makeMedia: (changes: Change[], sites: Sites, date: string) => Promise<Made>;
  runProbes: (probes: Probe[], deadline: number) => Promise<ProbeResult[]>;
  serve: () => Promise<{ stop(): Promise<void> }>; // starts config.release.serve and waits for it to answer
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  log: (event: string, fields: Record<string, unknown>) => void;
}

/** What `draft` and `undo` use: nothing that needs a Cloudflare or GitHub token. */
export type DraftDeps = Pick<Deps, 'config' | 'git' | 'work' | 'review' | 'derive' | 'makeMedia' | 'serve' | 'now' | 'log'>;

// ── Planning (pure) ────────────────────────────────────────────────────────

export type ReleasePlan =
  | { kind: 'nothing' }
  | { kind: 'quiet'; changes: Change[]; range: Range }
  | { kind: 'note'; changes: Change[]; heading: string; entry: string; range: Range };

/** Pure. Parses nothing: changes are parsed at the boundary. Uses assembleEntry, entryHeading and actionLine. */
export function planRelease(input: {
  changes: Change[];
  headings: string[];
  date: IsoDate;
  at: Date;
  range: Range;
  config: ClientConfig;
}): ReleasePlan {
  const { changes, range, config } = input;
  if (changes.length === 0) return { kind: 'nothing' };
  if (changes.every(change => change.kind === 'quiet')) return { kind: 'quiet', changes, range };
  const heading = entryHeading(input.date, input.at, config.timezone, input.headings);
  return { kind: 'note', changes, heading, entry: assembleEntry({ changes, heading, date: input.date, range, config }), range };
}

/** prod-<date>-<short commit>, the shape client repos' tags already have, so old tags and new ones sort together. */
export function releaseTag(date: IsoDate, commit: Sha): ProdTag {
  return `prod-${date}-${commit.slice(0, 7)}`;
}

/** The client's calendar date now. */
export function clientDate(at: Date, timezone: string): IsoDate {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find(p => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}` as IsoDate;
}

/** The bold lead of an item's bullet, "New — customers can book a call.", shown on the review page. */
function boldLead(bullet: string): string {
  return /\*\*(.+?)\*\*/s.exec(bullet)?.[1]?.replace(/\s+/g, ' ').trim() ?? bullet.split('\n')[0] ?? bullet;
}

export function changeSummary(change: Change): ChangeSummary {
  switch (change.kind) {
    case 'item': return { id: change.id, kind: 'item', line: boldLead(change.bullet) };
    case 'hood': return { id: change.id, kind: 'hood', line: change.sentence };
    case 'quiet': return { id: change.id, kind: 'quiet', line: change.why };
  }
}

/** The draft commit's message: what `git.draft` reads back, and what `git log` shows. */
export function draftMessage(heading: string | null, changes: Change[], date: IsoDate): string {
  const body = changes.map(changeSummary).map(change => `- ${change.id}: ${change.line}`).join('\n');
  return `${heading === null ? 'Quiet release' : `Release ${heading}`}\n\n${body}\n\n${DATE_TRAILER}: ${date}\n`;
}

/** Probe URLs planned for the client's site, pointed at a preview deployment instead. */
export function retarget(probes: Probe[], site: string, origin: string): Probe[] {
  return probes.map(probe => (probe.url.startsWith(`${site}/`) || probe.url === site ? { ...probe, url: `${origin.replace(/\/+$/, '')}${probe.url.slice(site.length)}` } : probe));
}

/** Main doesn't hold the last release, so a release from here would take that one back off the site. */
export function staleReason(base: Sha, release: ProdTag): string {
  return `Main, at ${short(base)}, doesn't include the last release, ${release}. A release from here would take ${release} back off the site. Merge ${release} into main, then draft again.`;
}

// ── What a draft holds, read back from git ─────────────────────────────────

export interface Derived {
  review: Review; // `shots` is empty and `video` null: the pictures and the recording are not in git
  entry: Entry | null;
  /** The email's copy of the entry, the Release body: the entry with each picture under its change. */
  email: string | null;
  changes: Change[];
}

/**
 * Everything the owner reviews, from git alone: the change files at base that
 * the draft deletes, the draft's newest PATCH_NOTES.md entry, the email's copy
 * of it with each picture's place, and the probes over what changed since the
 * last release. `draft` writes this to
 * review.json, and `run` derives it again and refuses to go on if the two
 * differ. Pure apart from the reads it is handed.
 */
export async function deriveReview(deps: Pick<Deps, 'config' | 'git' | 'derive'>, draft: Pick<Draft, 'commit' | 'base' | 'date'>): Promise<Derived> {
  const { config, git, derive } = deps;
  if (!config.repo) throw new Error('The client config has no repo, and the review must name it.');
  const { commit, base, date } = draft;
  const [atBase, atDraft] = await Promise.all([git.changeFiles(base), git.changeFiles(commit)]);
  const left = new Set(atDraft.map(({ file }) => file));
  const changes = atBase.filter(({ file }) => !left.has(file)).map(({ file, source }) => derive.parseChange(file, source));
  let entry: Entry | null = null;
  if (changes.some(change => change.kind !== 'quiet')) {
    entry = parseNotes(new TextDecoder().decode(await git.readFile(commit, 'PATCH_NOTES.md')))[0] ?? null;
    if (!entry) throw new Error('The draft commit has no PATCH_NOTES.md entry, but its changes are told.');
  }
  const tag = releaseTag(date, commit);
  const { repo } = config;
  const pictures: Review['pictures'] = changes.flatMap(change => {
    if (change.kind !== 'item' || !change.picture) return [];
    const file = derive.pictureFile(change.id, date);
    return [{ id: change.id, file, url: assetUrl(repo, tag, file) }];
  });
  // Skips this release's own tag, so a run resumed after the tag sees the same range.
  const previous = await git.lastRelease(tag);
  const changed = await git.changedFiles(previous?.commit ?? null, commit);
  const prs = prNumbers(await git.subjects(previous?.commit ?? null, base));
  // The email's copy: the committed entry with each picture under its change, shown from the email itself.
  const email = entry ? withPictures(entryText(entry), changes, date, file => assetUrl(repo, tag, file)) : null;
  const review: Review = {
    version: 1,
    slug: config.slug,
    repo: config.repo,
    commit,
    base,
    date,
    tag,
    heading: entry?.heading ?? null,
    to: entry ? config.release.to : [],
    changes: changes.map(changeSummary),
    prs,
    pictures,
    shots: [],
    video: null,
    probes: derive.planProbes({ entry, changed, tree: git.tree(commit), config }),
  };
  return { review, entry, email, changes };
}

const json = (value: unknown): Uint8Array => new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);

/** The commit the review directory holds a review of, or null when it holds none this kit can read. */
function reviewedCommit(dir: ReviewDir): Sha | null {
  const held = dir.read(REVIEW_FILE);
  try {
    return held ? parseReview(new TextDecoder().decode(held)).commit : null;
  } catch {
    return null;
  }
}

/** Opens the preview's links in a new tab. Nothing in it runs, loads a frame, posts a form or re-bases its links: only pictures and its own styles load. */
export const PREVIEW_HEAD = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' https: data:; media-src 'self'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'"><base target="_blank">`;

/**
 * The files of the review directory that follow from git and the media's description, by name: the
 * page and the email preview. Pure. `draft` writes them and `run` builds them again to check that what
 * the owner read is what ships. The pictures and the video are checked by their hashes instead.
 */
export function reviewFiles(config: ReleaseClient, derived: Derived, media: Pick<Review, 'shots' | 'video'>): { review: Review; files: Map<string, Uint8Array> } {
  const { entry, email } = derived;
  // A quiet release sends nothing, so it shows no pictures or recording.
  const review: Review = { ...derived.review, shots: entry ? media.shots : [], video: entry ? media.video : null };
  const files = new Map<string, Uint8Array>();
  let pages: string[] = [];
  const [note] = email ? parseNotes(email) : [];
  if (note) {
    // The email as `ayr send release` renders it, with one difference: it shows its pictures inline from
    // the email itself, so the preview loads the copies in this directory.
    let html = renderRelease(config, note, { hasVideo: review.video !== null }).html;
    for (const picture of review.pictures) html = html.replaceAll(`src="${picture.url}"`, `src="${picture.file}"`);
    pages = linkedPages(html, config.site);
    // Two more for the copy on this machine. A note is Markdown, which may hold HTML: a mail client
    // drops a script, and this policy does the same wherever the copy is opened, in the page's frame
    // or on its own. And a tapped link opens beside the review instead of inside the frame.
    html = html.replace(/<head[^>]*>/, head => `${head}${PREVIEW_HEAD}`);
    files.set(EMAIL_FILE, new TextEncoder().encode(html));
  }
  files.set(PAGE_FILE, new TextEncoder().encode(renderReviewPage(review, config, pages)));
  return { review, files };
}

/** Step 7 of a draft: the review directory, replaced whole. The pictures and the recording live here, and nowhere else until the release. */
async function writeReview(deps: DraftDeps, derived: Derived, made: Made): Promise<Review> {
  const { config, review: dir } = deps;
  const named = derived.entry ? derived.review.pictures.map(picture => picture.file) : [];
  const madeNames = made.pictures.map(picture => picture.file);
  if (named.join('\n') !== madeNames.join('\n')) throw new Error(`The pictures made (${madeNames.join(', ') || 'none'}) are not the ones the draft names (${named.join(', ') || 'none'}).`);
  const shots = await Promise.all(made.pictures.map(async picture => ({ file: picture.file, sha256: await sha256Hex(picture.bytes), bytes: picture.bytes.length })));
  const { video } = made;
  const described = video ? { name: video.name, sha256: await sha256Hex(video.bytes), bytes: video.bytes.length } : null;
  const { review, files } = reviewFiles(config, derived, { shots, video: described });
  const status: Status = { version: 1, state: 'draft', tag: review.tag, steps: [], updatedAt: deps.now().toISOString() };
  dir.clear();
  for (const [name, bytes] of files) dir.write(name, bytes);
  for (const picture of review.shots.length > 0 ? made.pictures : []) dir.write(picture.file, picture.bytes);
  if (video && review.video) dir.write(VIDEO_FILE, video.bytes);
  dir.write(REVIEW_FILE, json(review));
  dir.write(STATUS_FILE, json(status));
  return review;
}

// ── ayr release draft ──────────────────────────────────────────────────────

export type DraftOutcome =
  | { kind: 'nothing' }
  | {
    kind: 'drafted' | 'rebuilt';
    commit: Sha;
    tag: ProdTag;
    heading: string | null;
    reviewDir: string;
    to: string[];
    changes: number;
    pictures: number;
    video: boolean;
  };

/**
 * The checkout is at origin's main with nothing uncommitted, on main or detached. Returns that commit.
 * Detached counts: an agent's worktree can't check out main while another checkout holds it. Another
 * branch is refused, because the commands move HEAD and would drag that branch along.
 */
async function cleanMain(git: Git): Promise<Sha> {
  const head = await git.head();
  if (head.branch !== 'main' && head.branch !== null) {
    throw new Error(`This checkout is on ${head.branch}, not main. Switch to main, or detach at origin's main with \`git switch --detach origin/main\`, and run this again.`);
  }
  const remote = await git.main();
  if (head.commit !== remote) throw new Error(`Local main is at ${short(head.commit)} and origin's main is at ${short(remote)}. Pull or push first, so they are the same commit.`);
  const dirty = await git.dirty();
  if (dirty.length > 0) throw new Error(`The checkout has uncommitted changes in ${dirty.slice(0, 5).join(', ')}${dirty.length > 5 ? ` and ${dirty.length - 5} more` : ''}. Commit or remove them first.`);
  return remote;
}

async function serveAndMake(deps: DraftDeps, changes: Change[], date: IsoDate): Promise<Made> {
  const server = await deps.serve();
  try {
    return await deps.makeMedia(changes, { live: deps.config.site, local: deps.config.release.serve.url }, date);
  } finally {
    await server.stop();
  }
}

function drafted(kind: 'drafted' | 'rebuilt', review: Review, dir: ReviewDir): DraftOutcome {
  return {
    kind,
    commit: review.commit,
    tag: review.tag,
    heading: review.heading,
    reviewDir: dir.path,
    to: review.to,
    changes: review.changes.length,
    pictures: review.pictures.length,
    video: review.video !== null,
  };
}

/** Step 3: main's tip is a draft already. No new commit: the review directory is written again from it, with the pictures and the recording made again. */
async function rebuild(deps: DraftDeps, draft: Draft): Promise<DraftOutcome> {
  const derived = await deriveReview(deps, draft);
  let made: Made = { pictures: [], video: null };
  if (derived.entry && derived.changes.some(change => change.kind === 'item' && (change.picture || change.recording))) {
    for (const command of deps.config.release.setup) await deps.git.run(command);
    made = await serveAndMake(deps, derived.changes, draft.date);
    const tooBig = overLimit([...made.pictures.map(picture => picture.bytes.length), made.video?.bytes.length ?? 0]);
    if (tooBig) throw new Error(tooBig);
  }
  const review = await writeReview(deps, derived, made);
  deps.log('draft.rebuilt', { commit: draft.commit, reviewDir: deps.review.path });
  return drafted('rebuilt', review, deps.review);
}

/**
 * 1. The checkout is on main, equal to origin's main after a fetch, with nothing uncommitted.
 * 2. Main must hold the last release, or a release from here would undo it (stale).
 * 3. Main's tip is an unreleased draft → rebuild the review directory from it, no new commit.
 *    An unreleased draft further back means main moved past it: undo it first.
 *    A draft that is already tagged is not this command's business: `run` finishes it from git.
 * 4. Plan from changes/ at the tip. No change files → nothing, and nothing is touched.
 * 5. setup; for a told release, serve and makeMedia; write PATCH_NOTES.md, delete the released change
 *    files; run generate; run release.checks and `ayr check` on the new entry. The pictures and the
 *    recording are kept for the review directory: they go in the email only, never in the repo.
 * 6. Commit on the tip from what step 5 changed (not what setup left), as the checkout's own git
 *    identity. Push it to origin's main without force, then move local main to it. Any failure from
 *    step 5 on puts the working tree back.
 * 7. Write the review directory.
 */
export async function runDraft(deps: DraftDeps): Promise<DraftOutcome> {
  const { config, git, work, log } = deps;
  const { release } = config;
  const tip = await cleanMain(git);
  const last = await git.lastRelease();
  if (last && !(await git.isAncestor(last.commit, tip))) throw new Error(staleReason(tip, last.tag));
  const [open] = (await git.drafts(last?.commit ?? null, tip)).filter(draft => !draft.released);
  if (open?.commit === tip) return rebuild(deps, open);
  if (open) throw new Error(`Main moved past the draft ${short(open.commit)}, which was never released. Run \`ayr release undo\` to take it back, then draft again.`);

  const now = deps.now();
  const date = clientDate(now, config.timezone);
  const changes = (await git.changeFiles(tip)).map(({ file, source }) => deps.derive.parseChange(file, source));
  const range: Range = {
    from: last ? short(last.commit) : null,
    to: short(tip),
    prs: prNumbers(await git.subjects(last?.commit ?? null, tip)),
  };
  const plan = planRelease({ changes, headings: await git.headings(tip), date, at: now, range, config });
  if (plan.kind === 'nothing') {
    log('draft.nothing', { tip });
    return { kind: 'nothing' };
  }
  const heading = plan.kind === 'note' ? plan.heading : null;

  // What setup leaves behind (a copied .dev.vars, an install) is not part of the release.
  for (const command of release.setup) await git.run(command);
  const before = new Set(await git.dirty());
  const stepsChanged = async (): Promise<string[]> => (await git.dirty()).filter(path => !before.has(path));
  let made: Made = { pictures: [], video: null };
  let derived: Derived;
  try {
    if (plan.kind === 'note') {
      made = await serveAndMake(deps, plan.changes, date);
      // Before anything is committed: one email has to carry them.
      const tooBig = overLimit([...made.pictures.map(picture => picture.bytes.length), made.video?.bytes.length ?? 0]);
      if (tooBig) throw new Error(tooBig);
      const notes = new TextDecoder().decode(work.read('PATCH_NOTES.md') ?? new Uint8Array());
      work.write('PATCH_NOTES.md', new TextEncoder().encode(insertEntry(notes, plan.entry)));
    }
    for (const change of plan.changes) work.remove(change.file);
    for (const command of release.generate) await git.run(command);
    for (const command of release.checks) await git.run(command);
    if (plan.kind === 'note') {
      const notes = new TextDecoder().decode(work.read('PATCH_NOTES.md') ?? new Uint8Array());
      const errors = checkEntries(parseNotes(notes), config, { siteFile: path => work.read(posix.join(release.deploy.dir, path)) })
        .filter(finding => finding.severity === 'error');
      if (errors.length > 0) throw new Error(`The new entry fails ayr check: ${errors.map(finding => `${finding.rule}: ${finding.message}`).join(' ')}`);
      // The email's copy too: each picture's alt text is in it, and the email job lints what it sends.
      const shown = emailErrors(config, withPictures(plan.entry, plan.changes, date, file => assetUrl(config.repo ?? '', releaseTag(date, tip), file)));
      if (shown) throw new Error(`The email's copy of the new entry fails ayr check: ${shown}`);
    }

    const writes = new Map<string, Uint8Array>();
    const deletes: string[] = [];
    for (const path of await stepsChanged()) {
      const bytes = work.read(path);
      if (bytes) writes.set(path, bytes);
      else deletes.push(path);
    }
    const commit = await git.commit(tip, draftMessage(heading, plan.changes, date), writes, deletes);
    // Read back before the push, so a commit that isn't the release this planned never reaches main.
    derived = await deriveReview(deps, { commit, base: tip, date });
    if (derived.review.heading !== heading) {
      throw new Error(`The draft commit's newest entry is "${derived.review.heading ?? 'none'}", not the one this command wrote.`);
    }
    try {
      await git.pushMain(commit);
    } catch (error) {
      throw new Error(`Origin refused the draft commit, so nothing was drafted: ${message(error)} If main moved, pull and draft again.`);
    }
    await git.moveTo(commit, 'keep');
  } catch (error) {
    await stepsChanged().then(paths => git.restore(paths)).catch((failed: unknown) => log('draft.restore-failed', { reason: message(failed) }));
    throw error;
  }

  const review = await writeReview(deps, derived, made);
  log('draft.drafted', { commit: review.commit, reviewDir: deps.review.path });
  return drafted('drafted', review, deps.review);
}

// ── ayr release undo ───────────────────────────────────────────────────────

export type UndoOutcome =
  | { kind: 'nothing' }
  | { kind: 'undone'; draft: Sha; commit: Sha; restored: string[] };

/** status.json says `run` is releasing this tag, and said so within the last 30 minutes. */
function running(dir: ReviewDir, tag: ProdTag, now: Date): boolean {
  try {
    const status = JSON.parse(new TextDecoder().decode(dir.read(STATUS_FILE) ?? new Uint8Array())) as Partial<Status> | null;
    const age = now.getTime() - Date.parse(status?.updatedAt ?? '');
    return status?.state === 'releasing' && status.tag === tag && age < RUNNING_MS;
  } catch {
    return false;
  }
}

/**
 * Takes the newest unreleased draft on origin's main back with a revert, pushed
 * without force, so the change files return and the notes can be edited. A
 * released draft is never undone, and neither is one this machine is releasing
 * right now. A conflict changes nothing.
 */
export async function runUndo(deps: Pick<Deps, 'git' | 'review' | 'now' | 'log'>): Promise<UndoOutcome> {
  const { git, review: dir } = deps;
  const remote = await git.main();
  const last = await git.lastRelease();
  const [draft] = (await git.drafts(last?.commit ?? null, remote)).filter(found => !found.released);
  if (!draft) return { kind: 'nothing' };
  if (running(dir, releaseTag(draft.date, draft.commit), deps.now())) {
    throw new Error(`A release of the draft ${short(draft.commit)} is running on this machine. Wait for it to finish, then run this again.`);
  }
  await cleanMain(git);

  const reverted = await git.revert(draft.commit);
  if (typeof reverted === 'object') {
    throw new Error(`Taking back the draft ${short(draft.commit)} conflicts in ${reverted.conflict.join(', ')}. Main changed those files after it. Nothing was changed.`);
  }
  try {
    await git.pushMain(reverted);
  } catch (error) {
    await git.moveTo(remote, 'match');
    throw new Error(`Origin refused the revert, so the draft is still on main: ${message(error)} If main moved, pull and run this again.`);
  }
  const had = new Set((await git.changeFiles(remote)).map(({ file }) => file));
  const restored = (await git.changeFiles(reverted)).map(({ file }) => file).filter(file => !had.has(file));

  if (reviewedCommit(dir) === draft.commit) {
    const status: Status = { version: 1, state: 'withdrawn', tag: releaseTag(draft.date, draft.commit), steps: [], updatedAt: deps.now().toISOString() };
    dir.write(STATUS_FILE, json(status));
    dir.remove(REVIEW_FILE);
  }
  deps.log('undo.undone', { draft: draft.commit, commit: reverted, restored });
  return { kind: 'undone', draft: draft.commit, commit: reverted, restored };
}

// ── ayr release run ────────────────────────────────────────────────────────

export type RunOutcome =
  | { kind: 'done'; tag: ProdTag; sent: boolean; recordingLost?: true } // recordingLost: the email went without the recording, which was lost with the review directory
  | { kind: 'rehearsed'; url: string }
  | { kind: 'failed'; at: FailedAt; reason: string; rolledBack: boolean };

export const NO_REVIEW = 'No review of this draft on this machine. Run `ayr release draft` to rebuild the review page, read it, then run this again.';
const REDRAFT = 'Run `ayr release undo`, then draft again.';
const REBUILD = 'Run `ayr release draft` to rebuild the review page, read it, then run this again.';

const COMPARED = ['commit', 'base', 'date', 'tag', 'heading', 'pictures', 'probes'] as const;

const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((byte, index) => byte === b[index]);

/** What `run` goes on with. `keep` for the media: this machine no longer has the reviewed pictures and recording. */
interface Checked {
  review: Review;
  entry: Entry | null;
  email: string | null;
  media: ReleaseMedia;
  recorded: boolean; // the draft had a recording, so its email was reviewed with a video
}

const hasRecording = (derived: Derived): boolean => derived.entry !== null && derived.changes.some(change => change.kind === 'item' && change.recording !== null);

/**
 * Step 0 for a draft with no tag yet: the review on this machine against git,
 * before anything is touched. A string is why it can't go on. Otherwise the
 * review to release, built here from git, with only the video's description
 * taken from review.json.
 */
async function preflight(deps: Deps, held: Review): Promise<string | Checked> {
  const { config, git, review: dir } = deps;
  const main = await git.main();
  if (main !== held.commit) return `Main moved since the review: it is at ${short(main)}, and the review is of ${short(held.commit)}. ${REDRAFT}`;
  // The config that names the Pages project is read from this checkout, so it must be the reviewed one.
  const pinned = `The checkout must be at the reviewed commit ${short(held.commit)} with nothing uncommitted, so the release runs the config and code that were reviewed.`;
  const head = await git.head();
  if (head.commit !== held.commit) return `${pinned} It is at ${short(head.commit)}.`;
  const dirty = await git.dirty();
  if (dirty.length > 0) return `${pinned} It has changes in ${dirty.slice(0, 5).join(', ')}${dirty.length > 5 ? ` and ${dirty.length - 5} more` : ''}.`;
  const draft = await git.draft(held.commit);
  if (!draft) return `${short(held.commit)} is not a draft commit. ${REBUILD}`;
  const derived = await deriveReview(deps, draft);
  const differs = COMPARED.filter(key => JSON.stringify(derived.review[key]) !== JSON.stringify(held[key]));
  if (differs.length > 0) return `The draft in git differs from the review on this machine in ${differs.join(', ')}. ${REBUILD}`;
  // Checked first, before anything is deployed: the email job would refuse them after the tag. The hashes below hold the sizes to the truth.
  const tooBig = overLimit([...held.shots.map(shot => shot.bytes), held.video?.bytes ?? 0]);
  if (tooBig) return `${tooBig} Nothing was deployed.`;
  const { review, files } = reviewFiles(config, derived, held);
  for (const [name, bytes] of files) {
    const shown = dir.read(name);
    if (!shown || !same(shown, bytes)) return `${name} in ${dir.path} is not what the draft wrote. ${REBUILD}`;
  }
  // The pictures and the recording are in no commit: each must be the file the review page showed.
  const named = derived.entry ? review.pictures.map(picture => picture.file) : [];
  if (named.join('\n') !== review.shots.map(shot => shot.file).join('\n')) return `The review's pictures are not the ones the draft names. ${REBUILD}`;
  const media: ReleaseMedia = { pictures: [], video: null };
  for (const shot of review.shots) {
    const bytes = dir.read(shot.file);
    if (!bytes) return `The review names the picture ${shot.file}, and it is missing from ${dir.path}. ${REBUILD}`;
    if ((await sha256Hex(bytes)) !== shot.sha256) return `${shot.file} in ${dir.path} is not the picture the review page showed. ${REBUILD}`;
    media.pictures.push({ name: shot.file, bytes, sha256: shot.sha256 });
  }
  if (review.video) {
    const bytes = dir.read(VIDEO_FILE);
    if (!bytes) return `The review names a video, and ${VIDEO_FILE} is missing from ${dir.path}. ${REBUILD}`;
    if ((await sha256Hex(bytes)) !== review.video.sha256) return `${VIDEO_FILE} in ${dir.path} is not the video the review page showed. ${REBUILD}`;
    media.video = { name: review.video.name, bytes };
  }
  // The email job lints the note it sends. Checked here, before anything is deployed, rather than after the tag.
  const shown = derived.email ? emailErrors(config, derived.email) : null;
  if (shown) return `The email's copy of the entry fails ayr check: ${shown} ${REDRAFT}`;
  const last = await git.lastRelease(review.tag);
  if (last && !(await git.isAncestor(last.commit, review.base))) {
    return `${short(review.base)} is older than the last release, ${last.tag}, so deploying it would take that release back off the site. Nothing was deployed. ${REDRAFT}`;
  }
  return { review, entry: derived.entry, email: derived.email, media, recorded: hasRecording(derived) };
}

/**
 * Step 0 once the tag exists. The release is live and recorded, and what is
 * left, the Release and the email, comes from git alone. Main, the checkout and
 * the review directory no longer matter, so none of them is checked and a lost
 * review is no dead end. The pictures and the recording are what git doesn't hold:
 * each one this machine still has, by its hash, goes to the Release. A picture it
 * lost must be on the Release already, as the hash in review.json says. With no
 * review.json there is no hash, so nothing is published. A lost recording is kept
 * as the Release holds it.
 */
async function afterTag(deps: Deps, commit: Sha, held: Review | null): Promise<string | Checked> {
  const draft = await deps.git.draft(commit);
  if (!draft) return `${short(commit)} is not a draft commit.`;
  const derived = await deriveReview(deps, draft);
  const kept = async (name: string, sha256: string): Promise<Uint8Array | null> => {
    const bytes = deps.review.read(name);
    return bytes && (await sha256Hex(bytes)) === sha256 ? bytes : null;
  };
  // With no review here, the draft still names its pictures, though not their hashes.
  const named: { file: string; sha256: Sha256 | null }[] = held ? held.shots : derived.entry ? derived.review.pictures.map(picture => ({ file: picture.file, sha256: null })) : [];
  const pictures = await Promise.all(named.map(async ({ file, sha256 }) => ({ name: file, sha256, bytes: sha256 ? await kept(file, sha256) : null })));
  let video: ReleaseMedia['video'] = held ? null : hasRecording(derived) ? 'keep' : null;
  if (held?.video) {
    const bytes = await kept(VIDEO_FILE, held.video.sha256);
    video = bytes ? { name: held.video.name, bytes } : 'keep';
  }
  const media: ReleaseMedia = { pictures, video };
  return { review: derived.review, entry: derived.entry, email: derived.email, media, recorded: hasRecording(derived) };
}

/**
 * The draft a commit id names, when its release tag already points at it.
 * Null for anything else: an unknown id, a commit that is no draft, a draft with no tag.
 */
async function taggedDraft(git: Git, told: string): Promise<Draft | null> {
  try {
    await git.lastRelease(); // fetches the release tags, and with them a tagged commit this checkout may not have yet
    const commit = told.length === 40 ? (told as Sha) : await git.resolve(told);
    const draft = await git.draft(commit);
    return draft && (await git.tagged(releaseTag(draft.date, commit))) === commit ? draft : null;
  } catch {
    return null;
  }
}

/**
 * Asked again right before the deploy, because the checks can take 20 minutes
 * and an `undo` or a new draft may land meanwhile. A string is what changed.
 */
async function stillReviewed(deps: Deps, review: Review): Promise<string | null> {
  const changed = 'The draft changed while the checks ran:';
  const main = await deps.git.main();
  if (main !== review.commit) return `${changed} main is now at ${short(main)}, and the review is of ${short(review.commit)}. Nothing was deployed. ${REDRAFT}`;
  if (reviewedCommit(deps.review) !== review.commit) return `${changed} ${REVIEW_FILE} in ${deps.review.path} no longer holds the review of ${short(review.commit)}. Nothing was deployed. ${REBUILD}`;
  return null;
}

/**
 * Asked a last time before the tag, because the deploy and the live checks take
 * minutes and an `undo` from elsewhere may have landed in them. Main moving on
 * with other commits is fine. A string is how the draft was taken back.
 */
async function takenBack(deps: Deps, review: Review): Promise<string | null> {
  const main = await deps.git.main();
  // drafts leaves out one a later commit reverts, and one main no longer holds is not in the range at all.
  const open = (await deps.git.drafts(review.base, main)).some(draft => draft.commit === review.commit);
  if (!open) return `${short(review.commit)} is no longer a draft on main`;
  if (reviewedCommit(deps.review) !== review.commit) return `${REVIEW_FILE} in ${deps.review.path} no longer holds the review of ${short(review.commit)}`;
  return null;
}

/** Step 1. A string is why the checks did not pass. `beat` runs before each wait, so status.json stays fresh. */
async function awaitChecks(deps: Deps, commit: Sha, beat: () => void): Promise<string | null> {
  const workflow = deps.config.release.checksWorkflow;
  const deadline = deps.now().getTime() + CHECKS_WAIT_MS;
  for (;;) {
    const status = await deps.checks.status(commit);
    if (status === 'success') return null;
    if (status === 'failed') return `"${workflow}" failed on ${short(commit)}. Nothing was deployed. Fix main, run \`ayr release undo\`, then draft again.`;
    if (deps.now().getTime() >= deadline) return `"${workflow}" has not finished on ${short(commit)} after ${CHECKS_WAIT_MS / 60_000} minutes. Nothing was deployed. Run this again once it passes.`;
    beat();
    await deps.sleep(CHECKS_POLL_MS);
  }
}

/**
 * Step 5, after the Release is public: waits for the Notify release run that
 * publishing started. A failed run is rerun once, and only when this call is a
 * resume: a run that fails right after its own publish is reported as it is.
 */
async function awaitNotify(deps: Deps, tag: ProdTag, resumed: boolean, beat: () => void): Promise<{ sent: true; url?: string } | { sent: false; reason: string }> {
  const { notify, now } = deps;
  const workflow = deps.config.release.notifyWorkflow;
  const started = now().getTime();
  let deadline = started + NOTIFY_WAIT_MS;
  let reran: number | null = null; // the attempt this call reran
  for (;;) {
    const run = await notify.status(tag);
    const at = run.url ? ` ${run.url}` : '';
    // Right after a rerun the API can still show the attempt that failed.
    const stale = reran !== null && run.attempt !== undefined && run.attempt <= reran;
    if (run.state === 'success') return { sent: true, ...(run.url ? { url: run.url } : {}) };
    if (run.state === 'none') {
      if (now().getTime() - started >= NOTIFY_START_MS) return { sent: false, reason: `No "${workflow}" run started for ${tag}. Is the workflow in the repo?` };
    } else if (run.state === 'failed' && !stale) {
      if (!resumed || reran !== null || run.id === undefined) return { sent: false, reason: `"${workflow}" failed for ${tag}.${at}` };
      await notify.rerun(run.id);
      reran = run.attempt ?? 0;
      deadline = now().getTime() + NOTIFY_WAIT_MS;
    } else if (now().getTime() >= deadline) {
      return { sent: false, reason: `"${workflow}" has not finished for ${tag} after ${NOTIFY_WAIT_MS / 60_000} minutes.${at}` };
    }
    beat();
    await deps.sleep(NOTIFY_POLL_MS);
  }
}

/**
 * Releases the draft the caller names. Until its tag exists that takes the
 * review of it on this machine. Each step is written to status.json before and
 * after, and each is safe to repeat, so running the command again resumes.
 * 0. review: main and this checkout are at the reviewed commit with nothing uncommitted, git still derives
 *    the same review, the page, email and pictures in the review directory are byte for byte what that
 *    review gives, the video is the one shown, and the last release is an ancestor of the base. A refusal
 *    fails at `review`.
 * 1. checks: the client's checks workflow passed on the commit. Waits up to 20 minutes, then makes sure
 *    main and review.json still name this draft, so an undo during the wait stops the deploy.
 * 2. deploy: note the deployment a rollback returns to, then deploy the commit's own tree. If the
 *    deploy command fails once it has started, production may already serve the new version, so the
 *    probes run anyway: all passing means it took, and any failing rolls back and stops here.
 * 3. live: run the probes. A production failure rolls back. So does a draft that was taken back
 *    while the deploy and the probes ran: main and review.json are read once more before the tag.
 *    A rehearsal ends here.
 * 4. record: the annotated tag, pushed. A quiet release ends here.
 * 5. email: publish the GitHub Release, which starts Notify release, and wait for that run.
 * Once the tag exists at the commit, that release is already live and checked. Steps 1 to 3 are skipped,
 * step 0 reads git alone (see afterTag), and review.json is no longer needed.
 */
export async function runRelease(deps: Deps, input: { rehearsal: boolean; commit: string; review?: string }): Promise<RunOutcome> {
  const { config, git, pages, log, review: dir } = deps;
  const production = !input.rehearsal;
  const { project } = config.release.deploy;
  /** A refusal before this run has anything to do with the review directory: status.json stays as it is. */
  const refuse = (reason: string): RunOutcome => ({ kind: 'failed', at: 'review', reason, rolledBack: false });

  const told = input.commit;
  if (!/^[0-9a-f]{7,40}$/.test(told)) return refuse(`--commit must be the draft's commit id, or its first 7 or more characters, got "${told}". \`ayr release draft\` prints it.`);
  let held: Review | null = null;
  let unreadable: string | null = null;
  try {
    const bytes = dir.read(REVIEW_FILE);
    held = bytes ? parseReview(new TextDecoder().decode(bytes)) : null;
  } catch (error) {
    unreadable = `${message(error)} ${REBUILD}`;
  }
  // Two threads can share this directory. The owner's "send it" was about one commit, so the
  // caller names it, and a review of any other draft is not released on that word.
  const onDisk = held?.commit.startsWith(told) ? held : null;
  // A press from the review page names the review it was made on. The same draft rebuilt since, with other pictures, is not it.
  if (input.review !== undefined && (!onDisk || reviewDigest(onDisk) !== input.review)) {
    return refuse('The review was rebuilt after the owner pressed Release, so it is not the one they read. Nothing was deployed. Show them the new page and ask again.');
  }
  try {
    if (onDisk && told.length < 40) await git.resolve(told);
  } catch (error) {
    return refuse(message(error));
  }
  // A draft that is already tagged needs no review here: git holds everything but the recording.
  const shipped = onDisk || !production ? null : await taggedDraft(git, told);
  if (!onDisk && !shipped) {
    if (!held) return refuse(unreadable ?? NO_REVIEW);
    const [here, named] = short(held.commit) === told.slice(0, 7) ? [held.commit, told] : [short(held.commit), told.slice(0, 7)];
    return refuse(`The review on this machine is of ${here}, not the ${named} you were told to release. Run \`ayr release draft\` to see what is waiting.`);
  }
  const target = onDisk ?? (shipped ? { commit: shipped.commit, tag: releaseTag(shipped.date, shipped.commit) } : null);
  if (!target) return refuse(NO_REVIEW); // not reached: one of the two is set by now
  const { commit, tag } = target;

  const status: Status = { version: 1, state: 'releasing', tag, steps: [], updatedAt: '' };
  const save = (): void => {
    // status.json is the page's, and the page here is this draft's only when its review is here.
    if (!onDisk) return;
    status.updatedAt = deps.now().toISOString();
    dir.write(STATUS_FILE, json(status));
  };
  const mark = (id: StepId, state: StepState, detail?: string): void => {
    const step = status.steps.find(found => found.id === id);
    if (!step) return;
    step.state = state;
    step.label = stepLabel(id, state);
    if (detail) step.detail = detail;
    save();
  };
  const fail = (at: FailedAt, reason: string, rolledBack = false): RunOutcome => {
    status.state = 'failed';
    status.failure = { at, reason, rolledBack };
    if (at !== 'review') mark(at, 'failed');
    else save();
    log('release.failed', { tag, at, reason, rolledBack });
    return { kind: 'failed', at, reason, rolledBack };
  };
  /** Runs one step with its status around it. A throw is that step's failure. */
  const attempt = async <T>(id: StepId, work: () => Promise<T>): Promise<{ value: T } | { failed: RunOutcome }> => {
    mark(id, 'now');
    try {
      return { value: await work() };
    } catch (error) {
      return { failed: fail(id, message(error)) };
    }
  };

  // 0. The review against git. Everything after this uses what is derived here.
  let tagged: boolean;
  let checked: string | Checked;
  try {
    tagged = shipped !== null || (production && (await git.tagged(tag)) === commit);
    checked = tagged || !onDisk ? await afterTag(deps, commit, onDisk) : await preflight(deps, onDisk);
  } catch (error) {
    return fail('review', message(error));
  }
  if (typeof checked === 'string') return fail('review', checked);
  const { review, entry, email, media, recorded } = checked;

  const ids: StepId[] = !production ? ['checks', 'deploy', 'live'] : entry ? ['checks', 'deploy', 'live', 'record', 'email'] : ['checks', 'deploy', 'live', 'record'];
  status.steps = ids.map(id => {
    const state: StepState = tagged && id !== 'record' && id !== 'email' ? 'ok' : 'wait';
    return { id, label: stepLabel(id, state), state };
  });
  save();

  if (!tagged) {
    // 1. Checks, then the draft once more: it must still be the one on main and in the review directory.
    const checks = await attempt('checks', async () => (await awaitChecks(deps, commit, save)) ?? stillReviewed(deps, review));
    if ('failed' in checks) return checks.failed;
    if (checks.value) return fail('checks', checks.value);
    mark('checks', 'ok');

    // 2. Deploy.
    mark('deploy', 'now');
    let previous: string | null;
    let root: string;
    try {
      previous = production ? await pages.productionDeployment(project, commit, (await git.lastRelease(tag))?.commit ?? null) : null;
      root = await git.checkout(commit);
    } catch (error) {
      return fail('deploy', production ? `${message(error)} Nothing was deployed, so production is as it was.` : message(error));
    }
    // A site that builds is built in the release's own checkout, so what deploys is this commit's build.
    try {
      for (const command of config.release.deploy.build) await git.runIn(root, command);
    } catch (error) {
      await git.drop(root).catch((dropped: unknown) => log('release.drop-failed', { root, reason: message(dropped) }));
      return fail('deploy', `The build failed: ${message(error)} Nothing was deployed${production ? ', so production is as it was' : ''}.`);
    }
    let deployed: { id: string | null; url: string } | null = null;
    let deployError: string | null = null;
    try {
      deployed = await pages.deploy({ project, root, dir: config.release.deploy.dir, branch: production ? 'main' : REHEARSAL_BRANCH, commit });
    } catch (error) {
      // Once wrangler has started, a throw is not proof that nothing changed. In production the live site settles it.
      deployError = message(error);
    }
    await git.drop(root).catch((error: unknown) => log('release.drop-failed', { root, reason: message(error) }));
    if (!deployed && !production) return fail('deploy', deployError ?? 'The deploy named no deployment.');
    const url = deployed?.url ?? config.site;
    log('release.deployed', { deployment: deployed?.id ?? null, url, previous, deployError });

    /** Puts production back on `previous` and fails at `at`. `left` is where things stand if that can't be done. */
    const rollBack = async (at: 'deploy' | 'live', why: string, left: string): Promise<RunOutcome> => {
      if (!previous) return fail(at, `${why} There is no earlier deployment to roll back to, so ${left}.`);
      try {
        await pages.rollback(project, previous);
      } catch (error) {
        return fail(at, `${why} The rollback failed too, so ${left}: ${message(error)}`);
      }
      return fail(at, `${why} Rolled back to the previous version.`, true);
    };

    // 3. Check it live, and roll production back if any check fails. First Cloudflare must say that
    // production serves this commit, whatever the deploy command reported. The probes can't say it: a
    // release with no picture and no history page probes only text the old page has too. So a command
    // that failed after the upload was accepted, or one that succeeded into a preview because the
    // project's production branch isn't main, is never taken for a release.
    const probes = production ? review.probes : retarget(review.probes, config.site, url);
    const count = `${probes.length} ${probes.length === 1 ? 'check' : 'checks'}`;
    const runProbes = (): Promise<ProbeResult[]> => deps.runProbes(probes, deps.now().getTime() + VERIFY_DEADLINE_MS);
    if (production) {
      const said = deployError ? `The deploy command failed: ${deployError}` : 'The deploy command finished, but';
      let serves = false;
      try {
        // A deployment Cloudflare accepted can take a moment to become production.
        const deadline = deps.now().getTime() + SERVING_WAIT_MS;
        for (;;) {
          serves = (await pages.productionCommit(project)) === commit;
          if (serves || deps.now().getTime() >= deadline) break;
          await deps.sleep(SERVING_POLL_MS);
        }
      } catch (error) {
        return fail('deploy', deployError
          ? `${said} Cloudflare could not say which version production serves: ${message(error)} Production may be on either version. Run this again: it deploys the same commit and checks it live.`
          : `${said} Cloudflare could not say which version production serves: ${message(error)} Nothing was tagged or sent. Run this again: it deploys the same commit and checks it live.`);
      }
      if (!serves) {
        return fail('deploy', deployError
          ? `${said} A minute later Cloudflare still serves the version production had. If Cloudflare accepted the upload it can still go live, so look at the project's deployments, or run this again: it deploys the same commit and checks it live.`
          : `${said} a minute later Cloudflare's production still serves another version. It may have made a preview: check that the project's production branch is main. Nothing was tagged or sent.`);
      }
    }
    if (deployError) {
      const failed = `The deploy command failed: ${deployError}`;
      let results: ProbeResult[];
      try {
        results = await runProbes();
      } catch (error) {
        return fail('deploy', `${failed} The live site could not be checked either: ${message(error)} Production may be on either version. Run this again: it deploys the same commit and checks it live.`);
      }
      if (results.some(result => !result.ok)) {
        return rollBack('deploy', `${failed} The live site did not pass its checks: ${deps.derive.describeFailures(results)}`, 'production may be on either version');
      }
      mark('deploy', 'ok', `The deploy command reported an error, but Cloudflare serves the new version and it passed its checks: ${deployError}`);
    } else {
      mark('deploy', 'ok', production ? config.site : url);
      const probed = await attempt('live', runProbes);
      if ('failed' in probed) return probed.failed;
      if (probed.value.some(result => !result.ok)) {
        const failures = deps.derive.describeFailures(probed.value);
        return production ? rollBack('live', failures, 'the new version is live and failing') : fail('live', failures);
      }
    }
    if (production) {
      // The tag and the email can't be taken back, so the draft is checked once more before them.
      let withdrawn: string | null;
      try {
        withdrawn = await takenBack(deps, review);
      } catch (error) {
        return fail('live', `The new version is live and passed its checks, but git could not say whether the draft is still on main: ${message(error)} Nothing was tagged or sent. Run this again.`);
      }
      if (withdrawn) return rollBack('live', `The draft was taken back while the release ran: ${withdrawn}. Nothing was tagged or sent.`, 'the new version is still live');
    }
    mark('live', 'ok', count);

    if (!production) {
      status.state = 'rehearsed';
      status.links = { site: url };
      save();
      log('release.rehearsed', { tag, url });
      return { kind: 'rehearsed', url };
    }
  }

  // 4. Record: the tag. From here the release is live, checked and permanent.
  mark('record', 'now');
  try {
    await git.tag(tag, commit, `Production deploy — ${review.heading ?? 'quiet release'}`);
  } catch (error) {
    return fail('record', `Live, nothing sent. ${message(error)}`);
  }
  mark('record', 'ok', tag);
  if (!entry) {
    status.state = 'done';
    status.links = { site: config.site };
    save();
    log('release.done', { tag, sent: false });
    return { kind: 'done', tag, sent: false };
  }

  // 5. Email: the GitHub Release, then the workflow its publishing starts.
  mark('email', 'now');
  let sent: Awaited<ReturnType<typeof awaitNotify>>;
  let attached = true;
  try {
    const release = await deps.github.release(tag, `${config.noun} — ${entry.heading}`, email ?? entryText(entry), media);
    attached = release.video;
    sent = await awaitNotify(deps, tag, release.made === 'already', save);
  } catch (error) {
    sent = { sent: false, reason: message(error) };
  }
  if (!sent.sent) return fail('email', `Live and tagged. The client email is not confirmed. ${sent.reason}`);
  // The email was reviewed with a recording, this machine no longer has it, and the Release holds none.
  const recordingLost = media.video === 'keep' && recorded && !attached;
  mark('email', 'ok', `${review.to.join(', ')}${recordingLost ? '. Sent without the recording, which was lost with the review directory.' : ''}`);
  status.state = 'done';
  status.links = { site: config.site, release: `https://github.com/${review.repo}/releases/tag/${tag}`, ...(sent.url ? { run: sent.url } : {}) };
  save();
  log('release.done', { tag, sent: true, recordingLost });
  return { kind: 'done', tag, sent: true, ...(recordingLost ? { recordingLost: true as const } : {}) };
}

// ── ayr release status ─────────────────────────────────────────────────────

/** Where a client's releases stand on origin's main. Nothing in it comes from the working tree. */
export interface Standing {
  lastRelease: { tag: ProdTag; commit: Sha } | null;
  main: Sha;
  /** The newest unreleased draft since the last release. With none, main's tip when it is a tagged draft. */
  draft: {
    commit: Sha;
    tag: ProdTag;
    date: IsoDate;
    heading: string | null; // null for a quiet release
    released: boolean;
    atTip: boolean; // false: main moved past it, so it has to be undone
    reviewOnThisMachine: boolean;
  } | null;
  changeFiles: string[]; // changes/*.md on main, waiting for the next draft
}

/**
 * Reads only: one fetch of main and the release tags, then git and review.json.
 * It works from any checkout of the repo, on any branch, clean or not.
 */
export async function runStatus(deps: Pick<Deps, 'git' | 'review'>): Promise<Standing> {
  const { git } = deps;
  const main = await git.main();
  const lastRelease = await git.lastRelease();
  const [open] = (await git.drafts(lastRelease?.commit ?? null, main)).filter(draft => !draft.released);
  const atTip = open ? null : await git.draft(main);
  const found = open ?? (atTip?.released ? atTip : null);
  let draft: Standing['draft'] = null;
  if (found) {
    // The draft's own subject, as draftMessage wrote it.
    const [subject = ''] = await git.subjects(found.base, found.commit);
    draft = {
      commit: found.commit,
      tag: releaseTag(found.date, found.commit),
      date: found.date,
      heading: subject.startsWith('Release ') ? subject.slice('Release '.length) : null,
      released: found.released,
      atTip: found.commit === main,
      reviewOnThisMachine: reviewedCommit(deps.review) === found.commit,
    };
  }
  return { lastRelease, main, draft, changeFiles: (await git.changeFiles(main)).map(({ file }) => file) };
}
