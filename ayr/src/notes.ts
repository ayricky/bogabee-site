// Parses PATCH_NOTES.md into entries. Entry.body is the only client-visible
// text: everything that reaches an email or a page is built from it.

import { MONTHS } from './dates.ts';

export type Kind = 'New' | 'Changed' | 'Fixed';

export interface Item {
  line: number;
  text: string;
  kind: Kind | 'hood' | null;
  lead: string | null; // the words after "New — ", as plain text
}

export interface Entry {
  heading: string;
  line: number;
  date: string | null;
  raw: string; // everything under the heading, footer lines included
  body: string; // raw without the history line, the Internal line or the entry rule
  items: Item[];
}

export const IMAGE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

const HEADING = new RegExp(`^(${MONTHS.join('|')}) (\\d{1,2}), (\\d{4})(?: [—-] (.+))?$`);
const LEAD = /^\*\*(New|Changed|Fixed)\s+[—-]\s+(.+?)\*\*/s;

// One footer line to the end of its paragraph. Survives wrapped lines, bold or
// italic markup, and an indent left by a bullet above it. The check rejects one
// that isn't at the end of the entry, and what follows it stays in the body.
export const FOOTER = /^[ \t]*[*_]{0,2}(?:See every past update:|Internal:)(?:(?!\n[ \t]*\n)[\s\S])*$/gim;

export const COMMENT = /<!--[\s\S]*?(?:-->|$)/g;

export const ACTION_LINE = /^\*\*(?:Nothing you need to do\.|You need to: [^*]+\.)\*\*$/;

export function headingDate(heading: string): string | null {
  const match = HEADING.exec(heading);
  if (!match) return null;
  const [, month = '', day = '', year = ''] = match;
  return `${year}-${String(MONTHS.indexOf(month) + 1).padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function withoutRule(raw: string): string {
  return raw.replace(/(?:^|\n)\s*-{3,}\s*$/, '');
}

export function stripFooter(raw: string): string {
  return withoutRule(raw).replace(FOOTER, '').trimEnd();
}

// The action line is written to the client, so it stays out of a public page.
export function withoutActionLine(body: string): string {
  return body
    .split(/\n\s*\n/)
    .filter(paragraph => !ACTION_LINE.test(paragraph.trim().replace(/\s+/g, ' ')))
    .join('\n\n');
}

function parseItem(line: number, lines: string[]): Item {
  const text = lines.join('\n').trim();
  const lead = LEAD.exec(text);
  if (lead) {
    return {
      line,
      text,
      kind: lead[1] as Kind,
      lead: (lead[2] ?? '').replace(/\s+/g, ' ').replace(/[.,:;]+$/, ''),
    };
  }
  return { line, text, kind: /^\*Under the hood:\*/.test(text) ? 'hood' : null, lead: null };
}

// A bullet runs until the next bullet or the next line back at the margin.
function parseItems(body: string, firstLine: number): Item[] {
  const bullets: { line: number; lines: string[] }[] = [];
  let open: string[] | null = null;
  body.split('\n').forEach((line, index) => {
    if (/^[-*+] /.test(line)) {
      open = [line.slice(2)];
      bullets.push({ line: firstLine + index, lines: open });
    } else if (open && (line === '' || /^\s/.test(line))) {
      open.push(line.trim());
    } else {
      open = null;
    }
  });
  return bullets.map(bullet => parseItem(bullet.line, bullet.lines));
}

// An entry as it stood in the file, for a release body.
export function entryText({ heading, raw }: Entry): string {
  return `## ${heading}\n${withoutRule(raw).trimEnd()}\n`;
}

export function parseNotes(markdown: string): Entry[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const starts = lines.flatMap((line, index) => (line.startsWith('## ') ? [index] : []));
  if (starts.length === 0) throw new Error('The notes contain no entries: no "## " heading found.');

  return starts.map((start, index) => {
    const heading = (lines[start] ?? '').slice(3).trim();
    const raw = lines.slice(start + 1, starts[index + 1] ?? lines.length).join('\n');
    const body = stripFooter(raw).replace(COMMENT, '').trimEnd();
    return {
      heading,
      line: start + 1,
      date: headingDate(heading),
      raw,
      body,
      items: parseItems(body, start + 2),
    };
  });
}
