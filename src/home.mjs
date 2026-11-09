// The homepage's <main>. The journal strip shows the three newest published posts.
import { card, published, picture } from './content.mjs';
import { DM, ICON } from './layout.mjs';

const PRODUCTS = [
    { name: 'Small', size: '8 oz jar', price: 9, photo: 'product8oz' },
    { name: 'Signature', size: '16 oz jar', price: 16, photo: 'product16oz', featured: true },
    { name: 'Tasting Jar', size: 'Mini, with dipper', price: 5, photo: 'product_stocking_stuffer' },
];

const GALLERY = [
    { photo: 'honey_overflow', href: 'https://www.instagram.com/p/DSD64yTAeD2/' },
    { photo: 'hello_honey_bee', href: 'https://www.instagram.com/p/Cy7OtE0tx2g/' },
    { photo: 'sunflower', href: 'https://www.instagram.com/p/CxQyb3FLfER/?img_index=1' },
];

const PILLARS = [
    ['Never Filtered', 'Natural pollen &amp; enzymes', '<path d="M12 3.5c2.8 3.6 6 7.3 6 10.8a6 6 0 0 1-12 0c0-3.5 3.2-7.2 6-10.8z"/><path d="M9.2 15.2a3 3 0 0 0 2.6 2.4"/>'],
    ['100% New Jersey', 'Local Jersey wildflowers', '<circle cx="12" cy="12" r="2.6"/>' + [0, 72, 144, 216, 288].map(r => `<g transform="rotate(${r} 12 12)"><path d="M12 9.3c-1.7-2.1-1.7-4.5 0-6.3 1.7 1.8 1.7 4.2 0 6.3z"/></g>`).join('')],
    ['Small Batch', 'Hand-poured &amp; bottled', '<rect x="8" y="3" width="8" height="3" rx="1"/><path d="M7.5 6h9A1.5 1.5 0 0 1 18 7.5V19a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7.5A1.5 1.5 0 0 1 7.5 6z"/><path d="M9 12.5h6M9 15.5h4"/>'],
];

// The 3:4 photo covers its box, so it's drawn at least 3/4 as wide as the box is tall. On wide
// screens the box is half the width and the hero's height (up to 980px), so it's 75vh on
// screens narrower than 3:2. On phones it's the full width and 62% of the height, so it's 46.5vh
// on screens narrower than 93:200. Plain lengths, since older Safari drops sizes with max().
const HERO_SIZES = '(min-width: 900px) and (min-aspect-ratio: 3/2) 50vw, (min-width: 900px) 75vh, (max-aspect-ratio: 93/200) 46.5vh, 100vw';

export const homeHead = `<link rel="preload" as="image" href="/assets/img/market.webp" imagesrcset="/assets/img/market-1000.webp 1000w, /assets/img/market.webp 1500w" imagesizes="${HERO_SIZES}" fetchpriority="high">
    <link rel="stylesheet" href="/assets/css/home.css">
    <script type="application/ld+json">
    {
        "@context": "https://schema.org",
        "@graph": [
            { "@type": "LocalBusiness", "@id": "https://bogabeeapiaries.com/#business", "name": "Bogabee Apiaries", "url": "https://bogabeeapiaries.com/",
              "image": "https://bogabeeapiaries.com/assets/logo.png",
              "address": { "@type": "PostalAddress", "addressLocality": "Manalapan", "addressRegion": "NJ", "addressCountry": "US" },
              "sameAs": ["https://www.instagram.com/bogabee_apiaries/"] },
${PRODUCTS.map(p => `            { "@type": "Product", "name": "${p.name} wildflower honey, ${p.size}", "brand": { "@id": "https://bogabeeapiaries.com/#business" },
              "offers": { "@type": "Offer", "price": "${p.price}.00", "priceCurrency": "USD", "availability": "https://schema.org/InStock" } }`).join(',\n')}
        ]
    }
    </script>`;

export function homeMain(posts) {
    const latest = published(posts).slice(0, 3);
    return `    <main>
    <section class="hero" aria-labelledby="title">
        <div class="hero-bg">${picture('market', { sizes: HERO_SIZES, eager: true })}</div>
        <div class="hero-inner">
            <img class="hero-logo" src="/assets/img/logo-303.webp" width="260" height="260" alt="Bogabee Apiaries">
            <h1 class="display" id="title">The <em>Gold</em> Standard Honey</h1>
            <p>Experience the raw, unfiltered essence of our local seasons. Small-batch honey, harvested with heart.</p>
            <div class="ctas">
                <a class="btn btn-lg" href="#order">Shop the jars</a>
                <a class="btn btn-lg btn-ghost" href="/apiary/">Meet the bees</a>
            </div>
        </div>
    </section>

    <section class="trust" aria-labelledby="why-title">
        <div class="wrap">
            <h2 class="visually-hidden" id="why-title">Why Bogabee</h2>
            <div class="pillars">
                ${PILLARS.map(([h, p, icon]) => `<div class="pillar"><span class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true">${icon}</svg></span><h3>${h}</h3><p>${p}</p></div>`).join('\n                ')}
            </div>
        </div>
    </section>

    <section class="apiary" id="apiary">
        <div class="wrap reveal">
            <div class="section-head">
                <span class="eyebrow">The Apiary</span>
                <h2 class="display">Artisan Beekeeping.</h2>
            </div>
            <div class="gallery">
                ${GALLERY.map(g => `<a class="photo" href="${g.href}" target="_blank" rel="noopener">${picture(g.photo, { sizes: '(max-width: 720px) 33vw, 400px' })}<span class="ig">${ICON.instagram}View on Instagram</span></a>`).join('\n                ')}
            </div>
            <div class="more-link"><a class="btn btn-line" href="/apiary/">More about the apiary</a></div>
        </div>
    </section>
${latest.length ? `
    <section class="journal" id="journal" aria-labelledby="journal-title">
        <div class="wrap">
            <div class="section-head">
                <span class="eyebrow">Journal</span>
                <h2 class="display" id="journal-title">From the hives.</h2>
            </div>
            <div class="post-grid">${latest.map(p => card(p)).join('')}</div>
            <div class="more-link"><a class="btn btn-line" href="/journal/">All posts</a></div>
        </div>
    </section>
` : ''}
    <section class="shop" id="order" aria-labelledby="shop-title">
        <div class="wrap">
            <div class="section-head">
                <span class="eyebrow">This harvest</span>
                <h2 class="display" id="shop-title">Pick your jar.</h2>
            </div>
            <div class="products">
                ${PRODUCTS.map(p => `<article class="product${p.featured ? ' featured' : ''}">
                    ${p.featured ? '<span class="badge">Most Popular</span>' : ''}
                    <div class="shot">${picture(p.photo, { sizes: '(max-width: 720px) 50vw, 400px' })}</div>
                    <div class="meta"><h3>${p.name}<span class="size">${p.size}</span></h3><span class="price">$${p.price}</span></div>
                </article>`).join('\n                ')}
            </div>
            <div class="order-cta">
                <a class="btn btn-dark btn-lg" href="${DM}" target="_blank" rel="noopener">${ICON.instagram}DM to Order</a>
            </div>
        </div>
    </section>

    <section class="favors-band" aria-labelledby="favors-title">
        <div class="wrap">
            ${picture('product_stocking_stuffer', { sizes: '(max-width: 760px) 100vw, 480px', alt: 'Mini honey jar with a wooden dipper' })}
            <div>
                <span class="eyebrow">Party favors</span>
                <h2 class="display" id="favors-title">Honey for weddings and showers.</h2>
                <p>Mini jars with dippers, ribbons and custom labels. Send us your date and how many guests.</p>
                <a class="btn btn-lg" href="${DM}" target="_blank" rel="noopener">Ask about favors</a>
            </div>
        </div>
    </section>
    </main>`;
}
