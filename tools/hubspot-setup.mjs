#!/usr/bin/env node
// Sets up Bogabee's HubSpot account (portal 247317631) for the site: the contact and deal
// properties, the Online orders and Party favors deal pipelines, and a check for the
// Harvest news subscription type. Safe to run again: it only adds what's missing.
//
//   HUBSPOT_TOKEN=pat-... node tools/hubspot-setup.mjs            # report what it would do
//   HUBSPOT_TOKEN=pat-... node tools/hubspot-setup.mjs --apply    # make the changes
//
// The private app behind the token needs these scopes:
//   crm.objects.contacts.read, crm.objects.contacts.write, crm.schemas.contacts.read, crm.schemas.contacts.write,
//   crm.objects.deals.read, crm.objects.deals.write, crm.schemas.deals.read, crm.schemas.deals.write,
//   communication_preferences.read_write, forms
// HubSpot has no API for creating subscription types; create "Harvest news" under
// Settings > Marketing > Email > Subscription types if the report says it's missing.

const TOKEN = process.env.HUBSPOT_TOKEN;
const API = process.env.HUBSPOT_API || 'https://api.hubapi.com';
const APPLY = process.argv.includes('--apply');
if (!TOKEN) { console.error('Set HUBSPOT_TOKEN.'); process.exit(1); }

const CONTACT_PROPS = [
    {
        name: 'bogabee_interests', label: 'Bogabee interests', type: 'enumeration', fieldType: 'checkbox', groupName: 'contactinformation',
        description: 'What a guest said they were interested in when checking in at an event.',
        options: ['Honey', 'Party favors', 'Bee talks'].map((label, i) => ({ label, value: label.toLowerCase().replace(/ /g, '_'), displayOrder: i })),
    },
];
const DEAL_PROPS = [
    {
        name: 'bogabee_fulfillment', label: 'Bogabee fulfillment', type: 'enumeration', fieldType: 'select', groupName: 'dealinformation',
        description: 'How a paid order reaches the customer.',
        options: ['Porch pickup', 'Porch walk-up', 'Local delivery', 'Shipping'].map((label, i) => ({ label, value: label.toLowerCase().replace(/[ -]/g, '_'), displayOrder: i })),
    },
    { name: 'bogabee_order_id', label: 'Bogabee order number', type: 'string', fieldType: 'text', groupName: 'dealinformation', description: 'The order number on the receipt, e.g. BG-4KD9.' },
    { name: 'bogabee_quote_id', label: 'Bogabee quote number', type: 'string', fieldType: 'text', groupName: 'dealinformation', description: 'The party favors quote number, e.g. Q-7K2M.' },
];
// probability 1.0 + isClosed = closed won; 0.0 + isClosed = closed lost.
const stage = (label, probability, closed = false) => ({ label, metadata: { probability: String(probability), ...(closed ? { isClosed: 'true' } : {}) } });
const PIPELINES = [
    { label: 'Online orders', stages: [stage('Paid', 1.0, true), stage('Refunded', 0.0, true)] },
    { label: 'Party favors', stages: [stage('New request', 0.2), stage('Label approval', 0.4), stage('Payment link sent', 0.7), stage('Paid', 1.0, true), stage('Declined', 0.0, true)] },
];

async function hs(method, path, body) {
    const res = await fetch(API + path, {
        method,
        headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) { const err = new Error(`${method} ${path} → ${res.status}: ${data?.message || text}`); err.status = res.status; err.data = data; throw err; }
    return data;
}

const plan = [];
const note = (status, what) => { plan.push([status, what]); console.log(`${status.padEnd(8)} ${what}`); };

async function properties(objectType, wanted, mustExist = []) {
    const { results } = await hs('GET', `/crm/v3/properties/${objectType}`);
    const have = new Set(results.map(p => p.name));
    for (const name of mustExist) note(have.has(name) ? 'ok' : 'MISSING', `${objectType} property ${name}${have.has(name) ? '' : ' (expected from PR #4; create it by hand or rerun that setup)'}`);
    for (const prop of wanted) {
        if (have.has(prop.name)) { note('ok', `${objectType} property ${prop.name}`); continue; }
        if (APPLY) { await hs('POST', `/crm/v3/properties/${objectType}`, prop); note('created', `${objectType} property ${prop.name}`); }
        else note('create', `${objectType} property ${prop.name}`);
    }
}

async function pipelines() {
    const { results } = await hs('GET', '/crm/v3/pipelines/deals');
    for (const want of PIPELINES) {
        const found = results.find(p => p.label.toLowerCase() === want.label.toLowerCase());
        if (found) {
            const labels = new Set(found.stages.map(s => s.label.toLowerCase()));
            const missing = want.stages.filter(s => !labels.has(s.label.toLowerCase()));
            if (!missing.length) { note('ok', `pipeline ${want.label} (${found.stages.length} stages)`); continue; }
            for (const s of missing) {
                if (APPLY) { await hs('POST', `/crm/v3/pipelines/deals/${found.id}/stages`, { ...s, displayOrder: found.stages.length + want.stages.indexOf(s) }); note('created', `stage ${want.label} → ${s.label}`); }
                else note('create', `stage ${want.label} → ${s.label}`);
            }
            continue;
        }
        if (!APPLY) { note('create', `pipeline ${want.label}: ${want.stages.map(s => s.label).join(', ')}`); continue; }
        try {
            await hs('POST', '/crm/v3/pipelines/deals', { label: want.label, displayOrder: results.length, stages: want.stages.map((s, i) => ({ ...s, displayOrder: i })) });
            note('created', `pipeline ${want.label}`);
        } catch (err) {
            // Free accounts allow one deal pipeline. Fall back to adding the stages to it, prefixed so they stay distinguishable.
            if (err.status !== 400 && err.status !== 403) throw err;
            const main = results[0];
            note('limit', `can't add pipeline ${want.label} (${err.message.split(': ').pop()}); adding its stages to "${main.label}" instead`);
            const labels = new Set(main.stages.map(s => s.label.toLowerCase()));
            for (const s of want.stages) {
                const label = `${want.label}: ${s.label}`;
                if (labels.has(label.toLowerCase())) { note('ok', `stage ${main.label} → ${label}`); continue; }
                await hs('POST', `/crm/v3/pipelines/deals/${main.id}/stages`, { ...s, label, displayOrder: main.stages.length + want.stages.indexOf(s) });
                note('created', `stage ${main.label} → ${label}`);
            }
        }
    }
}

async function subscriptions() {
    try {
        const { subscriptionDefinitions = [] } = await hs('GET', '/communication-preferences/v3/definitions');
        const harvest = subscriptionDefinitions.find(d => /harvest news/i.test(d.name));
        note(harvest ? 'ok' : 'MANUAL', harvest ? `subscription type Harvest news (id ${harvest.id})` : 'subscription type Harvest news: create it in Settings > Marketing > Email > Subscription types');
    } catch (err) {
        note('MANUAL', `couldn't read subscription types (${err.status}); check the token has communication_preferences.read_write`);
    }
}

try {
    const me = await hs('GET', '/account-info/v3/details').catch(() => null);
    console.log(`HubSpot portal ${me?.portalId ?? '?'}${APPLY ? '' : ' (report only; pass --apply to make changes)'}\n`);
    if (me && String(me.portalId) !== '247317631') console.log('Note: this is not Bogabee\'s portal 247317631.\n');
    await properties('contacts', CONTACT_PROPS, ['bogabee_last_event']);
    await properties('deals', DEAL_PROPS);
    await pipelines();
    await subscriptions();
} catch (err) {
    console.error(`\nStopped: ${err.message}`);
    if (err.status === 401) console.error('The token was rejected. Check it was copied whole and the app is still installed.');
    if (err.status === 403) console.error('The token is missing a scope listed at the top of this file.');
    process.exit(1);
}
