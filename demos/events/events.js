// Guest check-in for one event: /demos/events/?e=<event id>, tablet mode with &kiosk=1.
(function () {
    const params = new URLSearchParams(location.search);
    const kiosk = params.get('kiosk') === '1';
    const event = Bogabee.events.get(params.get('e') || '');
    const $ = id => document.getElementById(id);

    if (kiosk) {
        document.body.classList.add('kiosk');
        // A shared tablet must not offer the last guest's details.
        document.querySelectorAll('#form input:not([type="checkbox"])').forEach(i => {
            i.setAttribute('autocomplete', 'off');
            i.setAttribute('autocorrect', 'off');
            i.setAttribute('spellcheck', 'false');
        });
        ['first', 'last'].forEach(id => $(id).setAttribute('autocapitalize', 'words'));
    } else {
        // The bee follows guests on their own phones, not on the shared tablet.
        const js = document.createElement('script');
        js.src = '../assets/bee2.js';
        document.body.append(js);
    }

    if (!event) {
        $('missing').hidden = false;
        return;
    }

    const day = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
    const short = d => time.format(d).replace(':00', '');
    $('event-when').textContent = `${day.format(event.start)} · ${short(event.start)}–${short(event.end)}`;
    $('event-name').textContent = event.name;
    $('event-place').textContent = event.place;
    document.title = `Check in · ${event.name} | Bogabee Apiaries`;
    if (event.end < Date.now()) {
        $('event-past').textContent = `This event was on ${day.format(event.start)}.`;
        $('event-past').hidden = false;
    }
    $('signin').hidden = false;

    const form = $('form');
    const fields = { first: $('first'), email: $('email'), phone: $('phone'), news: $('news') };
    const digits = s => s.replace(/\D/g, '');
    const emailOk = s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

    function show(id, on, input) {
        $(id).hidden = !on;
        if (input) input.setAttribute('aria-invalid', on ? 'true' : 'false');
    }

    function validate() {
        const first = fields.first.value.trim();
        const email = fields.email.value.trim();
        const phone = fields.phone.value.trim();
        const badEmail = email !== '' && !emailOk(email);
        const badPhone = phone !== '' && (digits(phone).length < 7 || digits(phone).length > 15);
        const noContact = !email && !phone;
        const newsNoEmail = fields.news.checked && !email;
        show('first-error', !first, fields.first);
        show('email-error', badEmail, fields.email);
        show('phone-error', badPhone, fields.phone);
        show('contact-error', noContact);
        if (noContact) { fields.email.setAttribute('aria-invalid', 'true'); fields.phone.setAttribute('aria-invalid', 'true'); }
        show('news-error', newsNoEmail);
        const firstBad = [!first && fields.first, (badEmail || noContact || newsNoEmail) && fields.email, badPhone && fields.phone].find(Boolean);
        if (firstBad) firstBad.focus();
        return !firstBad;
    }

    // Clear an error as soon as the guest fixes it.
    form.addEventListener('input', e => {
        if (e.target.getAttribute('aria-invalid') === 'true') {
            const id = e.target.id;
            if (id === 'first' && e.target.value.trim()) show('first-error', false, e.target);
            if (id === 'email' || id === 'phone') {
                show(id + '-error', false, e.target);
                if (fields.email.value.trim() || fields.phone.value.trim()) {
                    show('contact-error', false, fields.email);
                    fields.phone.setAttribute('aria-invalid', 'false');
                }
                if (fields.email.value.trim()) show('news-error', false);
            }
        }
    });

    let resetTimer;
    form.addEventListener('submit', e => {
        e.preventDefault();
        if (!validate()) return;
        const email = fields.email.value.trim().toLowerCase();
        const phone = fields.phone.value.trim();
        const all = Bogabee.signins.all();
        const same = s => (email && s.email === email) || (phone && s.phone && digits(s.phone) === digits(phone));
        const first = fields.first.value.trim();
        const interestsNow = [...form.querySelectorAll('[name="interests"]:checked')].map(i => i.value);
        const prior = all.find(s => s.eventId === event.id && same(s));
        const already = !!prior;
        if (already) {
            // Checking in again keeps the first visit but adds anything new: interests, a phone, harvest news.
            const merged = all.map(s => s.id !== prior.id ? s : {
                ...s,
                interests: [...new Set([...(s.interests || []), ...interestsNow])],
                news: s.news || fields.news.checked,
                email: s.email || email,
                phone: s.phone || phone,
            });
            localStorage.setItem(Bogabee.KEYS.signins, JSON.stringify(merged));
            window.dispatchEvent(new CustomEvent('bogabee:change', { detail: { key: Bogabee.KEYS.signins } }));
        } else {
            Bogabee.signins.add({
                eventId: event.id,
                first,
                last: $('last').value.trim(),
                email,
                phone,
                interests: [...form.querySelectorAll('[name="interests"]:checked')].map(i => i.value),
                news: fields.news.checked,
                // HubSpot keeps the stage of anyone it already knows; everyone else becomes a lead.
                returning: all.some(same),
            });
        }
        const interests = interestsNow;
        clearTimeout(idleTimer);
        form.hidden = true;
        $('done-title').textContent = `Thanks, ${first}!`;
        $('done-text').textContent = already
            ? `You were already checked in to ${event.name}.${fields.news.checked && !prior.news ? " We've added you to harvest news." : ''}`
            : `You're checked in to ${event.name}.`;
        if (kiosk) {
            $('next-guest').hidden = false;
            const bar = $('countdown');
            bar.hidden = false;
            bar.replaceChildren(document.createElement('i'));
            resetTimer = setTimeout(reset, 8000);
        } else {
            const link = $('done-link');
            const favors = interests.includes('Party favors');
            link.href = favors ? '../favors/' : '../refined/#order';
            link.textContent = favors ? 'Price out party favors' : 'Shop the jars';
            link.hidden = false;
        }
        $('done').hidden = false;
        $('done').focus();
    });

    // On the tablet, a half-filled form clears itself after a minute without a touch.
    let idleTimer;
    const IDLE = 60000;
    const filled = () => [...form.querySelectorAll('input')].some(i => (i.type === 'checkbox' ? i.checked : i.value.trim()));
    function armIdle() {
        if (!kiosk) return;
        clearTimeout(idleTimer);
        if (!form.hidden && filled()) idleTimer = setTimeout(reset, IDLE);
    }
    form.addEventListener('input', armIdle);
    form.addEventListener('change', armIdle);
    document.addEventListener('pointerdown', armIdle);

    function reset() {
        clearTimeout(resetTimer);
        clearTimeout(idleTimer);
        form.reset();
        form.querySelectorAll('[aria-invalid]').forEach(i => i.setAttribute('aria-invalid', 'false'));
        $('done').hidden = true;
        $('countdown').hidden = true;
        form.hidden = false;
        window.scrollTo(0, 0);
        fields.first.focus();
    }
    $('next-guest').addEventListener('click', reset);
})();
