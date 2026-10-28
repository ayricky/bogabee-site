// Demo data layer shared by every Bogabee demo page. Everything lives in localStorage so a
// customer page and the owner hub open in two tabs of the same browser stay in sync.
// In production this is D1 behind Cloudflare Pages Functions (see /demos/ideas/).
(function () {
    const KEYS = {
        cart: 'bogabee-demo-cart',
        orders: 'bogabee-demo-orders',
        events: 'bogabee-demo-events',
        signins: 'bogabee-demo-signins',
        quotes: 'bogabee-demo-quotes',
        cabinet: 'bogabee-demo-cabinet',
        posts: 'bogabee-demo-posts',
        pages: 'bogabee-demo-pages',
    };

    // Prices in cents. Stock is what's left of this harvest.
    const PRODUCTS = [
        { id: 'signature-16', name: 'Signature', size: '16 oz jar', price: 1600, img: 'product16oz.jpg', stock: 18, featured: true },
        { id: 'small-8', name: 'Small', size: '8 oz jar', price: 900, img: 'product8oz.jpg', stock: 24 },
        { id: 'tasting', name: 'Tasting Jar', size: 'Mini, with dipper', price: 500, img: 'product_stocking_stuffer.jpg', stock: 40 },
    ];

    // How a paid order reaches the customer.
    const FULFILLMENT = {
        porch: { label: 'Porch pickup', detail: 'Manalapan Township · a code opens the cabinet', fee: 0 },
        local: { label: 'Local delivery', detail: 'Near Manalapan · delivered Saturdays', fee: 500 },
        ship: { label: 'Shipping', detail: 'USPS Priority · 2–3 days', fee: 895 },
    };

    // Towns we deliver to (placeholder until Danny sets the real area; see /demos/ideas/).
    const DELIVERY_ZIPS = {
        '07726': 'Manalapan / Englishtown', '07728': 'Freehold', '07746': 'Marlboro', '07751': 'Morganville',
        '08510': 'Millstone', '08535': 'Perrineville', '08831': 'Monroe Township', '07722': 'Colts Neck', '07763': 'Tennent',
    };

    // Honey is food, which New Jersey doesn't tax. Add-ons like charms may be taxable: see /demos/ideas/.
    const TAX_RATE = 0;

    const read = (k, fallback) => {
        try { const v = JSON.parse(localStorage.getItem(k)); return v ?? fallback; } catch { return fallback; }
    };
    const write = (k, v) => {
        localStorage.setItem(k, JSON.stringify(v));
        window.dispatchEvent(new CustomEvent('bogabee:change', { detail: { key: k } }));
    };

    const money = cents => {
        const v = cents / 100;
        const digits = Number.isInteger(v) ? 0 : 2;
        return '$' + v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
    };

    const product = id => PRODUCTS.find(p => p.id === id);

    const cart = {
        items: () => read(KEYS.cart, []),
        count: () => cart.items().reduce((n, i) => n + i.qty, 0),
        subtotal: () => cart.items().reduce((s, i) => s + product(i.id).price * i.qty, 0),
        // Never more than what's left of the harvest (checkout checks again before paying).
        max: id => (window.Bogabee.shop ? window.Bogabee.shop.available(id) : product(id).stock),
        set(id, qty) {
            const items = cart.items().filter(i => i.id !== id);
            const max = cart.max(id);
            if (qty > 0) items.push({ id, qty: Math.min(qty, max) });
            items.sort((a, b) => PRODUCTS.findIndex(p => p.id === a.id) - PRODUCTS.findIndex(p => p.id === b.id));
            write(KEYS.cart, items);
        },
        add(id, qty = 1) {
            const cur = cart.items().find(i => i.id === id);
            cart.set(id, (cur ? cur.qty : 0) + qty);
        },
        clear: () => write(KEYS.cart, []),
    };

    // A pickup code is six digits, valid for the window the customer chose.
    const pickupCode = () => String(Math.floor(100000 + Math.random() * 900000));
    const orderNumber = () => 'BG-' + Math.random().toString(36).slice(2, 6).toUpperCase();

    const orders = {
        all: () => read(KEYS.orders, []),
        get: id => orders.all().find(o => o.id === id),
        create(order) {
            const o = { id: orderNumber(), createdAt: Date.now(), status: 'paid', ...order };
            if (o.fulfillment === 'porch') o.pickup = { code: pickupCode(), opened: [], pickedUpAt: null, ...o.pickup };
            write(KEYS.orders, [o, ...orders.all()]);
            return o;
        },
        update(id, patch) {
            write(KEYS.orders, orders.all().map(o => (o.id === id ? { ...o, ...patch } : o)));
        },
    };

    const events = {
        all: () => read(KEYS.events, null) ?? seedEvents(),
        get: id => events.all().find(e => e.id === id),
        save: list => write(KEYS.events, list),
    };
    const signins = {
        all: () => read(KEYS.signins, null) ?? seedSignins(),
        forEvent: id => signins.all().filter(s => s.eventId === id),
        add(s) {
            const entry = { id: crypto.randomUUID(), at: Date.now(), ...s };
            write(KEYS.signins, [entry, ...signins.all()]);
            return entry;
        },
    };
    const quotes = {
        all: () => read(KEYS.quotes, []),
        add(q) {
            const entry = { id: 'Q-' + Math.random().toString(36).slice(2, 6).toUpperCase(), at: Date.now(), status: 'new', ...q };
            write(KEYS.quotes, [entry, ...quotes.all()]);
            return entry;
        },
        update(id, patch) { write(KEYS.quotes, quotes.all().map(q => (q.id === id ? { ...q, ...patch } : q))); },
    };

    // ---------- Journal posts and editable pages ----------
    // Post and page bodies are HTML from the hub's editor, cleaned to this short list of tags before
    // they're stored or shown. Production does the same cleaning on the server.
    const ALLOWED = { P: [], H2: [], H3: [], STRONG: [], EM: [], B: [], I: [], A: ['href'], UL: [], OL: [], LI: [], BLOCKQUOTE: [], BR: [], FIGURE: [], FIGCAPTION: [], IMG: ['src', 'alt'] };
    function sanitize(html) {
        const doc = new DOMParser().parseFromString(`<div>${html || ''}</div>`, 'text/html');
        (function clean(node) {
            [...node.childNodes].forEach(n => {
                if (n.nodeType === 3) return;
                if (n.nodeType !== 1) { n.remove(); return; }
                if (!ALLOWED[n.tagName]) {
                    // Unknown wrappers (div, span) keep their text; scripts and styles go entirely.
                    if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT'].includes(n.tagName)) { n.remove(); return; }
                    clean(n);
                    n.replaceWith(...n.childNodes);
                    return;
                }
                [...n.attributes].forEach(a => { if (!ALLOWED[n.tagName].includes(a.name)) n.removeAttribute(a.name); });
                const url = n.getAttribute('href') || n.getAttribute('src');
                if (url && !/^(https?:|mailto:|\/|\.|data:image\/)|^[\w-]+\.(jpe?g|png|webp|gif)$/i.test(url.trim())) n.removeAttribute(n.tagName === 'A' ? 'href' : 'src');
                if (n.tagName === 'IMG' && !n.getAttribute('src')) { n.remove(); return; }
                if (n.tagName === 'A') { n.setAttribute('rel', 'noopener'); if (/^https?:/i.test(n.getAttribute('href') || '')) n.setAttribute('target', '_blank'); }
                clean(n);
            });
        })(doc.body.firstChild);
        return doc.body.firstChild.innerHTML;
    }
    // Cleaned HTML with site photos (stored by file name) pointed at the real files.
    function render(html) {
        const box = document.createElement('div');
        box.innerHTML = sanitize(html);
        box.querySelectorAll('img').forEach(img => { img.src = window.Bogabee.image(img.getAttribute('src')); img.loading = 'lazy'; });
        return box.innerHTML;
    }
    const slugify = t => (t || 'post').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 60) || 'post';

    const posts = {
        all: () => (read(KEYS.posts, null) ?? seedPosts()).sort((a, b) => (b.date || b.updated) - (a.date || a.updated)),
        published: () => posts.all().filter(p => p.status === 'published'),
        // Old addresses of renamed posts still find them (post pages then redirect to the new one).
        get: slug => posts.all().find(p => p.slug === slug) || posts.all().find(p => (p.aliases || []).includes(slug)),
        byId: id => posts.all().find(p => p.id === id),
        save(post) {
            const list = posts.all();
            const clean = { ...post, body: sanitize(post.body), updated: Date.now() };
            // Slugs stay unique so every post has its own address.
            let base = slugify(clean.slug || clean.title), slug = base, n = 2;
            while (list.some(p => p.slug === slug && p.id !== clean.id)) slug = `${base}-${n++}`;
            // A published post that changes address keeps its old one as an alias, so shared links still work.
            const before = list.find(p => p.id === clean.id);
            if (before && before.slug !== slug && before.status === 'published') clean.aliases = [...new Set([...(before.aliases || []), before.slug])];
            clean.slug = slug;
            if (clean.status === 'published' && !clean.date) clean.date = Date.now();
            const i = list.findIndex(p => p.id === clean.id);
            if (i >= 0) list[i] = clean; else list.push({ ...clean, id: crypto.randomUUID(), created: Date.now() });
            write(KEYS.posts, list);
            return list.find(p => p.slug === slug);
        },
        remove(id) { write(KEYS.posts, posts.all().filter(p => p.id !== id)); },
    };

    const pages = {
        get: key => (read(KEYS.pages, null) ?? {})[key] ?? SEED_PAGES[key],
        save(key, data) { write(KEYS.pages, { ...(read(KEYS.pages, null) ?? {}), [key]: { ...data, updated: Date.now() } }); },
        reset(key) { const all = read(KEYS.pages, null) ?? {}; delete all[key]; write(KEYS.pages, all); },
    };

    // Starting copy drawn from the current site and the jar labels. Danny edits it in the hub.
    const SEED_PAGES = {
        apiary: {
            eyebrow: 'The Apiary',
            title: 'Where the honey comes from.',
            intro: 'Our hives sit in Manalapan Township, New Jersey. The bees forage the wildflowers around them, and everything in a Bogabee jar comes from those hives.',
            heroImage: 'danny.jpg',
            sections: [
                { heading: 'The bees', image: 'hello_honey_bee.jpg', body: '<p>Honey bees do almost all the work here. Each colony raises its own young, builds its own wax comb, and stores more honey than it needs for winter. The extra is what goes in the jar.</p>' },
                { heading: 'What they forage', image: 'sunflower.jpg', body: '<p>A honey bee can fly a few miles from the hive for nectar. Ours visit the wildflowers, gardens and fields around Manalapan, which is why the honey is called wildflower: its color and taste follow whatever is in bloom.</p>' },
                { heading: 'How it gets to the jar', image: 'honey_overflow.jpg', body: '<p>We take frames the bees have finished and capped with wax, spin the honey out, and pour it into jars by hand in small batches. It is never filtered, so the natural pollen and enzymes stay in.</p>' },
            ],
            seasonsTitle: 'A year at the hives',
            seasons: [
                { name: 'Spring', text: 'Colonies grow fast as the first blooms open.' },
                { name: 'Summer', text: 'The main nectar flow. Honey supers go on and fill up.' },
                { name: 'Late summer', text: 'Harvest. Capped frames come off and get jarred.' },
                { name: 'Winter', text: 'The bees cluster to stay warm and live on the honey they kept.' },
            ],
            keeperTitle: 'The beekeeper',
            keeper: '<p>Danny keeps the Bogabee hives. Follow along on <a href="https://www.instagram.com/bogabee_apiaries/">Instagram</a> for the hives, the harvests and the occasional sunflower.</p>',
            keeperImage: 'danny.jpg',
        },
    };

    function seedPosts() {
        const day = 86400000, now = Date.now();
        const list = [
            {
                id: 'seed-unfiltered', slug: 'why-we-dont-filter-our-honey', status: 'published', date: now - 4 * day, cover: 'honey_overflow.jpg',
                title: "Why we don't filter our honey",
                excerpt: 'Raw honey keeps the pollen and enzymes that filtering takes out.',
                body: '<p>Most honey on store shelves has been filtered to make it clear and keep it from crystallizing. Filtering also strips out the pollen and enzymes that come with it from the hive.</p><p>We skip that step. Every Bogabee jar is raw: spun out of the comb and poured by hand, with the natural pollen and enzymes still in it.</p><h2>If it crystallizes</h2><p>Raw honey can thicken and turn grainy over time. That is natural, not spoilage. Set the jar in warm water and stir, and it turns smooth again.</p>',
            },
            {
                id: 'seed-sunflowers', slug: 'sunflower-shift', status: 'published', date: now - 19 * day, cover: 'sunflower.jpg',
                title: 'Sunflower shift',
                excerpt: 'Three of ours, hard at work on one flower head.',
                body: '<p>Sunflowers are a favorite stop. One flower head is made of hundreds of tiny florets, each with its own nectar and pollen, so a single bloom can keep several bees busy at once.</p><figure><img src="sunflower.jpg" alt="Honey bees foraging on a sunflower"><figcaption>Three foragers on one sunflower.</figcaption></figure>',
            },
            {
                id: 'seed-hello', slug: 'hello-honey', status: 'draft', date: null, cover: 'hello_honey_bee.jpg',
                title: 'Hello, honey',
                excerpt: 'A visitor at the wax.',
                body: '<p>Caught mid-wave on a piece of comb.</p>',
            },
        ];
        localStorage.setItem(KEYS.posts, JSON.stringify(list));
        return list;
    }

    // ---------- Sample data so the owner hub isn't empty on first open ----------
    function dayOffset(days, hour = 10) {
        const d = new Date();
        d.setDate(d.getDate() + days);
        d.setHours(hour, 0, 0, 0);
        return d.getTime();
    }
    function seedEvents() {
        const list = [
            { id: 'manalapan-fall-market', name: 'Manalapan Fall Market', place: 'Manalapan, NJ', start: dayOffset(4, 10), end: dayOffset(4, 15) },
            { id: 'holiday-craft-fair', name: 'Holiday Craft Fair', place: 'Freehold, NJ', start: dayOffset(25, 11), end: dayOffset(25, 16) },
            { id: 'harvest-open-house', name: 'Harvest Open House', place: 'Manalapan, NJ', start: dayOffset(-12, 12), end: dayOffset(-12, 16) },
            { id: 'englishtown-farmers-market', name: 'Englishtown Farmers Market', place: 'Englishtown, NJ', start: dayOffset(-33, 9), end: dayOffset(-33, 13) },
        ];
        localStorage.setItem(KEYS.events, JSON.stringify(list));
        return list;
    }
    function seedSignins() {
        const first = ['Maria', 'James', 'Priya', 'Tom', 'Aisha', 'Kevin', 'Lena', 'Marcus', 'Grace', 'Dev', 'Nora', 'Sam', 'Olivia', 'Raj', 'Hannah', 'Luis', 'Chloe', 'Ben', 'Ivy', 'Omar'];
        const last = ['Lopez', 'Kim', 'Shah', 'Russo', 'Bello', 'Walsh', 'Novak', 'Reed', 'Park', 'Patel', 'Byrne', 'Cohen', 'Diaz', 'Mehta', 'Fox', 'Ortiz', 'Gray', 'Stein', 'Chen', 'Haddad'];
        const interests = [['Honey'], ['Honey', 'Party favors'], ['Bee talks'], ['Honey'], ['Party favors'], ['Honey', 'Bee talks']];
        const out = [];
        const add = (eventId, n, base) => {
            for (let i = 0; i < n; i++) {
                const f = first[(i * 7 + n) % first.length], l = last[(i * 3 + n) % last.length];
                out.push({
                    id: `${eventId}-${i}`,
                    eventId,
                    first: f,
                    last: l,
                    email: i % 4 === 3 ? '' : `${f}.${l}@example.com`.toLowerCase(),
                    phone: i % 3 === 0 ? `(732) 555-01${String(10 + i).padStart(2, '0')}` : '',
                    interests: interests[i % interests.length],
                    news: i % 2 === 0,
                    returning: i % 5 === 0,
                    at: base + i * 9 * 60 * 1000,
                });
            }
        };
        add('harvest-open-house', 23, dayOffset(-12, 12));
        add('englishtown-farmers-market', 31, dayOffset(-33, 9));
        localStorage.setItem(KEYS.signins, JSON.stringify(out));
        return out;
    }

    // Re-render when another tab changes the data.
    window.addEventListener('storage', e => {
        if (Object.values(KEYS).includes(e.key)) window.dispatchEvent(new CustomEvent('bogabee:change', { detail: { key: e.key } }));
    });

    window.Bogabee = Object.assign(window.Bogabee || {}, {
        KEYS, PRODUCTS, FULFILLMENT, DELIVERY_ZIPS, TAX_RATE, money, product, cart, orders, events, signins, quotes, posts, pages, sanitize, render, slugify,
        asset: name => new URL('../assets/' + name, document.querySelector('script[src$="store.js"]').src).href,
        // Images stored with content are either a site photo's file name or an uploaded data: URL.
        image: src => (!src ? '' : /^(data:|https?:|\/)/.test(src) ? src : new URL('../assets/' + src, document.querySelector('script[src$="store.js"]').src).href),
        // Resized WebP copies of the site photos in demos/assets/img: photo('product16oz.jpg', 640).
        photo: (name, w) => new URL('assets/img/' + name.replace(/\.\w+$/, '') + (w ? '-' + w : '') + '.webp', document.querySelector('script[src$="store.js"]').src).href,
        PHOTOS: ['danny.jpg', 'hello_honey_bee.jpg', 'sunflower.jpg', 'honey_overflow.jpg', 'product16oz.jpg', 'product8oz.jpg', 'product_stocking_stuffer.jpg'],
        reset() { Object.values(KEYS).forEach(k => localStorage.removeItem(k)); location.reload(); },
    });
})();
