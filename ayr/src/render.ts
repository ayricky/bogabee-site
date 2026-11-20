// One layout for every message: a release note, a report or a template.
// Inline styles only, because email clients ignore external CSS.

import { marked, type Token, type Tokens } from 'marked';
import type { Brand, ClientConfig } from './config.ts';
import { COMMENT, withoutActionLine, type Entry } from './notes.ts';

export interface Message {
  subject: string;
  title: string;
  markdown: string;
  hardBreaks?: boolean; // a line break in the Markdown stays a line break
}

export interface Email {
  subject: string;
  html: string;
  text: string; // the plain-text part: title, body and footer
  body: string; // the plain-text body alone, for pasting into a mailbox
}

export const REPLY_LINE = 'Reply to this email to ask for a change.';
export const VIDEO_NOTE = 'A short video showing this update is attached.';

// The width of a list item in the email: Outlook ignores the width in img's style.
const IMAGE_WIDTH = 516;
const DEFAULT_LOGO_WIDTH = 150;

function tagStyles(brand: Brand): Record<string, string> {
  return {
    h2: `font-family:${brand.headingFont};font-size:18px;line-height:1.35;color:${brand.ink};margin:24px 0 10px;`,
    h3: `font-family:${brand.headingFont};font-size:16px;line-height:1.35;color:${brand.ink};margin:20px 0 8px;`,
    p: 'margin:0 0 12px;',
    strong: `color:${brand.ink};`,
    a: `color:${brand.accent};text-decoration:underline;`,
    li: 'margin-bottom:12px;',
    ul: 'padding-left:20px;margin-top:0;',
    ol: 'padding-left:20px;margin-top:0;',
    em: `color:${brand.muted};`,
    img: 'display:block;width:100%;height:auto;margin:12px 0 4px;',
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function displayDomain(site: string): string {
  return site.replace(/^https?:\/\//, '');
}

function renderHtml(config: ClientConfig, message: Message): string {
  const { brand } = config;
  const styles = tagStyles(brand);
  const content = (marked.parse(message.markdown, { async: false, breaks: message.hardBreaks ?? false })).replace(
    /<(h2|h3|p|strong|a|li|ul|ol|em|img)(?=[\s>])/g,
    (_match, tag: string) => `<${tag}${tag === 'img' ? ` width="${IMAGE_WIDTH}"` : ''} style="${styles[tag]}"`,
  );
  const logo = brand.logoUrl
    ? `<div style="text-align:center;padding:28px 32px 20px;border-bottom:1px solid ${brand.line};"><img src="${escapeHtml(brand.logoUrl)}" alt="${escapeHtml(config.name)}" width="${brand.logoWidth ?? DEFAULT_LOGO_WIDTH}" style="display:block;margin:0 auto;"></div>`
    : '';
  const history = config.updatesUrl
    ? `<a href="${escapeHtml(config.updatesUrl)}" style="display:inline-block;background:${brand.accent};color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none;font-family:${brand.bodyFont};font-size:14px;">See every past update</a>`
    : '';
  const small = `margin-top:14px;font-family:${brand.bodyFont};font-size:12px;line-height:1.5;color:${brand.muted};`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:${brand.paper};"><div style="background:${brand.paper};padding:24px 12px;"><div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid ${brand.line};border-radius:8px;overflow:hidden;">${logo}<div style="font-family:${brand.headingFont};font-size:22px;line-height:1.3;color:${brand.ink};padding:24px 32px 0;font-weight:bold;">${escapeHtml(message.title)}</div><div style="padding:8px 32px 24px;font-family:${brand.bodyFont};font-size:15px;line-height:1.65;color:${brand.body};overflow-wrap:anywhere;">${content}</div><div style="background:${brand.paper};border-top:1px solid ${brand.line};padding:20px 32px;text-align:center;">${history}<div style="${small}">${REPLY_LINE}</div><div style="${small}">${escapeHtml(brand.footer)} · <a href="${escapeHtml(config.site)}" style="color:${brand.muted};text-decoration:underline;">${escapeHtml(displayDomain(config.site))}</a></div></div></div></div></body></html>`;
}

function inlineText(tokens: Token[]): string {
  return tokens.map((token): string => {
    switch (token.type) {
      case 'link': {
        const { href, tokens: label } = token as Tokens.Link;
        const target = href.replace(/^mailto:/, '');
        const text = inlineText(label);
        return text === target ? target : `${text}: ${target}`;
      }
      case 'image': {
        const { href, text } = token as Tokens.Image;
        return text ? `${text}: ${href}` : href;
      }
      case 'strong':
      case 'em':
      case 'del':
        return inlineText((token as Tokens.Generic).tokens ?? []);
      case 'br':
        return '\n';
      case 'html':
        return '';
      case 'codespan':
        return (token as Tokens.Codespan).text;
      default: {
        const { tokens: children, text, raw } = token as Tokens.Generic;
        if (children) return inlineText(children);
        return String(text ?? raw).replace(/\s*\n\s*/g, ' ');
      }
    }
  }).join('');
}

// The arrow before a page link becomes a line of its own.
function paragraphText(tokens: Token[]): string {
  return inlineText(tokens).replace(/\s*→\s*(?=[^→\n]*https?:\/\/)/g, '\n').trim();
}

function itemLines(list: Tokens.List, item: Tokens.ListItem, index: number): string[] {
  const marker = list.ordered ? `${Number(list.start || 1) + index}. ` : '- ';
  const lines = blockLines(item.tokens).flatMap(block => block.split('\n'));
  return lines.map((line, at) => (at === 0 ? marker : ' '.repeat(marker.length)) + line);
}

function blockLines(tokens: Token[]): string[] {
  return tokens.flatMap((token): string[] => {
    switch (token.type) {
      case 'space':
      case 'hr':
      case 'html':
        return [];
      case 'list': {
        const list = token as Tokens.List;
        return list.items.flatMap((item, index) => itemLines(list, item, index));
      }
      case 'blockquote':
        return blockLines((token as Tokens.Blockquote).tokens);
      case 'code':
        return [(token as Tokens.Code).text];
      case 'paragraph':
      case 'heading':
      case 'text':
        return [paragraphText((token as Tokens.Generic).tokens ?? [token])];
      default:
        return [token.raw.trim()];
    }
  });
}

// Blocks are separated by a blank line, and so are bullets that run over one
// line. marked.lexer drops its defaults when given options, so gfm is spelled out to
// match marked.parse.
function plainText(markdown: string, breaks: boolean): string {
  return marked.lexer(markdown, { gfm: true, breaks }).flatMap((token): string[] => {
    if (token.type !== 'list') return blockLines([token]);
    const list = token as Tokens.List;
    const items = list.items.map((item, index) => itemLines(list, item, index).join('\n'));
    return [items.join(items.some(item => item.includes('\n')) ? '\n\n' : '\n')];
  }).join('\n\n');
}

export function renderEmail(config: ClientConfig, written: Message): Email {
  const message = { ...written, markdown: written.markdown.replace(COMMENT, '') };
  const body = plainText(message.markdown, message.hardBreaks ?? false);
  const text = [
    message.title,
    '',
    body,
    '',
    ...(config.updatesUrl ? [`See every past update: ${config.updatesUrl}`] : []),
    REPLY_LINE,
    `${config.brand.footer} · ${config.site}`,
    '',
  ].join('\n');
  return { subject: message.subject, html: renderHtml(config, message), text, body };
}

export function releaseSubject(config: ClientConfig, entry: Entry): string {
  if (entry.items.length === 0) throw new Error(`Entry "${entry.heading}" has no bullets to put in the subject.`);
  // An entry may hold only an Under the hood bullet, which has no lead.
  const lead = entry.items.find(item => item.lead)?.lead;
  if (!lead) return `${config.noun}: behind the scenes, nothing changes for you`;
  const more = entry.items.length - 1;
  return `${config.noun}: ${lead}${more > 0 ? ` and ${more} more` : ''}`;
}

export function renderRelease(config: ClientConfig, entry: Entry, { hasVideo = false } = {}): Email {
  return renderEmail(config, {
    subject: releaseSubject(config, entry),
    title: `${config.noun} — ${entry.heading}`,
    markdown: hasVideo ? `${entry.body}\n\n${VIDEO_NOTE}` : entry.body,
  });
}

// The public history page, for a client site's own page build to wrap.
export function renderPage(entries: Entry[]): string {
  return entries.map(({ heading, body }) => {
    const content = marked.parse(withoutActionLine(body), { async: false }).trimEnd();
    return `<article class="updates-entry">\n<h2>${marked.parseInline(heading, { async: false })}</h2>\n${content}\n</article>`;
  }).join('\n\n');
}
