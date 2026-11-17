// What's due across every client. SCHEDULE is the one place the timing lives.
// Nothing records what's been done, so each item stays listed for a window
// wide enough that a Monday scan can't miss it.

import type { ClientConfig, Plan, Renewal } from './config.ts';
import { addDays, isDate, longDate, MONTHS } from './dates.ts';

export const SCHEDULE = {
  lookaheadDays: 14, // check-ins and quarterly notes appear this far ahead
  lateDays: 7, // a check-in stays listed this long past its date
  checkIns: [
    { days: 14, template: 'checkin-2wk' },
    { days: 25, template: 'checkin-1mo' }, // inside the 30 days of free fixes
    { days: 90, template: 'checkin-3mo' },
    { days: 180, template: 'checkin-6mo' },
    { days: 365, template: 'checkin-12mo' },
  ],
  monthlyPlans: ['care', 'run', 'grow'] as Plan[], // from the 1st, for the month just ended
  quarterlyPlans: ['run', 'grow'] as Plan[], // from the lookahead, for the quarter ending
  reportWindowDays: 7, // both stay listed through this day of the month
  renewalDaysOut: [60, 14], // furthest first: listed from the first through the renewal date
  renewalTemplate: 'renewal-notice',
};

export interface DueItem {
  date: string;
  slug: string;
  client: string;
  kind: 'check-in' | 'monthly' | 'quarterly' | 'renewal' | 'stale-date';
  what: string;
  late?: boolean;
}

type Who = Pick<DueItem, 'slug' | 'client'>;

function checkIns(who: Who, launched: string, today: string): DueItem[] {
  return SCHEDULE.checkIns.flatMap(({ days, template }): DueItem[] => {
    const date = addDays(launched, days);
    if (today < addDays(date, -SCHEDULE.lookaheadDays) || today > addDays(date, SCHEDULE.lateDays)) return [];
    const late = today > date;
    const what = `Check-in, ${days} days after launch (${template})${late ? ', late' : ''}`;
    return [{ ...who, date, kind: 'check-in', what, ...(late ? { late } : {}) }];
  });
}

// February 29 lands on the 28th in a year without one.
function nextOccurrence(date: string, today: string): string {
  if (date >= today) return date;
  for (let year = Number(today.slice(0, 4)); ; year += 1) {
    const exact = `${year}${date.slice(4)}`;
    const next = isDate(exact) ? exact : `${year}-02-28`;
    if (next >= today) return next;
  }
}

function renewalItems(who: Who, renewal: Renewal, today: string): DueItem[] {
  const date = renewal.yearly ? nextOccurrence(renewal.date, today) : renewal.date;
  if (date < today) {
    const what = `${renewal.what}: the renewal date, ${longDate(date)}, has passed. Fix it in the config, or set "yearly": true.`;
    return [{ ...who, date, kind: 'stale-date', what }];
  }
  const notices = SCHEDULE.renewalDaysOut.map(days => ({ days, date: addDays(date, -days) }));
  const open = notices.findLast(notice => notice.date <= today);
  if (!open) return [];
  const next = notices.find(notice => notice.date > today);
  const later = next ? `, ${next.days}-day notice on ${longDate(next.date)}` : '';
  const cost = renewal.cost ? `, ${renewal.cost}` : '';
  const what = `${renewal.what} renews on ${longDate(date)}${cost}: ${open.days}-day notice now${later} (${SCHEDULE.renewalTemplate})`;
  return [{ ...who, date: open.date, kind: 'renewal', what }];
}

function monthly(who: Who, date: string, ended: string): DueItem {
  const [year = '', month = ''] = ended.split('-');
  const what = `Monthly report for ${MONTHS[Number(month) - 1]} ${year}`;
  return { ...who, date, kind: 'monthly', what };
}

function quarterly(who: Who, date: string, ended: string): DueItem {
  const [year = '', month = ''] = ended.split('-');
  const by = longDate(addDays(date, SCHEDULE.reportWindowDays - 1));
  return { ...who, date, kind: 'quarterly', what: `Quarterly note for Q${Number(month) / 3} ${year}, by ${by}` };
}

// Walks every 1st from the start of the report window through the lookahead.
// A month or a quarter holding any month before launch has no report.
function reportItems(who: Who, config: ClientConfig, today: string): DueItem[] {
  const launchMonth = config.launched.slice(0, 7);
  const items: DueItem[] = [];
  const until = addDays(today, SCHEDULE.lookaheadDays);
  for (let date = addDays(today, 1 - SCHEDULE.reportWindowDays); date <= until; date = addDays(date, 1)) {
    if (!date.endsWith('-01')) continue;
    const ended = addDays(date, -1);
    const endedMonth = Number(ended.slice(5, 7));
    if (date <= today && SCHEDULE.monthlyPlans.includes(config.plan) && ended.slice(0, 7) >= launchMonth) {
      items.push(monthly(who, date, ended));
    }
    const firstMonth = `${ended.slice(0, 5)}${String(endedMonth - 2).padStart(2, '0')}`;
    if (endedMonth % 3 === 0 && SCHEDULE.quarterlyPlans.includes(config.plan) && firstMonth >= launchMonth) {
      items.push(quarterly(who, date, ended));
    }
  }
  return items;
}

export function dueItems(configs: ClientConfig[], today: string): DueItem[] {
  return configs
    .filter(config => !config.example)
    .flatMap(config => {
      const who = { slug: config.slug, client: config.name };
      return [
        ...checkIns(who, config.launched, today),
        ...(config.renewals ?? []).flatMap(renewal => renewalItems(who, renewal, today)),
        ...reportItems(who, config, today),
      ];
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.client.localeCompare(b.client));
}
