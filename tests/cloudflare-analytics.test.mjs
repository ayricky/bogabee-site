import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cloudflareAnalytics } from '../server/cloudflare-analytics.js';
import { rangeFor } from '../server/dashboard.js';

const now = Date.parse('2026-09-07T12:00:00Z');
const range = rangeFor(7, now);
const env = { CF_ZONE_ID: 'a'.repeat(32), CF_ANALYTICS_TOKEN: 'test-only' };
const settings = { enabled: true, maxDuration: 31539600, notOlderThan: 31539600 };
const response = zone => Response.json({ data: { viewer: { zones: [zone] } }, errors: null });
const row = (date, requests, bytes, cachedRequests) => ({ dimensions: { date }, sum: { requests, bytes, cachedRequests } });

function upstream(t, report, options = {}) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url, ...init, body: JSON.parse(init.body) });
    if (calls.length === 1) return response({ settings: { httpRequests1dGroups: options.settings || settings } });
    return typeof report === 'function' ? report() : response({ httpRequests1dGroups: report });
  });
  return calls;
}

test('reads only the configured zone and returns separate network totals with UTC daily requests', async t => {
  const calls = upstream(t, [row('2026-09-01', 20, 1000, 5), row('2026-09-07', 5, 500, 0)]);
  const result = await cloudflareAnalytics(env, range, now);
  assert.equal(result.state, 'ready');
  assert.equal(result.requests, 25); assert.equal(result.bytes, 1500); assert.equal(result.cachedRequests, 5); assert.equal(result.cacheRate, .2);
  assert.equal(result.timeZone, 'UTC'); assert.equal(result.daily.length, 7); assert.deepEqual(result.daily[1], { day: '2026-09-02', count: 0 });
  assert.equal('sessions' in result, false); assert.equal('visitors' in result, false);
  assert.equal(calls.length, 2); assert.equal(calls[1].url, 'https://api.cloudflare.com/client/v4/graphql');
  assert.deepEqual(calls[1].body.variables, { zone: env.CF_ZONE_ID, start: range.start, end: range.end, limit: 7 });
  assert.equal(calls[1].headers.authorization, 'Bearer test-only');
  assert.equal(JSON.stringify(result).includes('test-only'), false);
});

test('valid empty history is zero, and cache share is undefined without requests', async t => {
  upstream(t, []);
  const result = await cloudflareAnalytics(env, range, now);
  assert.equal(result.state, 'ready'); assert.equal(result.requests, 0); assert.equal(result.cacheRate, null);
  assert.equal(result.daily.every(row => row.count === 0), true);
});

test('missing config and plan limits never become zero reports', async t => {
  const calls = upstream(t, [], { settings: { ...settings, notOlderThan: 86400 } });
  assert.deepEqual(await cloudflareAnalytics({}, range, now), { state: 'unconfigured' });
  assert.equal(calls.length, 0);
  assert.deepEqual(await cloudflareAnalytics(env, range, now), { state: 'limited', maxDays: 1 });
  assert.equal(calls.length, 1);
});

test('denied, incomplete, and malformed Cloudflare responses stay unavailable', async t => {
  for (const report of [
    () => Response.json({ errors: [{ message: 'permission denied' }], data: { viewer: { zones: [] } } }),
    () => new Response(null, { status: 403 }),
    () => Response.json({ data: { viewer: { zones: [] } } }),
    () => { throw new Error('Timeout'); },
    null,
    [row('2026-09-01', 3, 100, 4)],
    [row('2026-09-01', -1, 100, 0)],
    [row('2026-09-01', '3', 100, 0)],
    [row('2026-09-01', 3, 100, 0), row('2026-09-01', 3, 100, 0)],
    [row('2026-08-31', 3, 100, 0)]
  ]) {
    upstream(t, report);
    assert.deepEqual(await cloudflareAnalytics(env, range, now), { state: 'unavailable' });
    t.mock.restoreAll();
  }
});
