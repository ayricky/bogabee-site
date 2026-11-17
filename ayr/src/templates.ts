// Message templates: front matter with subject and when, then Markdown with
// {{placeholders}}. Refuses to render with any placeholder left over.

import type { ClientConfig } from './config.ts';
import { renderEmail, type Email } from './render.ts';

interface Template {
  subject: string;
  when: string;
  body: string;
}

const PLACEHOLDER = /\{\{\s*([\w.-]+)\s*\}\}/g;

export function parseTemplate(source: string, name: string): Template {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(source);
  if (!match) throw new Error(`Template ${name} has no front matter.`);
  const [, front = '', body = ''] = match;
  const meta = new Map(front.split(/\r?\n/).map((line): [string, string] => {
    const colon = line.indexOf(':');
    return [line.slice(0, colon).trim(), line.slice(colon + 1).trim().replace(/^(["'])(.*)\1$/, '$2')];
  }));
  const subject = meta.get('subject');
  const when = meta.get('when');
  if (!subject) throw new Error(`Template ${name} has no subject.`);
  if (!when) throw new Error(`Template ${name} has no when.`);
  return { subject, when, body: body.trim() };
}

// A blank, TODO or {{...}} value is still unfilled.
function fill(text: string, values: Record<string, string>, missing: Set<string>): string {
  return text.replace(PLACEHOLDER, (match, key: string) => {
    const value = values[key]?.trim();
    if (value && !value.includes('{{') && !/^todo$/i.test(value)) return values[key] ?? '';
    missing.add(key);
    return match;
  });
}

export function renderTemplate(template: Template, values: Record<string, string>, config: ClientConfig): Email {
  const known = { clientName: config.name, site: config.site, ...values };
  const missing = new Set<string>();
  const subject = fill(template.subject, known, missing);
  const markdown = fill(template.body, known, missing);
  if (missing.size > 0) {
    throw new Error(`Unfilled placeholder: ${[...missing].join(', ')}. Pass each with --set key=value.`);
  }
  return renderEmail(config, { subject, title: subject, markdown, hardBreaks: true });
}
