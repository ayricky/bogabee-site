import { json, rangeFor, recordedCheckins } from '../../../server/dashboard.js';
import { googleAnalytics } from '../../../server/google-analytics.js';

export async function onRequestGet({ request, env, data }) {
  const days = Number(new URL(request.url).searchParams.get('days') || 30);
  if (![7, 30, 90].includes(days)) return json({ error: 'Choose 7, 30, or 90 days.' }, 400);
  const range = rangeFor(days);
  const [traffic, checkins] = await Promise.all([googleAnalytics(env, range), recordedCheckins(env, range)]);
  return json({ range, traffic, checkins, identity: data.identity, hubspotUrl: /^\d+$/.test(env.HUBSPOT_PORTAL_ID || '') ? `https://app.hubspot.com/contacts/${env.HUBSPOT_PORTAL_ID}` : null });
}
