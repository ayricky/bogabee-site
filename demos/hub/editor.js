// Shared pieces for the hub's content screens: a rich-text editor and an image field with a
// photo picker. Load after ../store.js and hub.js (which provides the dialogs and the toast).
(function () {
    const B = window.Bogabee, Hub = window.Hub;
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const isQuota = e => e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014);
    // Site photos are stored by file name; this is the prefix B.image adds, so it can be taken off again.
    const assetBase = B.image('x.jpg').slice(0, -5);
    const toName = src => (src && src.startsWith(assetBase) ? src.slice(assetBase.length) : src);
    // Small previews: site photos have 240px thumbnails; uploads are shown as they are.
    const thumb = src => (B.PHOTOS.includes(src) ? `../assets/img/${src.replace(/\.\w+$/, '')}-240.webp` : B.image(src));

    const toast = Hub.toast, confirm = Hub.confirm, dialog = Hub.dialog;

    // Shrink an upload to at most 1600px wide and keep it as a JPEG data: URL.
    function shrink(file) {
        return new Promise((resolve, reject) => {
            if (!file.type.startsWith('image/')) { reject(new Error('That file is not an image.')); return; }
            const img = new Image();
            const url = URL.createObjectURL(file);
            img.onload = () => {
                const scale = Math.min(1, 1600 / img.naturalWidth);
                const c = document.createElement('canvas');
                c.width = Math.round(img.naturalWidth * scale);
                c.height = Math.round(img.naturalHeight * scale);
                const ctx = c.getContext('2d');
                ctx.fillStyle = '#fff';
                ctx.fillRect(0, 0, c.width, c.height);
                ctx.drawImage(img, 0, 0, c.width, c.height);
                URL.revokeObjectURL(url);
                resolve(c.toDataURL('image/jpeg', 0.82));
            };
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That image could not be read.')); };
            img.src = url;
        });
    }

    const PHOTO_NAMES = {
        'danny.jpg': 'Danny at the hives', 'hello_honey_bee.jpg': 'Bee on wax comb', 'sunflower.jpg': 'Bees on a sunflower', 'honey_overflow.jpg': 'Overflowing honey jar',
        'product16oz.jpg': '16 oz jar', 'product8oz.jpg': '8 oz jar', 'product_stocking_stuffer.jpg': 'Tasting jar',
    };
    // Choose a site photo or upload one. Resolves to { src, caption, alt } or null.
    function pickImage({ title = 'Choose a photo', current = '', caption = false } = {}) {
        return new Promise(resolve => {
            let chosen = current;
            const d = dialog(`<h2>${esc(title)}</h2>
                <div class="photo-grid" role="group" aria-label="Site photos">
                    ${B.PHOTOS.map(p => `<button type="button" data-photo="${esc(p)}" aria-pressed="${p === current}" aria-label="${esc(PHOTO_NAMES[p] || p)}"><img src="${esc(thumb(p))}" alt="" loading="lazy"></button>`).join('')}
                </div>
                <div class="upload">
                    <input type="file" accept="image/*" id="up-${Date.now()}">
                    <label class="btn btn-quiet btn-small" for="">Upload a photo</label>
                    <span class="up-name" style="font-size:13px;color:var(--muted)"></span>
                </div>
                ${caption ? `<label class="field"><span>Caption</span><input name="caption" type="text" maxlength="160"></label>
                    <label class="field"><span>Describe the photo for screen readers</span><input name="alt" type="text" maxlength="160"></label>` : ''}
                <p class="err" hidden></p>
                <div class="acts"><button class="btn btn-quiet" value="no">Cancel</button><button class="btn" value="yes" ${chosen ? '' : 'disabled'}>Use photo</button></div>`,
                v => {
                    if (v !== 'yes' || !chosen) { resolve(null); return; }
                    resolve({ src: chosen, caption: caption ? d.querySelector('[name=caption]').value.trim() : '', alt: caption ? d.querySelector('[name=alt]').value.trim() : '' });
                });
            const file = d.querySelector('input[type=file]');
            d.querySelector('.upload label').htmlFor = file.id;
            const use = d.querySelector('[value="yes"]');
            const err = d.querySelector('.err');
            const choose = src => {
                chosen = src;
                use.disabled = !src;
                d.querySelectorAll('[data-photo]').forEach(b => b.setAttribute('aria-pressed', b.dataset.photo === src));
            };
            d.addEventListener('click', e => { const b = e.target.closest('[data-photo]'); if (b) { choose(b.dataset.photo); d.querySelector('.up-name').textContent = ''; } });
            file.addEventListener('change', async () => {
                err.hidden = true;
                const f = file.files[0];
                if (!f) return;
                try {
                    choose(await shrink(f));
                    d.querySelector('.up-name').textContent = f.name;
                } catch (e) { err.textContent = e.message; err.hidden = false; }
            });
            d.showModal();
            (d.querySelector('[aria-pressed="true"]') || d.querySelector('[data-photo]')).focus();
        });
    }

    function linkDialog(current) {
        return new Promise(resolve => {
            const d = dialog(`<h2>Link</h2>
                <label class="field"><span>Web address</span><input name="url" type="url" placeholder="https://" value="${esc(current)}" required></label>
                <div class="acts">${current ? '<button class="btn btn-quiet" value="remove" formnovalidate>Remove link</button>' : ''}<button class="btn btn-quiet" value="no" formnovalidate>Cancel</button><button class="btn" value="yes">Add link</button></div>`,
                v => {
                    if (v === 'remove') resolve('');
                    else if (v === 'yes') resolve(d.querySelector('[name=url]').value.trim());
                    else resolve(null);
                });
            d.showModal();
            d.querySelector('[name=url]').select();
        });
    }

    // ---------- Image field ----------
    // `context` names the field for screen readers when several look alike ("for section 2").
    function imageField(host, { value = '', onChange = () => {}, label = 'Photo', optional = false, context = '' } = {}) {
        let v = value;
        host.classList.add('img-field');
        const of = context ? ` ${context}` : '';
        const draw = () => {
            host.innerHTML = `<span class="thumb ${v ? '' : 'empty'}" ${v ? `style="background-image:url('${esc(thumb(v))}')"` : ''}>${v ? '' : 'None'}</span>
                <span class="acts"><button type="button" class="btn btn-quiet btn-small" data-change aria-label="${v ? 'Change' : 'Choose'} ${esc(label.toLowerCase())}${esc(of)}">${v ? 'Change' : 'Choose'} ${esc(label.toLowerCase())}</button>
                ${optional && v ? `<button type="button" class="btn btn-quiet btn-small" data-clear aria-label="Remove ${esc(label.toLowerCase())}${esc(of)}">Remove</button>` : ''}</span>`;
        };
        host.addEventListener('click', async e => {
            if (e.target.closest('[data-change]')) {
                const r = await pickImage({ title: `Choose a ${label.toLowerCase()}`, current: v });
                if (r) { v = r.src; draw(); onChange(v); }
                host.querySelector('[data-change]').focus();
            } else if (e.target.closest('[data-clear]')) {
                v = ''; draw(); onChange(v);
                host.querySelector('[data-change]').focus();
            }
        });
        draw();
        return { get value() { return v; }, set value(x) { v = x || ''; draw(); } };
    }

    // ---------- Rich-text editor ----------
    const ICON = {
        ul: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1" fill="currentColor"/><circle cx="4.5" cy="12" r="1" fill="currentColor"/><circle cx="4.5" cy="18" r="1" fill="currentColor"/></svg>',
        ol: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 6h10M10 12h10M10 18h10"/><path d="M4 5h1.5v4M3.6 9h3M3.5 14.2c.4-.7 2.8-.9 2.8.5 0 1-2.8 1.8-2.8 3.3h3" stroke-width="1.5"/></svg>',
        quote: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 7c-3 1-5 3.4-5 6.6V18h5v-5H7.6c.2-1.7 1.3-3 3.1-3.7zM20 7c-3 1-5 3.4-5 6.6V18h5v-5h-2.4c.2-1.7 1.3-3 3.1-3.7z"/></svg>',
        link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
        img: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5"/></svg>',
    };
    let separatorSet = false;
    // One document listener for all editors; each editor registers while it's on the page.
    const editors = new Set();
    document.addEventListener('selectionchange', () => {
        for (const ed of editors) {
            if (!ed.area.isConnected) { editors.delete(ed); continue; }
            ed.onSelection();
        }
    });

    function create(host, { value = '', onChange = () => {}, placeholder = 'Write here…', label = 'Text', short = false } = {}) {
        if (!separatorSet) { try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) {} separatorSet = true; }
        host.classList.add('rte');
        if (short) host.classList.add('short');
        host.innerHTML = `<div class="rte-bar" role="toolbar" aria-label="${esc(label)} formatting">
                <button type="button" data-block="p" aria-pressed="false" title="Paragraph">Text</button>
                <button type="button" data-block="h2" aria-pressed="false" title="Heading">Heading</button>
                <button type="button" data-block="h3" aria-pressed="false" title="Subheading">Subheading</button>
                <span class="sep" aria-hidden="true"></span>
                <button type="button" class="b" data-cmd="bold" aria-pressed="false" aria-label="Bold" title="Bold (Ctrl+B)">B</button>
                <button type="button" class="i" data-cmd="italic" aria-pressed="false" aria-label="Italic" title="Italic (Ctrl+I)">I</button>
                <button type="button" data-link aria-pressed="false" aria-label="Link" title="Link (Ctrl+K)">${ICON.link}</button>
                <span class="sep" aria-hidden="true"></span>
                <button type="button" data-cmd="insertUnorderedList" aria-pressed="false" aria-label="Bulleted list" title="Bulleted list">${ICON.ul}</button>
                <button type="button" data-cmd="insertOrderedList" aria-pressed="false" aria-label="Numbered list" title="Numbered list">${ICON.ol}</button>
                <button type="button" data-block="blockquote" aria-pressed="false" aria-label="Quote" title="Quote">${ICON.quote}</button>
                <button type="button" data-image aria-label="Insert photo" title="Insert photo">${ICON.img}</button>
            </div>
            <div class="rte-area" contenteditable="true" role="textbox" aria-multiline="true" aria-label="${esc(label)}" data-placeholder="${esc(placeholder)}"></div>`;
        const bar = host.querySelector('.rte-bar');
        const area = host.querySelector('.rte-area');
        let saved = null;

        const set = html => {
            area.innerHTML = B.sanitize(html || '');
            area.querySelectorAll('img').forEach(img => { const s = img.getAttribute('src'); img.dataset.src = s; img.src = B.image(s); });
            // A photo at the end needs a line after it to keep writing; empty lines are dropped on save.
            if (area.lastElementChild && area.lastElementChild.tagName === 'FIGURE') area.insertAdjacentHTML('beforeend', '<p><br></p>');
        };
        const get = () => {
            // An inert document, so rewriting image addresses doesn't make the browser fetch them.
            const box = document.implementation.createHTMLDocument('').body;
            box.innerHTML = area.innerHTML;
            box.querySelectorAll('img').forEach(img => { img.setAttribute('src', img.dataset.src || toName(img.getAttribute('src'))); img.removeAttribute('data-src'); });
            // Empty paragraphs left behind by Enter don't belong in the post.
            box.querySelectorAll('p, h2, h3, blockquote, li').forEach(el => { if (!el.textContent.trim() && !el.querySelector('img')) el.remove(); });
            const html = B.sanitize(box.innerHTML).trim();
            return box.textContent.trim() || box.querySelector('img') ? html : '';
        };
        const notify = () => { onChange(get()); sync(); };

        function inside() {
            const s = getSelection();
            return s.rangeCount && area.contains(s.getRangeAt(0).commonAncestorContainer);
        }
        function remember() { if (inside()) saved = getSelection().getRangeAt(0).cloneRange(); }
        function restore() {
            area.focus();
            if (saved) { const s = getSelection(); s.removeAllRanges(); s.addRange(saved); }
        }
        function blockOf() {
            let n = getSelection().anchorNode;
            while (n && n !== area) { if (n.nodeType === 1 && /^(P|H2|H3|BLOCKQUOTE|LI)$/.test(n.tagName)) return n.tagName.toLowerCase(); n = n.parentNode; }
            return 'p';
        }
        function inLink() {
            let n = getSelection().anchorNode;
            while (n && n !== area) { if (n.nodeType === 1 && n.tagName === 'A') return n; n = n.parentNode; }
            return null;
        }
        // Keep the toolbar's pressed states in step with the cursor.
        function sync() {
            if (!inside()) return;
            const block = blockOf();
            bar.querySelectorAll('[data-block]').forEach(b => b.setAttribute('aria-pressed', b.dataset.block === block || (block === 'li' && false)));
            bar.querySelectorAll('[data-cmd]').forEach(b => { let on = false; try { on = document.queryCommandState(b.dataset.cmd); } catch (e) {} b.setAttribute('aria-pressed', on); });
            bar.querySelector('[data-link]').setAttribute('aria-pressed', !!inLink());
        }
        const self = { area, onSelection: () => { if (inside()) { remember(); sync(); } } };
        editors.add(self);

        function run(cmd, val) {
            restore();
            document.execCommand(cmd, false, val);
            notify();
        }
        async function link() {
            remember();
            const a = inLink();
            const url = await linkDialog(a ? a.getAttribute('href') : '');
            if (url === null) { restore(); return; }
            restore();
            if (!url) { if (a) { const r = document.createRange(); r.selectNodeContents(a); getSelection().removeAllRanges(); getSelection().addRange(r); } document.execCommand('unlink'); notify(); return; }
            if (getSelection().isCollapsed && !a) document.execCommand('insertHTML', false, `<a href="${esc(url)}">${esc(url)}</a>`);
            else document.execCommand('createLink', false, url);
            notify();
        }
        async function image() {
            remember();
            const r = await pickImage({ title: 'Insert a photo', caption: true });
            restore();
            if (!r) return;
            insertFigure(r);
        }
        function insertFigure(r) {
            // Built as nodes: insertHTML would split a figure that lands inside a paragraph.
            const fig = document.createElement('figure');
            fig.innerHTML = `<img src="${esc(B.image(r.src))}" data-src="${esc(r.src)}" alt="${esc(r.alt)}">${r.caption ? `<figcaption>${esc(r.caption)}</figcaption>` : ''}`;
            let block = getSelection().rangeCount ? getSelection().anchorNode : null;
            while (block && block.parentNode !== area) block = block.parentNode;
            const after = document.createElement('p');
            after.innerHTML = '<br>';
            if (block && block !== area) {
                // An empty paragraph becomes the photo; otherwise the photo goes after the current block.
                if (!block.textContent.trim() && !block.querySelector('img')) block.replaceWith(fig);
                else block.after(fig);
            } else area.appendChild(fig);
            fig.after(after);
            const range = document.createRange();
            range.setStart(after, 0);
            getSelection().removeAllRanges();
            getSelection().addRange(range);
            notify();
        }

        // Toolbar buttons keep the text selection: act on mousedown's default being prevented.
        bar.addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });
        bar.addEventListener('click', e => {
            const b = e.target.closest('button');
            if (!b) return;
            if (b.dataset.block) {
                const cur = blockOf();
                const to = b.dataset.block === cur && cur !== 'p' ? 'p' : b.dataset.block;
                run('formatBlock', `<${to}>`);
            } else if (b.dataset.cmd) run(b.dataset.cmd);
            else if ('link' in b.dataset) link();
            else if ('image' in b.dataset) image();
        });
        // One tab stop for the whole toolbar; arrow keys, Home and End move along it.
        const btns = [...bar.querySelectorAll('button')];
        const rove = b => { btns.forEach(x => { x.tabIndex = x === b ? 0 : -1; }); b.focus(); };
        btns.forEach((b, i) => { b.tabIndex = i === 0 ? 0 : -1; });
        bar.addEventListener('focusin', e => { if (btns.includes(e.target)) btns.forEach(x => { x.tabIndex = x === e.target ? 0 : -1; }); });
        bar.addEventListener('keydown', e => {
            const i = btns.indexOf(document.activeElement);
            if (i < 0) return;
            const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: btns.length - 1 }[e.key];
            if (to === undefined) return;
            e.preventDefault();
            rove(btns[(to + btns.length) % btns.length]);
        });
        area.addEventListener('keydown', e => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); link(); }
        });
        area.addEventListener('focus', () => { if (!area.innerHTML.trim()) { area.innerHTML = '<p><br></p>'; const r = document.createRange(); r.setStart(area.firstChild, 0); getSelection().removeAllRanges(); getSelection().addRange(r); } });
        area.addEventListener('blur', () => { if (!get()) area.innerHTML = ''; });
        area.addEventListener('input', notify);
        // A pasted or dropped image file is shrunk and inserted as a photo.
        async function insertFile(file) {
            try {
                const src = await shrink(file);
                restore();
                insertFigure({ src, caption: '', alt: '' });
            } catch (err) { toast(err.message, { error: true }); }
        }
        area.addEventListener('dragover', e => { if ([...e.dataTransfer.items].some(i => i.kind === 'file')) e.preventDefault(); });
        area.addEventListener('drop', e => {
            const file = [...e.dataTransfer.files].find(f => f.type.startsWith('image/'));
            if (!e.dataTransfer.files.length) return;
            e.preventDefault();
            if (!file) { toast('Only photos can be dropped into a post.', { error: true }); return; }
            const pos = document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
            if (pos) { getSelection().removeAllRanges(); getSelection().addRange(pos); remember(); }
            insertFile(file);
        });
        // Pasted content keeps only the tags the site allows.
        area.addEventListener('paste', e => {
            const file = [...e.clipboardData.files].find(f => f.type.startsWith('image/'));
            if (file) { e.preventDefault(); remember(); insertFile(file); return; }
            e.preventDefault();
            const html = e.clipboardData.getData('text/html');
            const text = e.clipboardData.getData('text/plain');
            const clean = html
                ? B.sanitize(html)
                : text.split(/\n{2,}/).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
            document.execCommand('insertHTML', false, clean);
            notify();
        });

        set(value);
        return {
            get value() { return get(); },
            set value(html) { set(html); },
            focus: () => area.focus(),
            destroy: () => editors.delete(self),
            area,
        };
    }

    // The formatting toolbar sticks just under the save bar, so it needs the save bar's height.
    function trackSavebar() {
        const bar = document.querySelector('.savebar');
        if (!bar) return;
        const set = () => document.documentElement.style.setProperty('--savebar-h', getComputedStyle(bar).position === 'sticky' ? bar.offsetHeight + 'px' : '0px');
        addEventListener('resize', set);
        new ResizeObserver(set).observe(bar);
        set();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', trackSavebar); else trackSavebar();

    // Phones: a bar above the tabs while there are unsaved changes. Its buttons press the save bar's.
    function dirtyBar(ids) {
        const bar = document.createElement('div');
        bar.className = 'dirtybar';
        bar.setAttribute('role', 'region');
        bar.setAttribute('aria-label', 'Unsaved changes');
        bar.innerHTML = '<span>Unsaved changes</span>' + ids.map(id => `<button type="button" class="btn${id === ids[ids.length - 1] ? '' : ' btn-quiet'}" data-mirror="${id}"></button>`).join('');
        document.body.appendChild(bar);
        bar.addEventListener('click', e => { const b = e.target.closest('[data-mirror]'); if (b) document.getElementById(b.dataset.mirror).click(); });
        return dirty => {
            bar.classList.toggle('on', !!dirty);
            bar.querySelectorAll('[data-mirror]').forEach(b => {
                const src = document.getElementById(b.dataset.mirror);
                b.textContent = src.textContent;
                b.hidden = src.hidden;
                b.disabled = src.disabled;
            });
        };
    }

    window.BogabeeEditor = { create, imageField, pickImage, confirm, toast, isQuota, esc, dirtyBar };
})();
