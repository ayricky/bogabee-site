export function json(body, status = 200) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export function easternDay(timestamp = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(timestamp));
  const get = type => parts.find(part => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function shiftDay(day, amount) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function rangeFor(days, now = Date.now()) {
  const end = easternDay(now);
  const start = shiftDay(end, 1 - days);
  return { days, start, end, timeZone: 'America/New_York' };
}

export async function recordedCheckins(env, range) {
  if (!env.HUBSPOT_TOKEN || !env.HUBSPOT_EVENT_FORM_ID || !env.HUBSPOT_PORTAL_ID) return { state: 'unconfigured' };
  const counts = new Map();
  const seen = new Set();
  const cursors = new Set();
  let after = '';
  let total = 0;
  let unassigned = 0;
  let oldest = null;
  let newest = null;
  try {
    // Fifty submissions per page is HubSpot's maximum. Keep within Pages' subrequest budget.
    for (let page = 0; page < 20; page++) {
      const url = new URL(`https://api.hubapi.com/form-integrations/v1/submissions/forms/${encodeURIComponent(env.HUBSPOT_EVENT_FORM_ID)}`);
      url.searchParams.set('limit', '50');
      if (after) url.searchParams.set('after', after);
      const response = await fetch(url, { headers: { authorization: `Bearer ${env.HUBSPOT_TOKEN}` }, signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error('HubSpot unavailable');
      const body = await response.json();
      if (!Array.isArray(body.results)) throw new Error('Invalid HubSpot response');
      let passedStart = false;
      for (const item of body.results) {
        if (typeof item.conversionId !== 'string' || !Number.isFinite(item.submittedAt) || !Array.isArray(item.values)) throw new Error('Invalid submission');
        const day = easternDay(item.submittedAt);
        if (day < range.start) { passedStart = true; continue; }
        if (day > range.end || seen.has(item.conversionId)) continue;
        seen.add(item.conversionId);
        oldest = oldest === null ? item.submittedAt : Math.min(oldest, item.submittedAt);
        newest = newest === null ? item.submittedAt : Math.max(newest, item.submittedAt);
        total++;
        const event = item.values.find(value => value.name === 'bogabee_last_event')?.value;
        if (typeof event === 'string' && event.trim()) counts.set(event, (counts.get(event) || 0) + 1);
        else unassigned++;
      }
      const next = body.paging?.next?.after;
      if (passedStart || !next) return { state: 'ready', total, unassigned, counts: Object.fromEntries(counts), oldest, newest };
      if (typeof next !== 'string' || cursors.has(next)) throw new Error('Invalid pagination');
      cursors.add(next);
      after = next;
    }
    return { state: 'partial', total, unassigned, counts: Object.fromEntries(counts), oldest, newest };
  } catch { return { state: 'unavailable' }; }
}
