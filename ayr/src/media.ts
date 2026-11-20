// Pictures and recordings, made from what change files declare. `ayr media`
// runs this for a look before the release, and `ayr release draft` runs it on
// the checkout it commits, so what the owner reviews was made from what ships.
//
// "After" is always the local server over the release's own files
// (config.release.serve). "Before" is always the live site, which is the last
// release. Neither depends on staging having caught up.
//
// Playwright is loaded lazily, so `ayr check` and the rest of the kit keep
// their one dependency. It is the kit's optional playwright-core. ffmpeg turns
// Playwright's webm into an H.264 mp4 that iPhone Mail plays inline (the
// devboxes have it).

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, BrowserContext, Locator, Page } from 'playwright-core';
import { pictureFile, type Change, type ChangeId, type Picture, type Recording, type SitePath, type Step, type Viewport } from './changes.ts';
import type { ClientConfig } from './config.ts';
import { imageWidth } from './lint.ts';
import { sha256Hex, type Sha256 } from './types.ts';

export const MAX_VIDEO_BYTES = 25 * 1024 * 1024; // Resend's 40 MB limit counts the encoded size, about 4/3 of the file

// A picture is laid out PICTURE_WIDTH CSS pixels wide and saved at PICTURE_SCALE times that, so it
// stays sharp on a high-density screen: the email shows it 516 CSS pixels wide, the review page
// about 730, and a laptop or phone needs two or three device pixels for each.
export const PICTURE_WIDTH = 1072;
export const PICTURE_SCALE = 2;
export const PHONE = { width: 390, height: 844, deviceScaleFactor: 3 } as const;
export const DESKTOP = { width: 1280, height: 800, deviceScaleFactor: PICTURE_SCALE } as const;
export const STEP_TIMEOUT_MS = 10_000; // how long a step waits for its text
const SHOWN_WAIT_MS = 5_000; // how long a picture waits for its section to show

const VIDEO = { width: 780, height: 1688 } as const; // screencast frames: the phone at 2x
const VIDEO_WIDTH = 720; // the mp4, scaled from VIDEO
const JPEG_QUALITY = 85;
// A compare whose shots differ in fewer than this share of pixels looks the same to a reader:
// 0.1% is about six characters of text on a phone screen, and well above rendering noise.
export const SAME_SHOT_SHARE = 0.001;
const PIXEL_TOLERANCE = 24; // per colour channel, so antialiasing alone never counts as a change
const MAX_WAIT_MS = 3000;

export interface Sites {
  live: string; // config.site
  local: string; // config.release.serve.url
}

export interface Made {
  pictures: { id: ChangeId; file: string; bytes: Uint8Array }[]; // file is its name: "2026-11-online-booking.jpg"
  video: { name: string; bytes: Uint8Array } | null; // one mp4: every recording in merge order, joined
}

export interface MediaOptions {
  stepTimeoutMs?: number;
}

export class MediaError extends Error {
  change: ChangeId;

  constructor(change: ChangeId, problem: string) {
    super(`${change}: ${problem}`);
    this.name = 'MediaError';
    this.change = change;
  }
}

// What went wrong with one picture or recording, before makeMedia knows which change it was.
class Problem extends Error {}

/**
 * Makes every picture and the one video for these changes. Throws MediaError
 * naming the change: a step whose text never appeared, a `compare` page the
 * live site doesn't have yet (use `after`), a `compare` whose Before and After
 * look the same (use `after` or `none`), a selector that matches nothing, a
 * video over the limit.
 */
export async function makeMedia(changes: Change[], sites: Sites, date: string, options: MediaOptions = {}): Promise<Made> {
  const stepTimeoutMs = options.stepTimeoutMs ?? STEP_TIMEOUT_MS;
  const items = changes.flatMap(change => (change.kind === 'item' ? [change] : []));
  if (!items.some(change => change.picture || change.recording)) return { pictures: [], video: null };

  const pictures: Made['pictures'] = [];
  const clips: Clip[] = [];
  const recorded: ChangeId[] = [];
  const browser = await launch();
  try {
    for (const change of items) {
      const about = (error: unknown) => new MediaError(change.id, problemText(error));
      if (change.picture) {
        const bytes = await shoot(browser, change.picture, sites).catch(error => { throw about(error); });
        pictures.push({ id: change.id, file: pictureFile(change.id, date), bytes });
      }
      if (change.recording) {
        clips.push(await record(browser, change.recording, sites.local, stepTimeoutMs).catch(error => { throw about(error); }));
        recorded.push(change.id);
      }
    }
  } finally {
    await browser.close();
  }

  const [first] = recorded;
  if (first === undefined) return { pictures, video: null };
  const bytes = await toMp4(clips);
  if (bytes.length > MAX_VIDEO_BYTES) {
    const size = (bytes.length / 1024 / 1024).toFixed(1);
    throw new MediaError(first, `the recording comes to ${size} MiB, over the 25 MiB limit. Fix: use fewer steps or shorter waits in ${recorded.join(', ')}.`);
  }
  return { pictures, video: { name: `update-${date}.mp4`, bytes } };
}

/**
 * One 1072px JPEG. For `compare`, both shots render into a small local HTML
 * page, labelled Before and After, and that page is screenshotted: no image
 * library needed. Animations are frozen and fonts awaited before each shot.
 */
export async function shootPicture(picture: Picture, sites: Sites): Promise<Uint8Array> {
  return withBrowser(browser => shoot(browser, picture, sites));
}

/**
 * The frames of one recording, each with how long it stays on screen.
 * Chromium's screencast sends a frame only when the page changes, at the
 * phone's own pixel density. (Playwright's recordVideo captures at CSS
 * pixels, so a phone video would be 390 wide and blurry.)
 */
export interface Clip {
  frames: { jpeg: Uint8Array; seconds: number }[];
}

/**
 * Plays the steps at phone size with a visible tap marker, pausing on each
 * `see` so a person can follow it, and returns its frames. Recording starts
 * once the page has loaded, so no blank page leads in. Steps resolve by role
 * and visible text (getByRole, getByLabel, getByText), never by selector.
 */
export async function recordSteps(recording: Recording, local: string, stepTimeoutMs = STEP_TIMEOUT_MS): Promise<Clip> {
  return withBrowser(browser => record(browser, recording, local, stepTimeoutMs));
}

/** Clips, in order → one H.264 baseline mp4 with faststart, encoded once by ffmpeg. */
export async function toMp4(clips: Clip[]): Promise<Uint8Array> {
  const frames = clips.flatMap(clip => clip.frames);
  if (frames.length === 0) throw new Error('toMp4 needs at least one frame.');
  const dir = await mkdtemp(join(tmpdir(), 'ayr-mp4-'));
  try {
    const list = ['ffconcat version 1.0'];
    for (const [index, frame] of frames.entries()) {
      const file = `${index}.jpg`;
      await writeFile(join(dir, file), frame.jpeg);
      list.push(`file ${file}`, `duration ${Math.max(frame.seconds, 0.001).toFixed(3)}`);
    }
    list.push(`file ${frames.length - 1}.jpg`); // the concat demuxer drops the last duration otherwise
    await writeFile(join(dir, 'frames.txt'), `${list.join('\n')}\n`);
    const out = join(dir, 'out.mp4');
    await ffmpeg([
      '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(dir, 'frames.txt'),
      '-vf', `scale=${VIDEO_WIDTH}:-2:flags=lanczos:out_range=tv,fps=30,format=yuv420p`, '-an',
      '-c:v', 'libx264', '-profile:v', 'baseline', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-preset', 'medium', '-crf', '24',
      '-movflags', '+faststart', out,
    ]);
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export interface Media {
  sha256: Sha256;
  bytes: number;
  type: 'image/jpeg' | 'video/mp4';
  name: string;
}

export async function describeMedia(bytes: Uint8Array, name: string, type: Media['type']): Promise<Media> {
  return { sha256: await sha256Hex(bytes), bytes: bytes.length, type, name };
}

// ── Browser ────────────────────────────────────────────────────────────────

async function launch(): Promise<Browser> {
  let playwright: typeof import('playwright-core');
  try {
    playwright = await import('playwright-core');
  } catch {
    throw new Error('Pictures and recordings need playwright-core. Run npm install where the kit lives, then npx playwright-core install chromium.');
  }
  return playwright.chromium.launch();
}

async function withBrowser<T>(use: (browser: Browser) => Promise<T>): Promise<T> {
  const browser = await launch();
  try {
    return await use(browser);
  } finally {
    await browser.close();
  }
}

function problemText(error: unknown): string {
  if (error instanceof Problem) return error.message;
  return `could not make its media: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`;
}

function size(on: Viewport) {
  const { width, height, deviceScaleFactor } = on === 'phone' ? PHONE : DESKTOP;
  return { viewport: { width, height }, deviceScaleFactor, isMobile: on === 'phone', hasTouch: on === 'phone' };
}

async function open(context: BrowserContext, base: string, path: SitePath, which: 'live' | 'local', usage: string): Promise<Page> {
  const page = await context.newPage();
  const url = new URL(path, base).href;
  const response = await page.goto(url, { waitUntil: 'load', timeout: 30_000 }).catch((error: Error) => {
    throw new Problem(`could not load ${url}: ${error.message.split('\n')[0]}`);
  });
  const status = response?.status() ?? 0;
  if (status === 404 && which === 'live') {
    throw new Problem(`the live site has no ${path} yet, so there is nothing to compare. Fix: ${usage}`);
  }
  if (status < 200 || status >= 400) throw new Problem(`the ${which} site answered ${status} for ${path}.`);
  await settle(page);
  return page;
}

// Fonts loaded, eager images decoded, the network quiet for a moment. Each wait is capped.
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  await page.evaluate(`(async () => {
    await document.fonts.ready;
    const images = [...document.images].filter(image => !image.complete && image.loading !== 'lazy');
    await Promise.race([
      Promise.all(images.map(image => image.decode().catch(() => {}))),
      new Promise(done => setTimeout(done, 5000)),
    ]);
  })()`);
}

// ── Pictures ───────────────────────────────────────────────────────────────

/** One viewport's shots for a picture: the live site's (null for `after`) and this release's. */
export interface Shots {
  on: Viewport;
  before: Uint8Array | null;
  after: Uint8Array;
}

// Not on the page at that size, or not on the live site yet.
const missing = (error: unknown) => error instanceof Problem && /matches nothing|has no \//.test(error.message);

async function shoot(browser: Browser, picture: Picture, sites: Sites): Promise<Uint8Array> {
  const section = picture.selector ? ` ${picture.selector}` : '';
  const form = (show: Picture['show'], on: Picture['on']) => `\`picture: ${show}${on === 'both' ? '' : ` ${on}`} ${picture.path}${section}\``;
  const sizes = picture.on === 'both' ? (['phone', 'desktop'] as const) : [picture.on];
  const shots: (Shots & { same: boolean })[] = [];
  for (const on of sizes) {
    const other: Viewport = on === 'phone' ? 'desktop' : 'phone';
    // Whether the other size has the section in this release.
    const otherHas = () => capture(browser, picture, other, sites.local, 'local').then(() => true, failure => {
      if (missing(failure)) return false;
      throw failure;
    });
    let after: Buffer;
    try {
      after = await capture(browser, picture, on, sites.local, 'local');
    } catch (error) {
      // Both sizes asked for, and this one doesn't have the section: name the size that does.
      if (picture.on === 'both' && missing(error) && (await otherHas())) {
        throw new Problem(`${picture.path}${section} isn't on the ${on}, only the ${other}. Fix: use ${form(picture.show, other)}.`);
      }
      throw error;
    }
    let before: Buffer | null = null;
    try {
      before = picture.show === 'compare' ? await capture(browser, picture, on, sites.live, 'live') : null;
    } catch (error) {
      // Nothing live to compare with: After it is, on both sizes when the other has the section too.
      if (error instanceof Problem && /yet, so there is nothing to compare\. Fix: /.test(error.message)) {
        throw new Problem(error.message.replace(/Fix: .*$/s, `Fix: use ${form('after', (await otherHas()) ? 'both' : on)}.`));
      }
      throw error;
    }
    shots.push({ on, before, after, same: before !== null && (await changedShare(browser, before, after)) < SAME_SHOT_SHARE });
  }
  if (shots.every(shot => shot.same)) {
    // One size named and unchanged: the change may be on the other size alone.
    const [only] = sizes;
    const elsewhere = picture.on !== 'both' && only ? only === 'phone' ? 'desktop' : 'phone' : null;
    const there = elsewhere ? await otherSizeShows(browser, picture, elsewhere, sites) : null;
    const fix = elsewhere && there === 'change' ? form('compare', elsewhere)
      : elsewhere && there === 'new' ? form('after', elsewhere)
      : `${form('after', picture.on)}, or \`picture: none\``;
    throw new Problem(`Before and After look the same on ${picture.path}${section}${elsewhere ? ` on the ${picture.on}` : ''}, so the picture shows no change. Fix: use ${fix}.`);
  }
  // With both, a size that didn't change would be a Before and After that look the same: show only the one that did.
  const same = shots.find(shot => shot.same);
  const changed = shots.find(shot => !shot.same);
  if (same && changed) {
    throw new Problem(`Before and After look the same on the ${same.on} on ${picture.path}${section}, so only the ${changed.on} shows the change. Fix: use ${form('compare', changed.on)}.`);
  }
  // One size named: the client looks at their site on both, so it must not leave the other out.
  const [named] = sizes;
  if (picture.on !== 'both' && named) {
    const other: Viewport = named === 'phone' ? 'desktop' : 'phone';
    const shows = await otherSizeShows(browser, picture, other, sites);
    if (shows === 'change') throw new Problem(`The change also shows on the ${other}, and the client looks at both. Fix: use ${form('compare', 'both')}.`);
    if (shows === 'section') throw new Problem(`${picture.path}${section} also shows on the ${other}, and the client looks at both. Fix: use ${form('after', 'both')}.`);
    // Without a Before on the other size, both sizes can only show how they look now.
    if (shows === 'new') throw new Problem(`${picture.path}${section} is new on the ${other}, and the client looks at both. Fix: use ${form('after', 'both')}.`);
  }
  return compose(browser, composeHtml(shots));
}

/**
 * What a picture limited to one size would leave out on the other: the change (`compare`), the section
 * as it is now (`after`, when that size changed or is new), or a section new on that size, which has
 * no Before there. Null: nothing, since that size doesn't show the section or didn't change.
 */
async function otherSizeShows(browser: Browser, picture: Picture, on: Viewport, sites: Sites): Promise<'change' | 'section' | 'new' | null> {
  let after: Buffer;
  try {
    after = await capture(browser, picture, on, sites.local, 'local');
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
  let before: Buffer;
  try {
    before = await capture(browser, picture, on, sites.live, 'live');
  } catch (error) {
    if (missing(error)) return picture.show === 'after' ? 'section' : 'new';
    throw error;
  }
  if ((await changedShare(browser, before, after)) < SAME_SHOT_SHARE) return null;
  return picture.show === 'after' ? 'section' : 'change';
}

/**
 * The share of pixels that differ between two PNGs, decoded and compared in
 * the browser with canvas getImageData, so no image library is needed. Shots
 * of different sizes differ entirely.
 */
async function changedShare(browser: Browser, a: Uint8Array, b: Uint8Array): Promise<number> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const src = (png: Uint8Array) => `data:image/png;base64,${Buffer.from(png).toString('base64')}`;
    await page.setContent(`<img src="${src(a)}"><img src="${src(b)}">`, { waitUntil: 'load' });
    return Number(await page.evaluate(`(async () => {
      const [a, b] = [...document.images];
      await Promise.all([a.decode(), b.decode()]);
      const width = a.naturalWidth, height = a.naturalHeight;
      if (width !== b.naturalWidth || height !== b.naturalHeight || width * height === 0) return 1;
      const pixels = image => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, width, height).data;
      };
      const [x, y] = [pixels(a), pixels(b)];
      let changed = 0;
      for (let i = 0; i < x.length; i += 4) {
        if (Math.abs(x[i] - y[i]) > ${PIXEL_TOLERANCE} || Math.abs(x[i + 1] - y[i + 1]) > ${PIXEL_TOLERANCE}
          || Math.abs(x[i + 2] - y[i + 2]) > ${PIXEL_TOLERANCE} || Math.abs(x[i + 3] - y[i + 3]) > ${PIXEL_TOLERANCE}) changed += 1;
      }
      return changed / (width * height);
    })()`));
  } finally {
    await context.close();
  }
}

// A PNG of the first screen, or of the selected element, at the viewport's own pixel ratio.
async function capture(browser: Browser, picture: Picture, on: Viewport, base: string, which: 'live' | 'local'): Promise<Buffer> {
  const context = await browser.newContext({ ...size(on), reducedMotion: 'reduce' });
  try {
    const usage = `use \`picture: after${picture.on === 'both' ? '' : ` ${picture.on}`} ${picture.path}${picture.selector ? ` ${picture.selector}` : ''}\`.`;
    const page = await open(context, base, picture.path, which, usage);
    if (picture.selector === null) return await page.screenshot({ type: 'png', animations: 'disabled' });
    const matches = page.locator(picture.selector);
    // Counting checks the selector parses.
    await matches.count().catch(() => {
      throw new Problem(`"${picture.selector}" is not a valid selector. Fix: use a CSS selector such as #book.`);
    });
    // Only a match the page shows at this size counts: a section a phone layout hides isn't on the desktop.
    // One that appears a moment after the page settles still counts, so wait a little for it.
    const element = matches.filter({ visible: true });
    // A section inserted late counts too, so wait even when nothing matches yet.
    const shown = await element.first().waitFor({ state: 'visible', timeout: SHOWN_WAIT_MS }).then(() => true, () => false);
    if (!shown && which === 'live') {
      throw new Problem(`"${picture.selector}" matches nothing on the live ${picture.path} yet, so there is nothing to compare. Fix: ${usage}`);
    }
    if (!shown) {
      throw new Problem(`"${picture.selector}" matches nothing on ${picture.path} on the ${on}. Fix: point the picture at an element that page shows.`);
    }
    // A bar pinned to the screen (a sticky header, a phone's call button) would sit on top of the
    // element in the shot. Hide every pinned element that isn't part of the element itself.
    // The shot is of the first match the page shows, so mark that one: an earlier hidden match isn't it.
    await element.first().evaluate((target: { setAttribute(name: string, value: string): void }) => target.setAttribute('data-ayr-shot', ''));
    await page.evaluate(`(() => {
      const target = document.querySelector('[data-ayr-shot]');
      for (const other of document.querySelectorAll('body *')) {
        const position = getComputedStyle(other).position;
        if ((position === 'fixed' || position === 'sticky') && !other.contains(target) && !target.contains(other)) {
          other.style.setProperty('visibility', 'hidden', 'important');
        }
      }
    })()`);
    return await element.first().screenshot({ type: 'png', animations: 'disabled' });
  } finally {
    await context.close();
  }
}

/**
 * The page that becomes the picture: PICTURE_WIDTH CSS pixels wide, shot at a
 * pixel ratio of PICTURE_SCALE. Each shot shows at its own pixel size, scaled
 * down when wider than its column and never up; narrower ones sit centred. Phones compare side by side with an arrow from Before to After,
 * desktops one above the other with an arrow down. Before is framed in grey
 * and labelled "Old version", After in green and "New version", so the two
 * can't be mixed up at a glance. With more than one size, each gets a Phone or
 * Desktop heading, and a phone shown alone takes half the width so it doesn't
 * tower over the desktop.
 */
export function composeHtml(shots: Shots[]): string {
  const src = (png: Uint8Array) => `data:image/png;base64,${Buffer.from(png).toString('base64')}`;
  const LABELS = { before: ['Before', 'Old version'], after: ['After', 'New version'] } as const;
  const figure = (label: 'before' | 'after' | null, png: Uint8Array) => {
    const caption = label ? `<figcaption class="${label}"><strong>${LABELS[label][0]}</strong><span>${LABELS[label][1]}</span></figcaption>` : '';
    // A shot shows at one of its pixels per picture pixel, or smaller to fit: never stretched.
    const natural = imageWidth(png);
    const width = natural ? ` style="width: ${natural / PICTURE_SCALE}px"` : '';
    return `<figure${label ? ` class="${label}"` : ''}>${caption}<img src="${src(png)}"${width} alt=""></figure>`;
  };
  const titled = shots.length > 1;
  const sections = shots.map(({ on, before, after }) => {
    const side = before !== null && on === 'phone';
    const columns = side ? '1fr 48px 1fr' : '1fr';
    // Drawn, not a font glyph: a glyph sits on its text baseline, low and off centre in the circle.
    const arrow = `<div class="arrow ${side ? 'right' : 'down'}" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg></div>`;
    const narrow = titled && !before && on === 'phone' ? ' narrow' : '';
    const heading = titled ? `<h2>${on === 'phone' ? 'Phone' : 'Desktop'}</h2>` : '';
    const body = before ? figure('before', before) + arrow + figure('after', after) : figure(null, after);
    return `<section>${heading}<main class="${before ? 'compare' : 'after'}${narrow}" style="grid-template-columns: ${columns};">${body}</main></section>`;
  });
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html, body { margin: 0; background: #fff; }
body { width: ${PICTURE_WIDTH}px; font: 700 22px/1 "Helvetica Neue", Arial, "Liberation Sans", sans-serif; }
section + section { margin-top: 36px; }
h2 { margin: 0 0 12px; font-size: 28px; color: #1c1d20; }
main { display: grid; gap: 12px; align-items: center; }
main.narrow figure { width: 50%; justify-self: center; }
figure { margin: 0; min-width: 0; display: flex; flex-direction: column; align-items: center; align-self: start; }
img { display: block; max-width: 100%; height: auto; }
main.compare figure { border: 4px solid; border-radius: 10px; overflow: hidden; background: #fff; }
main.compare figure.before { border-color: #8b9099; }
main.compare figure.after { border-color: #15803d; }
figcaption { align-self: stretch; display: flex; align-items: baseline; gap: 12px; padding: 12px 16px; color: #fff; }
figcaption strong { font-size: 30px; letter-spacing: 0.04em; text-transform: uppercase; }
figcaption span { font-size: 20px; font-weight: 400; opacity: 0.9; }
figcaption.before { background: #8b9099; }
figcaption.after { background: #15803d; }
.arrow { justify-self: center; align-self: center; display: grid; place-items: center; width: 48px; height: 48px; border-radius: 50%; background: #15803d; }
.arrow svg { width: 28px; height: 28px; fill: none; stroke: #fff; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
.arrow.down svg { transform: rotate(90deg); }
</style></head><body>${sections.join('')}</body></html>`;
}

async function compose(browser: Browser, html: string): Promise<Uint8Array> {
  const context = await browser.newContext({ viewport: { width: PICTURE_WIDTH, height: 200 }, deviceScaleFactor: PICTURE_SCALE });
  try {
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate('Promise.all([...document.images].map(image => image.decode()))');
    return await page.screenshot({ type: 'jpeg', quality: JPEG_QUALITY, fullPage: true });
  } finally {
    await context.close();
  }
}

// ── Recordings ─────────────────────────────────────────────────────────────

export function describeStep(step: Step): string {
  switch (step.do) {
    case 'tap': return `tap "${step.text}"`;
    case 'type': return `type "${step.field}" "${step.text}"`;
    case 'see': return `see "${step.text}"`;
    case 'scroll': return `scroll "${step.text}"`;
    case 'wait': return `wait ${step.ms}`;
    case 'back': return 'back';
  }
}

interface ScreencastFrame {
  data: string; // base64 JPEG
  sessionId: number;
  metadata: { timestamp?: number }; // seconds
}

async function record(browser: Browser, recording: Recording, local: string, timeout: number): Promise<Clip> {
  const context = await browser.newContext(size('phone'));
  try {
    const page = await open(context, local, recording.start, 'local', '');
    const cdp = await context.newCDPSession(page);
    const shots: { jpeg: Uint8Array; at: number }[] = [];
    cdp.on('Page.screencastFrame', (frame: ScreencastFrame) => {
      shots.push({ jpeg: Buffer.from(frame.data, 'base64'), at: frame.metadata.timestamp ?? Date.now() / 1000 });
      cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: VIDEO.width, maxHeight: VIDEO.height });
    await page.waitForTimeout(800);
    for (const [index, step] of recording.steps.entries()) {
      await play(page, step, timeout).catch(error => {
        if (error instanceof Problem) throw new Problem(`step ${index + 1} (${describeStep(step)}) on ${recording.start}: ${error.message}`);
        throw error;
      });
    }
    await page.waitForTimeout(600);
    await cdp.send('Page.stopScreencast');
    const end = Date.now() / 1000;
    if (shots.length === 0) throw new Error('Chromium sent no frames.');
    return { frames: shots.map((shot, i) => ({ jpeg: shot.jpeg, seconds: (shots[i + 1]?.at ?? end) - shot.at })) };
  } finally {
    await context.close();
  }
}

async function play(page: Page, step: Step, timeout: number): Promise<void> {
  switch (step.do) {
    case 'tap': {
      const target = await find(page, clickable(page, step.text), timeout, `nothing visible says "${step.text}"`, 'use the words the button or link shows.');
      await tap(page, target);
      return;
    }
    case 'type': {
      const field = await find(page, fields(page, step.field), timeout, `no field is labelled "${step.field}"`, 'use the field\'s label or placeholder as the page shows it.');
      await tap(page, field);
      await field.fill('');
      await field.pressSequentially(step.text, { delay: 60 });
      await page.waitForTimeout(300);
      return;
    }
    case 'see': {
      const text = await find(page, [page.getByText(step.text, { exact: true }), page.getByText(step.text)], timeout, `"${step.text}" never appeared`, 'use words the page shows once the steps before it are done.');
      await text.scrollIntoViewIfNeeded();
      await page.waitForTimeout(1000);
      return;
    }
    case 'scroll': {
      const text = await find(page, [page.getByRole('heading', { name: step.text }), page.getByText(step.text, { exact: true }), page.getByText(step.text)], timeout, `nothing visible says "${step.text}"`, 'use a heading or words the page shows.');
      await text.evaluate((element: { scrollIntoView(options: { behavior: string; block: string }): void }) => element.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      await page.waitForTimeout(900);
      return;
    }
    case 'wait':
      await page.waitForTimeout(Math.min(step.ms, MAX_WAIT_MS));
      return;
    case 'back':
      await page.goBack({ waitUntil: 'load' });
      await settle(page);
      return;
  }
}

// Most specific first: an exact button or link name beats text that merely contains the words.
function clickable(page: Page, text: string): Locator[] {
  return [
    page.getByRole('button', { name: text, exact: true }),
    page.getByRole('link', { name: text, exact: true }),
    page.getByRole('tab', { name: text, exact: true }),
    page.getByRole('option', { name: text, exact: true }),
    page.getByLabel(text, { exact: true }),
    page.getByText(text, { exact: true }),
    page.getByRole('button', { name: text }),
    page.getByRole('link', { name: text }),
    page.getByText(text),
  ];
}

function fields(page: Page, label: string): Locator[] {
  return [
    page.getByLabel(label, { exact: true }),
    page.getByRole('textbox', { name: label, exact: true }),
    page.getByPlaceholder(label, { exact: true }),
    page.getByLabel(label),
    page.getByPlaceholder(label),
  ];
}

// Waits until any candidate is visible, then takes the first candidate, in order, that is.
async function find(page: Page, candidates: Locator[], timeout: number, missing: string, fix: string): Promise<Locator> {
  const visible = candidates.map(candidate => candidate.filter({ visible: true }));
  const any = visible.reduce((all, next) => all.or(next));
  try {
    await any.first().waitFor({ state: 'visible', timeout });
  } catch {
    throw new Problem(`${missing} within ${Math.round(timeout / 1000)} s. Fix: ${fix}`);
  }
  for (const candidate of visible) if ((await candidate.count()) > 0) return candidate.first();
  return any.first();
}

// A ring appears where the finger lands, then the tap, then the ring fades.
async function tap(page: Page, target: Locator): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (box) {
    const x = Math.round(box.x + box.width / 2);
    const y = Math.round(box.y + box.height / 2);
    await page.evaluate(`(() => {
      const ring = document.createElement('div');
      ring.style.cssText = 'position:fixed;left:${x - 22}px;top:${y - 22}px;width:44px;height:44px;border-radius:50%;' +
        'background:rgba(28,29,32,.3);border:3px solid #fff;box-shadow:0 0 0 2px rgba(28,29,32,.55);' +
        'z-index:2147483647;pointer-events:none;transform:scale(.5);transition:transform .25s,opacity .5s';
      document.documentElement.append(ring);
      requestAnimationFrame(() => requestAnimationFrame(() => { ring.style.transform = 'scale(1)'; }));
      setTimeout(() => { ring.style.opacity = '0'; }, 650);
      setTimeout(() => ring.remove(), 1200);
    })()`);
    await page.waitForTimeout(400);
  }
  await target.tap();
  await page.waitForTimeout(600);
}

// ── Video ──────────────────────────────────────────────────────────────────

function ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.FFMPEG ?? 'ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-2000); });
    child.on('error', (error: NodeJS.ErrnoException) => {
      reject(error.code === 'ENOENT' ? new Error('ffmpeg is not installed. Install it, or set FFMPEG to its path.') : error);
    });
    child.on('close', code => (code === 0 ? resolve() : reject(new Error(`ffmpeg failed (exit ${code}): ${stderr.trim()}`))));
  });
}
