// Owner events screen: event list, live check-ins, QR, kiosk, CSV export, new and edited events.
// Load after hub.js.
(function () {
    const $ = id => document.getElementById(id);
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const DAY = 86400000;
    const INTERESTS = ['Honey', 'Party favors', 'Bee talks'];

    const fmtDay = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const fmtMonth = new Intl.DateTimeFormat('en-US', { month: 'short' });
    const fmtTime = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
    const shortTime = t => fmtTime.format(t).replace(':00', '');

    const startOfDay = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
    const daysUntil = e => Math.round((startOfDay(e.start) - startOfDay(Date.now())) / DAY);
    const isPast = e => e.end < Date.now();
    const when = e => {
        if (isPast(e)) return 'Past';
        const d = daysUntil(e);
        return d <= 0 ? 'Today' : d === 1 ? 'Tomorrow' : `In ${d} days`;
    };
    const stamp = t => Hub.when(t, { relative: false });
    const name = s => [s.first, s.last].filter(Boolean).join(' ');

    let selected = new URLSearchParams(location.search).get('e');
    let filter = 'all';
    let seen = new Set(Bogabee.signins.all().map(s => s.id));

    function sorted() {
        const all = Bogabee.events.all();
        const upcoming = all.filter(e => !isPast(e)).sort((a, b) => a.start - b.start);
        const past = all.filter(isPast).sort((a, b) => b.start - a.start);
        return { upcoming, past };
    }

    function current() {
        const { upcoming, past } = sorted();
        const e = Bogabee.events.get(selected) || upcoming[0] || past[0];
        selected = e && e.id;
        return e;
    }

    function guestUrl(e, kiosk) {
        const url = new URL('../events/', location.href);
        url.searchParams.set('e', e.id);
        if (kiosk) url.searchParams.set('kiosk', '1');
        return url.href;
    }

    function qrSvg(text, alt) {
        const qr = qrcode(0, 'M');
        qr.addData(text);
        qr.make();
        return qr.createSvgTag({ cellSize: 6, margin: 0, scalable: true, alt });
    }

    // ---------- Event list ----------
    function renderList() {
        const q = $('find-event').value.trim().toLowerCase();
        const match = e => !q || (e.name + ' ' + e.place).toLowerCase().includes(q);
        const { upcoming, past } = sorted();
        const counts = Bogabee.signins.all().reduce((m, s) => ((m[s.eventId] = (m[s.eventId] || 0) + 1), m), {});
        const item = e => {
            const d = new Date(e.start);
            const side = isPast(e)
                ? `<span class="ev-side"><b>${counts[e.id] || 0}</b>checked in</span>`
                : `<span class="ev-side soon">${esc(when(e))}</span>`;
            return `<li><a class="ev-item" href="?e=${encodeURIComponent(e.id)}" data-id="${esc(e.id)}"${e.id === selected ? ' aria-current="page"' : ''}>
                <span class="ev-date"><span>${fmtMonth.format(d)}</span><b>${d.getDate()}</b></span>
                <span class="ev-text"><b>${esc(e.name)}</b><span>${esc(fmtDay.format(d).split(',')[0])} · ${esc(e.place)}</span></span>
                ${side}</a></li>`;
        };
        const group = (label, list) => {
            const shown = list.filter(match);
            return `<div class="ev-group">${label} <span>${list.length}</span></div>` +
                (shown.length ? `<ul class="ev-items">${shown.map(item).join('')}</ul>` : `<p class="ev-none">${q ? 'No matches' : 'None'}</p>`);
        };
        $('event-list').innerHTML = group('Upcoming', upcoming) + group('Past', past);
        $('ev-list-title').textContent = `All events (${upcoming.length + past.length})`;
    }

    // ---------- Detail ----------
    function renderDetail(fresh = new Set()) {
        const e = current();
        if (!e) return;
        const guests = Bogabee.signins.forEvent(e.id).sort((a, b) => b.at - a.at);
        const tag = when(e);
        document.title = `${e.name} | Bogabee Hub`;
        $('title').textContent = e.name;
        $('meta').innerHTML = `<span class="tag ${tag === 'Past' ? 'dim' : 'gold'}">${esc(tag)}</span>
            <span>${esc(fmtDay.format(e.start))}, ${esc(shortTime(e.start))}–${esc(shortTime(e.end))}</span>
            <span>${esc(e.place)}</span>`;

        const n = guests.length;
        const newContacts = guests.filter(g => !g.returning).length;
        const news = guests.filter(g => g.news).length;
        const favors = guests.filter(g => (g.interests || []).includes('Party favors')).length;
        const pct = v => (n ? Math.round((v / n) * 100) + '%' : '—');
        $('stats').innerHTML = [
            ['Checked in', n, isPast(e) ? 'Final count' : tag],
            ['New contacts', newContacts, `<b>${n - newContacts}</b> already in HubSpot`],
            ['Harvest news', news, `${pct(news)} opted in`],
            ['Party favors', favors, `${pct(favors)} interested`],
        ].map(([label, v, small]) => `<div class="stat"><span>${label}</span><b>${v}</b><small>${small}</small></div>`).join('');

        // Filters and table
        const tests = {
            all: () => true,
            new: g => !g.returning,
            news: g => g.news,
            ...Object.fromEntries(INTERESTS.map(i => [i, g => (g.interests || []).includes(i)])),
        };
        const labels = [['all', 'All'], ['new', 'New contacts'], ...INTERESTS.map(i => [i, i]), ['news', 'Harvest news']];
        $('filters').innerHTML = labels.map(([k, l]) =>
            `<button class="filter" type="button" data-filter="${esc(k)}" aria-pressed="${k === filter}">${esc(l)}<span>${guests.filter(tests[k]).length}</span></button>`).join('');

        const q = $('find-guest').value.trim().toLowerCase();
        const rows = guests.filter(tests[filter]).filter(g => !q || [name(g), g.email, g.phone].join(' ').toLowerCase().includes(q));
        $('guests').innerHTML = rows.length
            ? rows.map(g => `<tr${fresh.has(g.id) ? ' class="fresh"' : ''}>
                <td><span class="who"><b>${esc(name(g))}</b><span>${esc(g.email || g.phone)}</span></span></td>
                <td><span class="tags">${(g.interests || []).map(i => `<span class="tag">${esc(i)}</span>`).join('') || '<span class="none">—</span>'}</span></td>
                <td>${g.returning ? '<span class="tag dim">Existing</span>' : '<span class="tag green">New lead</span>'}</td>
                <td>${g.news ? 'Yes' : '<span class="none">—</span>'}</td>
                <td class="when">${esc(stamp(g.at))}</td></tr>`).join('')
            : `<tr><td colspan="5" class="empty">${n ? 'No guests match.' : isPast(e) ? 'Nobody checked in.' : 'No check-ins yet. Share the QR code or run the kiosk.'}</td></tr>`;

        // QR and links
        const url = guestUrl(e);
        $('qr').innerHTML = qrSvg(url, `QR code to check in to ${e.name}`);
        $('qr-url').href = url;
        $('qr-url').textContent = url.replace(/^https?:\/\//, '');
        $('kiosk').href = guestUrl(e, true);
        $('sign-name').textContent = e.name;
        $('sign-when').textContent = `${fmtDay.format(e.start)} · ${e.place}`;
        $('sign-qr').innerHTML = qrSvg(url, '');

        const last = guests[0];
        // Sync status for this event's guests, from the HubSpot sync layer.
        const C = Bogabee.crm;
        C.reconcile();
        const states = guests.map(g => (C.status('signin:' + g.id) || {}).status);
        const synced = states.filter(s => s === 'synced').length, failed = states.filter(s => s === 'failed').length;
        const syncText = !n ? '—' : `${synced} of ${n} synced` + (failed ? ` · <a href="hubspot.html">${failed} failed</a>` : '');
        $('sync').innerHTML = `<div><dt>New leads</dt><dd>${newContacts}</dd></div><div><dt>Updated</dt><dd>${n - newContacts}</dd></div>
            <div style="grid-column: 1 / -1"><dt>Last check-in</dt><dd style="font: 500 15px/1.3 var(--sans)">${last ? esc(name(last)) + ' · ' + esc(stamp(last.at)) : '—'}</dd></div>
            <div style="grid-column: 1 / -1"><dt>Sync</dt><dd style="font: 500 15px/1.3 var(--sans)">${syncText}</dd></div>`;
    }

    function render(fresh) {
        renderList();
        renderDetail(fresh);
    }

    // ---------- Interactions ----------
    $('event-list').addEventListener('click', ev => {
        const a = ev.target.closest('.ev-item');
        if (!a) return;
        ev.preventDefault();
        selected = a.dataset.id;
        filter = 'all';
        $('find-guest').value = '';
        history.replaceState(null, '', '?e=' + encodeURIComponent(selected));
        render();
    });
    $('find-event').addEventListener('input', renderList);
    $('find-guest').addEventListener('input', () => renderDetail());
    $('filters').addEventListener('click', ev => {
        const b = ev.target.closest('[data-filter]');
        if (!b) return;
        filter = b.dataset.filter;
        renderDetail();
    });

    const toast = (text, opts) => Hub.toast(text, opts);

    $('copy').addEventListener('click', async () => {
        const url = guestUrl(current());
        if (await Hub.copy(url)) toast('Link copied');
        else window.prompt('Copy this link', url);
    });
    $('print').addEventListener('click', () => window.print());

    $('export').addEventListener('click', () => {
        const e = current();
        // Guests type their own names, so a leading = + - @ (or tab/return) is made plain text,
        // or a spreadsheet would run it as a formula.
        const cell = v => {
            let t = String(v ?? '');
            if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
            return `"${t.replace(/"/g, '""')}"`;
        };
        const date = t => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const rows = [['First name', 'Last name', 'Email', 'Phone', 'Interested in', 'Harvest news', 'HubSpot', 'Date', 'Time']]
            .concat(Bogabee.signins.forEvent(e.id).sort((a, b) => a.at - b.at).map(g => [
                g.first, g.last, g.email, g.phone, (g.interests || []).join('; '), g.news ? 'Yes' : 'No',
                g.returning ? 'Existing' : 'New lead', date(g.at), fmtTime.format(g.at),
            ]));
        const blob = new Blob([rows.map(r => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${e.id}-check-ins.csv`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });

    // New and edited events share one dialog.
    const dialog = $('new-event');
    const form = $('new-form');
    const hhmm = t => `${String(new Date(t).getHours()).padStart(2, '0')}:${String(new Date(t).getMinutes()).padStart(2, '0')}`;
    let editing = null;
    function openEvent(e) {
        editing = e || null;
        form.reset();
        $('new-title').textContent = e ? 'Edit event' : 'New event';
        $('new-submit').textContent = e ? 'Save event' : 'Create event';
        $('delete-event').hidden = !e;
        if (e) {
            form.name.value = e.name;
            form.place.value = e.place;
            form.date.value = Hub.isoDay(new Date(e.start));
            form.start.value = hhmm(e.start);
            form.end.value = hhmm(e.end);
        } else {
            // Two weeks out by the calendar (adding 14 × 24 hours lands a day short across a clock change).
            const d = new Date(); d.setDate(d.getDate() + 14);
            form.date.value = Hub.isoDay(d);
        }
        dialog.showModal();
        form.name.focus();
    }
    document.querySelectorAll('[data-new-event]').forEach(b => b.addEventListener('click', () => openEvent(null)));
    $('edit-event').addEventListener('click', () => openEvent(current()));
    $('new-cancel').addEventListener('click', () => dialog.close());
    $('delete-event').addEventListener('click', async () => {
        const e = editing;
        const n = Bogabee.signins.forEvent(e.id).length;
        dialog.close();
        const ok = await Hub.confirm({
            title: `Delete ${e.name}?`,
            body: n ? `Its ${n} check-in${n === 1 ? '' : 's'} stay in HubSpot but leave this list. Export the guest list first if you need it.` : 'It has no sign-ins.',
            ok: 'Delete event', danger: true,
        });
        if (!ok) return;
        const before = Bogabee.events.all();
        Bogabee.events.save(before.filter(x => x.id !== e.id));
        selected = null;
        history.replaceState(null, '', location.pathname);
        render();
        toast(`${e.name} deleted`, { undo: () => { Bogabee.events.save(before); selected = e.id; render(); } });
    });
    form.addEventListener('submit', ev => {
        if (form.end.value <= form.start.value) {
            ev.preventDefault();
            form.end.setCustomValidity('End after the start time.');
            form.end.reportValidity();
            return;
        }
        const at = t => new Date(`${form.date.value}T${t}`).getTime();
        const list = Bogabee.events.all();
        const fields = { name: form.name.value.trim(), place: form.place.value.trim(), start: at(form.start.value), end: at(form.end.value) };
        let id;
        if (editing) {
            id = editing.id;
            Bogabee.events.save(list.map(e => (e.id === id ? { ...e, ...fields } : e)));
        } else {
            const base = fields.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'event';
            id = base;
            let i = 2;
            while (list.some(e => e.id === id)) id = `${base}-${i++}`;
            Bogabee.events.save([...list, { id, ...fields }]);
        }
        selected = id;
        filter = 'all';
        history.replaceState(null, '', '?e=' + encodeURIComponent(id));
        render();
        toast(editing ? 'Event saved' : 'Event created');
        editing = null;
    });
    form.end.addEventListener('input', () => form.end.setCustomValidity(''));

    // Check-ins from a phone or the kiosk in another tab arrive here.
    window.addEventListener('bogabee:change', ev => {
        const key = ev.detail && ev.detail.key;
        if (key === Bogabee.crm.KEY) { render(); return; }
        if (key !== Bogabee.KEYS.signins && key !== Bogabee.KEYS.events) return;
        const all = Bogabee.signins.all();
        const fresh = all.filter(s => !seen.has(s.id));
        seen = new Set(all.map(s => s.id));
        render(new Set(fresh.map(s => s.id)));
        if (fresh.length) {
            const e = Bogabee.events.get(fresh[0].eventId);
            toast(`${name(fresh[0])} checked in${e ? ' · ' + e.name : ''}`);
        }
    });

    // On phones the event list starts folded so the selected event comes first; it's always open on wider screens.
    const phone = matchMedia('(max-width: 860px)');
    const fold = () => { $('ev-details').open = !phone.matches; };
    phone.addEventListener('change', fold);
    fold();
    $('event-list').addEventListener('click', () => { if (phone.matches) $('ev-details').open = false; });

    render();
})();
