import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import { onRequestGet, onRequestPost } from '../functions/api/event-check-in.js';

execFileSync(process.execPath, ['tools/build.mjs']);
await mkdir('test-results', { recursive: true });
let connected = false;
let rejectForm = false;
const calls = [];
const contacts = new Map();
globalThis.fetch = async (url, options) => {
  const path = new URL(url);
  assert.ok(['api.hubapi.com', 'api.hsforms.com'].includes(path.hostname), 'No live transport is permitted');
  const body = options.body ? JSON.parse(options.body) : null;
  calls.push({ url, method: options.method, body });
  if (path.hostname === 'api.hsforms.com') return Response.json({}, { status: rejectForm ? 503 : 200 });
  if (options.method === 'GET') {
    const contact = contacts.get(decodeURIComponent(path.pathname.split('/').pop()));
    return Response.json(contact || {}, { status: contact ? 200 : 404 });
  }
  if (path.pathname.endsWith('/search')) {
    const digits = body.filterGroups[0].filters[0].value;
    const matches = [...contacts.values()].filter(contact => contact.properties.phone?.replace(/\D/g, '').endsWith(digits));
    return Response.json({ results: matches });
  }
  if (options.method === 'POST') {
    const contact = { id: String(contacts.size + 1), properties: body.properties };
    contacts.set(body.properties.email || body.properties.phone, contact);
    return Response.json(contact, { status: 201 });
  }
  return Response.json({});
};

let origin;
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    if (url.pathname === '/api/event-check-in') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const request = new Request(url, { method: req.method, headers: req.headers, ...(req.method === 'POST' ? { body: Buffer.concat(chunks) } : {}) });
      const env = connected ? { HUBSPOT_TOKEN: 'test-only', HUBSPOT_PORTAL_ID: '123', HUBSPOT_EVENT_FORM_ID: '00000000-0000-0000-0000-000000000000', EVENT_ALLOWED_ORIGIN: origin } : {};
      const response = await (req.method === 'POST' ? onRequestPost : onRequestGet)({ request, env });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(await response.text());
      return;
    }
    const pathname = url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname;
    const file = resolve('dist', `.${pathname}`);
    assert.ok(file.startsWith(`${resolve('dist')}/`));
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg' };
    res.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());

try {
  await page.goto(`${origin}/event/?event=Fall%20market`);
  await page.getByText('Event sign-in is not available yet.', { exact: false }).waitFor();
  assert.equal(await page.locator('#guest-name').isDisabled(), true);
  assert.equal(calls.length, 0);

  connected = true;
  await page.reload();
  await page.waitForFunction(() => !document.getElementById('guest-fields').disabled);
  await page.screenshot({ path: 'test-results/event-desktop.png', fullPage: true });
  await page.locator('#guest-name').fill('Jamie Bee');
  await page.locator('#submit-button').click();
  assert.equal(calls.length, 0, 'A contact method is required');
  await page.locator('#guest-email').fill('jamie@example.com');
  await page.locator('#submit-button').click();
  await page.locator('#confirmation').waitFor({ state: 'visible' });
  assert.equal(contacts.get('jamie@example.com').properties.lifecyclestage, 'lead');
  assert.equal(calls.at(-1).body.fields.find(field => field.name === 'bogabee_last_event').value, 'Fall market');
  assert.equal(await page.locator('#guest-email').inputValue(), '', 'Guest details clear on success');

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${origin}/event/?event=Fall%20market&kiosk=1`);
  await page.waitForFunction(() => !document.getElementById('guest-fields').disabled);
  await page.screenshot({ path: 'test-results/event-mobile.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  for (const id of ['guest-name', 'guest-email', 'guest-phone']) {
    assert.equal(await page.locator(`#${id}`).getAttribute('autocomplete'), 'off');
  }
  await page.clock.install();
  await page.locator('#guest-name').fill('Alex Honey');
  await page.locator('#guest-phone').fill('7325550123');
  await page.locator('#submit-button').click();
  await page.locator('#confirmation').waitFor({ state: 'visible' });
  assert.equal(contacts.get('7325550123').properties.lifecyclestage, 'lead');
  await page.clock.fastForward(8100);
  assert.equal(await page.locator('#entry').isVisible(), true);
  assert.equal(await page.locator('#guest-phone').inputValue(), '');

  rejectForm = true;
  await page.locator('#guest-name').fill('Alex Honey');
  await page.locator('#guest-phone').fill('7325550123');
  await page.locator('#submit-button').click();
  await page.locator('#submit-error').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#confirmation').isVisible(), false);
  await page.clock.fastForward(20000);
  await page.locator('#guest-name').fill('Alex Honeybee');
  await page.clock.fastForward(20000);
  assert.equal(await page.locator('#guest-phone').inputValue(), '7325550123');
  await page.clock.fastForward(11000);
  assert.equal(await page.locator('#guest-phone').inputValue(), '');
  rejectForm = false;

  await page.goto(`${origin}/event/`);
  await page.getByText('Please use the QR code for this event', { exact: false }).waitFor();
  assert.equal(await page.locator('#guest-name').isDisabled(), true);

  await page.goto(`${origin}/event-qr/`);
  await page.locator('#event-name').fill('Fall market & honey tasting');
  await page.getByRole('button', { name: 'Create QR code' }).click();
  await page.locator('#qr-image svg').waitFor();
  const qrImage = PNG.sync.read(await page.locator('#qr-image').screenshot());
  const decoded = jsQR(new Uint8ClampedArray(qrImage.data), qrImage.width, qrImage.height);
  assert.ok(decoded, 'QR code decodes');
  const expected = `${origin}/event/?event=Fall+market+%26+honey+tasting`;
  assert.equal(decoded.data, expected);
  assert.equal(await page.locator('#kiosk-link').getAttribute('href'), `${expected}&kiosk=1`);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download QR as SVG' }).click();
  assert.match((await download).suggestedFilename(), /^bogabee-fall-market.*\.svg$/);
  await page.screenshot({ path: 'test-results/event-qr-mobile.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.locator('#event-name').fill('Different event');
  assert.equal(await page.locator('#poster').isVisible(), false, 'Editing cannot leave a stale printable QR');
  assert.deepEqual(errors, []);
  console.log('Browser checks passed: unavailable, validation, email + phone CRM flows, kiosk reset, failed form write, mobile layout, QR decode/download.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
