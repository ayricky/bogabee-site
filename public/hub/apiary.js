// The hub's Apiary page editor. Load after hub.js and editor.js.
(function () {
    const E = window.BogabeeEditor, esc = Hub.esc;
    const $ = id => document.getElementById(id);
    const strip = d => { const { updated, updatedBy, ...rest } = d; return rest; };
    const empty = () => ({ eyebrow: '', title: '', intro: '', heroImage: '', sections: [], seasonsTitle: '', seasons: [], keeperTitle: '', keeper: '', keeperImage: '', keeperImageAlt: '' });

    let data = null, stored = null, savedJSON = '', busy = false;
    const json = () => JSON.stringify(strip(data));
    const dirty = () => !!data && json() !== savedJSON;

    function renderState() {
        const d = dirty();
        const st = $('state');
        st.textContent = d ? 'Unsaved changes' : stored && stored.updated ? `Published ${Hub.when(stored.updated)}` : '';
        st.className = 'state' + (d ? ' dirty' : '');
        $('save').disabled = busy || !d;
        // The page still shows the copy the site launched with until Danny publishes his own.
        $('starter').hidden = !(stored && stored.updatedBy === 'seed');
        phoneBar(d);
    }
    const phoneBar = E.dirtyBar(['save']);
    const changed = () => { renderState(); queuePreview(); };

    const hero = E.imageField($('hero-image'), { label: 'Photo', optional: true, context: 'for the top of the page', onChange: v => { data.heroImage = v; changed(); } });
    const keeperImage = E.imageField($('keeper-image'), { label: 'Photo', optional: true, context: 'for the beekeeper', onChange: v => { data.keeperImage = v; changed(); } });
    const keeper = E.create($('keeper'), { label: 'Beekeeper text', short: true, onChange: v => { data.keeper = v; changed(); } });

    document.querySelectorAll('[data-key]').forEach(el => el.addEventListener('input', () => { data[el.dataset.key] = el.value; changed(); }));

    // ---------- Sections: heading, photo and text, in order ----------
    let sectionEditors = [];
    function renderSections(focusIndex) {
        const box = $('sections');
        sectionEditors.forEach(ed => ed.destroy());
        sectionEditors = [];
        box.innerHTML = '';
        data.sections.forEach((s, i) => {
            const card = document.createElement('div');
            card.className = 'card';
            card.innerHTML = `<div class="card-head"><b>Section ${i + 1}</b>
                    <span class="order">
                        <button type="button" class="icon-btn" data-up aria-label="Move section ${i + 1} up" ${i === 0 ? 'disabled' : ''}>↑</button>
                        <button type="button" class="icon-btn" data-down aria-label="Move section ${i + 1} down" ${i === data.sections.length - 1 ? 'disabled' : ''}>↓</button>
                        <button type="button" class="icon-btn danger" data-remove aria-label="Remove section ${i + 1}">Remove</button>
                    </span></div>
                <div class="two">
                    <label class="field"><span>Heading</span><input type="text" maxlength="120" value="${esc(s.heading)}" data-heading></label>
                    <div class="field"><span>Photo</span><div data-image></div></div>
                </div>
                <label class="field"><span>Photo description</span><input type="text" maxlength="200" value="${esc(s.imageAlt || '')}" data-alt></label>
                <div class="field"><span>Text</span><div data-body></div></div>`;
            box.appendChild(card);
            card.querySelector('[data-heading]').addEventListener('input', e => { s.heading = e.target.value; changed(); });
            card.querySelector('[data-alt]').addEventListener('input', e => { s.imageAlt = e.target.value; changed(); });
            E.imageField(card.querySelector('[data-image]'), { value: s.image, label: 'Photo', optional: true, context: `for section ${i + 1}`, onChange: v => { s.image = v; changed(); } });
            sectionEditors.push(E.create(card.querySelector('[data-body]'), { value: s.body, label: `Section ${i + 1} text`, short: true, onChange: v => { s.body = v; changed(); } }));
            card.querySelector('[data-up]').addEventListener('click', () => move(data.sections, i, -1, renderSections, '[data-up]'));
            card.querySelector('[data-down]').addEventListener('click', () => move(data.sections, i, 1, renderSections, '[data-down]'));
            card.querySelector('[data-remove]').addEventListener('click', () => {
                const [gone] = data.sections.splice(i, 1);
                renderSections(Math.min(i, data.sections.length - 1)); changed();
                if (!data.sections.length) $('add-section').focus();
                Hub.toast(`Section ${i + 1} removed`, { undo: () => { data.sections.splice(i, 0, gone); renderSections(i); changed(); } });
            });
        });
        if (focusIndex !== undefined && box.children[focusIndex]) box.children[focusIndex].querySelector('[data-heading]').focus();
    }

    // Move an item up or down and keep focus on the same control so keyboard users stay oriented.
    function move(list, i, d, render, sel) {
        const j = i + d;
        if (j < 0 || j >= list.length) return;
        [list[i], list[j]] = [list[j], list[i]];
        render();
        changed();
        const host = render === renderSections ? $('sections') : $('seasons');
        const btn = host.children[j] && host.children[j].querySelector(sel);
        if (btn && !btn.disabled) btn.focus(); else host.children[j] && host.children[j].querySelector('input').focus();
    }

    function renderSeasons() {
        const box = $('seasons');
        box.innerHTML = '';
        data.seasons.forEach((s, i) => {
            const row = document.createElement('div');
            row.className = 'season';
            row.innerHTML = `<label class="field"><span>Season</span><input type="text" maxlength="60" value="${esc(s.name)}" data-name></label>
                <label class="field"><span>What happens</span><input type="text" maxlength="300" value="${esc(s.text)}" data-text></label>
                <span class="order">
                    <button type="button" class="icon-btn" data-up aria-label="Move ${esc(s.name || 'season')} up" ${i === 0 ? 'disabled' : ''}>↑</button>
                    <button type="button" class="icon-btn" data-down aria-label="Move ${esc(s.name || 'season')} down" ${i === data.seasons.length - 1 ? 'disabled' : ''}>↓</button>
                    <button type="button" class="icon-btn" data-remove aria-label="Remove ${esc(s.name || 'season')}">×</button>
                </span>`;
            box.appendChild(row);
            row.querySelector('[data-name]').addEventListener('input', e => { s.name = e.target.value; changed(); });
            row.querySelector('[data-text]').addEventListener('input', e => { s.text = e.target.value; changed(); });
            row.querySelector('[data-up]').addEventListener('click', () => move(data.seasons, i, -1, renderSeasons, '[data-up]'));
            row.querySelector('[data-down]').addEventListener('click', () => move(data.seasons, i, 1, renderSeasons, '[data-down]'));
            row.querySelector('[data-remove]').addEventListener('click', () => {
                const [gone] = data.seasons.splice(i, 1); renderSeasons(); changed();
                const next = box.children[Math.min(i, data.seasons.length - 1)];
                (next ? next.querySelector('input') : $('add-season')).focus();
                Hub.toast(`${gone.name || 'Season'} removed`, { undo: () => { data.seasons.splice(i, 0, gone); renderSeasons(); changed(); } });
            });
        });
    }

    $('add-section').addEventListener('click', () => {
        data.sections.push({ heading: '', image: '', imageAlt: '', body: '' });
        renderSections(data.sections.length - 1);
        changed();
    });
    $('add-season').addEventListener('click', () => {
        data.seasons.push({ name: '', text: '' });
        renderSeasons();
        changed();
        $('seasons').lastElementChild.querySelector('input').focus();
    });

    function load(page) {
        stored = page;
        data = { ...empty(), ...structuredClone(strip(page || {})) };
        savedJSON = json();
        document.querySelectorAll('[data-key]').forEach(el => { el.value = data[el.dataset.key] || ''; });
        hero.value = data.heroImage;
        keeperImage.value = data.keeperImage;
        keeper.value = data.keeper;
        renderSections();
        renderSeasons();
        renderState();
        queuePreview();
    }

    // ---------- Preview: the page with the unsaved edits, rendered by the server ----------
    // Built only when there's room to show it. The frame is a picture of the page: sandboxed so
    // nothing in it runs, inert, and hidden from screen readers ("Open the live page" is the real link).
    let iframe = null, previewTimer = 0, previewSeq = 0;
    const wide = matchMedia('(min-width: 1320px)');
    async function feedPreview() {
        if (!iframe || !data) return;
        const seq = ++previewSeq;
        try {
            const html = await Hub.api('POST', 'preview/apiary', strip(data));
            if (seq === previewSeq) iframe.srcdoc = html;
        } catch (e) {
            if (seq === previewSeq) Hub.toast(e.message, { error: true });
        }
    }
    function queuePreview() { clearTimeout(previewTimer); previewTimer = setTimeout(feedPreview, 350); }
    function buildPreview() {
        if (iframe) return;
        const frame = $('frame');
        iframe = document.createElement('iframe');
        iframe.title = 'Preview of the Apiary page';
        iframe.setAttribute('sandbox', '');
        iframe.setAttribute('inert', '');
        iframe.setAttribute('aria-hidden', 'true');
        iframe.setAttribute('tabindex', '-1');
        frame.appendChild(iframe);
        // Show the page at desktop width, scaled to fit the preview panel.
        new ResizeObserver(() => {
            const sc = frame.clientWidth / 1280;
            iframe.style.transform = `scale(${sc})`;
            iframe.style.height = frame.clientHeight / sc + 'px';
        }).observe(frame);
        queuePreview();
    }
    wide.addEventListener('change', () => { if (wide.matches) buildPreview(); });
    if (wide.matches) buildPreview();

    $('save').addEventListener('click', async () => {
        busy = true; renderState();
        try {
            const { page } = await Hub.api('PUT', 'pages/apiary', strip(data));
            busy = false;
            load(page);
            Hub.toast('Apiary page published');
        } catch (e) {
            busy = false; renderState();
            Hub.toast(e.message, { error: true });
        }
    });
    addEventListener('beforeunload', e => { if (dirty()) { e.preventDefault(); e.returnValue = ''; } });

    (async () => {
        try {
            const { pages } = await Hub.api('GET', 'content');
            load(pages.apiary);
            $('layout').removeAttribute('aria-busy');
        } catch (e) {
            $('load-err').textContent = e.message;
            $('load-err').hidden = false;
        }
    })();
})();
