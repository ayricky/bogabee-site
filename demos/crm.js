// Simulated HubSpot sync for the demos. Load after store.js.
// Every customer touchpoint becomes a sync item derived from the store's records; this file only
// keeps each item's sync status. In production the same rules run in Cloudflare Pages Functions
// with the HUBSPOT_TOKEN secret (see /demos/ideas/#hubspot).
(function () {
    const B = window.Bogabee;
    const KEY = 'bogabee-demo-crm';
    const PORTAL = '247317631';
    const LINKS = {
        contacts: `https://app.hubspot.com/contacts/${PORTAL}/objects/0-1/views/all/list`,
        deals: `https://app.hubspot.com/contacts/${PORTAL}/objects/0-3/views/all/list`,
    };

    const TOUCHPOINTS = [
        { id: 'signins', name: 'Event check-ins', object: 'Contact', rule: 'New guests become leads; known contacts keep their stage. Sets Last Bogabee event and interests.' },
        { id: 'orders', name: 'Paid orders', object: 'Contact + deal', rule: 'Contact moves to Customer. A closed-won deal in Online orders with the amount, jars and fulfillment.' },
        { id: 'quotes', name: 'Party favor quotes', object: 'Contact + deal', rule: 'A deal in Party favors whose stage follows the quote.' },
        { id: 'news', name: 'Harvest news opt-ins', object: 'Subscription', rule: 'Subscribes the contact to Harvest news, only when they ticked the box or signed up.' },
    ];
    const PIPELINES = [
        { name: 'Online orders', stages: ['Closed won'] },
        { name: 'Party favors', stages: ['New request', 'Label approval', 'Payment link sent', 'Paid (closed won)', 'Declined (closed lost)'] },
    ];
    const PROPERTIES = [
        { name: 'bogabee_last_event', label: 'Last Bogabee event', on: 'Contact', note: 'From event check-ins. Created in PR #4.' },
        { name: 'bogabee_interests', label: 'Interested in', on: 'Contact', note: 'Honey, Party favors, Bee talks.' },
        { name: 'lifecyclestage', label: 'Lifecycle stage', on: 'Contact', note: 'Lead for new check-ins, Customer after a paid order.' },
        { name: 'bogabee_fulfillment', label: 'Fulfillment', on: 'Deal', note: 'Porch pickup, local delivery or shipping.' },
        { name: 'amount', label: 'Amount', on: 'Deal', note: 'Order or quote total.' },
    ];
    // One sample failure, so the hub shows what a failed sync and Retry look like.
    const SAMPLE_FAILURE = 'signin:englishtown-farmers-market-3';

    const read = () => {
        try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; }
    };
    let db = read() || { initAt: Date.now(), items: {}, toggles: { signins: true, orders: true, quotes: true, news: true }, subs: [] };
    const save = () => {
        localStorage.setItem(KEY, JSON.stringify(db));
        window.dispatchEvent(new CustomEvent('bogabee:change', { detail: { key: KEY } }));
    };

    const nameOf = o => [o.first, o.last].filter(Boolean).join(' ') || o.name || o.email || o.phone || 'Guest';
    const itemsText = items => items.map(i => `${i.qty}× ${B.product(i.id).name}`).join(', ');
    const FULFILL = { porch: 'Porch pickup', local: 'Local delivery', ship: 'Shipping' };

    function quoteStage(q) {
        if (q.status === 'paid') return 'Paid (closed won)';
        if (q.status === 'declined') return 'Declined (closed lost)';
        if (q.status === 'approved') return 'Payment link sent';
        return (q.addons || []).includes('label') || q.logoName ? 'Label approval' : 'New request';
    }

    // Every record the store holds, as the HubSpot writes it would cause.
    function derive() {
        const out = [];
        const eventName = id => (B.events.get(id) || {}).name || 'Event';
        for (const s of B.signins.all()) {
            const ev = eventName(s.eventId);
            const interests = (s.interests || []).length ? ` · Interests: ${s.interests.join(', ')}` : '';
            out.push({
                key: 'signin:' + s.id, source: 'signins', at: s.at, who: nameOf(s), what: `Checked in at ${ev}`,
                objects: ['Contact'], link: 'contacts',
                detail: (s.returning ? 'Known contact, stage kept' : 'New contact, stage Lead') + ` · Last event: ${ev}` + interests,
                // A repeat check-in merges into this record; new details (email, phone, interests) sync again.
                sig: ['contact', s.email || '', s.phone || '', (s.interests || []).join(',')].join('|'),
            });
            if (s.news && s.email) out.push({
                key: 'news:signin:' + s.id, source: 'news', at: s.at, who: s.email, what: `Opted in at ${ev}`,
                objects: ['Subscription'], link: 'contacts', detail: 'Subscribed to Harvest news', sig: 'sub',
            });
        }
        for (const o of B.orders.all()) {
            const walkUp = !o.customer || !o.customer.email;
            out.push({
                key: 'order:' + o.id, source: 'orders', at: o.createdAt, who: walkUp ? 'Porch walk-up' : o.customer.name,
                what: `Paid order ${o.id}`, objects: walkUp ? ['Deal'] : ['Contact', 'Deal'], link: 'deals',
                pipeline: 'Online orders', stage: 'Closed won',
                detail: `${B.money(o.total)} · ${itemsText(o.items)} · ${FULFILL[o.fulfillment] || o.fulfillment}` + (walkUp ? ' · No contact (no email)' : ' · Contact stage: Customer'),
                sig: 'closed',
            });
            if (o.news && !walkUp) out.push({
                key: 'news:order:' + o.id, source: 'news', at: o.createdAt, who: o.customer.email, what: `Opted in at checkout (${o.id})`,
                objects: ['Subscription'], link: 'contacts', detail: 'Subscribed to Harvest news', sig: 'sub',
            });
        }
        for (const q of B.quotes.all()) {
            const stage = quoteStage(q);
            out.push({
                key: 'quote:' + q.id, source: 'quotes', at: q.at, who: (q.contact && q.contact.name) || 'Quote', what: `Party favors quote ${q.id}`,
                objects: ['Contact', 'Deal'], link: 'deals', pipeline: 'Party favors', stage,
                detail: `${B.money(q.total || 0)} · ${q.qty} jars · ${(q.event && q.event.type) || 'Event'}`, sig: stage,
            });
        }
        for (const s of db.subs) {
            out.push({
                key: 'news:journal:' + s.email, source: 'news', at: s.at, who: s.email, what: 'Signed up on the Journal',
                objects: ['Contact', 'Subscription'], link: 'contacts', detail: 'Subscribed to Harvest news', sig: 'sub',
            });
        }
        return out;
    }

    let timer = 0;
    // Bring each item's status up to date: new or changed items queue, then sync a moment later.
    function reconcile() {
        const now = Date.now();
        let changed = false, pending = false;
        const seenBefore = new Set(Object.keys(db.items));
        for (const it of derive()) {
            const st = db.items[it.key];
            const on = db.toggles[it.source] !== false;
            // A check-in that turns harvest news on later (a repeat check-in) is new work, even though the
            // record itself is old: its contact was already seen without the subscription.
            const parentSeen = it.key.startsWith('news:signin:') && seenBefore.has('signin:' + it.key.slice('news:signin:'.length));
            if (st && st.sig === 'contact' && it.sig.startsWith('contact|')) {
                // Items stored before contact details were part of the signature: adopt it quietly.
                st.sig = it.sig;
                changed = true;
            } else if (!st) {
                // Records from before the demo's HubSpot layer existed count as already synced.
                if (it.at < db.initAt && !parentSeen) {
                    db.items[it.key] = it.key === SAMPLE_FAILURE
                        ? { status: 'failed', at: it.at + 2000, sig: it.sig, error: "HubSpot didn't respond in time.", attempts: 1 }
                        : { status: 'synced', at: it.at + 2000, sig: it.sig, attempts: 1 };
                } else {
                    db.items[it.key] = { status: on ? 'queued' : 'paused', at: now, sig: it.sig, attempts: 0 };
                }
                changed = true;
            } else if (st.sig !== it.sig) {
                Object.assign(st, { status: on ? 'queued' : 'paused', at: now, prev: st.sig, sig: it.sig, error: '' });
                changed = true;
            } else if (st.status === 'paused' && on) {
                Object.assign(st, { status: 'queued', at: now });
                changed = true;
            }
            const cur = db.items[it.key];
            if (cur.status === 'queued') {
                // Queued work finishes about a second after it was queued, even if no page was open then.
                if (now - cur.at >= 1200) { Object.assign(cur, { status: 'synced', at: cur.at + 1200, attempts: (cur.attempts || 0) + 1 }); changed = true; }
                else pending = true;
            }
        }
        if (changed) save();
        clearTimeout(timer);
        if (pending) timer = setTimeout(reconcile, 400);
    }

    function items() {
        reconcile();
        return derive().map(it => ({ ...it, ...(db.items[it.key] || { status: 'queued', at: Date.now() }), recordAt: it.at }))
            .sort((a, b) => b.at - a.at);
    }

    function retry(key) {
        const st = db.items[key];
        if (!st) return;
        Object.assign(st, { status: 'queued', at: Date.now(), error: '' });
        save();
        reconcile();
    }

    function toggle(id, on) {
        db.toggles[id] = on;
        save();
        reconcile();
    }

    function subscribe(email, source) {
        email = String(email || '').trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'Enter a valid email address.' };
        if (!db.subs.some(s => s.email === email)) {
            db.subs.push({ email, at: Date.now(), source: source || 'journal' });
            save();
            reconcile();
        }
        return { ok: true };
    }

    // Other tabs write the store (handled by store.js) and this key (handled here).
    window.addEventListener('storage', e => {
        if (e.key === KEY) { db = read() || db; window.dispatchEvent(new CustomEvent('bogabee:change', { detail: { key: KEY } })); }
    });
    window.addEventListener('bogabee:change', e => { if (!e.detail || e.detail.key !== KEY) reconcile(); });

    // The hub's HubSpot badge (failed syncs) is drawn by hub/hub.js from items().

    // "Get new posts by email": any element with data-signup becomes the form.
    const SIGNUP_CSS = `
    .signup { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr); gap: 16px 40px; align-items: center; margin: clamp(48px, 7vw, 88px) auto; padding: clamp(24px, 4vw, 40px); border-radius: 24px; background: var(--paper); box-shadow: 0 1px 0 var(--line), 0 24px 50px -36px rgb(36 24 14 / .4); }
    .signup h2 { margin: 0; font-size: clamp(28px, 3vw, 38px); }
    .signup p { margin: 8px 0 0; color: var(--muted); font-size: 15px; }
    .signup form { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; }
    .signup input { min-width: 0; padding: 14px 16px; border: 1px solid rgb(86 54 33 / .25); border-radius: 999px; background: #fff; font: inherit; color: var(--ink); }
    .signup input:focus-visible { outline: 2px solid var(--honey); outline-offset: 2px; }
    .signup input[aria-invalid="true"] { border-color: #a3341f; }
    .signup .btn { padding: 14px 24px; }
    .signup .fine { grid-column: 1 / -1; margin: 0; font-size: 13px; }
    .signup .err { grid-column: 1 / -1; margin: 0; color: #a3341f; font-size: 14px; }
    .signup .err:empty { display: none; }
    .signup .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    .signup .done { margin: 0; font: italic 400 22px/1.3 var(--display); color: var(--ink); }
    @media (max-width: 720px) { .signup { grid-template-columns: minmax(0, 1fr); } }
    @media (max-width: 420px) { .signup form { grid-template-columns: minmax(0, 1fr); } }`;
    let signupCount = 0;
    function mountSignups() {
        const spots = document.querySelectorAll('[data-signup]:not(.signup)');
        if (!spots.length) return;
        if (!document.getElementById('signup-css')) {
            const st = document.createElement('style');
            st.id = 'signup-css';
            st.textContent = SIGNUP_CSS;
            document.head.appendChild(st);
        }
        spots.forEach(el => {
            const n = ++signupCount;
            el.classList.add('signup', 'wrap');
            el.setAttribute('aria-labelledby', `signup-title-${n}`);
            el.innerHTML = `
                <div><h2 class="display" id="signup-title-${n}">Get new posts by email</h2><p>New journal posts and word when a harvest is ready.</p></div>
                <form novalidate>
                    <label class="sr-only" for="signup-email-${n}">Email</label>
                    <input type="email" id="signup-email-${n}" autocomplete="email" placeholder="you@example.com" aria-describedby="signup-err-${n}" required>
                    <button class="btn btn-dark" type="submit">Subscribe</button>
                    <p class="err" id="signup-err-${n}" role="alert"></p>
                    <p class="fine">Only with your sign-up. Unsubscribe anytime.</p>
                </form>`;
            const form = el.querySelector('form'), input = el.querySelector('input'), err = el.querySelector('.err');
            input.addEventListener('input', () => { input.removeAttribute('aria-invalid'); err.textContent = ''; });
            form.addEventListener('submit', e => {
                e.preventDefault();
                const res = subscribe(input.value, el.dataset.signup || 'journal');
                if (!res.ok) { err.textContent = res.error; input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
                form.outerHTML = `<p class="done" tabindex="-1">You're subscribed. Watch ${input.value.trim().replace(/[<>&"]/g, '')} for the next post.</p>`;
                el.querySelector('.done').focus();
            });
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountSignups); else mountSignups();

    B.crm = {
        PORTAL, LINKS, TOUCHPOINTS, PIPELINES, PROPERTIES, KEY,
        items, retry, toggle, subscribe, quoteStage, reconcile,
        toggles: () => ({ ...db.toggles }),
        status: key => db.items[key] || null,
        link: kind => LINKS[kind] || LINKS.contacts,
    };
    reconcile();
})();
