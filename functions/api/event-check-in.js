const CONTACTS = 'https://api.hubapi.com/crm/v3/objects/contacts';
const KEYS = ['name', 'email', 'phone', 'eventName', 'website'];

function json(body, status = 200) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

function configured(env, origin) {
  return Boolean(env.HUBSPOT_TOKEN && /^\d+$/.test(env.HUBSPOT_PORTAL_ID || '') &&
    /^[a-f0-9-]{36}$/i.test(env.HUBSPOT_EVENT_FORM_ID || '') && env.EVENT_ALLOWED_ORIGIN === origin);
}

function parseGuest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !KEYS.includes(key))) return null;
  const guest = {};
  const limits = { name: 120, email: 254, phone: 40, eventName: 120, website: 200 };
  for (const key of KEYS) {
    const value = body[key] ?? '';
    if (typeof value !== 'string' || value.length > limits[key]) return null;
    guest[key] = value.trim();
  }
  guest.name = guest.name.replace(/\s+/g, ' ');
  guest.eventName = guest.eventName.replace(/\s+/g, ' ');
  if (guest.name.length < 2 || !guest.eventName || guest.website || (!guest.email && !guest.phone)) return null;
  if (guest.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guest.email)) return null;
  const digits = guest.phone.replace(/\D/g, '');
  if (guest.phone && (!/^[+\d\s().-]+$/.test(guest.phone) || digits.length < 7 || digits.length > 15)) return null;
  return guest;
}

async function hubspot(env, url, method, body) {
  const response = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${env.HUBSPOT_TOKEN}`, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(8000)
  });
  return response;
}

async function findContact(env, guest) {
  if (guest.email) {
    const response = await hubspot(env, `${CONTACTS}/${encodeURIComponent(guest.email)}?idProperty=email`, 'GET');
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('Contact lookup failed');
    const contact = await response.json();
    if (typeof contact.id !== 'string') throw new Error('Invalid contact response');
    return contact.id;
  }
  const digits = guest.phone.replace(/\D/g, '');
  const normalized = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  const response = await hubspot(env, `${CONTACTS}/search`, 'POST', {
    filterGroups: [{ filters: [{ propertyName: 'hs_searchable_calculated_phone_number', operator: 'EQ', value: normalized }] }],
    properties: ['phone'], limit: 2
  });
  if (!response.ok) throw new Error('Contact lookup failed');
  const contacts = await response.json();
  if (!Array.isArray(contacts.results)) throw new Error('Invalid contact response');
  if (contacts.results.length > 1) return 'ambiguous';
  if (contacts.results.length && typeof contacts.results[0].id !== 'string') throw new Error('Invalid contact response');
  return contacts.results[0]?.id ?? null;
}

export async function onRequestGet({ request, env }) {
  return json({ available: configured(env, new URL(request.url).origin) });
}

export async function onRequestPost({ request, env }) {
  const origin = new URL(request.url).origin;
  if (request.headers.get('origin') !== origin) return json({ error: 'Please sign in from the event page.' }, 403);
  if (!configured(env, origin)) return json({ error: 'Event sign-in is not available yet. Please speak with the event host.' }, 503);
  if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'Expected JSON.' }, 415);
  if (Number(request.headers.get('content-length')) > 4096) return json({ error: 'Submission is too large.' }, 413);
  let guest;
  try {
    const text = await request.text();
    if (text.length > 4096) return json({ error: 'Submission is too large.' }, 413);
    guest = parseGuest(JSON.parse(text));
  } catch {
    return json({ error: 'Could not read your details. Please try again.' }, 400);
  }
  if (!guest) return json({ error: 'Please provide your name, event, and a valid email or phone number.' }, 400);

  try {
    let id = await findContact(env, guest);
    if (id === 'ambiguous') return json({ error: 'Please add an email address, or ask the event host to help you sign in.' }, 409);
    const split = guest.name.lastIndexOf(' ');
    const properties = {
      firstname: split > 0 ? guest.name.slice(0, split) : guest.name,
      ...(split > 0 ? { lastname: guest.name.slice(split + 1) } : {}),
      ...(guest.email ? { email: guest.email } : {}),
      ...(guest.phone ? { phone: guest.phone } : {}),
      bogabee_last_event: guest.eventName
    };
    let contact = await hubspot(env, id ? `${CONTACTS}/${encodeURIComponent(id)}` : CONTACTS, id ? 'PATCH' : 'POST', {
      properties: id ? properties : { ...properties, lifecyclestage: 'lead' }
    });
    // Another email submission may have created this contact since our lookup.
    if (!id && guest.email && contact.status === 409) {
      id = await findContact(env, guest);
      if (id) contact = await hubspot(env, `${CONTACTS}/${encodeURIComponent(id)}`, 'PATCH', { properties });
    }
    if (!contact.ok) throw new Error('Contact write failed');

    const page = new URL('/event/', origin);
    page.searchParams.set('event', guest.eventName);
    const submission = await hubspot(env,
      `https://api.hsforms.com/submissions/v3/integration/secure/submit/${env.HUBSPOT_PORTAL_ID}/${env.HUBSPOT_EVENT_FORM_ID}`,
      'POST', {
        fields: Object.entries(properties).map(([name, value]) => ({ objectTypeId: '0-1', name, value })),
        submittedAt: String(Date.now()),
        // No browser tracking cookie: this page also runs on shared tablets.
        context: { pageUri: page.href, pageName: `${guest.eventName} | Bogabee event sign-in` }
      });
    if (!submission.ok) throw new Error('Event submission failed');
    return json({ ok: true });
  } catch (error) {
    // HubSpot error bodies can contain guest details. Do not log or return them.
    if (error.name === 'TimeoutError' || error.name === 'AbortError' || error instanceof TypeError) {
      return json({ error: 'The connection was interrupted. Please ask the event host to check your sign-in before trying again.' }, 504);
    }
    return json({ error: 'We could not complete your sign-in. Please try again or speak with the event host.' }, 502);
  }
}
