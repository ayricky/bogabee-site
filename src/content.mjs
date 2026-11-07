// Renders the editable content (the Apiary page and Journal posts in content/) to HTML.
// Pure functions of their data, so the owner hub can reuse them to render what Danny saves.

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The site's own photos, in public/assets/img as NAME.webp and NAME-640.webp (market: NAME-1000.webp).
// Content refers to them by name; anything else is used as a plain URL.
export const PHOTOS = {
    market: { w: 1500, h: 2000, small: 1000, alt: 'The Bogabee Apiaries table at an outdoor market, with jars, honey bears and a price board' },
    danny: { w: 1168, h: 880, small: 640, alt: 'Danny crouched beside a white hive box covered in bees' },
    hello_honey_bee: { w: 1080, h: 1350, small: 640, alt: 'A honey bee peeking over a piece of wax comb' },
    sunflower: { w: 1080, h: 1350, small: 640, alt: 'Honey bees foraging on a sunflower' },
    honey_overflow: { w: 1080, h: 1357, small: 640, alt: 'An overfilled jar of honey running down its sides' },
    product16oz: { w: 1080, h: 1350, small: 640, alt: '16 ounce jar of Bogabee wildflower honey' },
    product8oz: { w: 1080, h: 1350, small: 640, alt: '8 ounce jar of Bogabee wildflower honey' },
    product_stocking_stuffer: { w: 1080, h: 1350, small: 640, alt: 'Mini tasting jar with a wooden honey dipper' },
};

export const photoUrl = name => PHOTOS[name] ? `/assets/img/${name}.webp` : name;

/** An <img> for a site photo (WebP with a srcset) or any other image URL. */
export function picture(src, { sizes = '100vw', alt, cls = '', eager = false } = {}) {
    if (!src) return '';
    const p = PHOTOS[src];
    const a = esc(alt ?? p?.alt ?? '');
    const c = cls ? ` class="${cls}"` : '';
    const load = eager ? ' fetchpriority="high"' : ' loading="lazy"';
    if (!p) return `<img${c} src="${esc(src)}" alt="${a}"${load} decoding="async">`;
    const base = `/assets/img/${src}`;
    return `<img${c} src="${base}.webp" srcset="${base}-${p.small}.webp ${p.small}w, ${base}.webp ${p.w}w" sizes="${sizes}" width="${p.w}" height="${p.h}" alt="${a}"${load} decoding="async">`;
}

const DAY = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
export const longDate = iso => (iso ? DAY.format(new Date(iso + 'T00:00:00Z')) : '');
export const postPath = p => `/journal/${p.slug}/`;
const timeTag = iso => `<time datetime="${esc(iso)}">${longDate(iso)}</time>`;

/** Published posts, newest first. */
export const published = posts => posts.filter(p => p.status === 'published').sort((a, b) => b.date.localeCompare(a.date));

/** A post card. `level` keeps headings in order: h2 on the Journal page, h3 under a section heading. */
export function card(p, size = '', level = 'h3') {
    const sizes = size === 'feature' ? '(max-width: 760px) 100vw, 640px' : '(max-width: 760px) 100vw, 400px';
    return `<article class="post-card${size ? ' ' + size : ''}${p.cover ? '' : ' no-cover'}">
                ${p.cover ? `<div class="post-cover">${picture(p.cover, { sizes, alt: '' })}</div>` : ''}
                <div class="post-text">
                    ${timeTag(p.date)}
                    <${level}><a href="${postPath(p)}">${esc(p.title)}</a></${level}>
                    ${p.excerpt ? `<p>${esc(p.excerpt)}</p>` : ''}
                </div>
            </article>`;
}

// Site photos inside a body become WebP with a srcset. Bodies come from content/ (or, later, the
// hub's sanitizer), so they are trusted HTML here.
function upgradeImages(html, sizes = '(max-width: 760px) 100vw, 720px') {
    return html.replace(/<img\b([^>]*?)\bsrc="([^"]+)"([^>]*)>/g, (tag, pre, src, post) => {
        const name = src.replace(/^.*\//, '').replace(/(-\d+)?\.(webp|jpe?g|png)$/, '');
        if (!PHOTOS[name]) return tag.includes('loading=') ? tag : tag.replace('<img', '<img loading="lazy"');
        const altMatch = /\balt="([^"]*)"/.exec(pre + post);
        return picture(name, { sizes, alt: altMatch ? altMatch[1] : undefined });
    });
}

export function apiaryMain(a) {
    const used = new Set(a.heroImage ? [a.heroImage] : []);
    const once = src => (!src || used.has(src) ? '' : (used.add(src), src));
    const figure = (src, alt) => (src ? `<figure class="a-img">${picture(src, { sizes: '(max-width: 760px) 100vw, 560px', alt: alt || undefined })}</figure>` : '');
    const sections = (a.sections || []).map(s => {
        const img = once(s.image);
        return `
            <section class="a-row${img ? '' : ' text-only'}">
                ${figure(img, s.imageAlt)}
                <div>
                    ${s.heading ? `<h2 class="display">${esc(s.heading)}</h2>` : ''}
                    <div class="prose">${upgradeImages(s.body || '')}</div>
                </div>
            </section>`;
    }).join('');
    const seasons = a.seasons || [];
    const keeperImg = once(a.keeperImage);
    return `
        <section class="a-hero${a.heroImage ? '' : ' plain'}" aria-labelledby="a-title">
            ${a.heroImage ? `<div class="a-hero-bg">${picture(a.heroImage, { sizes: '100vw', alt: '', eager: true })}</div>` : ''}
            <div class="wrap">
                ${a.eyebrow ? `<span class="eyebrow">${esc(a.eyebrow)}</span>` : ''}
                <h1 class="display" id="a-title">${esc(a.title)}</h1>
                ${a.intro ? `<p>${esc(a.intro)}</p>` : ''}
            </div>
        </section>
        ${sections ? `<div class="wrap a-sections">${sections}</div>` : ''}
        ${seasons.length ? `<section class="a-seasons" aria-labelledby="a-seasons-title">
            <div class="wrap">
                <h2 class="display" id="a-seasons-title">${esc(a.seasonsTitle || 'A year at the hives')}</h2>
                <ol>${seasons.map(s => `<li><h3>${esc(s.name)}</h3><p>${esc(s.text)}</p></li>`).join('')}</ol>
            </div>
        </section>` : ''}
        ${a.keeper || keeperImg ? `<section class="a-keeper" aria-labelledby="a-keeper-title">
            <div class="wrap${keeperImg ? '' : ' text-only'}">
                ${figure(keeperImg, a.keeperImageAlt)}
                <div>
                    <h2 class="display" id="a-keeper-title">${esc(a.keeperTitle || 'The beekeeper')}</h2>
                    <div class="prose">${upgradeImages(a.keeper || '')}</div>
                </div>
            </div>
        </section>` : ''}`;
}

export function journalMain(posts) {
    const [first, ...rest] = published(posts);
    return `
        <div class="wrap page-head">
            <span class="eyebrow">Journal</span>
            <h1 class="display">Notes from the hives.</h1>
        </div>
        <div class="wrap j-list">
            ${first ? `<div class="j-feature">${card(first, 'feature', 'h2')}</div>
            <div class="post-grid">${rest.map(p => card(p, '', 'h2')).join('')}</div>`
            : `<p class="j-empty">No posts yet. In the meantime, the hives are on <a href="https://www.instagram.com/bogabee_apiaries/" target="_blank" rel="noopener">Instagram</a>.</p>`}
        </div>`;
}

export function postMain(p, posts) {
    const list = published(posts), i = list.findIndex(x => x.slug === p.slug);
    const newer = i > 0 ? list[i - 1] : null, older = i >= 0 && i < list.length - 1 ? list[i + 1] : null;
    return `
        <article class="post">
            <header class="post-head">
                ${timeTag(p.date)}
                <h1 class="display">${esc(p.title)}</h1>
                ${p.excerpt ? `<p class="lede">${esc(p.excerpt)}</p>` : ''}
            </header>
            ${p.cover ? `<figure class="post-hero">${picture(p.cover, { sizes: '(max-width: 1120px) 100vw, 1080px', eager: true, alt: p.coverAlt || undefined })}</figure>` : ''}
            <div class="post-body prose">${upgradeImages(p.body || '')}</div>
            ${older || newer ? `<nav class="post-nav" aria-label="More posts">
                ${older ? `<a class="prev" href="${postPath(older)}"><small>Older</small><b>${esc(older.title)}</b></a>` : ''}
                ${newer ? `<a class="next" href="${postPath(newer)}"><small>Newer</small><b>${esc(newer.title)}</b></a>` : ''}
            </nav>` : ''}
            <div class="post-head"><a class="back" href="/journal/">All posts</a></div>
        </article>`;
}
