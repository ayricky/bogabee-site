import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet, onRequestPost } from '../functions/api/event-check-in.js';

const origin = 'https://bogabee.example';
const env = { HUBSPOT_TOKEN: 'test-only', HUBSPOT_PORTAL_ID: '123', HUBSPOT_EVENT_FORM_ID: '00000000-0000-0000-0000-000000000000', EVENT_ALLOWED_ORIGIN: origin };
const guest = { name: 'Jamie Bee', email: 'jamie@example.com', phone: '', eventName: 'Fall market', website: '' };
function submit(body = guest, config = env, requestOrigin = origin) {
  return onRequestPost({ env: config, request: new Request(`${origin}/api/event-check-in`, {
    method: 'POST', headers: { origin: requestOrigin, 'content-type': 'application/json' }, body: JSON.stringify(body)
  }) });
}
function transport(t, responses) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.match(String(url), /^https:\/\/(api.hubapi.com|api.hsforms.com)\//);
    calls.push({ url, method: options.method, body: options.body ? JSON.parse(options.body) : undefined });
    const next = responses.shift();
    assert.ok(next, 'Unexpected upstream request');
    return Response.json(next.body || {}, { status: next.status || 200 });
  });
  return calls;
}

test('missing configuration and preview origin never contact HubSpot', async t => {
  const calls = transport(t, []);
  assert.equal((await submit(guest, {})).status, 503);
  assert.equal((await submit(guest, { ...env, EVENT_ALLOWED_ORIGIN: 'https://another.example' })).status, 503);
  const readiness = await onRequestGet({ env: {}, request: new Request(`${origin}/api/event-check-in`) });
  assert.deepEqual(await readiness.json(), { available: false });
  assert.equal(calls.length, 0);
});

test('rejects bad input and cross-origin writes before HubSpot', async t => {
  const calls = transport(t, []);
  for (const body of [null, [], { ...guest, email: '', phone: '' }, { ...guest, name: ' ' }, { ...guest, email: 'bad' }, { ...guest, phone: 'not-a-number' }, { ...guest, eventName: '' }, { ...guest, eventName: 'x'.repeat(121) }, { ...guest, lifecyclestage: 'customer' }, { ...guest, website: 'bot' }]) {
    assert.equal((await submit(body)).status, 400);
  }
  assert.equal((await submit(guest, env, 'https://another.example')).status, 403);
  assert.equal(calls.length, 0);
});

test('email guest becomes a lead and gets an event form submission', async t => {
  const calls = transport(t, [{ status: 404 }, { status: 201, body: { id: '42' } }, {}]);
  const result = await submit();
  assert.deepEqual(await result.json(), { ok: true });
  assert.equal(calls[1].body.properties.lifecyclestage, 'lead');
  assert.equal(calls[1].body.properties.bogabee_last_event, 'Fall market');
  assert.equal(calls[2].url, 'https://api.hsforms.com/submissions/v3/integration/secure/submit/123/00000000-0000-0000-0000-000000000000');
  assert.equal(calls[2].body.fields.some(field => field.name === 'lifecyclestage'), false);
  assert.equal(calls[2].body.context.hutk, undefined);
  assert.equal(calls[2].body.legalConsentOptions, undefined);
  assert.equal(calls[2].body.context.pageUri, `${origin}/event/?event=Fall+market`);
});

test('returning guest updates contact without changing lifecycle', async t => {
  const calls = transport(t, [{ body: { id: '42', properties: { lifecyclestage: 'customer' } } }, {}, {}]);
  assert.equal((await submit()).status, 200);
  assert.equal(calls[1].method, 'PATCH');
  assert.equal(calls[1].body.properties.lifecyclestage, undefined);
});

test('phone-only guest is matched by normalized phone and recorded', async t => {
  const calls = transport(t, [{ body: { results: [{ id: '24' }] } }, {}, {}]);
  assert.equal((await submit({ ...guest, email: '', phone: '+1 (732) 555-0123' })).status, 200);
  assert.equal(calls[0].body.filterGroups[0].filters[0].value, '7325550123');
  assert.equal(calls[1].method, 'PATCH');
  assert.equal(calls[2].body.fields.some(field => field.name === 'email'), false);
});

test('new phone-only guest is created as a lead', async t => {
  const calls = transport(t, [{ body: { results: [] } }, { status: 201 }, {}]);
  assert.equal((await submit({ ...guest, email: '', phone: '7325550123' })).status, 200);
  assert.equal(calls[1].body.properties.lifecyclestage, 'lead');
});

test('ambiguous phone match asks for email without changing contacts', async t => {
  const calls = transport(t, [{ body: { results: [{ id: '1' }, { id: '2' }] } }]);
  const result = await submit({ ...guest, email: '', phone: '7325550123' });
  assert.equal(result.status, 409);
  assert.match((await result.json()).error, /email/);
  assert.equal(calls.length, 1);
});

test('contact failure prevents event write; form failure never confirms success', async t => {
  const calls = transport(t, [{ status: 404 }, { status: 403 }, { status: 404 }, { status: 201 }, { status: 429 }]);
  assert.equal((await submit()).status, 502);
  assert.equal(calls.length, 2);
  assert.equal((await submit()).status, 502);
  assert.equal(calls.length, 5);
});

test('concurrent email creation conflict reuses the contact', async t => {
  const calls = transport(t, [{ status: 404 }, { status: 409 }, { body: { id: '42' } }, {}, {}]);
  assert.equal((await submit()).status, 200);
  assert.equal(calls[3].method, 'PATCH');
  assert.equal(calls[3].body.properties.lifecyclestage, undefined);
});

test('readiness reveals no account details or secrets', async () => {
  const response = await onRequestGet({ env, request: new Request(`${origin}/api/event-check-in`) });
  assert.deepEqual(await response.json(), { available: true });
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('an upstream timeout asks for verification before retrying a possibly saved visit', async t => {
  let count = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    count++;
    if (count === 1) return Response.json({}, { status: 404 });
    if (count === 2) return Response.json({ id: '42' }, { status: 201 });
    throw new DOMException('Timed out', 'TimeoutError');
  });
  const response = await submit();
  assert.equal(response.status, 504);
  assert.match((await response.json()).error, /host to check your sign-in before trying again/);
});
