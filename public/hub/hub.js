// The owner hub's shell, shared by every hub screen: the navigation (a sidebar on wide screens,
// a bottom tab bar on phones), the toast and confirm dialogs, dates, and the API client.
// Pages mark their screen with <aside class="hub-side" data-screen="journal"></aside>.
(function () {
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const DAY = 864e5;

    // ---------- Dates ----------
    const fmt = (ts, o) => new Date(ts).toLocaleString('en-US', o);
    const time = ts => fmt(ts, { hour: 'numeric', minute: '2-digit' });
    const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
    // "12 min ago" within the hour, then "Today 3:18 PM", "Yesterday 3:18 PM", "Mon, Oct 20".
    function when(ts) {
        if (!ts) return '';
        const now = Date.now(), mins = Math.round((now - ts) / 60000);
        if (mins >= 0 && mins < 60) return mins < 1 ? 'just now' : `${mins} min ago`;
        if (sameDay(ts, now)) return 'today ' + time(ts);
        if (sameDay(ts, now - DAY)) return 'yesterday ' + time(ts);
        const y = new Date(ts).getFullYear() !== new Date(now).getFullYear();
        return fmt(ts, { weekday: 'short', month: 'short', day: 'numeric', ...(y ? { year: 'numeric' } : {}) });
    }
    // A calendar date stored as YYYY-MM-DD: "Oct 29", with the year when it isn't this year.
    function dayText(iso) {
        if (!iso) return '';
        const [y, m, d] = iso.split('-').map(Number), date = new Date(y, m - 1, d);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(y !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
    }

    // ---------- API ----------
    // Every call goes to /api/hub/. A failed one throws an Error carrying the server's message.
    async function api(method, path, body) {
        const opts = { method, headers: {}, credentials: 'same-origin' };
        if (body instanceof FormData) opts.body = body;
        else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['content-type'] = 'application/json'; }
        let res;
        try { res = await fetch('/api/hub/' + path, opts); }
        catch { throw new Error('Could not reach the site. Check your connection and try again.'); }
        if (res.status === 204) return null;
        const type = res.headers.get('content-type') || '';
        const data = type.includes('json') ? await res.json().catch(() => null) : null;
        if (res.ok) return data ?? (await res.text());
        if (res.status === 401) throw new Error('You were signed out. Reload the page to sign in again.');
        throw new Error((data && data.error) || `Something went wrong (${res.status}). Try again.`);
    }
    // Site photos the picker offers, written by the build (/hub/photos.js) from the list the pages use.
    const photos = () => window.HUB_PHOTOS || {};
    // A small preview of a photo: the site's own smaller copy, or an upload as it is.
    const thumb = src => (photos()[src] ? `/assets/img/${src}-${photos()[src].small}.webp` : src);
    const photoUrl = src => (photos()[src] ? `/assets/img/${src}.webp` : src);

    // ---------- Toast ----------
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
        toastTimer = setTimeout(() => { toastEl.hidden = true; }, error ? 8000 : undo ? 7000 : 2600);
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
    function confirm({ title, body = '', ok = 'OK', danger = false }) {
        return new Promise(resolve => {
            const d = dialog(`<h2>${esc(title)}</h2>${body ? `<p>${esc(body)}</p>` : ''}
                <div class="acts"><button class="btn btn-quiet" value="no">Cancel</button><button class="btn ${danger ? 'btn-dark' : ''}" value="yes">${esc(ok)}</button></div>`,
                v => resolve(v === 'yes'));
            d.showModal();
            d.querySelector('[value="no"]').focus();
        });
    }

    // ---------- Navigation ----------
    const SCREENS = [
        { id: 'journal', href: '/hub/', label: 'Journal', tab: true },
        { id: 'apiary', href: '/hub/apiary/', label: 'Apiary page', tab: true },
        { id: 'orders', href: '/hub/orders/', label: 'Orders', tab: true },
        { id: 'events', href: '/hub/events/', label: 'Events', tab: true },
        { id: 'favors', href: '/hub/favors/', label: 'Party favors' },
        { id: 'hubspot', href: '/hub/hubspot/', label: 'HubSpot' },
    ];
    const ICONS = {
        journal: '<path d="M5 4.5h10.5a3 3 0 0 1 3 3v12H8a3 3 0 0 1-3-3z"/><path d="M8.5 9h6.5M8.5 12.5h6.5M5 16.5a3 3 0 0 1 3-3"/>',
        apiary: '<path d="M12 3.5 19.5 8v8L12 20.5 4.5 16V8z"/><path d="M12 12v8.5M12 12l7.5-4M12 12 4.5 8"/>',
        orders: '<path d="M5 8h14l-1.2 11.2A2 2 0 0 1 15.8 21H8.2a2 2 0 0 1-2-1.8z"/><path d="M9 10V6.5a3 3 0 0 1 6 0V10"/>',
        events: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
        more: '<circle cx="5.5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="18.5" cy="12" r="1.4" fill="currentColor"/>',
    };
    const icon = id => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[id]}</svg>`;
    // Cloudflare Access ends the session here.
    const SIGN_OUT = '/cdn-cgi/access/logout';

    function buildNav() {
        const side = document.querySelector('.hub-side');
        if (!side) return;
        const current = side.dataset.screen;
        side.innerHTML = `
            <a class="hub-brand" href="/hub/"><img src="/assets/img/logo-96.webp" alt="" width="36" height="36"><span>Bogabee Hub</span></a>
            <nav class="hub-nav" aria-label="Hub">
                ${SCREENS.map(s => `<a href="${s.href}"${s.id === current ? ' aria-current="page"' : ''}>${s.label}</a>`).join('')}
            </nav>
            <div class="hub-foot">
                <a class="hub-out" href="/" target="_blank" rel="noopener">View the site</a>
                <a class="hub-out hub-signout" href="${SIGN_OUT}">Sign out</a>
            </div>`;

        // Phones: a bottom tab bar with four screens and More.
        const inMore = !SCREENS.find(s => s.id === current && s.tab);
        const tabs = document.createElement('nav');
        tabs.className = 'hub-tabs';
        tabs.setAttribute('aria-label', 'Hub');
        tabs.innerHTML = SCREENS.filter(s => s.tab).map(s =>
            `<a href="${s.href}"${s.id === current ? ' aria-current="page"' : ''}>${icon(s.id)}<span>${s.label}</span></a>`).join('') +
            `<button type="button" class="more-btn" aria-haspopup="dialog"${inMore ? ' aria-current="page"' : ''}>${icon('more')}<span>${inMore ? SCREENS.find(s => s.id === current).label : 'More'}</span></button>`;
        document.body.appendChild(tabs);
        tabs.querySelector('.more-btn').addEventListener('click', () => openMore(current));

        // The sticky offsets for save bars and toolbars follow the phone top bar's height.
        const setTop = () => document.documentElement.style.setProperty('--hub-top', getComputedStyle(side).position === 'sticky' && matchMedia('(max-width: 860px)').matches ? side.offsetHeight + 'px' : '0px');
        new ResizeObserver(setTop).observe(side);
        addEventListener('resize', setTop);
        setTop();
    }

    function openMore(current) {
        const d = dialog(`<h2>More</h2>
            <nav class="more-list" aria-label="More">
                ${SCREENS.filter(s => !s.tab).map(s => `<a href="${s.href}"${s.id === current ? ' aria-current="page"' : ''}>${s.label}</a>`).join('')}
                <a href="/" target="_blank" rel="noopener">View the site</a>
                <a href="${SIGN_OUT}">Sign out</a>
            </nav>
            <div class="acts"><button class="btn btn-quiet" value="no">Close</button></div>`, () => {}, 'sheet');
        d.addEventListener('click', e => { if (e.target === d) d.close(); });
        d.showModal();
        d.querySelector('.more-list a').focus();
    }

    window.Hub = { esc, when, dayText, toast, dialog, confirm, api, get PHOTOS() { return photos(); }, thumb, photoUrl };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildNav); else buildNav();
})();
