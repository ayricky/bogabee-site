import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { localDatabase } from '../tools/sqlite-d1.mjs';
import { onRequestGet as listEvents, onRequestPost as saveEvent } from '../functions/api/internal/events.js';
import { rangeFor, shiftDay } from '../server/dashboard.js';

execFileSync(process.execPath, ['tools/build.mjs']);
await mkdir('test-results', { recursive: true });
const db = localDatabase();
let origin;
let unauthorized = false;
let missingSources = false;
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    if (url.pathname === '/api/internal/overview') {
      if (unauthorized) { res.writeHead(401, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'Sign in again.', code: 'unauthorized' })); return; }
      const range = rangeFor(Number(url.searchParams.get('days') || 30));
      const traffic = missingSources ? { state: 'unconfigured' } : { state: 'ready', pageviews: 12, sessions: 7, timeZone: 'America/New_York', limited: false, daily: Array.from({ length: range.days }, (_, index) => ({ day: shiftDay(range.start, index), count: index === range.days - 1 ? 12 : 0 })), sources: [{ label: 'Instagram', count: 7 }], pages: [{ label: '/', count: 12 }] };
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ range, traffic, checkins: missingSources ? { state: 'unconfigured' } : { state: 'ready', total: 0, counts: {}, unassigned: 0 }, identity: { email: 'test@example.com' }, hubspotUrl: missingSources ? null : 'https://app.hubspot.com/contacts/123' })); return;
    }
    if (url.pathname === '/api/internal/events') {
      if (unauthorized) { res.writeHead(401, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'Sign in again.', code: 'unauthorized' })); return; }
      let body = ''; for await (const chunk of req) body += chunk;
      const request = new Request(url, { method: req.method, headers: req.headers, ...(req.method === 'POST' ? { body } : {}) });
      const response = await (req.method === 'POST' ? saveEvent : listEvents)({ request, env: { BOGABEE_DB: db } });
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text()); return;
    }
    const path = url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname;
    const file = resolve('dist', `.${path}`); assert.ok(file.startsWith(resolve('dist') + '/'));
    const body = await readFile(file); const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg' };
    res.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream' }); res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
try {
  await page.goto(`${origin}/internal/`);
  await page.waitForFunction(() => document.getElementById('pageviews').textContent === '12');
  assert.equal(await page.locator('#sessions').textContent(), '7');
  assert.equal(await page.locator('#activity-chart rect').count(), 30);
  await page.screenshot({ path: 'test-results/dashboard-fixture-desktop.png', fullPage: true });
  await page.getByRole('link', { name: 'Events', exact: true }).click();
  await page.waitForFunction(() => !document.getElementById('event-fields').disabled);
  await page.locator('#event-name').fill('toString'); await page.locator('#event-date').fill('2026-09-19'); await page.locator('#save-event').click();
  await page.locator('.event-row').waitFor(); assert.match(await page.locator('.event-row .count').textContent(), /^0 recorded check-ins/);
  assert.match(await page.locator('.event-row a').first().getAttribute('href'), /event-qr\/\?event=toString/);
  await page.locator('#event-name').fill('toString'); await page.locator('#event-date').fill('2026-09-19'); await page.locator('#save-event').click();
  await page.locator('#event-error').waitFor({ state: 'visible' }); assert.match(await page.locator('#event-error').textContent(), /already exists/);
  await page.setViewportSize({ width: 375, height: 812 });
  assert.equal(await page.locator('#logout').isVisible(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await page.screenshot({ path: 'test-results/dashboard-fixture-mobile.png', fullPage: true });
  unauthorized = true; await page.locator('#period').selectOption('7');
  await page.locator('#access-message').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#period-description').textContent(), 'This period could not be loaded.');
  assert.equal(await page.locator('#activity-chart').textContent(), 'Activity is temporarily unavailable.');
  assert.equal(await page.locator('#access-chip').textContent(), 'Sign-in needed');
  assert.equal(await page.locator('#metrics-chip').textContent(), 'Unknown');
  unauthorized = false; await page.reload();
  await page.getByRole('link', { name: 'Events', exact: true }).click();
  await page.waitForFunction(() => !document.getElementById('event-fields').disabled);
  await page.locator('#event-name').fill('Expired session event'); await page.locator('#event-date').fill('2026-09-20');
  unauthorized = true; await page.locator('#save-event').click();
  await page.locator('#event-error').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#save-event').isDisabled(), true);
  assert.equal(await page.locator('#access-chip').textContent(), 'Sign-in needed');
  unauthorized = false; missingSources = true; await page.reload();
  await page.waitForFunction(() => document.getElementById('pageviews-note').textContent === 'Traffic not connected');
  assert.equal(await page.locator('#pageviews').textContent(), '—'); assert.equal(await page.locator('#checkins').textContent(), '—');
  await page.getByRole('link', { name: 'Connections', exact: true }).click(); assert.equal(await page.locator('#hubspot-link').isVisible(), false);
  assert.deepEqual(errors, []);
  console.log('Dashboard browser checks passed: navigation, data states, chart, events, duplicate names, QR links, mobile sign-out, expired session.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); db.close(); }
