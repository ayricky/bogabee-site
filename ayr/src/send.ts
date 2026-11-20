// Every email the kit sends goes through postEmail. Every refusal happens
// before the request, and every failure throws, so a send can never look like
// a quiet success.

import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { isMailbox, mailboxAddress, type ClientConfig } from './config.ts';
import { checkEntries, onDomain } from './lint.ts';
import { marked, type Tokens } from 'marked';
import { parseNotes } from './notes.ts';
import { renderRelease } from './render.ts';

interface SendInput {
  config: ClientConfig;
  notes: string;
  tag: string;
  to?: string; // comma-separated; falls back to config.release.to, then NOTIFY_EMAILS
  videos?: string[]; // file paths
  pictures?: string[]; // file paths: each one the note shows from its Release, by file name
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
}

export const RESEND_URL = 'https://api.resend.com/emails';
/** What every attachment together may come to: Resend's 40 MB counts the encoded size, about 4/3 of the files. */
export const MAX_VIDEO_BYTES = 25 * 1024 * 1024;

/** What Resend receives, already rendered. */
export interface Outgoing {
  from: string;
  replyTo: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  /** With `contentId`, the email's HTML shows it inline as cid:<contentId>. */
  attachments: { filename: string; content: Uint8Array; contentId?: string }[];
}

export function resendKey(env: Record<string, string | undefined>): string {
  const key = env.RESEND_API_KEY;
  if (!key || /\s/.test(key)) throw new Error('Refusing to send: RESEND_API_KEY is not set, or has whitespace in it.');
  return key;
}

// Each address once, whatever its case or display name.
function splitRecipients(list: string | undefined): string[] {
  const addresses = (list ?? '').split(',').map(address => address.trim()).filter(Boolean);
  const bad = addresses.filter(address => !isMailbox(address));
  if (bad.length > 0) throw new Error(`Refusing to send: not an email address: ${bad.join(', ')}.`);
  const seen = new Set<string>();
  return addresses.filter(address => {
    const key = mailboxAddress(address);
    return !seen.has(key) && seen.add(key);
  });
}

async function refuseLarge(files: string[]): Promise<void> {
  const sizes = await Promise.all(files.map(async path => (await stat(path)).size));
  const total = sizes.reduce((sum, size) => sum + size, 0);
  if (total > MAX_VIDEO_BYTES) {
    const mebibytes = Math.ceil(total / (1024 * 1024));
    throw new Error(`Refusing to send: ${files.join(', ')} come to ${mebibytes} MiB, over the 25 MiB limit.`);
  }
}

/** The address a Release asset of this tag has: how the email's note names each picture. */
function releaseAsset(repo: string | undefined, tag: string, url: string): string | null {
  const prefix = `https://github.com/${repo}/releases/download/${tag}/`;
  return repo && url.startsWith(prefix) && !url.slice(prefix.length).includes('/') ? decodeURIComponent(url.slice(prefix.length)) : null;
}

/**
 * One POST to Resend with the Idempotency-Key, so a rerun inside 24 hours
 * never sends twice. Returns Resend's email id.
 */
export async function postEmail(outgoing: Outgoing, { key, idempotencyKey, fetch }: {
  key: string;
  idempotencyKey: string;
  fetch: typeof globalThis.fetch;
}): Promise<string> {
  const response = await fetch(RESEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({
      from: outgoing.from,
      to: outgoing.to,
      reply_to: outgoing.replyTo,
      subject: outgoing.subject,
      html: outgoing.html,
      text: outgoing.text,
      ...(outgoing.attachments.length > 0
        ? { attachments: outgoing.attachments.map(({ filename, content, contentId }) => ({ filename, content: Buffer.from(content).toString('base64'), ...(contentId ? { content_id: contentId } : {}) })) }
        : {}),
    }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Resend returned ${response.status}: ${body}`);
  let id: unknown;
  try {
    id = (JSON.parse(body) as { id?: unknown }).id;
  } catch {
    id = undefined;
  }
  if (typeof id !== 'string' || id === '') throw new Error(`Resend returned no email id: ${body}`);
  return id;
}

export async function sendRelease({ config, notes, tag, to, videos = [], pictures = [], env, fetch }: SendInput): Promise<string> {
  if (!/^prod-\S+$/.test(tag)) throw new Error(`Refusing to send: tag "${tag}" does not match prod-*.`);
  const key = resendKey(env);
  const recipients = splitRecipients(to ?? (config.release ? config.release.to.join(',') : env.NOTIFY_EMAILS));
  if (recipients.length === 0) throw new Error('Refusing to send: no recipients. Pass --to, set release.to in the client config, or set NOTIFY_EMAILS.');

  const entries = parseNotes(notes);
  const [entry] = entries;
  if (!entry) throw new Error('Refusing to send: the notes contain no entries.');
  const errors = checkEntries(entries, config).filter(finding => finding.severity === 'error');
  if (errors.length > 0) {
    const list = errors.map(finding => `  line ${finding.line} ${finding.rule}: ${finding.message}`).join('\n');
    throw new Error(`Refusing to send: "${entry.heading}" fails ayr check.\n${list}`);
  }

  // Each picture the note shows from this release's assets goes in the email itself, shown inline, and
  // each one given is shown: a picture missing or extra would send an email that isn't the reviewed one.
  // Every image the renderer will see, reference-style ones included, not only the inline syntax.
  const images: string[] = [];
  marked.walkTokens(marked.lexer(entry.body, { gfm: true }), token => {
    if (token.type === 'image') images.push((token as Tokens.Image).href);
  });
  const shown = new Map<string, string>(); // file name → the URL the note names it by
  for (const url of images) {
    const name = releaseAsset(config.repo, tag, url);
    if (name) shown.set(name, url);
  }
  const given = new Map(pictures.map(path => [basename(path), path]));
  const missing = [...shown.keys()].filter(name => !given.has(name));
  if (missing.length > 0) throw new Error(`Refusing to send: the note shows ${missing.join(', ')}, and no such picture was given. Pass each with --picture.`);
  const extra = [...given.keys()].filter(name => !shown.has(name));
  if (extra.length > 0) throw new Error(`Refusing to send: ${extra.join(', ')} ${extra.length === 1 ? 'is' : 'are'} not in the note.`);


  await refuseLarge([...pictures, ...videos]);
  const inline = await Promise.all([...shown].map(async ([name]) => ({ filename: name, content: await readFile(given.get(name) ?? ''), contentId: name })));
  const attached = await Promise.all(videos.map(async path => ({ filename: basename(path), content: await readFile(path) })));
  const email = renderRelease(config, entry, { hasVideo: attached.length > 0 });
  let { html, text } = email;
  for (const [name, url] of shown) {
    html = html.replaceAll(`src="${url}"`, `src="cid:${name}"`);
    // In the plain text a picture is its description: the email above holds it.
    text = text.replaceAll(`: ${url}`, '');
    if (html.includes(url)) throw new Error(`Refusing to send: ${name} would show from GitHub, where the client can't see it, not from the email.`);
  }
  // What the email will load, read from the HTML itself: each picture is in the email, or on the client's own site.
  for (const [, raw = ''] of html.matchAll(/<img\b[^>]*?\ssrc="([^"]*)"/gi)) {
    const src = raw.replace(/&amp;/g, '&');
    if (!src.startsWith('cid:') && !onDomain(src, config) && src !== config.brand?.logoUrl) {
      throw new Error(`Refusing to send: the note shows a picture from ${src}, which the client may not be able to see. Pictures go in the email: pass each with --picture.`);
    }
  }
  return postEmail(
    { from: config.from, replyTo: config.replyTo, to: recipients, subject: email.subject, html, text, attachments: [...inline, ...attached] },
    { key, idempotencyKey: `${config.slug}-${tag}`, fetch },
  );
}
