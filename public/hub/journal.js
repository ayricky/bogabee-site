// The hub's Journal screen: the list of posts and the editor. Load after hub.js and editor.js.
(function () {
    const E = window.BogabeeEditor, esc = Hub.esc;
    const $ = id => document.getElementById(id);
    const blank = () => ({ id: null, title: '', slug: '', excerpt: '', cover: '', coverAlt: '', body: '', status: 'draft', date: null });
    const FIELDS = ['title', 'slug', 'excerpt', 'cover', 'coverAlt', 'body'];
    // Same rule as the server (server/store.js), so the address shown is the one it will save.
    const slugify = t => String(t || 'post').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim()
        .replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'post';
    // The posts the site started with, until Danny edits them.
    const starter = p => !!p && p.updatedBy === 'seed';

    let posts = [];
    let filter = 'all', query = '';
    let draft = null;        // the post being edited, with unsaved changes (null: nothing open)
    let saved = null;        // the stored post (null for a new one)
    let slugTouched = false, slugUnlocked = false, busy = false;

    const cover = E.imageField($('cover'), { label: 'Photo', optional: true, context: 'for the cover', onChange: v => { draft.cover = v; changed(); } });
    const body = E.create($('body'), { label: 'Post', placeholder: 'Write the post…', onChange: v => { draft.body = v; changed(); } });

    const live = () => !!(saved && saved.status === 'published');
    const isDirty = () => !!draft && FIELDS.some(k => (draft[k] || '') !== ((saved || blank())[k] || ''));
    const byId = id => posts.find(p => p.id === id) || null;

    function statusText() {
        if (!saved) return 'New post, not saved';
        if (live()) return `Published ${Hub.dayText(saved.date)}`;
        return `Draft · saved ${Hub.when(saved.updated)}`;
    }

    function renderState() {
        const none = !draft;
        $('empty-editor').hidden = !none;
        $('savebar').hidden = none;
        $('form').hidden = none;
        if (none) { phoneBar(false); return; }
        const dirty = isDirty();
        const st = $('state');
        st.textContent = dirty ? 'Unsaved changes' : statusText();
        st.className = 'state' + (dirty ? ' dirty' : live() ? '' : ' draft');
        $('publish').textContent = live() ? 'Update' : 'Publish';
        $('publish').disabled = busy || (live() && !dirty);
        $('save-draft').hidden = live();
        $('save-draft').disabled = busy || (!dirty && !!saved);
        // Preview shows the saved post; a published post's unsaved edits aren't on the server yet.
        $('preview').disabled = busy || (live() && dirty);
        $('unpublish').hidden = !live();
        $('unpublish').disabled = busy;
        $('view').hidden = !live();
        if (live()) $('view').href = `/journal/${encodeURIComponent(saved.slug)}/`;
        $('delete').hidden = !saved;
        $('delete').disabled = busy;
        $('starter').hidden = !starter(saved);
        phoneBar(dirty);
        // A live post's address is locked: changing it is deliberate, and old links keep working.
        const locked = live() && !slugUnlocked;
        $('slug').readOnly = locked;
        $('slug-change').hidden = !locked;
        $('slug-note').textContent = live() && slugUnlocked ? 'Links to the old address will keep working.' : '';
    }

    const phoneBar = E.dirtyBar(['save-draft', 'publish']);
    function changed() { renderState(); renderList(); }

    function load(post) {
        saved = post ? { ...post } : null;
        draft = { ...(post || blank()) };
        slugTouched = !!post;
        slugUnlocked = false;
        $('title').value = draft.title;
        fitTitle();
        $('slug').value = draft.slug;
        $('excerpt').value = draft.excerpt || '';
        $('cover-alt').value = draft.coverAlt || '';
        cover.value = draft.cover;
        body.value = draft.body;
        renderState();
        renderList();
    }
    function showEmpty() {
        saved = null; draft = null;
        renderState();
        renderList();
    }

    function renderList() {
        const q = query.toLowerCase();
        const shown = posts.filter(p => (filter === 'all' || (filter === 'draft' ? p.status !== 'published' : p.status === 'published'))
            && (!q || (p.title + ' ' + (p.excerpt || '')).toLowerCase().includes(q)));
        const current = saved && saved.id;
        const rows = shown.map(p => {
            const title = p.id === current && draft && draft.title ? draft.title : p.title || 'Untitled';
            const sub = p.status === 'published'
                ? `<span class="tag green">Published</span>${esc(Hub.dayText(p.date))}`
                : `<span class="tag dim">Draft</span>${esc(Hub.when(p.updated))}`;
            const img = p.cover ? Hub.thumb(p.cover) : '';
            return `<li><button type="button" data-id="${esc(p.id)}" aria-current="${p.id === current}">
                <span class="pt" style="${img ? `background-image:url('${esc(img)}')` : ''}"></span>
                <span><b>${esc(title)}</b><small>${sub}${starter(p) ? ' · <span class="tag gold">Starter copy</span>' : ''}</small></span></button></li>`;
        });
        if (draft && !saved) rows.unshift(`<li><button type="button" aria-current="true"><span class="pt"></span><span><b>${esc(draft.title || 'New post')}</b><small><span class="tag gold">Not saved</span></small></span></button></li>`);
        $('posts').innerHTML = rows.join('') || '<li class="empty">No posts here yet.</li>';
    }

    async function leaveOk() {
        if (!isDirty()) return true;
        return Hub.confirm({ title: 'Discard your changes?', body: 'This post has edits that are not saved.', ok: 'Discard', danger: true });
    }

    // Saves the open post with the given status. The server cleans it and has the final say on
    // its address; errors (like a missing title) come back as a message to show.
    async function save(status, message) {
        busy = true; renderState();
        try {
            const { post } = await Hub.api('PUT', 'posts', { ...(saved || {}), ...draft, status, slug: draft.slug || slugify(draft.title) });
            posts = [post, ...posts.filter(p => p.id !== post.id)];
            busy = false;
            load(post);
            if (message) Hub.toast(message);
            return post;
        } catch (e) {
            busy = false; renderState();
            Hub.toast(e.message, { error: true });
            return null;
        }
    }

    // Preview opens the post as it will look on the site. A new or edited draft is saved first.
    async function preview() {
        // Opened now, while the click still counts, so pop-up blockers allow it.
        const w = window.open('about:blank', '_blank');
        let post = saved;
        if (!saved || (!live() && isDirty())) post = await save('draft', 'Draft saved');
        if (!post) { if (w) w.close(); return; }
        const url = `/hub/preview/${encodeURIComponent(post.id)}`;
        if (w) w.location = url; else location.assign(url);
    }

    // ---------- Wiring ----------
    // The title wraps instead of scrolling sideways, but stays one paragraph.
    const fitTitle = () => { const t = $('title'); t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; };
    $('title').addEventListener('keydown', e => { if (e.key === 'Enter') e.preventDefault(); });
    new ResizeObserver(fitTitle).observe($('title'));
    $('title').addEventListener('input', () => {
        $('title').value = $('title').value.replace(/\s*\n\s*/g, ' ');
        fitTitle();
        draft.title = $('title').value;
        if (!slugTouched) { draft.slug = draft.title ? slugify(draft.title) : ''; $('slug').value = draft.slug; }
        changed();
    });
    $('slug').addEventListener('input', () => { slugTouched = true; draft.slug = $('slug').value; changed(); });
    $('slug').addEventListener('change', () => { draft.slug = $('slug').value ? slugify($('slug').value) : ''; $('slug').value = draft.slug; changed(); });
    $('slug-change').addEventListener('click', async () => {
        const ok = await Hub.confirm({ title: 'Change this post’s address?', body: 'Links to the old address, like ones shared on Instagram, will keep working and send readers to the new one.', ok: 'Change address' });
        if (!ok) return;
        slugUnlocked = true; slugTouched = true;
        renderState();
        $('slug').focus(); $('slug').select();
    });
    $('excerpt').addEventListener('input', () => { draft.excerpt = $('excerpt').value; changed(); });
    $('cover-alt').addEventListener('input', () => { draft.coverAlt = $('cover-alt').value; changed(); });

    $('save-draft').addEventListener('click', () => save('draft', 'Draft saved'));
    $('publish').addEventListener('click', () => save('published', live() ? 'Post updated' : 'Post published'));
    $('unpublish').addEventListener('click', async () => {
        const ok = await Hub.confirm({ title: 'Take this post off the journal?', body: 'It becomes a draft. Its address stops working until you publish it again.', ok: 'Unpublish', danger: true });
        if (!ok) return;
        const out = await save('draft', '');
        if (out) Hub.toast('Post unpublished', { undo: () => save('published', 'Post published again') });
    });
    $('preview').addEventListener('click', preview);
    $('delete').addEventListener('click', async () => {
        if (!saved) return;
        const ok = await Hub.confirm({ title: 'Delete this post?', body: `"${saved.title}" will be removed from the journal. This can't be undone.`, ok: 'Delete', danger: true });
        if (!ok) return;
        busy = true; renderState();
        try {
            await Hub.api('DELETE', `posts/${encodeURIComponent(saved.id)}`);
            posts = posts.filter(p => p.id !== saved.id);
            busy = false;
            showEmpty();
            $('list-title').focus();
            Hub.toast('Post deleted');
        } catch (e) {
            busy = false; renderState();
            Hub.toast(e.message, { error: true });
        }
    });
    $('new-post').addEventListener('click', async () => {
        if (!(await leaveOk())) return;
        load(null);
        $('title').focus();
    });
    $('posts').addEventListener('click', async e => {
        const b = e.target.closest('button[data-id]');
        if (!b || (saved && b.dataset.id === saved.id)) return;
        if (!(await leaveOk())) return;
        load(byId(b.dataset.id));
        if (matchMedia('(max-width: 1080px)').matches) document.querySelector('.editor').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    });
    document.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => {
        filter = b.dataset.filter;
        document.querySelectorAll('[data-filter]').forEach(x => x.setAttribute('aria-pressed', x === b));
        renderList();
    }));
    $('search').addEventListener('input', () => { query = $('search').value.trim(); renderList(); });
    addEventListener('beforeunload', e => { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } });

    renderState();
    (async () => {
        try {
            ({ posts } = await Hub.api('GET', 'content'));
            const start = new URLSearchParams(location.search).get('post');
            load((start && byId(start)) || posts[0] || null);
            $('new-post').disabled = false;
            $('layout').removeAttribute('aria-busy');
        } catch (e) {
            $('load-err').textContent = e.message;
            $('load-err').hidden = false;
            showEmpty();
        }
    })();
})();
