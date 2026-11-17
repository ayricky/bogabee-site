// The monthly report and the quarterly note. Facts only, no offers. A fact
// with no source stays out: no uptime file means no uptime line.

import { parseJson, type ClientConfig } from './config.ts';
import { addDays, longDate, MONTHS } from './dates.ts';
import type { Entry, Kind } from './notes.ts';
import { renderEmail, type Email } from './render.ts';

interface Incident {
  id: number | string; // the same in every month the incident touches
  started: string; // the true start, which can fall in an earlier month
  ended: string | null;
  minutes: number; // the part inside this report's month
}

// The JSON that the monitor's GET /report returns.
export interface UptimeReport {
  slug: string;
  month: string;
  watchedFrom: string; // the first check in this month
  uptimePercent: number;
  checksSeen: number;
  checksExpected: number;
  incidents: Incident[];
}

export interface Numbers {
  measures: { label: string; now: number; before: number }[];
  hours?: number;
}

const ACTION = '**Nothing you need to do.**';
const KINDS: Kind[] = ['New', 'Changed', 'Fixed'];
const CHECK_INTERVAL_MS = 5 * 60_000;
const MONTH_START_GRACE_MS = 60 * 60_000; // a first check this late still counts as the whole month

function monthName(month: string): string {
  const [year = '', number = ''] = month.split('-');
  return `${MONTHS[Number(number) - 1]} ${year}`;
}

function isTime(value: unknown): boolean {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function isIncident(value: Partial<Incident>): boolean {
  return (typeof value.id === 'number' || typeof value.id === 'string') && isTime(value.started)
    && (value.ended === null || isTime(value.ended)) && typeof value.minutes === 'number';
}

// Takes one monthly report or a list of them. Refuses a report that belongs
// to another client, falls outside the period, or watched nothing: it would
// print a false fact.
export function parseUptime(
  json: string,
  config: ClientConfig,
  firstMonth: string,
  lastMonth: string,
  source = 'uptime file',
): UptimeReport[] {
  const parsed = parseJson(json, source);
  const reports = (Array.isArray(parsed) ? parsed : [parsed]) as (Partial<Omit<UptimeReport, 'watchedFrom'>> & { watchedFrom?: string | null })[];
  return reports.map(report => {
    if (
      typeof report.uptimePercent !== 'number' || typeof report.checksSeen !== 'number'
      || typeof report.checksExpected !== 'number' || !Array.isArray(report.incidents)
      || typeof report.month !== 'string' || (report.watchedFrom !== null && !isTime(report.watchedFrom))
      || !report.incidents.every(isIncident)
    ) {
      throw new Error(`${source}: not a monitor report. It needs uptimePercent, checksSeen, checksExpected, month, watchedFrom and incidents, each with id, started, ended and minutes.`);
    }
    if (report.slug !== config.slug) throw new Error(`${source}: for ${report.slug}, not ${config.slug}.`);
    if (report.month < firstMonth || report.month > lastMonth) {
      throw new Error(`${source}: covers ${report.month}, outside ${firstMonth} to ${lastMonth}.`);
    }
    const { watchedFrom } = report as { watchedFrom: string | null };
    if (report.checksExpected <= 0 || watchedFrom === null) {
      throw new Error(`${source}: no checks ran in ${report.month}, so there is no figure to report.`);
    }
    if (new Date(watchedFrom).toISOString().slice(0, 7) !== report.month) {
      throw new Error(`${source}: watchedFrom ${watchedFrom} is not in ${report.month}.`);
    }
    return report as UptimeReport;
  });
}

export function parseNumbers(json: string, source = 'numbers file'): Numbers {
  const parsed = parseJson(json, source) as Partial<Numbers>;
  const measures = parsed.measures;
  if (!Array.isArray(measures) || measures.length === 0) {
    throw new Error(`${source}: no measures. Output alone doesn't count as value. Skip the quarter.`);
  }
  for (const measure of measures) {
    if (!measure.label || typeof measure.now !== 'number' || typeof measure.before !== 'number') {
      throw new Error(`${source}: each measure needs a label, now and before.`);
    }
  }
  if (parsed.hours !== undefined && (typeof parsed.hours !== 'number' || parsed.hours < 0)) {
    throw new Error(`${source}: hours must be a number, zero or more.`);
  }
  return { measures, ...(parsed.hours === undefined ? {} : { hours: parsed.hours }) };
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

// In one month's report, minutes are clipped to that month, so an incident
// crossing the month's edge says which part it means.
function incidentLine({ started, ended, minutes }: Incident, timeZone: string, month?: string): string {
  const when = new Intl.DateTimeFormat('en-US', {
    timeZone, month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(new Date(started));
  const crosses = month && (started.slice(0, 7) !== month || (ended ?? started).slice(0, 7) !== month);
  const span = `${plural(minutes, 'minute')}${crosses ? ` in ${monthName(month)}` : ''}`;
  return `- ${when}, ${ended === null ? `${span} so far, still open` : span}.`;
}

// The monitor counts a check it never ran as down, so a stalled monitor can't
// show 100%. Say so, or the client reads our gap as their downtime.
function coverageLine(reports: UptimeReport[]): string[] {
  const seen = reports.reduce((sum, report) => sum + report.checksSeen, 0);
  const expected = reports.reduce((sum, report) => sum + report.checksExpected, 0);
  if (seen >= expected) return [];
  return [`The monitor ran ${seen} of its ${expected} checks. The ones it missed count as down in this figure, so the real number may be higher.`];
}

// A late first check is either a site added part way through the month, whose
// expected checks all fall after it, or a monitor gap, which coverageLine covers.
function figure(report: UptimeReport, timeZone: string): string {
  const { month, uptimePercent, checksExpected } = report;
  const watchedFrom = Date.parse(report.watchedFrom);
  if (watchedFrom - Date.parse(`${month}-01T00:00:00Z`) <= MONTH_START_GRACE_MS) {
    return `${uptimePercent}% in ${monthName(month)}`;
  }
  const [year = 0, number = 0] = month.split('-').map(Number);
  const checksLeft = (Date.UTC(year, number, 1) - watchedFrom) / CHECK_INTERVAL_MS;
  const day = new Intl.DateTimeFormat('en-US', { timeZone, month: 'long', day: 'numeric' }).format(watchedFrom);
  return `${uptimePercent}% from ${day}${checksExpected <= checksLeft + 1 ? ', when monitoring began' : ''}`;
}

// One outage reported by two months is one incident.
function mergeIncidents(reports: UptimeReport[]): Incident[] {
  const merged = new Map<Incident['id'], Incident>();
  for (const report of reports.toSorted((a, b) => a.month.localeCompare(b.month))) {
    for (const incident of report.incidents) {
      const earlier = merged.get(incident.id);
      merged.set(incident.id, earlier ? { ...incident, minutes: earlier.minutes + incident.minutes } : incident);
    }
  }
  return [...merged.values()];
}

function uptimeSection(reports: UptimeReport[], timeZone: string): string[] {
  const figures = reports.map(report => figure(report, timeZone)).join(', ');
  const incidents = mergeIncidents(reports);
  const month = reports.length === 1 ? reports[0]?.month : undefined;
  return [
    `**Uptime:** ${figures}.`,
    ...coverageLine(reports),
    `**Incidents:** ${incidents.length}.`,
    ...(incidents.length > 0 ? [incidents.map(incident => incidentLine(incident, timeZone, month)).join('\n')] : []),
  ];
}

function changesSection(entries: Entry[], from: string, to: string): string[] {
  const items = entries
    .filter(entry => entry.date && entry.date >= from && entry.date <= to)
    .flatMap(entry => entry.items)
    .filter(item => item.lead);
  if (items.length === 0) return ['**What changed:** no updates in this period.'];
  const counts = KINDS
    .map(kind => [kind, items.filter(item => item.kind === kind).length] as const)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => `${count} ${kind.toLowerCase()}`);
  return [
    `**What changed:** ${counts.join(', ')}.`,
    items.map(item => `- ${item.kind} — ${item.lead}.`).join('\n'),
  ];
}

export function renderMonthly(
  config: ClientConfig,
  entries: Entry[],
  { month, uptime, backups }: { month: string; uptime?: UptimeReport[]; backups?: string },
): Email {
  const [year = 0, number = 0] = month.split('-').map(Number);
  const nextMonth = new Date(Date.UTC(year, number, 1)).toISOString().slice(0, 10);
  return renderEmail(config, {
    subject: `${config.name}: monthly report, ${monthName(month)}`,
    title: `Monthly report, ${monthName(month)}`,
    markdown: [
      ACTION,
      ...(uptime ? uptimeSection(uptime, config.timezone) : []),
      `**Backups:** ${backups ?? 'Not checked this month.'}`,
      ...changesSection(entries, `${month}-01`, addDays(nextMonth, -1)),
    ].join('\n\n'),
  });
}

function change(now: number, before: number): string {
  const difference = now - before;
  if (difference === 0) return 'no change';
  return difference > 0 ? `up ${difference}` : `down ${-difference}`;
}

export function renderQuarterly(
  config: ClientConfig,
  entries: Entry[],
  { from, to, numbers, uptime }: { from: string; to: string; numbers: Numbers; uptime?: UptimeReport[] },
): Email {
  const period = `${longDate(from)} to ${longDate(to)}`;
  return renderEmail(config, {
    subject: `${config.name}: quarterly note, ${period}`,
    title: `Quarterly note, ${period}`,
    markdown: [
      ACTION,
      numbers.measures
        .map(({ label, now, before }) => `- ${label}: ${now}, was ${before} (${change(now, before)}).`)
        .join('\n'),
      ...(numbers.hours === undefined ? [] : [`**Hours saved, your estimate:** ${numbers.hours}.`]),
      ...(uptime ? uptimeSection(uptime, config.timezone) : []),
      ...changesSection(entries, from, to),
    ].join('\n\n'),
  });
}
