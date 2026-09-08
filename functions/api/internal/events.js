import { json } from '../../../server/dashboard.js';

export async function onRequestGet({ env }) {
  if (!env.BOGABEE_DB) return json({ state: 'unconfigured', events: [] });
  try {
    const result = await env.BOGABEE_DB.prepare('SELECT id, name, starts_on AS startsOn, created_at AS createdAt FROM events ORDER BY starts_on DESC, created_at DESC LIMIT 200').all();
    return json({ state: 'ready', events: result.results });
  } catch { return json({ state: 'unavailable', events: [] }, 503); }
}

export async function onRequestPost({ request, env }) {
  if (!env.BOGABEE_DB) return json({ error: 'Event storage is not connected yet.' }, 503);
  let body;
  try {
    const text = await request.text();
    if (text.length > 1000) return json({ error: 'Event details are too long.' }, 400);
    body = JSON.parse(text);
  } catch { return json({ error: 'Could not read the event details.' }, 400); }
  if (!body || typeof body.name !== 'string' || typeof body.startsOn !== 'string' || Object.keys(body).some(key => !['name', 'startsOn'].includes(key))) return json({ error: 'Enter an event name and date.' }, 400);
  const name = body.name.replace(/\s+/g, ' ').trim();
  const startsOn = body.startsOn;
  if (!name || name.length > 120 || !/^\d{4}-\d{2}-\d{2}$/.test(startsOn) || !Number.isFinite(Date.parse(startsOn)) || new Date(startsOn).toISOString().slice(0, 10) !== startsOn) return json({ error: 'Enter a valid name and date.' }, 400);
  const id = crypto.randomUUID();
  try {
    const result = await env.BOGABEE_DB.prepare('INSERT INTO events (id, name, starts_on) VALUES (?, ?, ?) ON CONFLICT(name) DO NOTHING').bind(id, name, startsOn).run();
    if (result.meta.changes === 0) return json({ error: 'That event name already exists. Include a date for a new occurrence.' }, 409);
    return json({ event: { id, name, startsOn } }, 201);
  } catch { return json({ error: 'The event could not be saved. Please try again.' }, 503); }
}
