// The owner hub's shell, shared by every hub screen. Load after ../store.js, seed.js and ../crm.js.
// It draws the navigation (a sidebar on wide screens, a bottom tab bar on phones), keeps every
// badge current, announces new orders and quotes, and provides the toast, confirm and date helpers.
// Pages mark their screen with <aside class="hub-side" data-screen="orders"></aside>.
(function () {
    const B = window.Bogabee;
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const DAY = 864e5;
    const REVISIONS = 'bogabee-demo-revisions';

    // ---------- Dates: one format everywhere ----------
    const fmt = (ts, o) => new Date(ts).toLocaleString('en-US', o);
    const time = ts => fmt(ts, { hour: 'numeric', minute: '2-digit' });
    const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
    // "12 min ago" within the hour, then "Today 3:18 PM", "Yesterday 3:18 PM", "Mon, Oct 20".
    function when(ts, { relative = true } = {}) {
        if (!ts) return '';
        const now = Date.now(), mins = Math.round((now - ts) / 60000);
        if (relative && mins >= 0 && mins < 60) return mins < 1 ? 'Just now' : `${mins} min ago`;
        if (sameDay(ts, now)) return 'Today ' + time(ts);
        if (sameDay(ts, now - DAY)) return 'Yesterday ' + time(ts);
        const y = new Date(ts).getFullYear() !== new Date(now).getFullYear();
        return fmt(ts, { weekday: 'short', month: 'short', day: 'numeric', ...(y ? { year: 'numeric' } : {}) });
    }
    // A calendar date stored as YYYY-MM-DD, read in local time.
    const day = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
    const dayText = iso => {
        const d = day(iso), y = d.getFullYear() !== new Date().getFullYear();
        return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...(y ? { year: 'numeric' } : {}) });
    };
    const daysUntil = iso => { const t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((day(iso) - t) / DAY); };
    const isoDay = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

    // ---------- Toast with an optional Undo ----------
    let toastEl, toastTimer;
    function toast(msg, { error = false, undo = null } = {}) {
        if (!toastEl) {
            toastEl = document.createElement('div');
            toastEl.className = 'toast';
            toastEl.setAttribute('role', 'status');
            toastEl.hidden = true;
            document.body.appendChild(toastEl);
        }
        toastEl.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button type="button" class="toast-undo">Undo</button>' : ''}`;
        toastEl.classList.toggle('err', error);
        toastEl.hidden = false;
        if (undo) toastEl.querySelector('.toast-undo').addEventListener('click', () => { toastEl.hidden = true; undo(); }, { once: true });
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { toastEl.hidden = true; }, error ? 6000 : undo ? 7000 : 2600);
    }

    // ---------- Dialogs ----------
    // A modal form. done(value) runs once: as soon as a button submits it, or with '' on Escape.
    function dialog(inner, done, cls = '') {
        const d = document.createElement('dialog');
        d.className = 'hub-dialog ' + cls;
        d.innerHTML = `<form method="dialog">${inner}</form>`;
        document.body.appendChild(d);
        let settled = false;
        const finish = v => { if (!settled) { settled = true; done(v, d); } };
        d.querySelector('form').addEventListener('submit', e => {
            e.preventDefault();
            const v = (e.submitter && e.submitter.value) || '';
            if (v !== 'no' && v !== 'cancel' && !d.querySelector('form').reportValidity()) return;
            finish(v);
            d.close(v);
        });
        d.addEventListener('close', () => { finish(d.returnValue || ''); setTimeout(() => d.remove(), 0); });
        return d;
    }
    function confirm({ title, body = '', html = '', ok = 'OK', danger = false }) {
        return new Promise(resolve => {
            const d = dialog(`<h2>${esc(title)}</h2>${body ? `<p>${esc(body)}</p>` : ''}${html}
                <div class="acts"><button class="btn btn-quiet" value="no">Cancel</button><button class="btn ${danger ? 'btn-dark' : ''}" value="yes">${esc(ok)}</button></div>`,
                v => resolve(v === 'yes'));
            d.showModal();
            d.querySelector('[value="no"]').focus();
        });
    }

    // ---------- Copy, with a fallback when the clipboard isn't available ----------
    async function copy(text, input) {
        try {
            if (!navigator.clipboard) throw new Error('no clipboard');
            await navigator.clipboard.writeText(text);
            return true;
        } catch (e) {
            if (input) { input.focus(); input.select(); }
            return false;
        }
    }

    // ---------- Navigation ----------
    const SCREENS = [
        { id: 'orders', href: './', label: 'Orders', tab: true },
        { id: 'events', href: 'events.html', label: 'Events', tab: true },
        { id: 'quotes', href: 'quotes.html', label: 'Quotes', tab: true },
        { id: 'journal', href: 'journal.html', label: 'Journal', tab: true },
        { id: 'pages', href: 'pages.html', label: 'Pages' },
        { id: 'hubspot', href: 'hubspot.html', label: 'HubSpot' },
    ];
    const ICONS = {
        orders: '<path d="M5 8h14l-1.2 11.2A2 2 0 0 1 15.8 21H8.2a2 2 0 0 1-2-1.8z"/><path d="M9 10V6.5a3 3 0 0 1 6 0V10"/>',
        events: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
        quotes: '<path d="M8 3.5h6l4.5 4.5v12.5H8a2 2 0 0 1-2-2V5.5a2 2 0 0 1 2-2z"/><path d="M14 3.5V8h4.5M9.5 13h6M9.5 16.5h4"/>',
        journal: '<path d="M5 4.5h10.5a3 3 0 0 1 3 3v12H8a3 3 0 0 1-3-3z"/><path d="M8.5 9h6.5M8.5 12.5h6.5M5 16.5a3 3 0 0 1 3-3"/>',
        more: '<circle cx="5.5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="18.5" cy="12" r="1.4" fill="currentColor"/>',
    };
    const icon = id => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[id]}</svg>`;

    // What needs Danny's attention, for the badges and the tab title.
    function counts() {
        const orders = B.orders.all().filter(o => o.status === 'paid').length;
        const quotes = B.quotes.all().filter(q => q.status === 'new').length;
        const revisions = (() => { try { return Object.keys(JSON.parse(localStorage.getItem(REVISIONS)) || {}).length; } catch { return 0; } })();
        const journal = B.posts.all().filter(p => p.status !== 'published').length + revisions;
        const events = B.events.all().filter(e => sameDay(e.start, Date.now()) && e.end > Date.now()).length;
        let hubspot = 0;
        if (B.crm) hubspot = B.crm.items().filter(i => i.status === 'failed').length;
        return { orders, quotes, journal, events, hubspot, pages: 0 };
    }
    const BADGE_LABEL = { orders: 'to do', quotes: 'new', journal: 'drafts', events: 'today', hubspot: 'failed' };

    function buildNav() {
        const side = document.querySelector('.hub-side');
        if (!side) return;
        const current = side.dataset.screen;
        const home = B.shop ? B.shop.home() : '../refined/';
        side.innerHTML = `
            <a class="hub-brand" href="./"><img src="../assets/img/logo-96.webp" alt="" width="36" height="36"><span>Bogabee Hub</span></a>
            <nav class="hub-nav" aria-label="Hub">
                ${SCREENS.map(s => `<a href="${s.href}" data-nav="${s.id}"${s.id === current ? ' aria-current="page"' : ''}>${s.label}<span class="count" data-count="${s.id}" hidden></span></a>`).join('')}
            </nav>
            <div class="hub-foot">
                <a class="hub-out" href="${esc(home)}">View the site</a>
                <button class="hub-out hub-reset" type="button" data-reset>Reset demo data</button>
            </div>`;

        // Phones: a bottom tab bar with the four daily screens and More.
        const inMore = !SCREENS.find(s => s.id === current && s.tab);
        const tabs = document.createElement('nav');
        tabs.className = 'hub-tabs';
        tabs.setAttribute('aria-label', 'Hub');
        tabs.innerHTML = SCREENS.filter(s => s.tab).map(s =>
            `<a href="${s.href}"${s.id === current ? ' aria-current="page"' : ''}>${icon(s.id)}<span>${s.label}</span><span class="count" data-count="${s.id}" hidden></span></a>`).join('') +
            `<button type="button" class="more-btn" aria-haspopup="dialog"${inMore ? ' aria-current="page"' : ''}>${icon('more')}<span>${inMore ? SCREENS.find(s => s.id === current).label : 'More'}</span><span class="count" data-count="more" hidden></span></button>`;
        document.body.appendChild(tabs);
        tabs.querySelector('.more-btn').addEventListener('click', openMore);

        document.addEventListener('click', e => { if (e.target.closest('[data-reset]')) resetDemo(); });

        // The sticky offsets for save bars and toolbars follow the phone top bar's height.
        const setTop = () => document.documentElement.style.setProperty('--hub-top', getComputedStyle(side).position === 'sticky' && matchMedia('(max-width: 860px)').matches ? side.offsetHeight + 'px' : '0px');
        new ResizeObserver(setTop).observe(side);
        addEventListener('resize', setTop);
        setTop();
    }

    function openMore() {
        const c = counts();
        const home = B.shop ? B.shop.home() : '../refined/';
        const current = document.querySelector('.hub-side').dataset.screen;
        const d = dialog(`<h2>More</h2>
            <nav class="more-list" aria-label="More">
                ${SCREENS.filter(s => !s.tab).map(s => `<a href="${s.href}"${s.id === current ? ' aria-current="page"' : ''}>${s.label}${c[s.id] ? `<span class="count">${c[s.id]}</span>` : ''}</a>`).join('')}
                <a href="${esc(home)}">View the site</a>
                <button type="button" data-reset>Reset demo data</button>
            </nav>
            <div class="acts"><button class="btn btn-quiet" value="no">Close</button></div>`, () => {}, 'sheet');
        d.addEventListener('click', e => { if (e.target === d || e.target.closest('[data-reset]')) d.close(); });
        d.showModal();
        d.querySelector('.more-list a, .more-list button').focus();
    }

    async function resetDemo() {
        const ok = await confirm({ title: 'Reset the demo?', body: 'Orders, events, quotes, posts, page edits and HubSpot activity go back to the sample data in this browser.', ok: 'Reset', danger: true });
        if (!ok) return;
        [B.KEYS && Object.values(B.KEYS), 'bogabee-demo-crm', REVISIONS].flat().filter(Boolean).forEach(k => localStorage.removeItem(k));
        sessionStorage.removeItem('bogabee-hub-known');
        location.reload();
    }

    // ---------- Badges, tab title and announcements ----------
    const baseTitle = document.title;
    let live;
    function announce(text) {
        if (!live) {
            live = document.createElement('div');
            live.className = 'sr-only';
            live.setAttribute('role', 'status');
            document.body.appendChild(live);
        }
        live.textContent = '';
        setTimeout(() => { live.textContent = text; }, 50);
    }
    function known() { try { return JSON.parse(sessionStorage.getItem('bogabee-hub-known')) || null; } catch { return null; } }

    function refresh() {
        const c = counts();
        document.querySelectorAll('[data-count]').forEach(el => {
            const k = el.dataset.count;
            const n = k === 'more' ? c.pages + c.hubspot : c[k];
            el.textContent = n || '';
            el.hidden = !n;
            if (k !== 'more') el.setAttribute('aria-label', n ? `${n} ${BADGE_LABEL[k] || ''}`.trim() : '');
        });
        const todo = c.orders + c.quotes;
        document.title = (todo ? `(${todo}) ` : '') + baseTitle.replace(/^\(\d+\)\s*/, '');

        // Say when something new comes in from the site in another tab.
        const now = { orders: B.orders.all().map(o => o.id), quotes: B.quotes.all().map(q => q.id) };
        const before = known();
        if (before) {
            const newOrders = B.orders.all().filter(o => !before.orders.includes(o.id));
            const newQuotes = B.quotes.all().filter(q => !before.quotes.includes(q.id));
            const parts = [
                ...newOrders.map(o => `New order ${o.id}${o.customer && o.customer.name ? ' from ' + o.customer.name : ''}`),
                ...newQuotes.map(q => `New quote request from ${(q.contact && q.contact.name) || 'a customer'}`),
            ];
            if (parts.length) announce(parts.join('. '));
        }
        sessionStorage.setItem('bogabee-hub-known', JSON.stringify(now));
    }

    window.Hub = { esc, when, time, dayText, daysUntil, isoDay, toast, dialog, confirm, copy, refresh, REVISIONS };

    function init() {
        buildNav();
        refresh();
        let t;
        window.addEventListener('bogabee:change', () => { clearTimeout(t); t = setTimeout(refresh, 60); });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
