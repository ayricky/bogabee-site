(function () {
    const { JARS, ADDONS, MIN_QTY, STEP, MAX_QTY, LEAD_DAYS, price, needsApproval } = window.Favors;
    const { money, quotes, asset } = window.Bogabee;
    const $ = id => document.getElementById(id);
    const form = $('quote-form');

    const COLORS = [
        ['Gold', '#e0a526'], ['Blush', '#f3c9d4'], ['Sage', '#a9bf9a'], ['Navy', '#1f3556'],
        ['White', '#ffffff'], ['Lavender', '#c9b8e6'], ['Burgundy', '#7a1f33'],
    ];

    // ---------- Build the choice cards ----------
    $('jars').innerHTML = Object.entries(JARS).map(([id, j]) => `
        <label class="choice choice-img">
            <input type="radio" name="jar" value="${id}"${id === 'small' ? ' checked' : ''}>
            <span class="choice-body">
                <img src="${asset(j.img)}" alt="">
                <b>${j.name}</b><span>${j.size}</span><i class="price">${money(j.price)} / jar</i>
            </span>
        </label>`).join('');

    $('addons').innerHTML = Object.entries(ADDONS).map(([id, a]) => `
        <label class="choice choice-img">
            <input type="checkbox" name="addon" value="${id}">
            <span class="choice-body">
                <img src="../assets/addons/${id}.jpg" alt="">
                <b>${a.name}</b><span>${a.detail}</span><i class="price">+${money(a.price)}</i>
            </span>
        </label>`).join('');

    $('swatches').innerHTML = COLORS.map(([name, hex]) => `
        <label class="swatch" title="${name}">
            <input type="radio" name="color" value="${name}">
            <span style="--c:${hex}"></span><em>${name}</em>
        </label>`).join('') + `
        <label class="swatch custom" title="Custom color">
            <input type="radio" name="color" value="custom">
            <span id="custom-dot"></span><em>Custom</em>
            <input type="color" id="custom-color" value="#e0a526" aria-label="Pick a custom color">
        </label>`;

    // Event dates start after the lead time.
    const earliest = new Date();
    earliest.setDate(earliest.getDate() + LEAD_DAYS);
    const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    $('event-date').min = iso(earliest);

    // ---------- Read the form ----------
    function state() {
        const color = form.querySelector('[name=color]:checked');
        return {
            jar: form.querySelector('[name=jar]:checked').value,
            qty: parseInt($('qty').value, 10),
            addons: [...form.querySelectorAll('[name=addon]:checked')].map(i => i.value),
            assembly: form.querySelector('[name=assembly]:checked').value,
            labelText: $('label-text').value.trim(),
            logoName: $('logo').files[0]?.name || '',
            event: {
                type: $('event-type').value,
                date: $('event-date').value,
                color: color ? (color.value === 'custom' ? $('custom-color').value : color.value) : '',
            },
            notes: $('notes').value.trim(),
            contact: { name: $('c-name').value.trim(), email: $('c-email').value.trim(), phone: $('c-phone').value.trim() },
        };
    }

    // ---------- Live summary ----------
    function render() {
        const s = state();
        const p = price(s);
        $('lines').innerHTML = p.lines.map(l => `<li><span>${l.label}</span><span>${l.each ? money(l.each) : 'Included'}</span></li>`).join('');
        $('per-jar').textContent = money(p.perJar);
        $('qty-out').textContent = `× ${p.qty}`;
        $('total').textContent = money(p.total);
        const approval = needsApproval(s);
        $('submit').textContent = approval ? 'Send for approval' : `Pay ${money(p.total)}`;
        $('approval-note').hidden = !approval;
        $('label-details').hidden = !s.addons.includes('label');
        const typed = parseInt($('qty').value, 10);
        $('qty-hint').classList.toggle('warn', !(typed >= MIN_QTY) || typed > MAX_QTY);
        document.querySelectorAll('.quick button').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.qty === p.qty)));
    }

    // Typed amounts snap to the nearest five, never under the minimum. Over 500 still works: it goes for a hand quote.
    function setQty(n) {
        $('qty').value = Math.max(MIN_QTY, Math.round((n || MIN_QTY) / STEP) * STEP);
        render();
    }
    document.querySelectorAll('.step-btn').forEach(b => b.addEventListener('click', () => {
        const cur = parseInt($('qty').value, 10) || MIN_QTY;
        const d = +b.dataset.step;
        // Snap to the step grid, then move one step.
        setQty(d > 0 ? Math.floor(cur / STEP) * STEP + STEP : Math.ceil(cur / STEP) * STEP - STEP);
    }));
    document.querySelectorAll('.quick button').forEach(b => b.addEventListener('click', () => setQty(+b.dataset.qty)));
    $('qty').addEventListener('change', () => setQty(parseInt($('qty').value, 10) || MIN_QTY));

    $('logo').addEventListener('change', () => {
        $('logo-name').textContent = $('logo').files[0]?.name || 'Choose a file';
        $('logo').closest('.upload').classList.toggle('has-file', Boolean($('logo').files[0]));
    });
    $('custom-color').addEventListener('input', e => {
        $('custom-dot').style.setProperty('--c', e.target.value);
        form.querySelector('[name=color][value=custom]').checked = true;
    });
    form.addEventListener('input', render);
    form.addEventListener('change', render);

    $('detail-toggle').addEventListener('click', () => {
        const open = $('summary').classList.toggle('open');
        $('detail-toggle').setAttribute('aria-expanded', String(open));
        $('detail-toggle').textContent = open ? 'Hide details' : 'Details';
    });

    // ---------- Validation ----------
    function check() {
        const s = state();
        const rules = [
            ['err-label', 'label-text', !s.addons.includes('label') || s.labelText.length > 0],
            ['err-type', 'event-type', Boolean(s.event.type)],
            ['err-date', 'event-date', Boolean(s.event.date) && s.event.date >= $('event-date').min],
            ['err-name', 'c-name', s.contact.name.length > 1],
            ['err-email', 'c-email', /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.contact.email)],
            ['err-phone', 'c-phone', s.contact.phone.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '').length === 10],
        ];
        let first = null;
        for (const [err, field, ok] of rules) {
            $(err).classList.toggle('show', !ok);
            $(field).setAttribute('aria-invalid', String(!ok));
            if (!ok) $(field).setAttribute('aria-describedby', err); else $(field).removeAttribute('aria-describedby');
            if (!ok && !first) first = $(field);
        }
        if (first) {
            first.focus({ preventScroll: true });
            first.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
        }
        return !first;
    }
    // Errors clear as soon as the field is fixed.
    form.addEventListener('input', e => {
        const id = e.target.getAttribute('aria-describedby');
        if (id && e.target.getAttribute('aria-invalid') === 'true') {
            e.target.setAttribute('aria-invalid', 'false');
            $(id).classList.remove('show');
        }
    });

    function record(status) {
        const s = state();
        const p = price(s);
        const entry = { ...s, qty: p.qty, perJar: p.perJar, total: p.total, status };
        if (status === 'paid') entry.paidAt = Date.now();
        return quotes.add(entry);
    }

    form.addEventListener('submit', e => {
        e.preventDefault();
        if (!check()) return;
        if (needsApproval(state())) {
            finish(record('new'));
        } else {
            const total = money(price(state()).total);
            $('pay-amount').textContent = total;
            $('pay-submit').textContent = `Pay ${total}`;
            $('pay').showModal();
        }
    });

    // ---------- Simulated payment sheet ----------
    const pay = $('pay');
    $('pay-close').addEventListener('click', () => pay.close());
    pay.addEventListener('click', e => { if (e.target === pay) pay.close(); });
    function cardOk() {
        const errs = window.Bogabee.shop.cardErrors({ number: $('card').value, exp: $('exp').value, cvc: $('cvc').value });
        ['card', 'exp', 'cvc'].forEach((id, i) => $(id).setAttribute('aria-invalid', String(Boolean(errs[['number', 'exp', 'cvc'][i]]))));
        $('pay-error').textContent = Object.values(errs).join(' ');
        const bad = ['card', 'exp', 'cvc'].find(id => $(id).getAttribute('aria-invalid') === 'true');
        if (bad) $(bad).focus();
        return !bad;
    }
    function charge(button) {
        button.disabled = true;
        button.classList.add('busy');
        setTimeout(() => {
            button.disabled = false;
            button.classList.remove('busy');
            pay.close();
            finish(record('paid'));
        }, 900);
    }
    $('express').addEventListener('click', () => charge($('express')));
    $('pay-form').addEventListener('submit', e => { e.preventDefault(); if (cardOk()) charge($('pay-submit')); });

    function finish(q) {
        const jar = JARS[q.jar];
        const date = new Date(q.event.date + 'T12:00').toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' });
        const paid = q.status === 'paid';
        $('done').innerHTML = `
            <span class="eyebrow">${paid ? 'Paid' : 'Sent for approval'} · ${q.id}</span>
            <h2 class="display">${paid ? 'Your favors are booked.' : 'We have your quote.'}</h2>
            <p>${paid
                ? `A receipt is on its way to ${escape(q.contact.email)}.`
                : `We'll check your ${q.qty > MAX_QTY ? 'order' : q.addons.includes('label') ? 'label' : 'logo'} and email a payment link to ${escape(q.contact.email)}.`}</p>
            <dl class="done-list">
                <div><dt>Jars</dt><dd>${q.qty} × ${jar.name} (${jar.size})</dd></div>
                <div><dt>Add-ons</dt><dd>${q.addons.length ? q.addons.map(a => ADDONS[a].name).join(', ') : 'None'}</dd></div>
                <div><dt>Assembly</dt><dd>${q.assembly === 'diy' ? 'DIY kit' : 'Assembled'}</dd></div>
                <div><dt>Event</dt><dd>${escape(q.event.type)} · ${date}</dd></div>
                <div><dt>${paid ? 'Paid' : 'Total'}</dt><dd><b>${money(q.total)}</b></dd></div>
            </dl>
            <div class="done-actions">
                <a class="btn btn-lg" href="./">Start another quote</a>
            </div>`;
        form.hidden = true;
        $('done').hidden = false;
        $('done').focus();
        scrollTo({ top: 0 });
    }

    function escape(s) {
        return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    }

    render();
})();
