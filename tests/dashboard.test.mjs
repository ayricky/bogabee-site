import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT } from 'jose';
import { localDatabase } from '../tools/sqlite-d1.mjs';
import { easternDay, rangeFor, recordedCheckins } from '../server/dashboard.js';
import { verifyIdentity, accessConfig } from '../server/access.js';
import { onRequest } from '../functions/api/internal/_middleware.js';
import { onRequestPost as createEvent, onRequestGet as listEvents } from '../functions/api/internal/events.js';

const origin = 'https://bogabeeapiaries.com';
function request(path, body) { return new Request(origin + path, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) }); }

test('date windows use New York calendar days across DST', () => {
  assert.equal(easternDay(Date.parse('2026-09-08T02:00:00Z')), '2026-09-07');
  assert.deepEqual(rangeFor(7, Date.parse('2026-03-10T05:00:00Z')), { days: 7, start: '2026-03-04', end: '2026-03-10', timeZone: 'America/New_York' });
});

test('production auth fails closed before any data handler executes', async () => {
  let called = false;
  const context = { request: new Request(`${origin}/api/internal/events`), env: {}, data: {}, next() { called = true; } };
  assert.equal((await onRequest(context)).status, 503);
  context.env = { ACCESS_TEAM_DOMAIN: 'bogabee.cloudflareaccess.com', ACCESS_AUD: 'test-audience', DASHBOARD_EMAILS: 'bogabeeapiaries@gmail.com' };
  assert.equal((await onRequest(context)).status, 401);
  context.request = new Request(`${origin}/api/internal/events`, { headers: { 'cf-access-authenticated-user-email': 'bogabeeapiaries@gmail.com' } });
  assert.equal((await onRequest(context)).status, 401);
  assert.equal(called, false);
});

test('Access verifies signatures, issuer, audience, expiry, and email allowlist', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const config = accessConfig({ ACCESS_TEAM_DOMAIN: 'bogabee.cloudflareaccess.com', ACCESS_AUD: 'dashboard', DASHBOARD_EMAILS: 'bogabeeapiaries@gmail.com,ayrsoftwaredev@gmail.com' });
  async function token(email, audience = 'dashboard', expiry = '5m', issuer = config.issuer) { return new SignJWT({ email }).setProtectedHeader({ alg: 'RS256' }).setSubject('owner').setIssuedAt().setExpirationTime(expiry).setIssuer(issuer).setAudience(audience).sign(privateKey); }
  assert.deepEqual(await verifyIdentity(await token('ayrsoftwaredev@gmail.com'), config, publicKey), { email: 'ayrsoftwaredev@gmail.com' });
  for (const value of [await token('stranger@example.com'), await token('bogabeeapiaries@gmail.com', 'different'), await token('bogabeeapiaries@gmail.com', 'dashboard', '-1m'), await token('bogabeeapiaries@gmail.com', 'dashboard', '5m', 'https://other.cloudflareaccess.com')]) await assert.rejects(verifyIdentity(value, config, publicKey));
  const { publicKey: wrong } = await generateKeyPair('RS256');
  await assert.rejects(verifyIdentity(await token('bogabeeapiaries@gmail.com'), config, wrong));
});

test('event directory persists events and refuses duplicate labels and invalid dates', async () => {
  const db = localDatabase(); const env = { BOGABEE_DB: db };
  try {
    const payload = { name: 'Fall   market · September 19', startsOn: '2026-09-19' };
    assert.equal((await createEvent({ request: request('/api/internal/events', payload), env })).status, 201);
    assert.equal((await createEvent({ request: request('/api/internal/events', payload), env })).status, 409);
    assert.equal((await createEvent({ request: request('/api/internal/events', { ...payload, startsOn: '2026-02-30' }), env })).status, 400);
    const list = await (await listEvents({ env })).json(); assert.equal(list.events.length, 1); assert.equal(list.events[0].name, 'Fall market · September 19');
  } finally { db.close(); }
});

const hubspot = { HUBSPOT_TOKEN: 'fake', HUBSPOT_PORTAL_ID: '123', HUBSPOT_EVENT_FORM_ID: 'test-form' };
const submission = (id, event, timestamp = Date.parse('2026-09-07T15:00:00Z')) => ({ conversionId: id, submittedAt: timestamp, values: [{ name: 'bogabee_last_event', value: event }, { name: 'email', value: 'must-not-escape@example.com' }] });

test('counts use historical submission values with pagination and never return guest PII', async t => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async url => {
    requests++; assert.equal(new URL(url).hostname, 'api.hubapi.com');
    return Response.json(requests === 1 ? { results: [submission('2', 'Second market')], paging: { next: { after: 'next-page' } } } : { results: [submission('1', 'First market'), submission('2', 'Second market')] });
  });
  const result = await recordedCheckins(hubspot, rangeFor(7, Date.parse('2026-09-07T16:00:00Z')));
  assert.equal(result.state, 'ready'); assert.equal(result.total, 2); assert.deepEqual(result.counts, { 'Second market': 1, 'First market': 1 }); assert.equal(JSON.stringify(result).includes('must-not-escape'), false);
});

test('capped HubSpot history is marked partial and failures never become zero', async t => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => Response.json({ results: [submission(String(++requests), 'Market')], paging: { next: { after: String(requests) } } }));
  const result = await recordedCheckins(hubspot, rangeFor(7, Date.parse('2026-09-07T16:00:00Z')));
  assert.equal(requests, 20); assert.equal(result.state, 'partial'); assert.equal(result.total, 20); assert.ok(result.oldest);
  t.mock.method(globalThis, 'fetch', async () => Response.json({}, { status: 403 }));
  assert.deepEqual(await recordedCheckins(hubspot, rangeFor(7)), { state: 'unavailable' });
  assert.deepEqual(await recordedCheckins({}, rangeFor(7)), { state: 'unconfigured' });
});
