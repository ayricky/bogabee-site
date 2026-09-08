import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportPKCS8, decodeJwt } from 'jose';
import { googleAnalytics } from '../server/google-analytics.js';
import { rangeFor } from '../server/dashboard.js';

async function config() {
  const { privateKey } = await generateKeyPair('RS256', { extractable: true });
  return { GA_PROPERTY_ID: '12345', GA_SERVICE_ACCOUNT_JSON: JSON.stringify({ type: 'service_account', client_email: 'test@test-project.iam.gserviceaccount.com', private_key: await exportPKCS8(privateKey) }) };
}
const report = (dimensions, metrics, values, metadata = {}) => ({ ...(dimensions.length ? { dimensionHeaders: dimensions.map(name => ({ name })) } : {}), metricHeaders: metrics.map(name => ({ name })), rows: values.map(([labels, numbers]) => ({ dimensionValues: labels.map(value => ({ value })), metricValues: numbers.map(value => ({ value: String(value) })) })), metadata });

test('reads GA reports with read-only service identity and the Bogabee hostname filter', async t => {
  const env = await config();
  let tokenRequests = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      tokenRequests++;
      const claims = decodeJwt(options.body.get('assertion'));
      assert.equal(claims.scope, 'https://www.googleapis.com/auth/analytics.readonly');
      assert.equal(claims.iss, 'test@test-project.iam.gserviceaccount.com');
      return Response.json({ access_token: 'test-only', expires_in: 3600 });
    }
    assert.equal(url, 'https://analyticsdata.googleapis.com/v1beta/properties/12345:batchRunReports');
    const requests = JSON.parse(options.body).requests;
    assert.equal(requests.length, 4);
    assert.deepEqual(requests[0].dimensionFilter.andGroup.expressions[0].filter.inListFilter.values, ['bogabeeapiaries.com', 'www.bogabeeapiaries.com']);
    return Response.json({ reports: [
      report([], ['screenPageViews', 'sessions'], [[[], [21, 10]]], { timeZone: 'America/New_York' }),
      report(['date'], ['screenPageViews'], [[['20260907'], [21]]]),
      report(['pagePath'], ['screenPageViews'], [[['/'], [21]]]),
      report(['sessionSource'], ['sessions'], [[['(direct)'], [10]]], { subjectToThresholding: true })
    ] });
  });
  const range = rangeFor(7, Date.parse('2026-09-07T16:00:00Z'));
  const result = await googleAnalytics(env, range);
  assert.equal(result.state, 'ready'); assert.equal(result.pageviews, 21); assert.equal(result.sessions, 10); assert.equal(result.daily.length, 7); assert.equal(result.daily.at(-1).count, 21); assert.equal(result.limited, true); assert.equal(result.sources[0].label, 'Direct');
  await googleAnalytics(env, range); assert.equal(tokenRequests, 1, 'Google access tokens are cached until near expiry');
});

test('a connected empty report is zero; absent, denied and malformed reports are not', async t => {
  const env = await config(); let responseMode = 'empty';
  t.mock.method(globalThis, 'fetch', async url => {
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'test-only', expires_in: 3600 });
    if (responseMode === 'denied') return Response.json({}, { status: 403 });
    if (responseMode === 'malformed') return Response.json({ reports: [] });
    return Response.json({ reports: [report([], ['screenPageViews', 'sessions'], []), report(['date'], ['screenPageViews'], []), report(['pagePath'], ['screenPageViews'], []), report(['sessionSource'], ['sessions'], [])] });
  });
  assert.deepEqual(await googleAnalytics({}, rangeFor(7)), { state: 'unconfigured' });
  const empty = await googleAnalytics(env, rangeFor(7)); assert.equal(empty.state, 'ready'); assert.equal(empty.pageviews, 0);
  responseMode = 'denied'; assert.deepEqual(await googleAnalytics(env, rangeFor(7)), { state: 'unavailable' });
  responseMode = 'malformed'; assert.deepEqual(await googleAnalytics(env, rangeFor(7)), { state: 'unavailable' });
});
