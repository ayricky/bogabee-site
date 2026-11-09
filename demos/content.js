// Rendering helpers shared by the Apiary page, the Journal and the homepage's journal strip.
// Load after store.js.
(function () {
    const B = window.Bogabee;

    // Descriptions for the site's own photos; uploaded images have none, so they read as decorative.
    const ALT = {
        'danny.jpg': 'Danny crouched beside a white hive box covered in bees',
        'hello_honey_bee.jpg': 'A honey bee peeking over a piece of wax comb',
        'sunflower.jpg': 'Honey bees foraging on a sunflower',
        'honey_overflow.jpg': 'An overfilled jar of honey running down its sides',
        'product16oz.jpg': '16 ounce jar of Bogabee wildflower honey',
        'product8oz.jpg': '8 ounce jar of Bogabee wildflower honey',
        'product_stocking_stuffer.jpg': 'Mini tasting jar with a wooden honey dipper',
    };

    // The site photos also exist as WebP at their own width and at 640px (demos/assets/img).
    const SIZE = {
        'danny.jpg': [1168, 880], 'hello_honey_bee.jpg': [1080, 1350], 'sunflower.jpg': [1080, 1350], 'honey_overflow.jpg': [1080, 1357],
        'product16oz.jpg': [1080, 1350], 'product8oz.jpg': [1080, 1350], 'product_stocking_stuffer.jpg': [1080, 1350],
    };
    const IMG_DIR = new URL('assets/img/', document.currentScript.src).href;
    const siteName = src => {
        const name = String(src || '').split('/').pop();
        return SIZE[name] ? name : null;
    };
    // An <img> for a stored photo: site photos get WebP with a srcset; uploads (data: URLs) are used as they are.
    function picture(src, { sizes = '100vw', alt: text, cls = '', eager = false } = {}) {
        if (!src) return '';
        const name = siteName(src);
        const a = esc(text ?? ALT[name] ?? '');
        const c = cls ? ` class="${cls}"` : '';
        const load = eager ? ' fetchpriority="high"' : ' loading="lazy"';
        if (!name) return `<img${c} src="${esc(B.image(src))}" alt="${a}"${load} decoding="async">`;
        const [w, h] = SIZE[name], base = IMG_DIR + name.replace(/\.jpg$/, '');
        return `<img${c} src="${base}.webp" srcset="${base}-640.webp 640w, ${base}.webp ${w}w" sizes="${sizes}" width="${w}" height="${h}" alt="${a}"${load} decoding="async">`;
    }
    // Swap site photos inside rendered post or page bodies for the WebP versions.
    function upgrade(root, sizes = '(max-width: 760px) 100vw, 720px') {
        root.querySelectorAll('img').forEach(img => {
            const name = siteName(img.getAttribute('src'));
            if (!name) return;
            const [w, h] = SIZE[name], base = IMG_DIR + name.replace(/\.jpg$/, '');
            img.srcset = `${base}-640.webp 640w, ${base}.webp ${w}w`;
            img.sizes = sizes;
            img.src = `${base}.webp`;
            img.width = w; img.height = h;
            img.decoding = 'async';
            if (!img.getAttribute('alt')) img.alt = ALT[name];
        });
    }

    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const alt = src => esc(ALT[siteName(src)] || '');
    const date = ms => (ms ? new Date(ms).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'Draft');
    const postUrl = (p, base) => `${base}post.html?slug=${encodeURIComponent(p.slug)}`;

    // A post card. `base` is the path to /demos/journal/ from the current page; `level` keeps headings in order
    // (h2 on the Journal list, h3 under the homepage's section heading).
    function card(p, base, size, level = 'h3') {
        const sizes = size === 'feature' ? '(max-width: 760px) 100vw, 640px' : '(max-width: 760px) 100vw, 400px';
        const img = p.cover ? `<div class="post-cover">${picture(p.cover, { sizes, alt: '' })}</div>` : '';
        return `<article class="post-card${size ? ' ' + size : ''}${p.cover ? '' : ' no-cover'}">
            ${img}
            <div class="post-text">
                <time ${p.date ? `datetime="${new Date(p.date).toISOString().slice(0, 10)}"` : ''}>${date(p.date)}</time>
                <${level}><a href="${postUrl(p, base)}">${esc(p.title || 'Untitled')}</a></${level}>
                ${p.excerpt ? `<p>${esc(p.excerpt)}</p>` : ''}
            </div>
        </article>`;
    }

    // Re-run a render whenever posts or pages change, here or in the hub in another tab.
    function live(keys, fn) {
        fn();
        window.addEventListener('bogabee:change', e => { if (keys.includes(e.detail.key)) fn(); });
    }

    B.content = { esc, alt, date, card, postUrl, live, picture, upgrade, siteName };
})();
