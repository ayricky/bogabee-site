// An isolated tailnet preview, never included in dist/ or Cloudflare Functions.
// Only local event records are mutable. It never loads account credentials.
import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { localDatabase } from './sqlite-d1.mjs';
import { onRequestGet as overview } from '../functions/api/internal/overview.js';
import { onRequestGet as events, onRequestPost as createEvent } from '../functions/api/internal/events.js';

await mkdir('.wrangler', { recursive: true });
const db = localDatabase('.wrangler/dashboard-preview.sqlite');
const origin = 'https://ayrdevbox.tail429003.ts.net:8766';
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    if (url.pathname.startsWith('/api/internal/')) {
      if (req.method !== 'GET' && req.headers.origin !== origin) { res.writeHead(403); res.end(); return; }
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 2000) { res.writeHead(413); res.end(); return; } }
      const request = new Request(url, { method: req.method, headers: req.headers, ...(req.method === 'POST' ? { body } : {}) });
      let response;
      if (url.pathname === '/api/internal/overview' && req.method === 'GET') {
        response = await overview({ request, env: {}, data: { identity: { email: 'Preview workspace' } } });
        if (response.ok) response = Response.json({ ...await response.json(), preview: true }, { headers: { 'cache-control': 'no-store' } });
      } else if (url.pathname === '/api/internal/events' && ['GET', 'POST'].includes(req.method)) {
        response = await (req.method === 'GET' ? events : createEvent)({ request, env: { BOGABEE_DB: db } });
      } else response = new Response(null, { status: 404 });
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text()); return;
    }
    if (url.pathname.startsWith('/api/')) {
      // Public event forms remain unavailable in this credential-free preview.
      const response = url.pathname === '/api/event-check-in' && req.method === 'GET'
        ? Response.json({ available: false }) : Response.json({ error: 'Submissions are disabled in this preview.' }, { status: 503 });
      res.writeHead(response.status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(await response.text()); return;
    }
    const upstream = await fetch(`http://127.0.0.1:8766${url.pathname}${url.search}`, { redirect: 'manual' });
    const headers = Object.fromEntries(upstream.headers); delete headers['content-encoding']; delete headers['content-length'];
    if (headers.location) { const redirect = new URL(headers.location, url); headers.location = redirect.pathname + redirect.search; }
    res.writeHead(upstream.status, headers); res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch { res.writeHead(502); res.end('Preview temporarily unavailable.'); }
});
server.listen(8772, '127.0.0.1', () => console.log('Bogabee dashboard preview listening on 127.0.0.1:8772'));
process.on('SIGTERM', () => server.close(() => { db.close(); process.exit(0); }));
