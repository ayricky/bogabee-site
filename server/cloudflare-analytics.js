import { shiftDay } from './dashboard.js';

const ENDPOINT = 'https://api.cloudflare.com/client/v4/graphql';
const DAY = 86400000;

async function query(env, query, variables) {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error('Cloudflare unavailable');
  const result = await response.json();
  // GraphQL can return HTTP 200 with errors and incomplete data.
  if (result.errors?.length || result.data?.viewer?.zones?.length !== 1) throw new Error('Cloudflare report unavailable');
  return result.data.viewer.zones[0];
}

export async function cloudflareAnalytics(env, range, now = Date.now()) {
  if (!env.CF_ANALYTICS_TOKEN || !env.CF_ZONE_ID) return { state: 'unconfigured' };
  try {
    if (!/^[a-f0-9]{32}$/i.test(env.CF_ZONE_ID)) throw new Error('Invalid Cloudflare zone');
    const variables = { zone: env.CF_ZONE_ID };
    const zone = await query(env, `query ($zone: String!) {
      viewer { zones(filter: { zoneTag: $zone }) {
        settings { httpRequests1dGroups { enabled maxDuration notOlderThan } }
      } }
    }`, variables);
    const settings = zone.settings?.httpRequests1dGroups;
    if (!settings?.enabled || !Number.isFinite(settings.maxDuration) || !Number.isFinite(settings.notOlderThan)) throw new Error('Cloudflare dataset unavailable');
    if (range.days * DAY > settings.maxDuration * 1000 || Date.parse(`${range.start}T00:00:00Z`) < now - settings.notOlderThan * 1000) {
      return { state: 'limited', maxDays: Math.floor(Math.min(settings.maxDuration, settings.notOlderThan) / 86400) };
    }
    const report = await query(env, `query ($zone: String!, $start: Date!, $end: Date!, $limit: Int!) {
      viewer { zones(filter: { zoneTag: $zone }) {
        httpRequests1dGroups(limit: $limit, filter: { date_geq: $start, date_leq: $end }, orderBy: [date_ASC]) {
          dimensions { date }
          sum { requests bytes cachedRequests }
        }
      } }
    }`, { ...variables, start: range.start, end: range.end, limit: range.days });
    const rows = report.httpRequests1dGroups;
    if (!Array.isArray(rows)) throw new Error('Invalid Cloudflare report');
    const days = new Map();
    let requests = 0;
    let bytes = 0;
    let cachedRequests = 0;
    for (const row of rows) {
      const day = row.dimensions?.date;
      const sum = row.sum;
      if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || day < range.start || day > range.end || days.has(day) ||
          !sum || ![sum.requests, sum.bytes, sum.cachedRequests].every(value => Number.isSafeInteger(value) && value >= 0) || sum.cachedRequests > sum.requests) throw new Error('Invalid Cloudflare totals');
      days.set(day, sum.requests);
      requests += sum.requests;
      bytes += sum.bytes;
      cachedRequests += sum.cachedRequests;
    }
    return {
      state: 'ready', requests, bytes, cachedRequests,
      cacheRate: requests ? cachedRequests / requests : null,
      timeZone: 'UTC',
      daily: Array.from({ length: range.days }, (_, index) => { const day = shiftDay(range.start, index); return { day, count: days.get(day) || 0 }; })
    };
  } catch { return { state: 'unavailable' }; }
}
